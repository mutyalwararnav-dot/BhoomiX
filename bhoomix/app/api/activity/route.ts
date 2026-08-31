import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

type ActivityAction = 'edited' | 'rejected' | 'confirmed';

interface ActivityRow {
  id?: string;
  log_id?: string;
  parcel_id: string;
  action: ActivityAction;
  surveyor_id: string | null;
  area_delta_sqm: number | null;
  created_at: string;
}

export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'activity-history', limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  try {
    // Use the deployed SECURITY DEFINER export RPC so public guest users see
    // the same audit dataset as the existing Sync Feedback feature.
    let { data, error } = await supabase.rpc('get_feedback_export');

    // Compatibility fallback for installations that have the table but have
    // not deployed the export RPC yet.
    if (error) {
      const fallback = await supabase
        .from('model_feedback_logs')
        .select('id,parcel_id,action,surveyor_id,area_delta_sqm,created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      data = fallback.data;
      error = fallback.error;
    }

    if (error) {
      console.error('[Activity] Could not load feedback history:', error.message);
      return internalServerError('Activity history could not be loaded.');
    }

    const activities = ((data ?? []) as ActivityRow[]).slice(0, 100).map((row) => ({
      id: row.log_id ?? row.id ?? `${row.parcel_id}-${row.created_at}`,
      parcel_id: row.parcel_id,
      action: row.action,
      surveyor_id: row.surveyor_id,
      area_delta_sqm: row.area_delta_sqm,
      created_at: row.created_at,
    }));
    const summary = activities.reduce(
      (counts, item) => {
        counts[item.action] += 1;
        return counts;
      },
      { confirmed: 0, edited: 0, rejected: 0 } as Record<ActivityAction, number>,
    );

    return NextResponse.json(
      { activities, summary, total: activities.length },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[Activity] Unexpected error:', message);
    return internalServerError('Activity history could not be loaded.');
  }
}
