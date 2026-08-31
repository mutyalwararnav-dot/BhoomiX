export type ImageAnnotationStatus = 'pending' | 'approved' | 'rejected';
export type ImageAnnotationSource = 'demo' | 'manual' | 'model';

export interface ImageAnnotationPoint {
  x: number;
  y: number;
}

export interface ImageAnnotation {
  id: string;
  confidence: number | null;
  points: ImageAnnotationPoint[];
  status: ImageAnnotationStatus;
  source: ImageAnnotationSource;
}

const ANNOTATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const ALLOWED_STATUSES = new Set<ImageAnnotationStatus>(['pending', 'approved', 'rejected']);
const ALLOWED_SOURCES = new Set<ImageAnnotationSource>(['demo', 'manual', 'model']);

export function validateImageAnnotations(value: unknown): { annotations?: ImageAnnotation[]; error?: string } {
  if (!Array.isArray(value)) return { error: 'Annotations must be an array.' };
  if (value.length > 500) return { error: 'A maximum of 500 image polygons can be saved at once.' };

  const ids = new Set<string>();
  const annotations: ImageAnnotation[] = [];
  for (const [annotationIndex, candidate] of value.entries()) {
    if (!candidate || typeof candidate !== 'object') return { error: `Annotation ${annotationIndex + 1} is invalid.` };
    const row = candidate as Record<string, unknown>;
    if (typeof row.id !== 'string' || !ANNOTATION_ID_PATTERN.test(row.id) || ids.has(row.id)) {
      return { error: `Annotation ${annotationIndex + 1} has an invalid or duplicate identifier.` };
    }
    if (!ALLOWED_STATUSES.has(row.status as ImageAnnotationStatus) || !ALLOWED_SOURCES.has(row.source as ImageAnnotationSource)) {
      return { error: `Annotation ${row.id} has an invalid status or source.` };
    }
    if (row.confidence !== null && (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1)) {
      return { error: `Annotation ${row.id} has an invalid confidence score.` };
    }
    if (!Array.isArray(row.points) || row.points.length < 3 || row.points.length > 100) {
      return { error: `Annotation ${row.id} must contain between 3 and 100 points.` };
    }
    const points: ImageAnnotationPoint[] = [];
    for (const point of row.points) {
      if (!point || typeof point !== 'object') return { error: `Annotation ${row.id} contains an invalid point.` };
      const { x, y } = point as Record<string, unknown>;
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 1000) {
        return { error: `Annotation ${row.id} contains a point outside the image.` };
      }
      points.push({ x, y });
    }
    ids.add(row.id);
    annotations.push({
      id: row.id,
      confidence: row.confidence as number | null,
      points,
      status: row.status as ImageAnnotationStatus,
      source: row.source as ImageAnnotationSource,
    });
  }
  return { annotations };
}
