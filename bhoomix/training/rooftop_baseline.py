from __future__ import annotations

import argparse
import json
import math
import random
import re
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import torch
from PIL import Image, ImageDraw
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision.transforms import functional as TF


IMAGE_SIZE = 512
SEED = 7492
SOURCE_ID = re.compile(r"^(sample_\d+)_jpg\.rf\.")
ZANZIBAR_TILE = re.compile(
    r"^grid_\d+(?:_corrected)?_(?P<zoom>\d+)_(?P<x>\d+)_(?P<y>\d+)_img$"
)


def source_id(path: Path) -> str:
    match = SOURCE_ID.match(path.stem)
    return match.group(1) if match else path.stem


def paired_record(image_path: Path) -> dict[str, str]:
    mask_path = image_path.with_name(f"{image_path.stem}_mask.png")
    if not mask_path.exists():
        raise FileNotFoundError(f"Mask missing for {image_path}")
    return {
        "image": str(image_path.resolve()),
        "mask": str(mask_path.resolve()),
        "source_id": source_id(image_path),
    }


def choose_group_subset(groups: list[list[dict[str, str]]], target: int) -> list[list[dict[str, str]]]:
    possible: dict[int, list[int]] = {0: []}
    for index, group in enumerate(groups):
        for current in sorted(list(possible), reverse=True):
            total = current + len(group)
            if total <= target and total not in possible:
                possible[total] = [*possible[current], index]
        if target in possible:
            break
    if target not in possible:
        raise RuntimeError(f"Could not create a group-safe split containing exactly {target} images.")
    return [groups[index] for index in possible[target]]


def prepare_manifest(
    dataset_root: Path,
    output: Path,
    seed: int = SEED,
    development_size: int = 500,
    validation_size: int = 50,
) -> None:
    train_dir = dataset_root / "train"
    test_dir = dataset_root / "test"
    source_test = {source_id(path) for path in test_dir.glob("*.jpg")}

    groups_by_id: dict[str, list[dict[str, str]]] = defaultdict(list)
    excluded_for_test_leakage = 0
    for image_path in sorted(train_dir.glob("*.jpg")):
        record = paired_record(image_path)
        if record["source_id"] in source_test:
            excluded_for_test_leakage += 1
            continue
        groups_by_id[record["source_id"]].append(record)

    groups = list(groups_by_id.values())
    random.Random(seed).shuffle(groups)
    eligible_count = sum(len(group) for group in groups)
    if development_size <= 0 or development_size >= eligible_count:
        development_groups = groups
    else:
        development_groups = choose_group_subset(groups, development_size)
    development_count = sum(len(group) for group in development_groups)
    if validation_size <= 0 or validation_size >= development_count:
        raise ValueError("Validation size must be positive and smaller than the development split.")
    random.Random(seed + 1).shuffle(development_groups)
    validation_groups = choose_group_subset(development_groups, validation_size)
    validation_ids = {record["source_id"] for group in validation_groups for record in group}

    validation = [record for group in validation_groups for record in group]
    training = [
        record
        for group in development_groups
        for record in group
        if record["source_id"] not in validation_ids
    ]
    testing = [paired_record(path) for path in sorted(test_dir.glob("*.jpg"))]

    assert len(training) + len(validation) == development_count
    assert len(validation) == validation_size
    assert len(testing) == 60
    assert not ({row["source_id"] for row in training} & {row["source_id"] for row in validation})
    assert not ({row["source_id"] for row in training + validation} & {row["source_id"] for row in testing})

    payload = {
        "version": 1,
        "seed": seed,
        "dataset_root": str(dataset_root.resolve()),
        "image_size": IMAGE_SIZE,
        "task": "binary_rooftop_semantic_segmentation",
        "excluded_train_images_overlapping_test_sources": excluded_for_test_leakage,
        "eligible_development_images": eligible_count,
        "splits": {"train": training, "validation": validation, "test": testing},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({
        "manifest": str(output.resolve()),
        "train": len(training),
        "validation": len(validation),
        "test": len(testing),
        "excluded_for_test_leakage": excluded_for_test_leakage,
    }, indent=2))


