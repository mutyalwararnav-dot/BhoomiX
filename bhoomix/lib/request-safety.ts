import 'server-only';

import { NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
}

const globalRateLimit = globalThis as typeof globalThis & {
  bhoomixRateLimits?: Map<string, RateLimitEntry>;
};

const rateLimits = globalRateLimit.bhoomixRateLimits ?? new Map<string, RateLimitEntry>();
globalRateLimit.bhoomixRateLimits = rateLimits;

function requestIdentity(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'local';
}

/** Best-effort per-instance protection for the public prototype APIs. */
export function rateLimitRequest(request: Request, options: RateLimitOptions) {
  const now = Date.now();

  if (rateLimits.size > 5000) {
    for (const [storedKey, entry] of rateLimits) {
      if (entry.resetAt <= now) rateLimits.delete(storedKey);
    }
    if (rateLimits.size > 5000) rateLimits.clear();
  }

  const key = `${options.bucket}:${requestIdentity(request)}`;
  const existing = rateLimits.get(key);

  if (!existing || existing.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  if (existing.count >= options.limit) {
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return NextResponse.json(
      { error: 'Too many requests. Please wait before trying again.' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  existing.count += 1;
  return null;
}

export function contentLengthError(request: Request, maximumBytes: number) {
  const rawLength = request.headers.get('content-length');
  if (!rawLength) return null;

  const length = Number(rawLength);
  if (!Number.isFinite(length) || length < 0) {
    return NextResponse.json({ error: 'Invalid Content-Length header.' }, { status: 400 });
  }

  if (length > maximumBytes) {
    return NextResponse.json(
      { error: `Request is too large. Maximum size is ${Math.ceil(maximumBytes / 1024 / 1024)} MB.` },
      { status: 413 },
    );
  }

  return null;
}

/** Blocks browser requests initiated by another website without disabling guests. */
export function mutationRequestError(request: Request) {
  if (request.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: 'Cross-site requests are not allowed.' }, { status: 403 });
  }

  const origin = request.headers.get('origin');
  if (!origin) return null;

  const allowedOrigins = new Set<string>();
  try {
    allowedOrigins.add(new URL(request.url).origin);
  } catch {
    return NextResponse.json({ error: 'Invalid request URL.' }, { status: 400 });
  }

  const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (configuredSiteUrl) {
    try {
      allowedOrigins.add(new URL(configuredSiteUrl).origin);
    } catch {
      console.error('[RequestSafety] NEXT_PUBLIC_SITE_URL is not a valid URL.');
    }
  }

  if (!allowedOrigins.has(origin)) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 });
  }

  return null;
}

/** Fails safely instead of attempting privileged writes with an anon key. */
export function serverConfigurationError() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
    && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  if (configured) return null;
  return NextResponse.json(
    { error: 'The server is not fully configured. Please contact the administrator.' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}

/** Keeps database, storage, and stack details out of public API responses. */
export function internalServerError(message = 'The request could not be completed. Please try again.') {
  return NextResponse.json(
    { error: message },
    { status: 500, headers: { 'Cache-Control': 'no-store' } },
  );
}

export function isValidParcelId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && !/[\u0000-\u001F\u007F]/.test(value);
}
