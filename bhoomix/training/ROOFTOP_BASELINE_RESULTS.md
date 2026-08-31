# BhoomiX Rooftop Baseline Results

Training completed on 31 August 2026 using an NVIDIA GeForce RTX 4050 Laptop GPU.

## Dataset split

- 450 training images
- 50 validation images
- 60 untouched test images
- Four training records sharing source IDs with the test set were excluded
- Inputs were resized from 1024 × 1024 to 512 × 512 for training

The original dataset in `D:\datasets\archive (1) 1` was read only. Generated manifests and run artifacts are ignored by Git.

## Model

- Architecture: lightweight U-Net (`base=16`)
- Parameters: 1,942,577
- Loss: weighted binary cross entropy plus soft Dice loss
- Optimizer: AdamW
- Batch size: 4
- Maximum epochs: 25
- Best checkpoint: epoch 21
- Total training time: approximately 5.6 minutes

## Metrics

| Split | IoU | Dice | Precision | Recall | Pixel accuracy |
| --- | ---: | ---: | ---: | ---: | ---: |
| Validation (best) | 0.8148 | 0.8979 | 0.8510 | 0.9503 | 0.9579 |
| Untouched test | 0.8002 | 0.8890 | 0.8377 | 0.9470 | 0.9571 |

## Inference observations

- A held-out Gandhinagar image produced 49 generally well-aligned rooftop polygons.
- The supplied different-city screenshot produced 19 polygons at threshold 0.55.
- Lowering the threshold to 0.35 produced 32 polygons but increased false detections.
- The target screenshot has a large domain shift in roof materials, density, shadows, and viewing context.
- This model detects rooftop footprints. It does not infer legal cadastral parcels.

## Local artifacts

- Checkpoint: `training/runs/rooftop-baseline/best.pt`
- Training history: `training/runs/rooftop-baseline/history.json`
- Test metrics: `training/runs/rooftop-baseline/test_metrics.json`
- Held-out overlay: `training/runs/rooftop-baseline/held-out-prediction/prediction_overlay.png`
- Target overlay (strict): `training/runs/rooftop-baseline/sample-prediction/prediction_overlay.png`
- Target overlay (lower threshold): `training/runs/rooftop-baseline/sample-prediction-t035/prediction_overlay.png`
- Each prediction directory contains BhoomiX-compatible `image_predictions.json`

## Recommended next action

Do not present this checkpoint as a cadastral model. Add and label target-domain aerial images, fine-tune the rooftop model, then build an HTTP inference service that returns the generated `image_predictions` schema to BhoomiX.