def zanzibar_record(image_path: Path, mask_dir: Path, spatial_block_size: int = 8) -> dict[str, str]:
    match = ZANZIBAR_TILE.match(image_path.stem)
    if not match:
        raise ValueError(f"Unexpected Zanzibar tile name: {image_path.name}")
    mask_stem = image_path.stem.removesuffix("_img") + "_mask_buffered.png"
    mask_path = mask_dir / mask_stem
    if not mask_path.exists():
        raise FileNotFoundError(f"Mask missing for {image_path}")
    x = int(match.group("x"))
    y = int(match.group("y"))
    return {
        "image": str(image_path.resolve()),
        "mask": str(mask_path.resolve()),
        # Adjacent web-map tiles are highly correlated. Grouping 8x8 spatial
        # blocks prevents neighbouring views leaking across data splits.
        "source_id": f"zanzibar-z{match.group('zoom')}-{x // spatial_block_size}-{y // spatial_block_size}",
        "dataset": "zanzibar-building-segmentation",
    }


def prepare_zanzibar_manifest(
    dataset_root: Path,
    output: Path,
    base_manifest_path: Path | None = None,
    seed: int = SEED,
    validation_size: int = 269,
    test_size: int = 269,
) -> None:
    image_dir = dataset_root / "images-512"
    mask_dir = dataset_root / "masks-512"
    if not image_dir.is_dir() or not mask_dir.is_dir():
        raise FileNotFoundError("Expected images-512 and masks-512 inside the Zanzibar dataset root.")

    groups_by_id: dict[str, list[dict[str, str]]] = defaultdict(list)
    for image_path in sorted(image_dir.glob("*.jpg")):
        record = zanzibar_record(image_path, mask_dir)
        groups_by_id[record["source_id"]].append(record)
    if not groups_by_id:
        raise RuntimeError("No Zanzibar image-mask pairs were found.")

    groups = list(groups_by_id.values())
    random.Random(seed).shuffle(groups)
    total = sum(len(group) for group in groups)
    if validation_size <= 0 or test_size <= 0 or validation_size + test_size >= total:
        raise ValueError("Validation and test sizes must be positive and leave training images available.")

    test_groups = choose_group_subset(groups, test_size)
    test_ids = {record["source_id"] for group in test_groups for record in group}
    remaining_groups = [group for group in groups if group[0]["source_id"] not in test_ids]
    validation_groups = choose_group_subset(remaining_groups, validation_size)
    validation_ids = {record["source_id"] for group in validation_groups for record in group}

    testing = [record for group in test_groups for record in group]
    validation = [record for group in validation_groups for record in group]
    zanzibar_training = [
        record
        for group in remaining_groups
        for record in group
        if record["source_id"] not in validation_ids
    ]

    replay_training: list[dict[str, str]] = []
    if base_manifest_path is not None:
        base_manifest = load_manifest(base_manifest_path)
        replay_training = [
            {**record, "dataset": record.get("dataset", "bhoomix-rooftop-baseline")}
            for record in base_manifest["splits"]["train"]
        ]
    training = [*zanzibar_training, *replay_training]

    split_ids = {
        "train": {row["source_id"] for row in zanzibar_training},
        "validation": {row["source_id"] for row in validation},
        "test": {row["source_id"] for row in testing},
    }
    assert not (split_ids["train"] & split_ids["validation"])
    assert not (split_ids["train"] & split_ids["test"])
    assert not (split_ids["validation"] & split_ids["test"])
    assert len(zanzibar_training) + len(validation) + len(testing) == total

    payload = {
        "version": 2,
        "seed": seed,
        "dataset_root": str(dataset_root.resolve()),
        "image_size": IMAGE_SIZE,
        "task": "binary_building_semantic_segmentation",
        "spatial_grouping": "8x8 web-map tile blocks",
        "base_manifest": str(base_manifest_path.resolve()) if base_manifest_path else None,
        "counts": {
            "zanzibar_total": total,
            "zanzibar_train": len(zanzibar_training),
            "replay_train": len(replay_training),
            "combined_train": len(training),
            "validation": len(validation),
            "test": len(testing),
        },
        "splits": {"train": training, "validation": validation, "test": testing},
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(output.resolve()), **payload["counts"]}, indent=2))


