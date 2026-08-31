# BhoomiX model dataset preparation

The first rooftop-segmentation baseline is implemented in `rooftop_baseline.py`. See `ROOFTOP_BASELINE_RESULTS.md` for its split, metrics, limitations, and local artifact locations.

BhoomiX supports two reviewed sources for boundary-model training:

1. **Map feedback GeoJSON** — georeferenced parcel confirmations and corrections linked to their source orthomosaic.
2. **Image annotation JSON** — polygons drawn and approved directly on JPG, PNG, or TIFF imagery in Image Analysis.

Untouched demo polygons are excluded automatically. If a reviewer moves a demo vertex, BhoomiX converts that polygon to a manual annotation before saving it.

## Export reviewed labels

Sign in as a surveyor or administrator, open **Dataset**, and download either:

- `bhoomix_retraining_dataset.geojson` for map-based reviews.
- `bhoomix_image_annotations.json` for image-space polygons.

The image export contains private Supabase storage paths, not public image URLs. Keep it private and do not commit it.

## Prepare deterministic splits

Run the same command for either export:

```bash
npm run dataset:prepare -- bhoomix_image_annotations.json
```

An optional second argument chooses the output directory:

```bash
npm run dataset:prepare -- bhoomix_retraining_dataset.geojson training/prepared-map
```

The command writes `manifest.jsonl`, `train.jsonl`, `validation.jsonl`, `test.jsonl`, and `report.json`. Splits are deterministic and grouped by source upload, so polygons from one image cannot leak across training, validation, and test sets.

## Required gates before training

- Run `npm run preflight` and resolve every failure.
- Run `npm run test:dataset` and `npm run check`.
- Apply Supabase migrations `00` through `09` in order.
- In Supabase, enable point-in-time recovery or scheduled database backups appropriate to the project plan and confirm the private `drone_datasets` bucket is included in a separate storage-backup process.
- Verify ownership, consent, and training rights for every source image.
- Remove duplicate or near-duplicate flights.
- Review every item listed in the generated `report.json`.
- Prefer at least 200 usable, reviewer-approved polygons for the first full run. A small pilot may begin at 50 high-quality polygons, but its results are not production evidence.
- Keep the final test split sealed until model selection is complete.

Image annotation exports require stored image dimensions. Historical uploads created before this pipeline should be re-uploaded if the Dataset panel reports missing dimensions.
