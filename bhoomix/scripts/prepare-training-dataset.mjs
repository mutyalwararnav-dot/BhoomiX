import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function usage() {
  console.log('Usage: npm run dataset:prepare -- <feedback.geojson> [output-directory]');
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

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg || inputArg === '--help' || inputArg === '-h') {
    usage();
    return;
  }

  const inputPath = path.resolve(inputArg);
  const outputPath = path.resolve(process.argv[3] || 'training/prepared');
  const payload = JSON.parse(await readFile(inputPath, 'utf8'));

  if (payload.type !== 'FeatureCollection' || !Array.isArray(payload.features)) {
    throw new Error('Input must be a GeoJSON FeatureCollection exported by BhoomiX.');
  }

  const samples = [];
  const issues = [];

  payload.features.forEach((feature, index) => {
    const properties = feature.properties || {};
    const action = readString(properties.action);
    const uploadId = readString(properties.source_upload_id);
    const storagePath = readString(properties.source_file_path);
    const sampleId = readString(properties.log_id) || readString(properties.parcel_id) || `feature-${index}`;

    if (!['edited', 'confirmed', 'rejected'].includes(action || '')) {
      issues.push({ feature: index, reason: 'Unsupported or missing review action.' });
      return;
    }
    if (!uploadId || !storagePath) {
      issues.push({ feature: index, reason: 'Missing source image lineage. Apply migration 06 and collect linked reviews.' });
      return;
    }
    if (action !== 'rejected' && !isGeometry(feature.geometry)) {
      issues.push({ feature: index, reason: 'Positive sample is missing its verified geometry.' });
      return;
    }

    samples.push({
      sample_id: sampleId,
      group_id: uploadId,
      split: chooseSplit(uploadId),
      image: {
        upload_id: uploadId,
        filename: readString(properties.source_filename),
        storage_path: storagePath,
      },
      annotation: {
        action,
        geometry: feature.geometry,
        original_geometry: isGeometry(properties.original_geometry) ? properties.original_geometry : null,
        label: 'cadastral_parcel',
      },
      provenance: {
        source_type: readString(properties.source_type) || 'unknown',
        model_version: readString(properties.model_version),
        reviewer: readString(properties.surveyor_id),
        reviewed_at: readString(properties.reviewed_at),
      },
    });
  });

  await mkdir(outputPath, { recursive: true });
  const bySplit = {
    train: samples.filter((sample) => sample.split === 'train'),
    validation: samples.filter((sample) => sample.split === 'validation'),
    test: samples.filter((sample) => sample.split === 'test'),
  };

  await Promise.all([
    writeFile(path.join(outputPath, 'manifest.jsonl'), asJsonLines(samples), 'utf8'),
    writeFile(path.join(outputPath, 'train.jsonl'), asJsonLines(bySplit.train), 'utf8'),
    writeFile(path.join(outputPath, 'validation.jsonl'), asJsonLines(bySplit.validation), 'utf8'),
    writeFile(path.join(outputPath, 'test.jsonl'), asJsonLines(bySplit.test), 'utf8'),
    writeFile(path.join(outputPath, 'report.json'), JSON.stringify({
      generated_at: new Date().toISOString(),
      input_features: payload.features.length,
      usable_samples: samples.length,
      excluded_samples: issues.length,
      split_counts: {
        train: bySplit.train.length,
        validation: bySplit.validation.length,
        test: bySplit.test.length,
      },
      issues,
    }, null, 2) + '\n', 'utf8'),
  ]);

  console.log(`Prepared ${samples.length} model-ready sample(s) in ${outputPath}`);
  console.log(`Excluded ${issues.length} sample(s); see report.json for details.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
