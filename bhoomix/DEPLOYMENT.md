# BhoomiX deployment runbook

## Architecture

- `web`: Next.js dashboard and API routes on port 3000.
- `ai`: GPU-backed FastAPI service for rooftop inference and ORI/DSM/DTM raster processing on port 8000.
- Supabase: authentication, PostgreSQL/PostGIS, private imagery storage and audit records.

## Required preparation

1. Apply `supabase/10_elevation_bundles.sql` after migrations 00–09.
2. Keep the trained checkpoint at `training/runs/rooftop-baseline/best.pt`, or mount an equivalent file at `/models/best.pt` in the AI container.
3. Configure all values from `.env.example`. The service-role key belongs only on the web server and must never be exposed as a `NEXT_PUBLIC_*` variable.
4. Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin and add that origin to Supabase Authentication redirect URLs.

## Container verification

With an NVIDIA Container Toolkit-compatible host:

```powershell
docker compose --env-file .env.local up --build
npm run test:smoke
```

Verify `http://localhost:3000/api/health` and `http://localhost:8000/health` before exposing the services.

## Production requirements

- Terminate HTTPS at a managed load balancer or reverse proxy.
- Keep the AI service private; only the Next.js server needs access to it.
- Use a persistent Supabase project and enable scheduled database backups.
- Configure storage lifecycle cleanup for abandoned objects under `incoming/`.
- Send application and AI-service logs to a persistent log provider.
- Choose a GPU host that supports CUDA 12.8 and NVIDIA containers.

Creating the live deployment is intentionally a separate operation because it creates external infrastructure and may incur GPU hosting charges.
