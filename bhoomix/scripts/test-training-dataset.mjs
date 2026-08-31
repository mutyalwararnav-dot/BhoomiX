import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const scriptPath = path.resolve('scripts/prepare-training-dataset.mjs');

async function runFixture(root, name, payload) {
  const input = path.join(root, `${name}.json`);
  const output = path.join(root, `${name}-prepared`);
  await writeFile(input, JSON.stringify(payload), 'utf8');
  await execute(process.execPath, [scriptPath, input, output]);
  const report = JSON.parse(await readFile(path.join(output, 'report.json'), 'utf8'));
  const manifest = await readFile(path.join(output, 'manifest.jsonl'), 'utf8');
  return { report, rows: manifest.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

async function main() {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'bhoomix-dataset-test-'));
  try {
    const mapResult = await runFixture(temporaryRoot, 'map', {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[73, 18], [74, 18], [74, 19], [73, 18]]] },
        properties: {
          log_id: 'review-1',
          parcel_id: 'parcel-1',
          action: 'confirmed',
          source_upload_id: 'upload-1',
          source_file_path: 'incoming/image-1.tif',
        },
      }],
    });
    assert.equal(mapResult.report.dataset_type, 'map_feedback');
    assert.equal(mapResult.report.usable_samples, 1);
    assert.equal(mapResult.report.split_group_leakage, 0);

    const imageResult = await runFixture(temporaryRoot, 'images', {
      schema: 'bhoomix-image-annotations/v1',
      images: [{
        upload_id: 'upload-2',
        filename: 'drone.jpg',
        storage_path: 'incoming/drone.jpg',
        mime_type: 'image/jpeg',
        dimensions: { width: 2000, height: 1000 },
        annotations: [{
          id: 'MANUAL-001',
          source: 'manual',
          confidence: null,
          polygon_normalized: [[0.1, 0.2], [0.4, 0.2], [0.4, 0.6], [0.1, 0.6]],
        }],
      }],
    });
    assert.equal(imageResult.report.dataset_type, 'image_annotations');
    assert.equal(imageResult.report.usable_annotations, 1);
    assert.deepEqual(imageResult.rows[0].annotations[0].polygon_pixels[0], [200, 200]);
    assert.equal(imageResult.report.split_group_leakage, 0);
    console.log('PASS  map-feedback dataset preparation');
    console.log('PASS  image-annotation dataset preparation');
    console.log('PASS  deterministic group-level split isolation');
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
