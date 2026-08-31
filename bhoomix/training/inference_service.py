from __future__ import annotations

import io
import os
from pathlib import Path

import cv2
import numpy as np
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from torchvision.transforms import functional as TF

from training.rooftop_baseline import IMAGE_SIZE, load_checkpoint
from training.elevation_pipeline import ElevationValidationError, process_elevation_bundle


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CHECKPOINT_PATH = Path(
    os.getenv("ROOFTOP_MODEL_PATH", PROJECT_ROOT / "training/runs/rooftop-baseline/best.pt")
).resolve()
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_ELEVATION_BYTES = 100 * 1024 * 1024
THRESHOLD = float(os.getenv("ROOFTOP_MODEL_THRESHOLD", "0.50"))
MIN_AREA = int(os.getenv("ROOFTOP_MODEL_MIN_AREA", "300"))
# Training resized complete 1024x1024 source scenes to IMAGE_SIZE (512).
# Keep that scene scale at inference time instead of feeding 2x-zoomed 512px crops.
TILE_SIZE = int(os.getenv("ROOFTOP_MODEL_TILE_SIZE", "1024"))
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/tiff"}

if not CHECKPOINT_PATH.is_file():
    raise RuntimeError(f"Rooftop checkpoint was not found: {CHECKPOINT_PATH}")
if not torch.cuda.is_available():
    raise RuntimeError("CUDA is unavailable. The BhoomiX rooftop service requires the configured NVIDIA GPU.")

DEVICE = torch.device("cuda")
MODEL = load_checkpoint(CHECKPOINT_PATH, DEVICE)
MODEL_LOCK = torch.cuda.Stream()

app = FastAPI(title="BhoomiX Rooftop Inference", version="0.1.0")


def tile_starts(length: int, tile_size: int) -> list[int]:
    if length <= tile_size:
        return [0]
    stride = tile_size // 2
    return sorted(set([*range(0, length - tile_size + 1, stride), length - tile_size]))


@torch.inference_mode()
def predict_polygons(image: Image.Image) -> list[dict]:
    width, height = image.size
    tile_size = min(TILE_SIZE, max(width, height))
    probability_sum = np.zeros((height, width), dtype=np.float32)
    probability_count = np.zeros((height, width), dtype=np.float32)

    with torch.cuda.stream(MODEL_LOCK):
        for y in tile_starts(height, tile_size):
            for x in tile_starts(width, tile_size):
                crop = image.crop((x, y, min(x + tile_size, width), min(y + tile_size, height)))
                crop_width, crop_height = crop.size
                resized = TF.resize(crop, [IMAGE_SIZE, IMAGE_SIZE], interpolation=TF.InterpolationMode.BILINEAR)
                tensor = TF.pil_to_tensor(resized).float().div_(255.0).unsqueeze(0).to(DEVICE)
                probability = torch.sigmoid(MODEL(tensor))[0, 0].float().cpu().numpy()
                probability = np.asarray(
                    Image.fromarray(probability, mode="F").resize(
                        (crop_width, crop_height), Image.Resampling.BILINEAR
                    )
                )
                probability_sum[y:y + crop_height, x:x + crop_width] += probability
                probability_count[y:y + crop_height, x:x + crop_width] += 1
        MODEL_LOCK.synchronize()

    probability = probability_sum / np.maximum(probability_count, 1)
    binary = (probability >= THRESHOLD).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    polygons: list[dict] = []
    ranked_contours = sorted(contours, key=cv2.contourArea, reverse=True)
    for contour in ranked_contours:
        area = float(cv2.contourArea(contour))
        if area < MIN_AREA:
            continue
        perimeter = cv2.arcLength(contour, True)
        points = cv2.approxPolyDP(contour, max(2.0, perimeter * 0.008), True).reshape(-1, 2)
        if len(points) < 3:
            continue
        region_mask = np.zeros((height, width), dtype=np.uint8)
        cv2.drawContours(region_mask, [contour], -1, 255, thickness=-1)
        confidence = float(cv2.mean(probability, mask=region_mask)[0])
        polygons.append({
            "id": f"ROOFTOP-{len(polygons) + 1:04d}",
            "coordinate_space": "normalized",
            "points": [[round(int(px) / width, 6), round(int(py) / height, 6)] for px, py in points],
            "confidence_score": round(confidence, 4),
        })
    return polygons


@app.get("/health")
def health() -> dict:
    return {
        "status": "healthy",
        "task": "rooftop_segmentation",
        "device": torch.cuda.get_device_name(0),
        "checkpoint": CHECKPOINT_PATH.name,
        "threshold": THRESHOLD,
        "tile_size": TILE_SIZE,
        "capabilities": ["rgb_rooftop_inference", "ori_dsm_dtm_validation", "ndsm_generation"],
    }


@app.post("/predict")
async def predict(file: UploadFile = File(...)) -> dict:
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail="Upload a JPG, PNG, or TIFF image.")
    data = await file.read(MAX_IMAGE_BYTES + 1)
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image must be between 1 byte and 25 MB.")
    try:
        with Image.open(io.BytesIO(data)) as source:
            source.verify()
        with Image.open(io.BytesIO(data)) as source:
            image = source.convert("RGB")
    except Exception as error:
        raise HTTPException(status_code=422, detail="The uploaded image could not be decoded.") from error

    polygons = predict_polygons(image)
    return {
        "image_predictions": polygons,
        "model": "bhoomix-rooftop-unet-v1",
        "task": "rooftop_segmentation",
        "prediction_count": len(polygons),
    }


@app.post("/elevation/process")
async def process_elevation(
    ori: UploadFile = File(...),
    dsm: UploadFile = File(...),
    dtm: UploadFile = File(...),
) -> dict:
    uploads = {"ORI": ori, "DSM": dsm, "DTM": dtm}
    payloads: dict[str, bytes] = {}
    for label, upload in uploads.items():
        if upload.content_type != "image/tiff":
            raise HTTPException(status_code=415, detail=f"{label} must be a GeoTIFF file.")
        data = await upload.read(MAX_ELEVATION_BYTES + 1)
        if not data or len(data) > MAX_ELEVATION_BYTES:
            raise HTTPException(status_code=413, detail=f"{label} must be between 1 byte and 100 MB.")
        payloads[label] = data
    try:
        result = process_elevation_bundle(payloads["ORI"], payloads["DSM"], payloads["DTM"])
    except ElevationValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        **result,
        "pipeline": "bhoomix-ori-dsm-dtm-v1",
        "training_status": "awaiting_paired_training_samples",
    }
