const baseUrl = (process.env.BHOOMIX_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

async function check(name, path, expectedStatus, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(15_000) });
  if (response.status !== expectedStatus) {
    const body = (await response.text()).slice(0, 300);
    throw new Error(`${name}: expected ${expectedStatus}, received ${response.status}. ${body}`);
  }
  console.log(`PASS  ${name}`);
}

async function main() {
  await check('dashboard loads', '/', 200);
  await check('database health', '/api/health', 200);
  await check('cross-site mutation is rejected', '/api/validate-parcels', 403, {
    method: 'POST',
    headers: { Origin: 'https://example.invalid', 'Content-Type': 'application/json' },
    body: '{}',
  });
  await check('malformed GeoJSON is rejected', '/api/import-parcels', 400, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: '{',
  });
  await check('incomplete elevation bundle is rejected', '/api/elevation/process', 400, {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ layers: {} }),
  });
  await check('saved elevation bundles load', '/api/elevation/bundles', 200);
  await check('invalid job identifier is rejected', '/api/processing-jobs/not-a-uuid', 400);
  await check('guest job history is protected', '/api/processing-jobs', 403);
  await check('guest training export is protected', '/api/dataset/image-annotations', 403);
  console.log('BhoomiX API smoke tests completed successfully.');
}

main().catch((error) => {
  console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
