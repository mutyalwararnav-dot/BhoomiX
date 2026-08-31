import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { contentLengthError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

const ELEVATION_STAGED_PATH = /^incoming\/elevation\/(ori|dsm|dtm)\/[a-f0-9-]+_[^/]+$/i;

export async function DELETE(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'staged-imagery-cleanup', limit: 20, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 16 * 1024);
  if (oversized) return oversized;

  let body: { paths?: unknown };
  try {
    body = await request.json() as { paths?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  if (!Array.isArray(body.paths) || body.paths.length === 0 || body.paths.length > 3) {
    return NextResponse.json({ error: 'Provide one to three staged elevation paths.' }, { status: 400 });
  }
  const paths = body.paths.filter((path): path is string => typeof path === 'string' && ELEVATION_STAGED_PATH.test(path));
  if (paths.length !== body.paths.length) {
    return NextResponse.json({ error: 'One or more staged paths are invalid.' }, { status: 400 });
  }
  const { error } = await supabase.storage.from('drone_datasets').remove(paths);
  if (error) return NextResponse.json({ error: 'Staged files could not be removed.' }, { status: 502 });
  return NextResponse.json({ removed: paths.length });
}
