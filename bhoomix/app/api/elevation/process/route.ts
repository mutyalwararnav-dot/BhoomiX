import { NextResponse } from 'next/server';
import { extractGeoTiffMetadata } from '@/lib/geotiff-metadata';
import { resolveRequestActor } from '@/lib/request-actor';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import {
  contentLengthError,
  internalServerError,
  mutationRequestError,
  rateLimitRequest,
  serverConfigurationError,
} from '@/lib/request-safety';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_ELEVATION_BYTES = 100 * 1024 * 1024;
const STAGED_PATH = /^incoming\/elevation\/(ori|dsm|dtm)\/[a-f0-9-]+_[^/]+$/i;

interface StagedLayer {
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
  lastModified: number;
}

interface ElevationPayload {
  layers?: { ori?: StagedLayer; dsm?: StagedLayer; dtm?: StagedLayer };
}

interface RasterResponse {
  validation?: {
    status?: string;
    target_crs?: string;
    aligned_width?: number;
    aligned_height?: number;
    wgs84_bounds?: number[];
    ori?: unknown;
    dsm?: unknown;
    dtm?: unknown;
  };
  ndsm_statistics?: Record<string, number>;
  ndsm_geotiff_base64?: string;
  ndsm_preview_base64?: string;
  pipeline?: string;
  detail?: unknown;
}

function validStagedLayer(layer: unknown, expected: 'ori' | 'dsm' | 'dtm'): layer is StagedLayer {
  if (!layer || typeof layer !== 'object') return false;
  const value = layer as Partial<StagedLayer>;
  const extension = value.filename?.split('.').pop()?.toLowerCase();
  return typeof value.storagePath === 'string'
    && STAGED_PATH.test(value.storagePath)
    && value.storagePath.startsWith(`incoming/elevation/${expected}/`)
    && typeof value.filename === 'string'
    && value.filename.length > 0
    && value.filename.length <= 255
    && ['tif', 'tiff'].includes(extension ?? '')
    && value.mimeType === 'image/tiff'
    && Number.isInteger(value.size)
    && Number(value.size) > 0
    && Number(value.size) <= MAX_ELEVATION_BYTES;
}

function hasTiffSignature(bytes: Uint8Array) {
  return bytes.length >= 4 && (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
    || (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2b && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2b)
  );
}