class RooftopDataset(Dataset):
    def __init__(self, records: list[dict[str, str]], augment: bool = False) -> None:
        self.records = records
        self.augment = augment

    def __len__(self) -> int:
        return len(self.records)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        record = self.records[index]
        with Image.open(record["image"]) as source:
            image = source.convert("RGB")
        with Image.open(record["mask"]) as source:
            mask_array = np.asarray(source.convert("RGB"), dtype=np.uint8)[..., 0] > 0
        mask = Image.fromarray(mask_array.astype(np.uint8) * 255, mode="L")

        image = TF.resize(image, [IMAGE_SIZE, IMAGE_SIZE], interpolation=TF.InterpolationMode.BILINEAR)
        mask = TF.resize(mask, [IMAGE_SIZE, IMAGE_SIZE], interpolation=TF.InterpolationMode.NEAREST)
        image_tensor = TF.pil_to_tensor(image).float().div_(255.0)
        mask_tensor = (TF.pil_to_tensor(mask).float() > 0).float()

        if self.augment:
            if random.random() < 0.5:
                image_tensor = torch.flip(image_tensor, dims=[2])
                mask_tensor = torch.flip(mask_tensor, dims=[2])
            if random.random() < 0.5:
                image_tensor = torch.flip(image_tensor, dims=[1])
                mask_tensor = torch.flip(mask_tensor, dims=[1])
            turns = random.randrange(4)
            if turns:
                image_tensor = torch.rot90(image_tensor, turns, dims=[1, 2])
                mask_tensor = torch.rot90(mask_tensor, turns, dims=[1, 2])
            if random.random() < 0.7:
                brightness = 0.85 + random.random() * 0.30
                contrast = 0.85 + random.random() * 0.30
                image_tensor = TF.adjust_brightness(image_tensor, brightness)
                image_tensor = TF.adjust_contrast(image_tensor, contrast).clamp_(0, 1)

        return image_tensor, mask_tensor


