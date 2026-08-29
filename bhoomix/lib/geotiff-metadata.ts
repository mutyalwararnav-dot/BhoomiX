import 'server-only';

import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';

export type BoundingBox = [number, number, number, number];

export interface GeoRasterMetadata {
  georeferenced: boolean;
  width: number;
  height: number;
  sourceCrs: string | null;
  epsg: number | null;
  nativeBoundingBox: BoundingBox | null;
  wgs84BoundingBox: BoundingBox | null;
  footprint: GeoJSON.Polygon | null;
  pixelResolution: [number, number] | null;
  warning: string | null;
}

function numberGeoKey(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (Array.isArray(value) && typeof value[0] === 'number' && Number.isInteger(value[0])) return value[0];
  return null;
}

function projectionForEpsg(epsg: number): string | null {
  if (epsg === 4326) return 'EPSG:4326';
  if (epsg === 3857) return 'EPSG:3857';

  if (epsg >= 32601 && epsg <= 32660) {
    return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  }
  if (epsg >= 32701 && epsg <= 32760) {
    return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  }

  return null;
}

function isFiniteBoundingBox(value: number[]): value is BoundingBox {
  return value.length >= 4 && value.slice(0, 4).every(Number.isFinite) && value[0] < value[2] && value[1] < value[3];
}

function transformBoundingBox(bbox: BoundingBox, sourceProjection: string): BoundingBox | null {
  const corners: Array<[number, number]> = [
    [bbox[0], bbox[1]],
    [bbox[0], bbox[3]],
    [bbox[2], bbox[1]],
    [bbox[2], bbox[3]],
  ];

  try {
    const transformed = corners.map((coordinate) => proj4(sourceProjection, 'EPSG:4326', coordinate));
    const longitudes = transformed.map(([longitude]) => longitude);
    const latitudes = transformed.map(([, latitude]) => latitude);
    const result: BoundingBox = [
      Math.min(...longitudes),
      Math.min(...latitudes),
      Math.max(...longitudes),
      Math.max(...latitudes),
    ];

    if (
      !result.every(Number.isFinite) ||
      result[0] < -180 || result[2] > 180 ||
      result[1] < -90 || result[3] > 90 ||
      result[0] >= result[2] || result[1] >= result[3]
    ) return null;

    return result;
  } catch {
    return null;
  }
}

function bboxPolygon(bbox: BoundingBox): GeoJSON.Polygon {
  const [west, south, east, north] = bbox;
  return {
    type: 'Polygon',
    coordinates: [[
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ]],
  };
}

/** Reads only the first GeoTIFF image's headers; raster pixels are not decoded. */
export async function extractGeoTiffMetadata(buffer: ArrayBuffer): Promise<GeoRasterMetadata> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage(0);
  const width = image.getWidth();
  const height = image.getHeight();
  const geoKeys = image.getGeoKeys();

  let nativeBoundingBox: BoundingBox | null = null;
  try {
    const candidate = image.getBoundingBox();
    if (isFiniteBoundingBox(candidate)) nativeBoundingBox = candidate.slice(0, 4) as BoundingBox;
  } catch {
    // A regular TIFF can be visually valid while having no geographic transform.
  }

  let pixelResolution: [number, number] | null = null;
  try {
    const resolution = image.getResolution();
    if (resolution.length >= 2 && Number.isFinite(resolution[0]) && Number.isFinite(resolution[1])) {
      pixelResolution = [resolution[0], resolution[1]];
    }
  } catch {
    // Missing resolution is reported through the warning below.
  }

  const projectedEpsg = numberGeoKey(geoKeys?.ProjectedCSTypeGeoKey);
  const geographicEpsg = numberGeoKey(geoKeys?.GeographicTypeGeoKey);
  const epsg = projectedEpsg ?? geographicEpsg;
  const sourceProjection = epsg ? projectionForEpsg(epsg) : null;
  const wgs84BoundingBox = nativeBoundingBox && sourceProjection
    ? transformBoundingBox(nativeBoundingBox, sourceProjection)
    : null;

  let warning: string | null = null;
  if (!nativeBoundingBox) {
    warning = 'This TIFF has no usable geographic transform. It can be stored and processed, but it cannot be placed accurately on the map.';
  } else if (!epsg) {
    warning = 'The TIFF contains map bounds but no supported EPSG coordinate-system code, so BhoomiX cannot place it safely on the map.';
  } else if (!sourceProjection) {
    warning = `EPSG:${epsg} is not yet supported for automatic conversion to WGS84.`;
  } else if (!wgs84BoundingBox) {
    warning = `The EPSG:${epsg} bounds could not be converted to valid longitude/latitude coordinates.`;
  }

  return {
    georeferenced: Boolean(nativeBoundingBox && wgs84BoundingBox),
    width,
    height,
    sourceCrs: epsg ? `EPSG:${epsg}` : null,
    epsg,
    nativeBoundingBox,
    wgs84BoundingBox,
    footprint: wgs84BoundingBox ? bboxPolygon(wgs84BoundingBox) : null,
    pixelResolution,
    warning,
  };
}