export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'elevation-process', limit: 5, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 32 * 1024);
  if (oversized) return oversized;

  let body: ElevationPayload;
  try {
    body = await request.json() as ElevationPayload;
  } catch {
    return NextResponse.json({ error: 'Request body must contain staged ORI, DSM and DTM layers.' }, { status: 400 });
  }

  const layers = body.layers;
  if (!validStagedLayer(layers?.ori, 'ori') || !validStagedLayer(layers?.dsm, 'dsm') || !validStagedLayer(layers?.dtm, 'dtm')) {
    return NextResponse.json({ error: 'ORI, DSM and DTM must be securely staged GeoTIFF uploads.' }, { status: 400 });
  }

  const staged = { ori: layers.ori, dsm: layers.dsm, dtm: layers.dtm };
  const stagedPaths = Object.values(staged).map(layer => layer.storagePath);
  const derivedPaths: string[] = [];
  let recordsCreated = false;

  const cleanup = async () => {
    if (recordsCreated) return;
    const paths = [...stagedPaths, ...derivedPaths];
    if (paths.length) await supabase.storage.from('drone_datasets').remove(paths);
  };

  try {
    const downloaded = await Promise.all((['ori', 'dsm', 'dtm'] as const).map(async layerName => {
      const layer = staged[layerName];
      const { data, error } = await supabase.storage.from('drone_datasets').download(layer.storagePath);
      if (error || !data) throw new Error(`${layerName.toUpperCase()} could not be downloaded from secure storage.`);
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (bytes.byteLength !== layer.size || !hasTiffSignature(bytes)) {
        throw new Error(`${layerName.toUpperCase()} failed stored-file validation.`);
      }
      const metadata = await extractGeoTiffMetadata(bytes.buffer as ArrayBuffer);
      return { layerName, layer, bytes, metadata };
    }));

    const configuredUrl = process.env.AI_INFERENCE_URL;
    if (!configuredUrl) {
      await cleanup();
      return NextResponse.json({ error: 'The BhoomiX raster service is not configured.' }, { status: 503 });
    }
    const endpoint = new URL(configuredUrl);
    endpoint.pathname = '/elevation/process';
    endpoint.search = '';
    const upstream = new FormData();
    for (const item of downloaded) {
      upstream.append(item.layerName, new Blob([item.bytes], { type: 'image/tiff' }), item.layer.filename);
    }
    const response = await fetch(endpoint, {
      method: 'POST',
      body: upstream,
      signal: AbortSignal.timeout(240_000),
      cache: 'no-store',
    });
    const raster = await response.json().catch(() => null) as RasterResponse | null;
    if (!response.ok || !raster) {
      await cleanup();
      const detail = typeof raster?.detail === 'string' ? raster.detail : 'ORI/DSM/DTM validation failed.';
      return NextResponse.json({ error: detail }, { status: response.status || 502 });
    }
    if (!raster.ndsm_geotiff_base64 || !raster.ndsm_preview_base64 || !raster.validation?.wgs84_bounds || !raster.ndsm_statistics) {
      throw new Error('The raster service returned an incomplete nDSM result.');
    }

    const bundleId = crypto.randomUUID();
    const ndsmBytes = Buffer.from(raster.ndsm_geotiff_base64, 'base64');
    const previewBytes = Buffer.from(raster.ndsm_preview_base64, 'base64');
    const ndsmPath = `derived/elevation/${bundleId}/ndsm.tif`;
    const previewPath = `derived/elevation/${bundleId}/ndsm-preview.png`;
    derivedPaths.push(ndsmPath, previewPath);

    const [ndsmUpload, previewUpload] = await Promise.all([
      supabase.storage.from('drone_datasets').upload(ndsmPath, ndsmBytes, { contentType: 'image/tiff', upsert: false }),
      supabase.storage.from('drone_datasets').upload(previewPath, previewBytes, { contentType: 'image/png', upsert: false }),
    ]);
    if (ndsmUpload.error || previewUpload.error) {
      throw new Error(ndsmUpload.error?.message || previewUpload.error?.message || 'Derived nDSM files could not be stored.');
    }

    const actor = await resolveRequestActor(request);
    const completedAt = new Date().toISOString();
    const originalRows = downloaded.map(item => ({
      filename: item.layer.filename,
      file_path: item.layer.storagePath,
      status: 'ready',
      file_size_bytes: item.layer.size,
      mime_type: 'image/tiff',
      uploaded_by: actor,
      completed_at: completedAt,
      metadata: {
        extension: item.layer.filename.split('.').pop()?.toLowerCase(),
        bundle_id: bundleId,
        layer_type: item.layerName,
        georeferencing: item.metadata,
      },
    }));
    const oriMetadata = downloaded.find(item => item.layerName === 'ori')!.metadata;
    const rows = [
      ...originalRows,
      {
        filename: `${bundleId}_nDSM.tif`,
        file_path: ndsmPath,
        status: 'ready',
        file_size_bytes: ndsmBytes.byteLength,
        mime_type: 'image/tiff',
        uploaded_by: actor,
        completed_at: completedAt,
        metadata: {
          extension: 'tif',
          bundle_id: bundleId,
          layer_type: 'ndsm',
          preview_path: previewPath,
          georeferencing: {
            ...oriMetadata,
            width: raster.validation.aligned_width,
            height: raster.validation.aligned_height,
          },
          validation: raster.validation,
          ndsm_statistics: raster.ndsm_statistics,
          pipeline: raster.pipeline || 'bhoomix-ori-dsm-dtm-v1',
        },
      },
    ];

    const { data: created, error: insertError } = await supabase
      .from('drone_uploads')
      .insert(rows)
      .select('id,metadata');
    if (insertError || !created) throw new Error(insertError?.message || 'Elevation bundle records could not be created.');
    recordsCreated = true;
    const ndsmRecord = created.find(row => (row.metadata as { layer_type?: string } | null)?.layer_type === 'ndsm');
    if (!ndsmRecord) throw new Error('The stored nDSM record could not be identified.');

    return NextResponse.json({
      success: true,
      bundleId,
      ndsmUploadId: ndsmRecord.id,
      previewUrl: `/api/imagery/${ndsmRecord.id}/overlay`,
      validation: raster.validation,
      ndsm_statistics: raster.ndsm_statistics,
      pipeline: raster.pipeline || 'bhoomix-ori-dsm-dtm-v1',
      training_status: 'awaiting_paired_training_samples',
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    await cleanup();
    const message = error instanceof Error ? error.message : 'Unknown elevation processing error';
    console.error('[ElevationProcess] Failed:', message);
    return internalServerError('The ORI/DSM/DTM bundle could not be processed and stored.');
  }
}
