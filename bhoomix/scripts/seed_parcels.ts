// scripts/seed_parcels.ts
// Seed mock cadastral parcels around Pune, India into Supabase
//
// Usage:
//   npx tsx scripts/seed_parcels.ts
//
// Requires .env.local with:
//   NEXT_PUBLIC_SUPABASE_URL=...
//   NEXT_PUBLIC_SUPABASE_ANON_KEY=...

// CRITICAL: Load dotenv BEFORE any other imports that might use env vars
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import type { ParcelStatus } from '../lib/supabase';

// ─── Validate Environment ─────────────────────────────────────────────────────

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing environment variables.');
  console.error('   Ensure .env.local contains:');
  console.error('   NEXT_PUBLIC_SUPABASE_URL=...');
  console.error('   NEXT_PUBLIC_SUPABASE_ANON_KEY=...');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Pune Bounding Box ────────────────────────────────────────────────────────
// Approximate area: Kothrud, Baner, Aundh, Hinjewadi corridor
const PUNE_CENTER = { lat: 18.52, lng: 73.855 };

// ─── Geometry Helpers ─────────────────────────────────────────────────────────

function randomOffset(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}

/**
 * Generate a pseudo-rectangular cadastral parcel polygon
 * around a given centroid, with slight irregular edges
 */
function generateParcelPolygon(
  centerLat: number,
  centerLng: number,
  widthDeg: number,
  heightDeg: number,
  rotationDeg: number = 0
): GeoJSON.Polygon {
  const rot = (rotationDeg * Math.PI) / 180;

  // Corner offsets before rotation
  const corners = [
    [-widthDeg / 2, -heightDeg / 2],
    [widthDeg / 2, -heightDeg / 2],
    [widthDeg / 2, heightDeg / 2],
    [-widthDeg / 2, heightDeg / 2],
  ].map(([dx, dy]) => {
    // Apply rotation
    const rx = dx * Math.cos(rot) - dy * Math.sin(rot);
    const ry = dx * Math.sin(rot) + dy * Math.cos(rot);
    // Add slight noise for realistic cadastral shapes
    const noise = widthDeg * 0.08;
    return [
      centerLng + rx + randomOffset(noise),
      centerLat + ry + randomOffset(noise),
    ] as [number, number];
  });

  // Close the polygon ring
  const ring: [number, number][] = [...corners, corners[0]];

  return {
    type: 'Polygon',
    coordinates: [ring],
  };
}

/**
 * Calculate approximate area in sqm from a GeoJSON polygon
 * (simple flat-earth approximation for mock data)
 */
function approximateAreaSqm(polygon: GeoJSON.Polygon): number {
  const ring = polygon.coordinates[0];
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    area += x1 * y2 - x2 * y1;
  }
  // Convert degrees² → m² (rough: 1deg ≈ 111,320m at equator)
  const areaInDegSq = Math.abs(area) / 2;
  return areaInDegSq * 111320 * 111320 * Math.cos((PUNE_CENTER.lat * Math.PI) / 180);
}

// ─── Mock Parcel Definitions ──────────────────────────────────────────────────

interface MockParcelInput {
  id: string;
  status: ParcelStatus;
  confidence_score: number;
  land_use: string;
  geometry: GeoJSON.Polygon;
  computed_area_sqm: number;
}

const LAND_USES = ['residential', 'commercial', 'agricultural', 'industrial', 'mixed_use', 'public'];
const STATUSES: ParcelStatus[] = ['ai_suggestion', 'confirmed', 'conflict', 'pending'];
const STATUS_WEIGHTS = [0.35, 0.40, 0.10, 0.15]; // probability distribution

function weightedStatus(): ParcelStatus {
  const r = Math.random();
  let cumulative = 0;
  for (let i = 0; i < STATUSES.length; i++) {
    cumulative += STATUS_WEIGHTS[i];
    if (r < cumulative) return STATUSES[i];
  }
  return 'pending';
}

