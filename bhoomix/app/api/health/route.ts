import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (!configured) {
    return NextResponse.json(
      { status: 'unhealthy', database: 'not_configured' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const { error } = await supabase.rpc('get_parcels_as_geojson');

    if (error) {
      console.error('[Health] Supabase check failed:', error.message);
      return NextResponse.json(
        { status: 'degraded', database: 'unavailable' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    return NextResponse.json(
      { status: 'healthy', database: 'connected' },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Health] Unexpected error:', message);
    return NextResponse.json(
      { status: 'degraded', database: 'unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