class DoubleConv(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, 3, padding=1, bias=False),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class Down(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.block = nn.Sequential(nn.MaxPool2d(2), DoubleConv(in_channels, out_channels))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class Up(nn.Module):
    def __init__(self, in_channels: int, skip_channels: int, out_channels: int) -> None:
        super().__init__()
        self.up = nn.ConvTranspose2d(in_channels, out_channels, 2, stride=2)
        self.conv = DoubleConv(out_channels + skip_channels, out_channels)

    def forward(self, x: torch.Tensor, skip: torch.Tensor) -> torch.Tensor:
        x = self.up(x)
        return self.conv(torch.cat([skip, x], dim=1))


class SmallUNet(nn.Module):
    def __init__(self, base: int = 16) -> None:
        super().__init__()
        self.entry = DoubleConv(3, base)
        self.down1 = Down(base, base * 2)
        self.down2 = Down(base * 2, base * 4)
        self.down3 = Down(base * 4, base * 8)
        self.down4 = Down(base * 8, base * 16)
        self.up1 = Up(base * 16, base * 8, base * 8)
        self.up2 = Up(base * 8, base * 4, base * 4)
        self.up3 = Up(base * 4, base * 2, base * 2)
        self.up4 = Up(base * 2, base, base)
        self.output = nn.Conv2d(base, 1, 1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x0 = self.entry(x)
        x1 = self.down1(x0)
        x2 = self.down2(x1)
        x3 = self.down3(x2)
        x4 = self.down4(x3)
        return self.output(self.up4(self.up3(self.up2(self.up1(x4, x3), x2), x1), x0))


def dice_bce_loss(logits: torch.Tensor, target: torch.Tensor, pos_weight: torch.Tensor) -> torch.Tensor:
    bce = nn.functional.binary_cross_entropy_with_logits(logits, target, pos_weight=pos_weight)
    probability = torch.sigmoid(logits)
    intersection = (probability * target).sum(dim=(1, 2, 3))
    denominator = probability.sum(dim=(1, 2, 3)) + target.sum(dim=(1, 2, 3))
    dice_loss = 1 - ((2 * intersection + 1) / (denominator + 1)).mean()
    return 0.5 * bce + 0.5 * dice_loss


def metric_counts(logits: torch.Tensor, target: torch.Tensor, threshold: float = 0.5) -> tuple[int, int, int, int]:
    prediction = torch.sigmoid(logits) >= threshold
    truth = target >= 0.5
    return (
        int((prediction & truth).sum().item()),
        int((prediction & ~truth).sum().item()),
        int((~prediction & truth).sum().item()),
        int((~prediction & ~truth).sum().item()),
    )


def metrics_from_counts(tp: int, fp: int, fn: int, tn: int) -> dict[str, float]:
    epsilon = 1e-8
    return {
        "iou": tp / (tp + fp + fn + epsilon),
        "dice": 2 * tp / (2 * tp + fp + fn + epsilon),
        "precision": tp / (tp + fp + epsilon),
        "recall": tp / (tp + fn + epsilon),
        "pixel_accuracy": (tp + tn) / (tp + fp + fn + tn + epsilon),
    }


@torch.inference_mode()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device, threshold: float = 0.5) -> dict[str, float]:
    model.eval()
    counts = [0, 0, 0, 0]
    for images, masks in loader:
        logits = model(images.to(device, non_blocking=True))
        batch_counts = metric_counts(logits, masks.to(device, non_blocking=True), threshold)
        counts = [left + right for left, right in zip(counts, batch_counts)]
    return metrics_from_counts(*counts)


@torch.inference_mode()
def tune_thresholds(
    model: nn.Module,
    records: list[dict[str, str]],
    device: torch.device,
    batch_size: int,
    thresholds: list[float],
) -> dict[str, dict[str, float]]:
    model.eval()
    counts = {threshold: [0, 0, 0, 0] for threshold in thresholds}
    for images, masks in loader(records, batch_size, augment=False, shuffle=False):
        probability = torch.sigmoid(model(images.to(device, non_blocking=True)))
        truth = masks.to(device, non_blocking=True) >= 0.5
        for threshold in thresholds:
            prediction = probability >= threshold
            batch_counts = (
                int((prediction & truth).sum().item()),
                int((prediction & ~truth).sum().item()),
                int((~prediction & truth).sum().item()),
                int((~prediction & ~truth).sum().item()),
            )
            counts[threshold] = [left + right for left, right in zip(counts[threshold], batch_counts)]
    return {f"{threshold:.2f}": metrics_from_counts(*counts[threshold]) for threshold in thresholds}


@torch.inference_mode()
def evaluate_per_image(
    model: nn.Module,
    records: list[dict[str, str]],
    device: torch.device,
    threshold: float = 0.5,
) -> dict:
    model.eval()
    dataset = RooftopDataset(records, augment=False)
    rows: list[dict] = []
    total_counts = [0, 0, 0, 0]
    for record, (image, mask) in zip(records, dataset):
        logits = model(image.unsqueeze(0).to(device))
        counts = metric_counts(logits, mask.unsqueeze(0).to(device), threshold)
        total_counts = [left + right for left, right in zip(total_counts, counts)]
        metrics = metrics_from_counts(*counts)
        rows.append({
            "image": Path(record["image"]).name,
            "source_id": record["source_id"],
            **metrics,
        })

    ordered = sorted(rows, key=lambda row: row["iou"])
    ious = np.asarray([row["iou"] for row in rows], dtype=np.float64)
    macro = {
        name: float(np.mean([row[name] for row in rows]))
        for name in ("iou", "dice", "precision", "recall", "pixel_accuracy")
    }
    return {
        "image_count": len(rows),
        "micro": metrics_from_counts(*total_counts),
        "macro": macro,
        "iou_distribution": {
            "minimum": float(ious.min()),
            "p10": float(np.percentile(ious, 10)),
            "median": float(np.median(ious)),
            "p90": float(np.percentile(ious, 90)),
            "maximum": float(ious.max()),
        },
        "quality_bands": {
            "good_iou_at_least_0_75": int((ious >= 0.75).sum()),
            "review_iou_0_50_to_0_75": int(((ious >= 0.50) & (ious < 0.75)).sum()),
            "poor_iou_below_0_50": int((ious < 0.50).sum()),
        },
        "worst_images": ordered[:10],
        "best_images": list(reversed(ordered[-10:])),
        "images": rows,
    }


@torch.inference_mode()
def save_error_overlays(
    model: nn.Module,
    records: list[dict[str, str]],
    image_names: list[str],
    device: torch.device,
    output_dir: Path,
    threshold: float = 0.5,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    record_by_name = {Path(record["image"]).name: record for record in records}
    for image_name in image_names:
        record = record_by_name[image_name]
        image, mask = RooftopDataset([record], augment=False)[0]
        probability = torch.sigmoid(model(image.unsqueeze(0).to(device)))[0, 0].cpu().numpy()
        prediction = probability >= threshold
        truth = mask[0].numpy() >= 0.5
        pixels = np.transpose(image.numpy(), (1, 2, 0)) * 255
        overlay = pixels.copy()
        true_positive = prediction & truth
        false_positive = prediction & ~truth
        false_negative = ~prediction & truth
        overlay[true_positive] = 0.55 * overlay[true_positive] + 0.45 * np.array([34, 211, 238])
        overlay[false_positive] = 0.35 * overlay[false_positive] + 0.65 * np.array([244, 63, 94])
        overlay[false_negative] = 0.35 * overlay[false_negative] + 0.65 * np.array([250, 204, 21])
        Image.fromarray(np.clip(overlay, 0, 255).astype(np.uint8), mode="RGB").save(
            output_dir / f"{Path(image_name).stem}_error-overlay.png"
        )


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def loader(records: list[dict[str, str]], batch_size: int, augment: bool, shuffle: bool) -> DataLoader:
    return DataLoader(
        RooftopDataset(records, augment=augment),
        batch_size=batch_size,
        shuffle=shuffle,
        num_workers=2,
        pin_memory=True,
        persistent_workers=True,
        drop_last=augment,
    )


def train_model(
    manifest_path: Path,
    run_dir: Path,
    epochs: int,
    batch_size: int,
    init_checkpoint: Path | None = None,
) -> None:
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. GPU training is required for this baseline.")
    torch.manual_seed(SEED)
    random.seed(SEED)
    np.random.seed(SEED)
    torch.backends.cudnn.benchmark = True

    manifest = load_manifest(manifest_path)
    train_loader = loader(manifest["splits"]["train"], batch_size, augment=True, shuffle=True)
    validation_loader = loader(manifest["splits"]["validation"], batch_size, augment=False, shuffle=False)
    device = torch.device("cuda")
    model = SmallUNet().to(device)
    if init_checkpoint is not None:
        checkpoint = torch.load(init_checkpoint, map_location=device, weights_only=True)
        model.load_state_dict(checkpoint["model_state"])
    optimizer = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, mode="max", factor=0.5, patience=2)
    scaler = torch.amp.GradScaler("cuda")
    pos_weight = torch.tensor([4.0], device=device)
    run_dir.mkdir(parents=True, exist_ok=True)
    history: list[dict] = []
    best_iou = -1.0
    stale_epochs = 0
    started = time.time()

    print(json.dumps({
        "device": torch.cuda.get_device_name(0),
        "training_images": len(manifest["splits"]["train"]),
        "validation_images": len(manifest["splits"]["validation"]),
        "epochs": epochs,
        "batch_size": batch_size,
        "parameters": sum(parameter.numel() for parameter in model.parameters()),
        "initialized_from": str(init_checkpoint.resolve()) if init_checkpoint else None,
    }, indent=2), flush=True)

    for epoch in range(1, epochs + 1):
        model.train()
        running_loss = 0.0
        batches = 0
        for images, masks in train_loader:
            images = images.to(device, non_blocking=True)
            masks = masks.to(device, non_blocking=True)
            optimizer.zero_grad(set_to_none=True)
            with torch.amp.autocast("cuda", dtype=torch.float16):
                logits = model(images)
                loss = dice_bce_loss(logits, masks, pos_weight)
            scaler.scale(loss).backward()
            scaler.step(optimizer)
            scaler.update()
            running_loss += float(loss.item())
            batches += 1

        validation_metrics = evaluate(model, validation_loader, device)
        scheduler.step(validation_metrics["iou"])
        row = {
            "epoch": epoch,
            "train_loss": running_loss / max(batches, 1),
            "learning_rate": optimizer.param_groups[0]["lr"],
            **validation_metrics,
            "elapsed_minutes": (time.time() - started) / 60,
        }
        history.append(row)
        print(json.dumps(row), flush=True)
        (run_dir / "history.json").write_text(json.dumps(history, indent=2), encoding="utf-8")

        if validation_metrics["iou"] > best_iou + 1e-4:
            best_iou = validation_metrics["iou"]
            stale_epochs = 0
            torch.save({
                "model_state": model.state_dict(),
                "epoch": epoch,
                "validation_metrics": validation_metrics,
                "image_size": IMAGE_SIZE,
                "architecture": "small_unet_base16",
                "initialized_from": str(init_checkpoint.resolve()) if init_checkpoint else None,
            }, run_dir / "best.pt")
        else:
            stale_epochs += 1
            if epoch >= 10 and stale_epochs >= 6:
                print(f"Early stopping after epoch {epoch}.", flush=True)
                break

    print(json.dumps({"best_validation_iou": best_iou, "checkpoint": str((run_dir / "best.pt").resolve())}, indent=2))


def load_checkpoint(checkpoint_path: Path, device: torch.device) -> SmallUNet:
    checkpoint = torch.load(checkpoint_path, map_location=device, weights_only=True)
    model = SmallUNet().to(device)
    model.load_state_dict(checkpoint["model_state"])
    model.eval()
    return model


def evaluate_checkpoint(
    manifest_path: Path,
    checkpoint_path: Path,
    run_dir: Path,
    batch_size: int,
    threshold: float = 0.5,
) -> None:
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    manifest = load_manifest(manifest_path)
    model = load_checkpoint(checkpoint_path, device)
    test_metrics = evaluate(model, loader(manifest["splits"]["test"], batch_size, False, False), device, threshold)
    detailed_metrics = evaluate_per_image(model, manifest["splits"]["test"], device, threshold)
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "test_metrics.json").write_text(json.dumps(test_metrics, indent=2), encoding="utf-8")
    (run_dir / "test_metrics_detailed.json").write_text(json.dumps(detailed_metrics, indent=2), encoding="utf-8")
    save_error_overlays(
        model,
        manifest["splits"]["test"],
        [row["image"] for row in detailed_metrics["worst_images"][:6]],
        device,
        run_dir / "evaluation-overlays",
        threshold,
    )
    print(json.dumps({"threshold": threshold, "aggregate": test_metrics, **{key: detailed_metrics[key] for key in ("image_count", "macro", "iou_distribution", "quality_bands", "worst_images")}}, indent=2))