function confidenceForStatus(status: ParcelStatus): number {
  switch (status) {
    case 'confirmed':    return 0.85 + Math.random() * 0.15; // 0.85–1.0
    case 'ai_suggestion': return 0.55 + Math.random() * 0.30; // 0.55–0.85
    case 'conflict':     return 0.10 + Math.random() * 0.40; // 0.10–0.50
    case 'pending':      return 0.40 + Math.random() * 0.35; // 0.40–0.75
    case 'reviewed_edited': return 0.90 + Math.random() * 0.10; // 0.90-1.0
    default:             return 0.50;
  }
}

// Named landmark-based parcel clusters for realism
const PUNE_CLUSTERS = [
  { name: 'Kothrud',    lat: 18.5074, lng: 73.8077 },
  { name: 'Baner',      lat: 18.5590, lng: 73.7868 },
  { name: 'Aundh',      lat: 18.5591, lng: 73.8081 },
  { name: 'Hinjewadi',  lat: 18.5912, lng: 73.7390 },
  { name: 'Wakad',      lat: 18.5997, lng: 73.7641 },
  { name: 'Hadapsar',   lat: 18.5018, lng: 73.9277 },
  { name: 'Viman Nagar',lat: 18.5679, lng: 73.9143 },
  { name: 'Koregaon Pk',lat: 18.5362, lng: 73.8944 },
  { name: 'Shivajinagar',lat: 18.5309, lng: 73.8474},
  { name: 'Deccan',     lat: 18.5168, lng: 73.8478 },
];

function generateMockParcels(): MockParcelInput[] {
  const parcels: MockParcelInput[] = [];
  let index = 0;

  PUNE_CLUSTERS.forEach(({ name, lat, lng }) => {
    // 2–3 parcels per cluster
    const count = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      index++;
      const clusterLat = lat + randomOffset(0.008);
      const clusterLng = lng + randomOffset(0.012);
      const widthDeg  = 0.001 + Math.random() * 0.003;  // ~100–400m wide
      const heightDeg = 0.001 + Math.random() * 0.003;
      const rotation  = Math.random() * 45;

      const status = weightedStatus();
      const geometry = generateParcelPolygon(clusterLat, clusterLng, widthDeg, heightDeg, rotation);

      parcels.push({
        id:                `PUNE-${name.replace(/\s+/g, '').toUpperCase()}-${String(index).padStart(3, '0')}`,
        status,
        confidence_score:  parseFloat(confidenceForStatus(status).toFixed(4)),
        land_use:          LAND_USES[Math.floor(Math.random() * LAND_USES.length)],
        geometry,
        computed_area_sqm: parseFloat(approximateAreaSqm(geometry).toFixed(2)),
      });
    }
  });

  return parcels;
}

// ─── Main Seeding Function ────────────────────────────────────────────────────

async function main() {
  console.log('🌏 BhoomiX Parcel Seeder');
  console.log('━'.repeat(50));
  console.log(`📡 Supabase URL: ${SUPABASE_URL}`);

  const parcels = generateMockParcels();
  console.log(`\n📦 Generated ${parcels.length} mock parcels around Pune, India`);

  // Show distribution
  const statusCounts = parcels.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('   Status distribution:', statusCounts);

  // Invoke the seed_mock_parcels RPC
  console.log('\n⬆️  Seeding via seed_mock_parcels RPC...');

  const { data, error } = await supabase.rpc('seed_mock_parcels', {
    parcels_input: parcels,
  });

  if (error) {
    console.error('❌ RPC error:', error.message);
    console.error('   Details:', error.details);
    console.error('   Hint:', error.hint);
    process.exit(1);
  }

  console.log('\n✅ Seeding complete!');
  console.log('   Result:', JSON.stringify(data, null, 2));

  // Verify by counting
  const { count, error: countError } = await supabase
    .from('parcels')
    .select('*', { count: 'exact', head: true });

  if (!countError) {
    console.log(`\n📊 Total parcels in database: ${count}`);
  }

  console.log('\n🗺️  Open the BhoomiX dashboard to see your parcels on the map!');
}

main().catch((err) => {
  console.error('💥 Unexpected error:', err);
  process.exit(1);
});
