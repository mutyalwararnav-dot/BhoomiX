import 'server-only';

import { validateGeoJsonPolygon } from '@/lib/geometry';
import { validateImageAnnotations, type ImageAnnotation, type ImageAnnotationPoint } from '@/lib/image-annotations';

// Keep this aligned with the annotation persistence and rendering limits.
const MAX_MODEL_PARCELS = 500;
const DEFAULT_TIMEOUT_MS = 120_000;

interface ModelPrediction {
  id?: unknown;
  geometry?: unknown;
  confidence_score?: unknown;
  computed_area_sqm?: unknown;
  land_use?: unknown;
}

interface ModelResponse {
  predictions?: unknown;
  image_predictions?: unknown;
}

export interface InferredParcel {
  id: string;
  status: 'ai_suggestion';
  confidence_score: number;
  computed_area_sqm: number | null;
  land_use: string;
  geometry: GeoJSON.Polygon;
}

export interface ModelInferenceResult {
  parcels: InferredParcel[];
  imageAnnotations: ImageAnnotation[];
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizePrediction(value: unknown, index: number, runId: number): InferredParcel {
  if (!value || typeof value !== 'object') {
    throw new Error(`Model prediction ${index + 1} is not an object.`);
  }

  const prediction = value as ModelPrediction;
  const geometryError = validateGeoJsonPolygon(prediction.geometry);
  if (geometryError) {
    throw new Error(`Model prediction ${index + 1} is invalid: ${geometryError}`);
  }

  const confidence = optionalFiniteNumber(prediction.confidence_score);
  if (confidence === null || confidence < 0 || confidence > 1) {
    throw new Error(`Model prediction ${index + 1} has an invalid confidence_score.`);
  }

  const area = optionalFiniteNumber(prediction.computed_area_sqm);
  if (area !== null && area < 0) {
    throw new Error(`Model prediction ${index + 1} has an invalid computed_area_sqm.`);
  }

  const suppliedId = typeof prediction.id === 'string'
    ? prediction.id.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 120)
    : '';

  return {
    id: suppliedId || `AI-MODEL-${runId}-${index}`,
    status: 'ai_suggestion',
    confidence_score: confidence,
    computed_area_sqm: area,
    land_use: typeof prediction.land_use === 'string'
      ? prediction.land_use.trim().slice(0, 100) || 'unknown'
      : 'unknown',
    geometry: prediction.geometry as GeoJSON.Polygon,
  };
}

function normalizeImagePrediction(value: unknown, index: number, runId: number): ImageAnnotation {
  if (!value || typeof value !== 'object') throw new Error(`Image prediction ${index + 1} is not an object.`);
  const prediction = value as Record<string, unknown>;
  const rawPoints = Array.isArray(prediction.points)
    ? prediction.points
    : Array.isArray(prediction.polygon)
      ? prediction.polygon
      : null;
  if (!rawPoints || rawPoints.length < 3 || rawPoints.length > 100) {
    throw new Error(`Image prediction ${index + 1} must contain between 3 and 100 polygon points.`);
  }

  const numericPoints = rawPoints.map((point) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error(`Image prediction ${index + 1} contains an invalid point.`);
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Image prediction ${index + 1} contains a non-numeric point.`);
    return { x, y };
  });
  const normalizedSpace = prediction.coordinate_space === 'normalized'
    || numericPoints.every(({ x, y }) => x >= 0 && x <= 1 && y >= 0 && y <= 1);
  const points: ImageAnnotationPoint[] = numericPoints.map(({ x, y }) => ({
    x: normalizedSpace ? x * 1000 : x,
    y: normalizedSpace ? y * 1000 : y,
  }));
  const confidence = optionalFiniteNumber(prediction.confidence_score);
  const suppliedId = typeof prediction.id === 'string'
    ? prediction.id.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
    : '';
  const annotation: ImageAnnotation = {
    id: suppliedId || `MODEL-${runId}-${index}`,
    confidence,
    points,
    status: 'pending',
    source: 'model',
  };
  const validation = validateImageAnnotations([annotation]);
  if (validation.error || !validation.annotations?.[0]) {
    throw new Error(`Image prediction ${index + 1} is invalid: ${validation.error || 'Unknown annotation error.'}`);
  }
  return validation.annotations[0];
}

export function isModelConfigured() {
  return Boolean(process.env.AI_INFERENCE_URL);
}

export async function runModelInference(file: File): Promise<ModelInferenceResult> {
  const endpoint = process.env.AI_INFERENCE_URL;
  if (!endpoint) throw new Error('AI_INFERENCE_URL is not configured.');

  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(endpoint);
  } catch {
    throw new Error('AI_INFERENCE_URL is not a valid URL.');
  }

  if (!['http:', 'https:'].includes(parsedEndpoint.protocol)) {
    throw new Error('AI_INFERENCE_URL must use HTTP or HTTPS.');
  }

  const configuredTimeout = Number(process.env.AI_INFERENCE_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
    ? Math.min(configuredTimeout, 300_000)
    : DEFAULT_TIMEOUT_MS;

  const form = new FormData();
  form.append('file', file, file.name);

  const headers = new Headers({ Accept: 'application/json' });
  if (process.env.AI_INFERENCE_API_KEY) {
    headers.set('Authorization', `Bearer ${process.env.AI_INFERENCE_API_KEY}`);
  }

  const response = await fetch(parsedEndpoint, {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`AI service returned HTTP ${response.status}.`);
  }

  let payload: ModelResponse;
  try {
    payload = await response.json() as ModelResponse;
  } catch {
    throw new Error('AI service returned invalid JSON.');
  }

  const parcelPredictions = Array.isArray(payload.predictions) ? payload.predictions : [];
  const imagePredictions = Array.isArray(payload.image_predictions) ? payload.image_predictions : [];
  if (parcelPredictions.length === 0 && imagePredictions.length === 0) {
    throw new Error('AI service did not detect any parcel boundaries.');
  }
  if (parcelPredictions.length + imagePredictions.length > MAX_MODEL_PARCELS) {
    throw new Error(`AI service returned more than ${MAX_MODEL_PARCELS} parcels in one request.`);
  }

  const runId = Date.now();
  return {
    parcels: parcelPredictions.map((prediction, index) => normalizePrediction(prediction, index, runId)),
    imageAnnotations: imagePredictions.map((prediction, index) => normalizeImagePrediction(prediction, index, runId)),
  };
}
