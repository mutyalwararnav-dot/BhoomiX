import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { contentLengthError, internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { isModelConfigured, runModelInference, type InferredParcel } from '@/lib/ai-inference';
import type { ImageAnnotation } from '@/lib/image-annotations';
import { resolveRequestActor } from '@/lib/request-actor';
import { extractGeoTiffMetadata, type GeoRasterMetadata } from '@/lib/geotiff-metadata';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/tiff']);
const ALLOWED_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff']);
const STAGED_PATH_PATTERN = /^incoming\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[a-zA-Z0-9._-]{1,120}$/i;

type VerifiedImageType = 'image/jpeg' | 'image/png' | 'image/tiff';

function detectImageType(bytes: Uint8Array): VerifiedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'image/png';
  if (
    bytes.length >= 4
    && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
      || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  ) return 'image/tiff';
  return null;
}

// ─── POST /api/process-imagery ────────────────────────────────────────────────
// Accepts a small JSON reference to a direct-to-Supabase upload. Multipart is
// retained for local/backward compatibility, but production clients use JSON.
// 1. Downloads a staged private image, or stores a legacy multipart upload
// 2. Inserts a drone_uploads record             (status: processing_ai → ready)
// 3. Calls the configured AI service. Without a model, no boundaries are invented.
// 4. Stores map-space parcels and image-space boundary predictions
// Returns { success, uploadId, parcelCount, imageAnnotationCount }
export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'process-imagery', limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, MAX_IMAGE_BYTES + 1024 * 1024);
  if (oversized) return oversized;

  let trackedUploadId: string | null = null;
  let trackedJobId: string | null = null;

  try {
    const actor = await resolveRequestActor(request);
    let file: File;
    let fileBuffer: ArrayBuffer;
    let filePath: string | null = null;
    let alreadyStored = false;

    if (request.headers.get('content-type')?.includes('application/json')) {
      let body: Record<string, unknown>;
      try {
        body = await request.json() as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
      }

      const storagePath = typeof body.storagePath === 'string' ? body.storagePath : '';
      const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
      const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
      const size = typeof body.size === 'number' ? body.size : Number.NaN;
      const lastModified = typeof body.lastModified === 'number' && Number.isFinite(body.lastModified)
        ? body.lastModified
        : Date.now();

      if (!STAGED_PATH_PATTERN.test(storagePath) || !filename || filename.length > 255) {
        return NextResponse.json({ error: 'The staged image reference is invalid.' }, { status: 400 });
      }
      if (!ALLOWED_IMAGE_TYPES.has(mimeType) || !Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
        return NextResponse.json({ error: 'The staged image metadata is invalid.' }, { status: 400 });
      }

      const { data: storedFile, error: downloadError } = await supabase.storage
        .from('drone_datasets')
        .download(storagePath);
      if (downloadError || !storedFile) {
        console.error('[ProcessImagery] Staged image download failed:', downloadError?.message);
        return NextResponse.json({ error: 'The staged image could not be loaded.' }, { status: 422 });
      }
      if (storedFile.size !== size || storedFile.size <= 0 || storedFile.size > MAX_IMAGE_BYTES) {
        await supabase.storage.from('drone_datasets').remove([storagePath]);
        return NextResponse.json({ error: 'The staged image size does not match the upload request.' }, { status: 422 });
      }

      fileBuffer = await storedFile.arrayBuffer();
      file = new File([fileBuffer], filename, { type: mimeType, lastModified });
      filePath = storagePath;
      alreadyStored = true;
    } else {
      let formData: FormData;
      try {
        formData = await request.formData();
      } catch {
        return NextResponse.json(
          { error: 'Send a staged image as JSON or multipart/form-data with a file field.' },
          { status: 400 },
        );
      }
      const multipartFile = formData.get('file');
      if (!(multipartFile instanceof File)) {
        return NextResponse.json({ error: 'No image file was provided.' }, { status: 400 });
      }
      file = multipartFile;
      fileBuffer = await file.arrayBuffer();
    }

    const cleanupStagedFile = async () => {
      if (!alreadyStored || !filePath) return;
      const { error } = await supabase.storage.from('drone_datasets').remove([filePath]);
      if (error) console.warn('[ProcessImagery] Invalid staged-file cleanup failed:', error.message);
    };

    if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
      await cleanupStagedFile();
      return NextResponse.json(
        { error: 'Image must be larger than 0 bytes and no more than 25 MB.' },
        { status: 413 }
      );
    }

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_IMAGE_TYPES.has(file.type) && !ALLOWED_IMAGE_EXTENSIONS.has(extension)) {
      await cleanupStagedFile();
      return NextResponse.json(
        { error: 'Unsupported image type. Upload a JPG, PNG, TIFF, or TIF file.' },
        { status: 415 }
      );
    }

    // ── 2. Verify bytes and store legacy multipart uploads ─────────────────
    const verifiedType = detectImageType(new Uint8Array(fileBuffer, 0, Math.min(fileBuffer.byteLength, 16)));
    if (!verifiedType) {
      await cleanupStagedFile();
      return NextResponse.json(
        { error: 'The uploaded file contents are not a supported JPG, PNG, or TIFF image.' },
        { status: 415 },
      );
    }
    const expectedExtensions: Record<VerifiedImageType, Set<string>> = {
      'image/jpeg': new Set(['jpg', 'jpeg']),
      'image/png': new Set(['png']),
      'image/tiff': new Set(['tif', 'tiff']),
    };
    if (verifiedType !== file.type) {
      await cleanupStagedFile();
      return NextResponse.json(
        { error: 'The declared image type does not match the uploaded file contents.' },
        { status: 415 },
      );
    }
    if (!expectedExtensions[verifiedType].has(extension)) {
      await cleanupStagedFile();
      return NextResponse.json(
        { error: `The file extension does not match its ${verifiedType} contents.` },
        { status: 415 },
      );
    }
    const isTiff = verifiedType === 'image/tiff';
    let georeferencing: GeoRasterMetadata | null = null;
    let imageDimensions: { width: number; height: number } | null = null;

    if (isTiff) {
      try {
        georeferencing = await extractGeoTiffMetadata(fileBuffer);
        imageDimensions = { width: georeferencing.width, height: georeferencing.height };
      } catch (metadataError: unknown) {
        const message = metadataError instanceof Error ? metadataError.message : 'Unknown TIFF parsing error';
        console.error('[ProcessImagery] TIFF metadata parsing failed:', message);
        await cleanupStagedFile();
        return NextResponse.json(
          { error: 'The TIFF file could not be read or contains unsupported metadata.' },
          { status: 422 }
        );
      }
    } else {
      try {
        const decodedMetadata = await sharp(Buffer.from(fileBuffer), { limitInputPixels: 100_000_000 }).metadata();
        if (!decodedMetadata.width || !decodedMetadata.height) throw new Error('Image dimensions are unavailable.');
        imageDimensions = { width: decodedMetadata.width, height: decodedMetadata.height };
      } catch (metadataError: unknown) {
        const message = metadataError instanceof Error ? metadataError.message : 'Unknown image parsing error';
        console.error('[ProcessImagery] Raster metadata parsing failed:', message);
        await cleanupStagedFile();
        return NextResponse.json(
          { error: 'The image could not be decoded safely.' },
          { status: 422 },
        );
      }
    }

    const processingMode = isModelConfigured() ? 'model' : 'demo';
    const modelVersion = processingMode === 'model'
      ? process.env.AI_MODEL_VERSION || 'unversioned'
      : 'manual-review-v1';
    // Start local inference as soon as the bytes and dimensions are verified.
    // Cloud storage and database setup can proceed at the same time.
    const earlyInference = processingMode === 'model'
      ? runModelInference(file)
          .then((result) => ({ result, error: null as unknown }))
          .catch((error: unknown) => ({ result: null, error }))
      : null;

    if (!alreadyStored) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'upload';
      const legacyStoragePath = `uploads/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
      const { data: storageData, error: storageError } = await supabase.storage
        .from('drone_datasets')
        .upload(legacyStoragePath, fileBuffer, {
          contentType: verifiedType,
          cacheControl: '3600',
          upsert: false,
        });

      if (storageError) {
        console.error('[ProcessImagery] Storage upload failed:', storageError.message);
        return NextResponse.json(
          { error: 'The image could not be stored. Please try again.' },
          { status: 500, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      filePath = storageData.path;
    }
    if (!filePath) return internalServerError('The stored image reference is unavailable.');

    const uploadMetadata = {
      extension,
      last_modified: file.lastModified || null,
      image_dimensions: imageDimensions,
      georeferencing: georeferencing ?? {
        georeferenced: false,
        sourceCrs: null,
        epsg: null,
        nativeBoundingBox: null,
        wgs84BoundingBox: null,
        footprint: null,
        pixelResolution: null,
        warning: 'JPG and PNG files do not provide a complete image-to-map transform. Upload a georeferenced GeoTIFF for an accurate map overlay.',
      },
    };

    // ── 3. Create processing records ───────────────────────────────────────
    // Write the active state immediately. Avoiding separate queued/uploaded
    // updates saves two cloud round trips on every synchronous upload.
    const processingStartedAt = new Date().toISOString();
    const { data: uploadRow, error: insertError } = await supabase
      .from('drone_uploads')
      .insert({
        filename: file.name,
        file_path: filePath,
        status: 'processing_ai',
        file_size_bytes: file.size,
        mime_type: verifiedType,
        uploaded_by: actor,
        metadata: uploadMetadata,
      })
      .select()
      .single();

    if (insertError) {
      console.error('[ProcessImagery] drone_uploads insert failed:', insertError.message);
      const { error: cleanupError } = await supabase.storage.from('drone_datasets').remove([filePath]);
      if (cleanupError) console.warn('[ProcessImagery] Orphan cleanup failed:', cleanupError.message);
      return NextResponse.json(
        { error: 'The upload record could not be created.' },
        { status: 500, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    const uploadId: string = uploadRow.id;
    trackedUploadId = uploadId;

    const { data: jobRow, error: jobError } = await supabase
      .from('imagery_processing_jobs')
      .insert({
        upload_id: uploadId,
        status: 'processing',
        processing_mode: processingMode,
        progress: 20,
        model_version: modelVersion,
        requested_by: actor,
        started_at: processingStartedAt,
        updated_at: processingStartedAt,
      })
      .select('id')
      .single();

    if (jobError) {
      console.error('[ProcessImagery] Job creation failed:', jobError.message);
      await supabase.from('drone_uploads').update({ status: 'failed', error_message: jobError.message }).eq('id', uploadId);
      return internalServerError('The processing job could not be created.');
    }

    const jobId: string = jobRow.id;
    trackedJobId = jobId;

    // ── 4. Run model inference ──────────────────────────────────────────────
    let inferredParcels: InferredParcel[] = [];
    let imageAnnotations: ImageAnnotation[] = [];

    if (processingMode === 'model') {
      try {
        const settledInference = await earlyInference;
        if (!settledInference?.result) throw settledInference?.error || new Error('The AI service returned no result.');
        const inference = settledInference.result;
        inferredParcels = inference.parcels;
        imageAnnotations = inference.imageAnnotations;
      } catch (modelError: unknown) {
        const message = modelError instanceof Error ? modelError.message : 'Unknown AI service error';
        console.error('[ProcessImagery] AI inference failed:', message);
        const failedAt = new Date().toISOString();
        await Promise.all([
          supabase.from('drone_uploads').update({ status: 'failed', error_message: message }).eq('id', uploadId),
          supabase.from('imagery_processing_jobs').update({ status: 'failed', progress: 100, error_message: message, completed_at: failedAt, updated_at: failedAt }).eq('id', jobId),
        ]);
        return NextResponse.json({ error: 'The AI processing service failed.', jobId }, { status: 502 });
      }
    }

    // ── 5. Insert parcels via existing RPC ──────────────────────────────────
    const parcelsWithLineage = inferredParcels.map((parcel) => ({
      ...parcel,
      source_upload_id: uploadId,
      source_type: processingMode,
      model_version: modelVersion,
    }));

    if (parcelsWithLineage.length > 0) {
      const { data: rpcResult, error: rpcError } = await supabase.rpc('seed_mock_parcels', {
        parcels_input: parcelsWithLineage,
      });

      const rpcFailure = rpcResult && typeof rpcResult === 'object' && rpcResult.success === false
        ? String(rpcResult.error || 'Parcel ingestion RPC returned failure.')
        : null;

      if (rpcError || rpcFailure) {
        const failureMessage = rpcError?.message || rpcFailure || 'Unknown parcel insertion error';
        console.error('[ProcessImagery] seed_mock_parcels RPC failed:', failureMessage);
        const failedAt = new Date().toISOString();
        await Promise.all([
          supabase.from('drone_uploads').update({ status: 'failed', error_message: failureMessage }).eq('id', uploadId),
          supabase.from('imagery_processing_jobs').update({ status: 'failed', progress: 100, error_message: failureMessage, completed_at: failedAt, updated_at: failedAt }).eq('id', jobId),
        ]);
        return NextResponse.json(
          { error: 'The detected parcels could not be stored.', jobId },
          { status: 500 }
        );
      }
    }

    // ── 6. Prepare final persisted result ──────────────────────────────────
    const processedMetadata = imageAnnotations.length > 0
      ? {
          ...uploadMetadata,
          imageAnnotations: {
            version: 1,
            annotations: imageAnnotations,
            savedAt: new Date().toISOString(),
            savedBy: `Model ${modelVersion}`,
          },
        }
      : uploadMetadata;
    // ── 7. Spatial validation ───────────────────────────────────────────────
    // Run the PostGIS overlap scan on ALL ai_suggestion parcels.
    // Any newly inserted polygon that intersects an existing one will have
    // its status automatically promoted to 'conflict'.
    let conflictCount = 0;
    if (inferredParcels.length > 0) {
      try {
        const { data: validationData, error: validationError } = await supabase.rpc(
          'flag_overlapping_parcels',
          { p_tolerance_sqm: 1.0 }
        );

        if (validationError) {
          console.warn('[ProcessImagery] Spatial validation warning:', validationError.message);
        } else {
          const pairs = (validationData ?? []) as Array<{ parcel_a: string; parcel_b: string; overlap_sqm: number }>;
          conflictCount = pairs.length;
          if (conflictCount > 0) {
            console.log(`[ProcessImagery] Spatial validation: ${conflictCount} overlap pair(s) flagged as conflict`);
            pairs.forEach(p =>
              console.log(`  → ${p.parcel_a} ∩ ${p.parcel_b} = ${p.overlap_sqm.toFixed(2)} m²`)
            );
          }
        }
      } catch (e) {
        console.warn('[ProcessImagery] Spatial validation skipped (RPC not deployed?):', e);
      }
    }

    const detectedBoundaryCount = inferredParcels.length + imageAnnotations.length;

    // Persist both final states concurrently. Image Analysis already receives
    // annotations in this response, so an intermediate 85% write adds latency
    // without improving what the user sees.
    const processingFinishedAt = new Date().toISOString();
    await Promise.all([
      supabase
        .from('drone_uploads')
        .update({ status: 'ready', error_message: null, completed_at: processingFinishedAt, metadata: processedMetadata })
        .eq('id', uploadId),
      supabase
        .from('imagery_processing_jobs')
        .update({
          status: 'completed',
          progress: 100,
          parcel_count: detectedBoundaryCount,
          conflict_count: conflictCount,
          completed_at: processingFinishedAt,
          updated_at: processingFinishedAt,
        })
        .eq('id', jobId),
    ]);

    return NextResponse.json({
      success:       true,
      uploadId,
      jobId,
      jobStatus:     'completed',
      parcelCount:   inferredParcels.length,
      imageAnnotationCount: imageAnnotations.length,
      // The browser already waited for inference, so return these results with
      // the completion response instead of forcing Image Analysis to fetch the
      // same JSON from Supabase again.
      imageAnnotations,
      conflictCount, // number of overlap pairs detected — may be 0
      processingMode,
      georeferencing: {
        isGeoreferenced: georeferencing?.georeferenced ?? false,
        sourceCrs: georeferencing?.sourceCrs ?? null,
        epsg: georeferencing?.epsg ?? null,
        boundingBox: georeferencing?.wgs84BoundingBox ?? null,
        warning: georeferencing?.warning ?? 'This image has no complete map transform. Use a georeferenced GeoTIFF for accurate placement.',
      },
      processingNotice: processingMode === 'demo'
        ? 'No trained model is connected, so BhoomiX did not invent automatic boundaries. Use Add Polygon for manual labels or connect the trained inference service.'
        : null,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ProcessImagery] Unexpected error:', message);
    const failedAt = new Date().toISOString();
    const failureWrites = [];
    if (trackedUploadId) {
      failureWrites.push(supabase.from('drone_uploads').update({ status: 'failed', error_message: message }).eq('id', trackedUploadId));
    }
    if (trackedJobId) {
      failureWrites.push(supabase.from('imagery_processing_jobs').update({ status: 'failed', progress: 100, error_message: message, completed_at: failedAt, updated_at: failedAt }).eq('id', trackedJobId));
    }
    await Promise.all(failureWrites);
    return internalServerError('Image processing could not be completed.');
  }
}
