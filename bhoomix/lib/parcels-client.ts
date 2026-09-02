'use client';

import { apiFetch } from '@/lib/api-fetch';
import type { ParcelFeature } from '@/lib/supabase';

export interface ActiveParcelsPayload {
  geojson: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
  legacyHiddenCount: number;
}

export async function fetchActiveParcels(): Promise<ActiveParcelsPayload> {
  const response = await apiFetch('/api/parcels', { cache: 'no-store' });
  const payload = await response.json().catch(() => null) as {
    geojson?: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
    legacyHiddenCount?: number;
    error?: string;
  } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Parcel loading failed with status ${response.status}.`);
  }
  if (!payload?.geojson || payload.geojson.type !== 'FeatureCollection' || !Array.isArray(payload.geojson.features)) {
    throw new Error('The parcel service returned an invalid response.');
  }

  return {
    geojson: {
      type: 'FeatureCollection',
      features: payload.geojson.features as ParcelFeature[],
    },
    legacyHiddenCount: Number.isFinite(payload.legacyHiddenCount) ? Number(payload.legacyHiddenCount) : 0,
  };
}
