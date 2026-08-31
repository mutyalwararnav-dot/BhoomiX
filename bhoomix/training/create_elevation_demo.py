from __future__ import annotations

from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin


def write(path: Path, data: np.ndarray, nodata: float | int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=data.shape[-1],
        height=data.shape[-2],
        count=data.shape[0],
        dtype=data.dtype,
        crs="EPSG:32643",
        transform=from_origin(392_000, 2_050_000, 0.5, 0.5),
        nodata=nodata,
        compress="deflate",
    ) as target:
        target.write(data)


def main() -> None:
    output = Path("training/demo-elevation")
    height = width = 256
    yy, xx = np.mgrid[:height, :width]
    terrain = (545 + xx * 0.015 + yy * 0.01).astype(np.float32)
    surface = terrain.copy()
    ori = np.zeros((3, height, width), dtype=np.uint8)
    ori[:] = np.array([62, 92, 58], dtype=np.uint8)[:, None, None]

    buildings = [(25, 30, 85, 95, 8), (110, 24, 190, 82, 14), (45, 135, 120, 220, 11), (155, 125, 232, 205, 18)]
    colors = [(205, 199, 185), (185, 170, 150), (220, 215, 200), (180, 190, 205)]
    for (left, top, right, bottom, elevation), color in zip(buildings, colors, strict=True):
        surface[top:bottom, left:right] += elevation
        ori[:, top:bottom, left:right] = np.array(color, dtype=np.uint8)[:, None, None]

    write(output / "demo_ORI.tif", ori, 0)
    write(output / "demo_DSM.tif", surface[None, ...], -9999.0)
    write(output / "demo_DTM.tif", terrain[None, ...], -9999.0)
    print(f"Created presentation-safe GeoTIFF triplet in {output.resolve()}")


if __name__ == "__main__":
    main()
