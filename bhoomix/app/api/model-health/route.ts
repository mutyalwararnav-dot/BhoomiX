import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const configuredEndpoint = process.env.AI_INFERENCE_URL;
  if (!configuredEndpoint) {
    return NextResponse.json(
      { configured: false, available: false, model: null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const healthUrl = new URL('/health', configuredEndpoint);
    const response = await fetch(healthUrl, {
      cache: 'no-store',
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Model health returned ${response.status}`);
    const health = await response.json() as { model?: unknown; device?: unknown };
    return NextResponse.json({
      configured: true,
      available: true,
      model: typeof health.model === 'string' ? health.model : process.env.AI_MODEL_VERSION || 'Configured model',
      device: typeof health.device === 'string' ? health.device : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    console.warn('[ModelHealth] Inference service unavailable:', error instanceof Error ? error.message : error);
    return NextResponse.json(
      { configured: true, available: false, model: process.env.AI_MODEL_VERSION || null },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
