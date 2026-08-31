from __future__ import annotations

import base64
import io
import math
from dataclasses import dataclass

import cv2
import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds


MAX_ALIGNED_EDGE = 2048
MAX_SOURCE_PIXELS = 100_000_000


class ElevationValidationError(ValueError):
    pass


@dataclass(frozen=True)
class RasterSummary:
    width: int
    height: int
    band_count: int
    crs: str
    bounds: tuple[float, float, float, float]
    resolution: tuple[float, float]
    dtype: str
    nodata: float | None

    def as_dict(self) -> dict:
        return {
            "width": self.width,
            "height": self.height,
            "band_count": self.band_count,
            "crs": self.crs,
            "bounds": list(self.bounds),
            "resolution": list(self.resolution),
            "dtype": self.dtype,
            "nodata": self.nodata if self.nodata is None or math.isfinite(self.nodata) else None,
        }


def _summary(dataset: rasterio.io.DatasetReader, label: str) -> RasterSummary:
    if dataset.crs is None or dataset.transform.is_identity:
        raise ElevationValidationError(f"{label} must be a georeferenced GeoTIFF with a CRS and affine transform.")
    if dataset.width <= 0 or dataset.height <= 0 or dataset.width * dataset.height > MAX_SOURCE_PIXELS:
        raise ElevationValidationError(f"{label} raster dimensions are invalid or exceed the 100-million-pixel safety limit.")
    bounds = dataset.bounds
    return RasterSummary(
        width=dataset.width,
        height=dataset.height,
        band_count=dataset.count,
        crs=dataset.crs.to_string(),
        bounds=(bounds.left, bounds.bottom, bounds.right, bounds.top),
        resolution=(abs(dataset.transform.a), abs(dataset.transform.e)),
        dtype=dataset.dtypes[0],
        nodata=dataset.nodata,
    )


def _intersection_bounds(*summaries: RasterSummary) -> tuple[float, float, float, float]:
    left = max(item.bounds[0] for item in summaries)
    bottom = max(item.bounds[1] for item in summaries)
    right = min(item.bounds[2] for item in summaries)
    top = min(item.bounds[3] for item in summaries)
    if left >= right or bottom >= top:
        raise ElevationValidationError("ORI, DSM and DTM do not cover a common geographic area.")
    return left, bottom, right, top


def _aligned_shape(ori: rasterio.io.DatasetReader) -> tuple[int, int]:
    scale = min(1.0, MAX_ALIGNED_EDGE / max(ori.width, ori.height))
    return max(1, round(ori.height * scale)), max(1, round(ori.width * scale))


def _read_aligned_elevation(
    source: rasterio.io.DatasetReader,
    target_crs,
    target_transform,
    target_height: int,
    target_width: int,
) -> np.ndarray:
    destination = np.full((target_height, target_width), np.nan, dtype=np.float32)
    reproject(
        source=rasterio.band(source, 1),
        destination=destination,
        src_transform=source.transform,
        src_crs=source.crs,
        src_nodata=source.nodata,
        dst_transform=target_transform,
        dst_crs=target_crs,
        dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    return destination


def _encode_ndsm_geotiff(ndsm: np.ndarray, valid: np.ndarray, transform, crs) -> bytes:
    profile = {
        "driver": "GTiff",
        "height": ndsm.shape[0],
        "width": ndsm.shape[1],
        "count": 1,
        "dtype": "float32",
        "crs": crs,
        "transform": transform,
        "nodata": -9999.0,
        "compress": "deflate",
        "predictor": 3,
    }
    output = np.where(valid, ndsm, -9999.0).astype(np.float32)
    with MemoryFile() as memory:
        with memory.open(**profile) as target:
            target.write(output, 1)
            target.set_band_description(1, "normalized_surface_height_m")
        return memory.read()


def _encode_preview(ndsm: np.ndarray, valid: np.ndarray) -> bytes:
    valid_values = ndsm[valid]
    upper = float(np.percentile(valid_values, 98)) if valid_values.size else 1.0
    upper = max(upper, 1.0)
    scaled = np.clip(ndsm / upper, 0, 1)
    grayscale = (scaled * 255).astype(np.uint8)
    colored = cv2.applyColorMap(grayscale, cv2.COLORMAP_TURBO)
    colored[~valid] = (20, 20, 20)
    ok, encoded = cv2.imencode(".png", colored)
    if not ok:
        raise RuntimeError("The nDSM preview could not be encoded.")
    return encoded.tobytes()


def process_elevation_bundle(ori_bytes: bytes, dsm_bytes: bytes, dtm_bytes: bytes) -> dict:
    try:
        with MemoryFile(ori_bytes) as ori_memory, MemoryFile(dsm_bytes) as dsm_memory, MemoryFile(dtm_bytes) as dtm_memory:
            with ori_memory.open() as ori, dsm_memory.open() as dsm, dtm_memory.open() as dtm:
                ori_summary = _summary(ori, "ORI")
                dsm_summary = _summary(dsm, "DSM")
                dtm_summary = _summary(dtm, "DTM")
                if ori.count < 3:
                    raise ElevationValidationError("ORI must contain at least three image bands (RGB).")

                common_bounds = _intersection_bounds(ori_summary, dsm_summary, dtm_summary)
                wgs84_bounds = transform_bounds(ori.crs, "EPSG:4326", *ori_summary.bounds, densify_pts=21)
                target_height, target_width = _aligned_shape(ori)
                target_transform = from_bounds(*ori_summary.bounds, target_width, target_height)
                aligned_dsm = _read_aligned_elevation(dsm, ori.crs, target_transform, target_height, target_width)
                aligned_dtm = _read_aligned_elevation(dtm, ori.crs, target_transform, target_height, target_width)
                valid = np.isfinite(aligned_dsm) & np.isfinite(aligned_dtm)
                coverage = float(valid.mean())
                if coverage < 0.5:
                    raise ElevationValidationError(
                        f"Only {coverage:.1%} of the ORI grid has matching DSM and DTM values; at least 50% is required."
                    )

                raw_ndsm = aligned_dsm - aligned_dtm
                ndsm = np.where(valid, np.maximum(raw_ndsm, 0.0), 0.0).astype(np.float32)
                values = ndsm[valid]
                stats = {
                    "minimum_m": round(float(values.min()), 3),
                    "maximum_m": round(float(values.max()), 3),
                    "mean_m": round(float(values.mean()), 3),
                    "p98_m": round(float(np.percentile(values, 98)), 3),
                    "valid_coverage": round(coverage, 6),
                }
                geotiff = _encode_ndsm_geotiff(ndsm, valid, target_transform, ori.crs)
                preview = _encode_preview(ndsm, valid)

                return {
                    "validation": {
                        "status": "valid",
                        "common_bounds": list(common_bounds),
                        "wgs84_bounds": list(wgs84_bounds),
                        "aligned_width": target_width,
                        "aligned_height": target_height,
                        "target_crs": ori.crs.to_string(),
                        "ori": ori_summary.as_dict(),
                        "dsm": dsm_summary.as_dict(),
                        "dtm": dtm_summary.as_dict(),
                    },
                    "ndsm_statistics": stats,
                    "ndsm_geotiff_base64": base64.b64encode(geotiff).decode("ascii"),
                    "ndsm_preview_base64": base64.b64encode(preview).decode("ascii"),
                }
    except ElevationValidationError:
        raise
    except rasterio.errors.RasterioError as error:
        raise ElevationValidationError("All three inputs must be readable GeoTIFF rasters.") from error
