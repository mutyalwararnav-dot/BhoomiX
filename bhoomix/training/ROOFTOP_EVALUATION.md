# BhoomiX Rooftop Model Evaluation

Evaluation completed on 31 August 2026 using all 60 untouched test images from the group-isolated dataset split. No test image was used for training or checkpoint selection.

## Overall result

| Metric | Score |
| --- | ---: |
| Pixel IoU | 0.8002 |
| Dice | 0.8890 |
| Precision | 0.8377 |
| Recall | 0.9470 |
| Pixel accuracy | 0.9571 |
| Per-image mean IoU | 0.8010 |
| Per-image median IoU | 0.8142 |

## Consistency

- 48 of 60 images have IoU at or above 0.75.
- 12 images have IoU between 0.50 and 0.75 and require review.
- No image has IoU below 0.50.
- Per-image IoU ranges from 0.5959 to 0.8770.
- The bottom ten percent begins below IoU 0.7197.

## Error review

The lowest-IoU image (`sample_8`) has both missed rooftops and partial edge errors, especially around tree cover, shadows, and roofs near image borders. Several other low-ranked images have high recall (about 0.97) but lower precision (about 0.69–0.72), meaning the model predicts more rooftop area than the supplied masks contain.

Visual inspection of the generated error overlays shows that some apparent false positives fall on visible rooftops that are absent or only partly represented in the ground-truth mask. This suggests a mixture of model over-segmentation and incomplete or ambiguous annotations. Target-domain city screenshots remain harder than the test split because their roof materials, density, shadows, and scale differ from the training data.

Error-overlay colors:

- Cyan: correctly predicted rooftop pixels.
- Rose: predicted rooftop pixels outside the supplied mask.
- Yellow: rooftop pixels missed by the model.

## Decision

The checkpoint is suitable as an assisted rooftop-labeling prototype, but not for unattended cadastral decisions. The next improvement cycle should prioritize clean target-domain annotations, particularly dense urban scenes, tree-covered roofs, image-edge buildings, and examples where adjacent roofs must remain separate.

Detailed machine-readable results and the six weakest-case overlays are stored under `training/runs/rooftop-baseline/` and remain excluded from Git because they are generated artifacts.
