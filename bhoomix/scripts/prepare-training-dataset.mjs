import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function usage() {
  console.log('Usage: npm run dataset:prepare -- <bhoomix-export.json|geojson> [output-directory]');
  console.log('Accepts either the map-feedback GeoJSON or the image-annotation JSON export.');
}

function readString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isGeometry(value) {
  return Boolean(value && typeof value === 'object' && typeof value.type === 'string');
}

function chooseSplit(groupId) {
  const bucket = Number.parseInt(createHash('sha256').update(groupId).digest('hex').slice(0, 8), 16) % 100;
  if (bucket < 80) return 'train';
  if (bucket < 90) return 'validation';
  return 'test';
}

function asJsonLines(samples) {
  return samples.map((sample) => JSON.stringify(sample)).join('\n') + (samples.length ? '\n' : '');
}

function prepareMapFeedback(payload) {
  if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) return null;

  const samples = [];
  const issues = [];
  payload.features.forEach((feature, index) => {
    const properties = feature?.properties || {};
    const action = readString(properties.action);
    const uploadId = readString(properties.source_upload_id);
    const storagePath = readString(properties.source_file_path);
    const sampleId = readString(properties.log_id) || readString(properties.parcel_id) || `feature-${index}`;

    if (!['edited', 'confirmed', 'rejected'].includes(action || '')) {
      issues.push({ item: index, reason: 'Unsupported or missing review action.' });
      return;
    }
    if (!uploadId || !storagePath) {
      issues.push({ item: index, reason: 'Missing source image lineage. Apply migration 06 and collect linked reviews.' });
      return;
    }
    if (action !== 'rejected' && !isGeometry(feature.geometry)) {
      issues.push({ item: index, reason: 'Positive sample is missing its verified geometry.' });
      return;
    }

    samples.push({
      sample_id: sampleId,
      group_id: uploadId,
      split: chooseSplit(uploadId),
      task: 'geospatial_polygon_review',
      image: {
        upload_id: uploadId,
        filename: readString(properties.source_filename),
        storage_path: storagePath,
      },
      annotations: [{
        id: sampleId,
        action,
        geometry: feature.geometry,
        original_geometry: isGeometry(properties.original_geometry) ? properties.original_geometry : null,
        label: 'cadastral_parcel',
      }],
      provenance: {
        source_type: readString(properties.source_type) || 'unknown',
        model_version: readString(properties.model_version),
        reviewer: readString(properties.surveyor_id),
        reviewed_at: readString(properties.reviewed_at),
      },
    });
  });

  return { datasetType: 'map_feedback', inputItems: payload.features.length, samples, issues };
}

function validNormalizedPolygon(value) {
  return Array.isArray(value)
    && value.length >= 3
    && value.length <= 100
    && value.every((point) => Array.isArray(point)
      && point.length >= 2
      && point.slice(0, 2).every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate) && coordinate >= 0 && coordinate <= 1));
}

