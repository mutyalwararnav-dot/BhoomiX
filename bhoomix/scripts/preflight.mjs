import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { request as httpsRequest } from 'node:https';

config({ path: '.env.local', quiet: true, override: true });

const requiredVariables = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'NEXT_PUBLIC_SITE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function fail(message) {
  throw new Error(message);
}

function describeError(error) {
  if (!error) return 'unknown error';
  const parts = [error.message, error.details, error.hint, error.code, error.name]
    .filter((value) => typeof value === 'string' && value.trim());
  return parts.join(' · ') || 'request failed without diagnostic details';
}

function backendFetch(input, init = {}) {
  const url = input instanceof Request ? new URL(input.url) : new URL(input);
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  headers.set('User-Agent', 'BhoomiX-Server-Preflight/1.0');
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  const body = init.body;

  return new Promise((resolve, reject) => {
    const request = httpsRequest(url, {
      method,
      headers: Object.fromEntries(headers.entries()),
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode || 500,
          headers: response.headers,
        }));
      });
    });
    request.setTimeout(15_000, () => request.destroy(new Error('Request timed out.')));
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

async function main() {
  const missing = requiredVariables.filter((name) => !process.env[name]?.trim());
  if (missing.length) fail(`Missing required environment variable(s): ${missing.join(', ')}`);

  const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const siteUrl = new URL(process.env.NEXT_PUBLIC_SITE_URL);
  if (supabaseUrl.protocol !== 'https:') fail('NEXT_PUBLIC_SUPABASE_URL must use HTTPS.');
  if (!['http:', 'https:'].includes(siteUrl.protocol)) fail('NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin.');
  if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail('The browser key and service-role key must not be the same value.');
  }

  let credentialResponse;
  try {
    credentialResponse = await backendFetch(`${supabaseUrl}rest/v1/parcels?select=id&limit=1`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        'User-Agent': 'BhoomiX-Server-Preflight/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    fail('Supabase could not be reached. Check the network connection and project URL.');
  }
  if (!credentialResponse.ok) {
    fail(`SUPABASE_SERVICE_ROLE_KEY was rejected by Supabase (HTTP ${credentialResponse.status}). Copy the current secret key from Project Settings → API Keys.`);
  }

  const supabase = createClient(supabaseUrl.toString(), process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      fetch: backendFetch,
      headers: { 'User-Agent': 'BhoomiX-Server-Preflight/1.0' },
    },
  });
  const checks = [
    ['parcels table', () => supabase.from('parcels').select('id', { count: 'exact', head: true })],
    ['drone_uploads table', () => supabase.from('drone_uploads').select('id', { count: 'exact', head: true })],
    ['imagery_processing_jobs table', () => supabase.from('imagery_processing_jobs').select('id', { count: 'exact', head: true })],
    ['model_feedback_logs table', () => supabase.from('model_feedback_logs').select('id', { count: 'exact', head: true })],
    ['parcel GeoJSON RPC', () => supabase.rpc('get_parcels_as_geojson')],
    ['training lineage RPC', () => supabase.rpc('get_feedback_export')],
    ['private imagery bucket', () => supabase.storage.listBuckets()],
  ];

  for (const [label, run] of checks) {
    const result = await run();
    if (result.error) fail(`${label} check failed: ${describeError(result.error)}`);
    if (label === 'private imagery bucket') {
      const bucket = result.data?.find((candidate) => candidate.id === 'drone_datasets');
      if (!bucket) fail('The drone_datasets storage bucket does not exist.');
      if (bucket.public) fail('The drone_datasets storage bucket must remain private.');
    }
    console.log(`PASS  ${label}`);
  }

  console.log('PASS  Environment values are present and separated safely.');
  console.log('Pre-training infrastructure preflight completed successfully.');
}

main().catch((error) => {
  console.error(`FAIL  ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
