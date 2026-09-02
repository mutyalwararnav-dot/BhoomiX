# BhoomiX Zanzibar Building-Segmentation Candidate

Training completed on 1 September 2026 using the paired segmentation portion of `archive (4)`.

## Data and split

- 2,691 Zanzibar aerial image/mask pairs
- 2,153 Zanzibar training tiles
- 269 spatially isolated validation tiles
- 269 untouched, spatially isolated test tiles
- 450 replay samples from the original BhoomiX rooftop training split
- 2,603 combined training images
- Adjacent tiles were grouped into 8×8 spatial blocks to prevent split leakage

## Training

- Initialized from the previous BhoomiX rooftop checkpoint
- Lightweight U-Net, 1,942,577 parameters
- 20 epochs on an NVIDIA GeForce RTX 4050 Laptop GPU
- Best checkpoint: epoch 20
- Selected inference threshold: 0.75

## Results

| Evaluation set | IoU | Dice | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| Zanzibar validation | 0.7901 | 0.8827 | 0.9003 | 0.8659 |
| Zanzibar untouched test | 0.6992 | 0.8230 | 0.8488 | 0.7987 |
| Original BhoomiX untouched test | 0.7833 | 0.8785 | 0.8425 | 0.9177 |
| Old model on Zanzibar untouched test | 0.0425 | 0.0816 | 0.7645 | 0.0431 |

The candidate greatly improves coverage on the newly supplied low-resolution aerial domain while retaining most performance on the original domain. It is promoted as the local assisted-labeling model.

## Limitation

This checkpoint detects visible building footprints. It does not infer legal cadastral ownership parcels, and all predictions still require human review. Map placement additionally requires georeferenced imagery.
