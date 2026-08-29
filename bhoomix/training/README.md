# BhoomiX model dataset preparation

The training pipeline needs two things for every reviewed parcel:

1. The source drone image or orthomosaic.
2. The human-verified parcel geometry linked to that same image.

Migration `supabase/06_training_dataset_lineage.sql` adds this connection for all new image-processing runs. Historical reviews without a source image remain useful for GIS testing, but should not be used for image-model training.

## Prepare a dataset

1. Download the feedback GeoJSON from **Sync Feedback**.
2. Run:

```bash
npm run dataset:prepare -- bhoomix_retraining_dataset.geojson
```

The command produces `training/prepared/manifest.jsonl`, separate train/validation/test manifests, and a quality report. Splitting is performed by source image rather than individual polygon, preventing parcels from the same image leaking across evaluation sets.

The prepared directory is intentionally ignored by Git because real survey imagery and generated training artifacts may be large or sensitive.

## Before model training

- Prefer georeferenced GeoTIFF orthomosaics so WGS84 parcel polygons can be converted to pixel masks accurately.
- Verify licensing and permission for every image.
- Remove duplicate or near-duplicate flights.
- Review excluded samples in `report.json`.
- Do not start the first full training run until the Dataset panel reports sufficient usable samples and reviewer traceability.
