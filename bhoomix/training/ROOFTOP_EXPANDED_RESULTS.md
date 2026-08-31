# BhoomiX Expanded Rooftop Candidate

Training completed on 31 August 2026 for presentation-readiness testing.

## Data

- 462 leakage-safe training images
- 50 group-isolated validation images
- 60 untouched test images
- 4 records excluded because their source IDs overlap the test set
- The VisDrone dataset was excluded because its labels describe vehicles rather than rooftops

## Result

| Checkpoint | Test IoU | Dice | Precision | Recall |
| --- | ---: | ---: | ---: | ---: |
| Current live baseline | 0.8002 | 0.8890 | 0.8377 | 0.9470 |
| Expanded candidate | 0.7994 | 0.8885 | 0.8384 | 0.9450 |

The expanded candidate did not beat the current checkpoint and was therefore not promoted. The current live checkpoint remains the safer presentation model.

The major visible improvement came from correcting inference scale: complete 1024×1024 scenes are now resized to the model's 512×512 input, matching training. The exact `sample_7` upload changed from 9 fragmented contours to 28 predictions after this correction.

## Next data requirement

Meaningful improvement requires new target-domain images with accurate rooftop masks. Additional vehicle-labeled or unlabeled drone imagery should not be mixed into supervised rooftop training.
