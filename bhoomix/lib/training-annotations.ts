import { validateImageAnnotations, type ImageAnnotation } from '@/lib/image-annotations';

export interface ImageDimensions {
  width: number;
  height: number;
}

export interface TrainingUploadMetadata {
  image_dimensions?: unknown;
  imageAnnotations?: {
    annotations?: unknown;
    savedAt?: unknown;
    savedBy?: unknown;
  };
  [key: string]: unknown;
}

function readImageDimensions(value: unknown): ImageDimensions | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.width !== 'number'
    || typeof candidate.height !== 'number'
    || !Number.isInteger(candidate.width)
    || !Number.isInteger(candidate.height)
    || candidate.width <= 0
    || candidate.height <= 0
  ) return null;
  return { width: candidate.width, height: candidate.height };
}

export function summarizeTrainingAnnotations(metadataValue: unknown) {
  const metadata = metadataValue && typeof metadataValue === 'object'
    ? metadataValue as TrainingUploadMetadata
    : {};
  const validation = validateImageAnnotations(metadata.imageAnnotations?.annotations ?? []);
  const annotations = validation.annotations ?? [];
  const approved = annotations.filter((annotation) => annotation.status === 'approved' && annotation.source !== 'demo');

  return {
    approved,
    rejected: annotations.filter((annotation) => annotation.status === 'rejected').length,
    pending: annotations.filter((annotation) => annotation.status === 'pending').length,
    excludedDemo: annotations.filter((annotation) => annotation.status === 'approved' && annotation.source === 'demo').length,
    dimensions: readImageDimensions(metadata.image_dimensions),
    savedAt: typeof metadata.imageAnnotations?.savedAt === 'string' ? metadata.imageAnnotations.savedAt : null,
    savedBy: typeof metadata.imageAnnotations?.savedBy === 'string' ? metadata.imageAnnotations.savedBy : null,
    validationError: validation.error ?? null,
  };
}

export function annotationToTrainingPolygons(annotation: ImageAnnotation, dimensions: ImageDimensions | null) {
  const normalized = annotation.points.map(({ x, y }) => [x / 1000, y / 1000]);
  return {
    id: annotation.id,
    source: annotation.source,
    confidence: annotation.confidence,
    polygon_normalized: normalized,
    polygon_pixels: dimensions
      ? normalized.map(([x, y]) => [Math.round(x * dimensions.width), Math.round(y * dimensions.height)])
      : null,
  };
}