function prepareImageAnnotations(payload) {
  if (payload.schema !== 'bhoomix-image-annotations/v1' || !Array.isArray(payload.images)) return null;

  const samples = [];
  const issues = [];
  let usableAnnotations = 0;
  payload.images.forEach((image, index) => {
    const uploadId = readString(image?.upload_id);
    const filename = readString(image?.filename);
    const storagePath = readString(image?.storage_path);
    const width = image?.dimensions?.width;
    const height = image?.dimensions?.height;

    if (!uploadId || !filename || !storagePath) {
      issues.push({ item: index, reason: 'Image is missing upload_id, filename, or storage_path.' });
      return;
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      issues.push({ item: uploadId, reason: 'Image dimensions are missing. Re-upload the source image before training.' });
      return;
    }
    if (!Array.isArray(image.annotations) || image.annotations.length === 0) {
      issues.push({ item: uploadId, reason: 'Image has no approved annotations.' });
      return;
    }

    const annotations = image.annotations.flatMap((annotation, annotationIndex) => {
      if (!validNormalizedPolygon(annotation?.polygon_normalized)) {
        issues.push({ item: `${uploadId}:${annotationIndex}`, reason: 'Annotation polygon is invalid or outside the image.' });
        return [];
      }
      usableAnnotations += 1;
      return [{
        id: readString(annotation.id) || `${uploadId}-${annotationIndex}`,
        label: 'cadastral_parcel',
        source: readString(annotation.source) || 'manual',
        confidence: typeof annotation.confidence === 'number' ? annotation.confidence : null,
        polygon_normalized: annotation.polygon_normalized,
        polygon_pixels: annotation.polygon_normalized.map(([x, y]) => [Math.round(x * width), Math.round(y * height)]),
      }];
    });
    if (!annotations.length) return;

    samples.push({
      sample_id: uploadId,
      group_id: uploadId,
      split: chooseSplit(uploadId),
      task: 'image_polygon_segmentation',
      image: {
        upload_id: uploadId,
        filename,
        storage_path: storagePath,
        mime_type: readString(image.mime_type),
        width,
        height,
      },
      annotations,
      provenance: image.provenance && typeof image.provenance === 'object' ? image.provenance : {},
    });
  });

  return { datasetType: 'image_annotations', inputItems: payload.images.length, samples, issues, usableAnnotations };
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg || inputArg === '--help' || inputArg === '-h') {
    usage();
    return;
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(process.argv[3] || 'training/prepared');
  const raw = await readFile(inputPath, 'utf8');
  const payload = JSON.parse(raw.replace(/^\uFEFF/, ''));
  const prepared = prepareMapFeedback(payload) ?? prepareImageAnnotations(payload);
  if (!prepared) {
    throw new Error('Input must be a BhoomiX feedback GeoJSON or bhoomix-image-annotations/v1 export.');
  }

  const bySplit = {
    train: prepared.samples.filter((sample) => sample.split === 'train'),
    validation: prepared.samples.filter((sample) => sample.split === 'validation'),
    test: prepared.samples.filter((sample) => sample.split === 'test'),
  };
  const splitGroupSets = Object.fromEntries(Object.entries(bySplit).map(([name, rows]) => [name, new Set(rows.map((row) => row.group_id))]));
  const leakedGroups = [...splitGroupSets.train].filter((id) => splitGroupSets.validation.has(id) || splitGroupSets.test.has(id))
    .concat([...splitGroupSets.validation].filter((id) => splitGroupSets.test.has(id)));
  if (leakedGroups.length) throw new Error('Dataset split leakage was detected; no files were written.');

  await mkdir(outputPath, { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    dataset_type: prepared.datasetType,
    input_items: prepared.inputItems,
    usable_samples: prepared.samples.length,
    usable_annotations: prepared.usableAnnotations ?? prepared.samples.reduce((total, sample) => total + sample.annotations.length, 0),
    excluded_items: prepared.issues.length,
    split_counts: {
      train: bySplit.train.length,
      validation: bySplit.validation.length,
      test: bySplit.test.length,
    },
    split_group_leakage: 0,
    issues: prepared.issues,
  };

  await Promise.all([
    writeFile(path.join(outputPath, 'manifest.jsonl'), asJsonLines(prepared.samples), 'utf8'),
    writeFile(path.join(outputPath, 'train.jsonl'), asJsonLines(bySplit.train), 'utf8'),
    writeFile(path.join(outputPath, 'validation.jsonl'), asJsonLines(bySplit.validation), 'utf8'),
    writeFile(path.join(outputPath, 'test.jsonl'), asJsonLines(bySplit.test), 'utf8'),
    writeFile(path.join(outputPath, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
  ]);

  console.log(`Prepared ${prepared.samples.length} training sample(s) in ${outputPath}`);
  console.log(`Dataset type: ${prepared.datasetType}; split leakage: 0 groups.`);
  console.log(`Excluded ${prepared.issues.length} item(s); see report.json for details.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