def tune_checkpoint_threshold(
    manifest_path: Path,
    checkpoint_path: Path,
    run_dir: Path,
    batch_size: int,
    thresholds: list[float],
) -> None:
    if not thresholds or any(threshold <= 0 or threshold >= 1 for threshold in thresholds):
        raise ValueError("Thresholds must be numbers strictly between zero and one.")
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    manifest = load_manifest(manifest_path)
    model = load_checkpoint(checkpoint_path, device)
    results = tune_thresholds(model, manifest["splits"]["validation"], device, batch_size, thresholds)
    best_threshold, best_metrics = max(results.items(), key=lambda item: item[1]["iou"])
    payload = {"best_threshold": float(best_threshold), "best_metrics": best_metrics, "thresholds": results}
    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "threshold_tuning.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(json.dumps(payload, indent=2))


@torch.inference_mode()
def predict_image(checkpoint_path: Path, image_path: Path, output_dir: Path, threshold: float, min_area: int) -> None:
    try:
        import cv2
    except ImportError as error:
        raise RuntimeError("OpenCV is required for polygon extraction. Install opencv-python-headless.") from error

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = load_checkpoint(checkpoint_path, device)
    with Image.open(image_path) as source:
        original = source.convert("RGB")
    width, height = original.size
    tile_size = min(1024, max(width, height))
    stride = max(tile_size // 2, 1)
    probability_sum = np.zeros((height, width), dtype=np.float32)
    probability_count = np.zeros((height, width), dtype=np.float32)

    x_starts = sorted(set([*range(0, max(width - tile_size + 1, 1), stride), max(width - tile_size, 0)]))
    y_starts = sorted(set([*range(0, max(height - tile_size + 1, 1), stride), max(height - tile_size, 0)]))
    for y in y_starts:
        for x in x_starts:
            crop = original.crop((x, y, min(x + tile_size, width), min(y + tile_size, height)))
            crop_width, crop_height = crop.size
            tensor = TF.pil_to_tensor(TF.resize(crop, [IMAGE_SIZE, IMAGE_SIZE])).float().div_(255.0).unsqueeze(0).to(device)
            probability = torch.sigmoid(model(tensor))[0, 0].float().cpu().numpy()
            probability = np.asarray(Image.fromarray(probability, mode="F").resize((crop_width, crop_height), Image.Resampling.BILINEAR))
            probability_sum[y:y + crop_height, x:x + crop_width] += probability
            probability_count[y:y + crop_height, x:x + crop_width] += 1

    probability = probability_sum / np.maximum(probability_count, 1)
    binary = (probability >= threshold).astype(np.uint8) * 255
    kernel = np.ones((3, 3), np.uint8)
    binary = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel)
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    polygons: list[dict] = []
    overlay = original.copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    for index, contour in enumerate(sorted(contours, key=cv2.contourArea, reverse=True), start=1):
        area = float(cv2.contourArea(contour))
        if area < min_area:
            continue
        perimeter = cv2.arcLength(contour, True)
        simplified = cv2.approxPolyDP(contour, max(2.0, perimeter * 0.008), True).reshape(-1, 2)
        if len(simplified) < 3:
            continue
        points = [(int(point[0]), int(point[1])) for point in simplified]
        mean_confidence = float(np.mean([probability[point[1], point[0]] for point in points]))
        draw.polygon(points, fill=(34, 211, 238, 55), outline=(34, 211, 238, 255), width=3)
        polygons.append({
            "id": f"ROOFTOP-{index:04d}",
            "coordinate_space": "normalized",
            "points": [[round(x / width, 6), round(y / height, 6)] for x, y in points],
            "confidence_score": round(mean_confidence, 4),
            "pixel_area": round(area, 1),
        })

    output_dir.mkdir(parents=True, exist_ok=True)
    overlay_path = output_dir / "prediction_overlay.png"
    mask_path = output_dir / "prediction_mask.png"
    json_path = output_dir / "image_predictions.json"
    overlay.save(overlay_path)
    Image.fromarray(binary, mode="L").save(mask_path)
    json_path.write_text(json.dumps({"image_predictions": polygons}, indent=2), encoding="utf-8")
    print(json.dumps({
        "input": str(image_path.resolve()),
        "polygon_count": len(polygons),
        "overlay": str(overlay_path.resolve()),
        "mask": str(mask_path.resolve()),
        "predictions": str(json_path.resolve()),
    }, indent=2))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="BhoomiX rooftop segmentation baseline")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare")
    prepare.add_argument("--dataset-root", type=Path, required=True)
    prepare.add_argument("--manifest", type=Path, default=Path("training/prepared/rooftop_manifest.json"))
    prepare.add_argument("--development-size", type=int, default=500, help="Use 0 to include every leakage-safe labeled image.")
    prepare.add_argument("--validation-size", type=int, default=50)

    prepare_zanzibar = subparsers.add_parser("prepare-zanzibar")
    prepare_zanzibar.add_argument("--dataset-root", type=Path, required=True)
    prepare_zanzibar.add_argument("--manifest", type=Path, default=Path("training/prepared/zanzibar_manifest.json"))
    prepare_zanzibar.add_argument("--base-manifest", type=Path)
    prepare_zanzibar.add_argument("--validation-size", type=int, default=269)
    prepare_zanzibar.add_argument("--test-size", type=int, default=269)

    train = subparsers.add_parser("train")
    train.add_argument("--manifest", type=Path, default=Path("training/prepared/rooftop_manifest.json"))
    train.add_argument("--run-dir", type=Path, default=Path("training/runs/rooftop-baseline"))
    train.add_argument("--epochs", type=int, default=25)
    train.add_argument("--batch-size", type=int, default=4)
    train.add_argument("--init-checkpoint", type=Path)

    test = subparsers.add_parser("evaluate")
    test.add_argument("--manifest", type=Path, default=Path("training/prepared/rooftop_manifest.json"))
    test.add_argument("--checkpoint", type=Path, default=Path("training/runs/rooftop-baseline/best.pt"))
    test.add_argument("--run-dir", type=Path, default=Path("training/runs/rooftop-baseline"))
    test.add_argument("--batch-size", type=int, default=4)
    test.add_argument("--threshold", type=float, default=0.5)

    tune = subparsers.add_parser("tune-threshold")
    tune.add_argument("--manifest", type=Path, required=True)
    tune.add_argument("--checkpoint", type=Path, required=True)
    tune.add_argument("--run-dir", type=Path, required=True)
    tune.add_argument("--batch-size", type=int, default=4)
    tune.add_argument("--thresholds", default="0.35,0.40,0.45,0.50,0.55,0.60,0.65,0.70")

    predict = subparsers.add_parser("predict")
    predict.add_argument("--checkpoint", type=Path, default=Path("training/runs/rooftop-baseline/best.pt"))
    predict.add_argument("--image", type=Path, required=True)
    predict.add_argument("--output-dir", type=Path, default=Path("training/runs/rooftop-baseline/sample-prediction"))
    predict.add_argument("--threshold", type=float, default=0.5)
    predict.add_argument("--min-area", type=int, default=300)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    if args.command == "prepare":
        prepare_manifest(args.dataset_root, args.manifest, development_size=args.development_size, validation_size=args.validation_size)
    elif args.command == "prepare-zanzibar":
        prepare_zanzibar_manifest(
            args.dataset_root,
            args.manifest,
            base_manifest_path=args.base_manifest,
            validation_size=args.validation_size,
            test_size=args.test_size,
        )
    elif args.command == "train":
        train_model(args.manifest, args.run_dir, args.epochs, args.batch_size, args.init_checkpoint)
    elif args.command == "evaluate":
        evaluate_checkpoint(args.manifest, args.checkpoint, args.run_dir, args.batch_size, args.threshold)
    elif args.command == "tune-threshold":
        tune_checkpoint_threshold(
            args.manifest,
            args.checkpoint,
            args.run_dir,
            args.batch_size,
            [float(value.strip()) for value in args.thresholds.split(",") if value.strip()],
        )
    elif args.command == "predict":
        predict_image(args.checkpoint, args.image, args.output_dir, args.threshold, args.min_area)


if __name__ == "__main__":
    main()
