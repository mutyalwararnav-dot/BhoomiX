// lib/supabase.ts
// Supabase client singleton for BhoomiX
// Use this in both client and server components

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[BhoomiX] Supabase credentials not set.\n' +
    'Map will load but parcel data will not be available.\n' +
    'Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local'
  );
}

// Use placeholder values so createClient doesn't throw on empty strings.
// Actual requests will fail gracefully and show an error in the map UI.
export const supabase = createClient(
  supabaseUrl  || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
);


// ─── Type Definitions ─────────────────────────────────────────────────────────

export type ParcelStatus =
  | 'ai_suggestion'
  | 'confirmed'
  | 'conflict'
  | 'pending'
  | 'reviewed_edited'
  | 'rejected';

export interface Parcel {
  id: string;
  status: ParcelStatus;
  confidence_score: number | null;
  computed_area_sqm: number | null;
  land_use: string | null;
  geometry: GeoJSON.Polygon;
}

export interface ParcelAuditEntry {
  id: number;
  parcel_id: string;
  previous_status: ParcelStatus | null;
  new_status: ParcelStatus | null;
  previous_geometry: GeoJSON.Polygon | null;
  new_geometry: GeoJSON.Polygon | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ParcelFeature extends GeoJSON.Feature<GeoJSON.Polygon> {
  properties: {
    id: string;
    status: ParcelStatus;
    confidence_score: number | null;
    computed_area_sqm: number | null;
    land_use: string | null;
  };
}
