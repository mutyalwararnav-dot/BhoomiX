from __future__ import annotations

import unittest

import numpy as np
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from training.elevation_pipeline import ElevationValidationError, process_elevation_bundle


def raster_bytes(
    data: np.ndarray,
    *,
    bands: int,
    crs: str | None = "EPSG:32643",
    pixel_size: float = 1,
) -> bytes:
    height, width = data.shape[-2:]
    profile = {
        "driver": "GTiff",
        "height": height,
        "width": width,
        "count": bands,
        "dtype": str(data.dtype),
        "crs": crs,
        "transform": from_origin(500_000, 2_050_000, pixel_size, pixel_size),
        "nodata": 0 if data.dtype == np.uint8 else -9999,
    }
    with MemoryFile() as memory:
        with memory.open(**profile) as target:
            target.write(data)
        return memory.read()


class ElevationPipelineTest(unittest.TestCase):
    def test_aligns_layers_and_calculates_ndsm(self) -> None:
        ori = np.full((3, 8, 8), 100, dtype=np.uint8)
        dsm = np.full((1, 4, 4), 112, dtype=np.float32)
        dtm = np.full((1, 8, 8), 100, dtype=np.float32)
        result = process_elevation_bundle(
            raster_bytes(ori, bands=3),
            raster_bytes(dsm, bands=1, pixel_size=2),
            raster_bytes(dtm, bands=1),
        )
        self.assertEqual(result["validation"]["status"], "valid")
        self.assertEqual(result["validation"]["aligned_width"], 8)
        self.assertAlmostEqual(result["ndsm_statistics"]["mean_m"], 12.0)
        self.assertTrue(result["ndsm_geotiff_base64"])
        self.assertTrue(result["ndsm_preview_base64"])

    def test_rejects_missing_crs(self) -> None:
        ori = np.full((3, 8, 8), 100, dtype=np.uint8)
        elevation = np.full((1, 8, 8), 100, dtype=np.float32)
        with self.assertRaisesRegex(ElevationValidationError, "georeferenced"):
            process_elevation_bundle(
                raster_bytes(ori, bands=3, crs=None),
                raster_bytes(elevation, bands=1),
                raster_bytes(elevation, bands=1),
            )


if __name__ == "__main__":
    unittest.main()
