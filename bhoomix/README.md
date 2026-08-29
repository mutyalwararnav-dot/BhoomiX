# BhoomiX

BhoomiX is an AI-assisted cadastral mapping and surveyor-review platform built with Next.js, MapLibre, PostGIS, and Supabase.

## What the application supports

- Public guest access, with optional sign-up and login
- Least-privilege reviewer, surveyor, and administrator identities
- GeoJSON parcel uploads and interactive polygon display
- Parcel geometry editing, approval, rejection, and conflict validation
- Reviewer activity history and feedback export
- Dataset quality and model-training readiness reporting
- GeoTIFF CRS, bounds, resolution, and WGS84 footprint extraction
- Imagery upload metadata checks and production request safeguards

## Local setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env.local` and enter the Supabase URL and anon key.
3. Apply the SQL files in `supabase/` in numeric order to the Supabase project.
4. Run `npm run dev` and open `http://localhost:3000`.

## Production checks

Run the following before deployment:

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

After startup, `GET /api/health` should return `{"status":"healthy","database":"connected"}`.

## Deployment configuration

BhoomiX requires a host that supports a full Next.js Node.js application because its API routes perform uploads, validation, feedback logging, and dataset checks. Configure these variables in both the build and production environments:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL` — exact deployed origin used for same-origin mutation checks
- `SUPABASE_SERVICE_ROLE_KEY` — server-only; never expose or prefix with `NEXT_PUBLIC_`

When the trained model service is available, configure these server-only variables:

- `AI_INFERENCE_URL` — the model's HTTP prediction endpoint
- `AI_INFERENCE_API_KEY` — optional bearer token for the model service
- `AI_INFERENCE_TIMEOUT_MS` — optional timeout between 1 and 300 seconds

The model endpoint must accept multipart form data with a `file` field and return:

```json
{
  "predictions": [
    {
      "id": "optional-model-id",
      "geometry": { "type": "Polygon", "coordinates": [] },
      "confidence_score": 0.92,
      "computed_area_sqm": 425.5,
      "land_use": "optional-label"
    }
  ]
}
```

If `AI_INFERENCE_URL` is not set, raw-image uploads remain in clearly identified demo mode. If it is set and the model fails, BhoomiX returns an error instead of silently inserting simulated data.

## Imagery coordinates

For an accurate map overlay, upload a georeferenced TIFF containing both an affine map transform and a supported EPSG code. BhoomiX currently converts WGS84 (`EPSG:4326`), Web Mercator (`EPSG:3857`), and WGS84 UTM north/south zones (`EPSG:32601`–`32660` and `EPSG:32701`–`32760`) into map-ready longitude/latitude bounds. The extracted metadata is stored with the upload and is available from `GET /api/imagery/footprints`. The map requests a bounded JPEG preview from `GET /api/imagery/[id]/overlay` and places it beneath parcel polygons; original private TIFF files are not exposed directly.

Ordinary JPG/PNG files and TIFF files without complete coordinate metadata may still be stored and processed, but BhoomiX labels them as unlocated and does not claim that they align accurately with the basemap. A raw drone photograph normally needs photogrammetry/orthomosaic processing before it becomes a georeferenced map layer.

Do not commit `.env.local`. The anon key is designed for browser use, but database access must remain protected by Supabase Row Level Security policies.

Public guest use remains enabled, but state-changing APIs reject cross-site browser calls, enforce body and rate limits, verify image signatures instead of trusting filenames, and refuse privileged operations when the server role is missing. Internal database and storage errors are written to server logs rather than exposed to visitors.

Imagery files are uploaded directly from the browser to the private Supabase bucket using a short-lived signed upload URL. The Next.js processing route receives only a small JSON storage reference, avoiding serverless request-body limits while retaining browser upload progress and server-side file verification.

Before applying `supabase/07_security_roles_and_rls.sql`, configure `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` and restart the Next.js server. Migration 07 makes raw imagery private, enables RLS, and removes public database mutation permissions. Public visitors can still view the map and use the validated guest workflow through the server APIs. New accounts begin as reviewers; role promotion must be performed by an administrator through a trusted server-side process.

After the production URL is known, add it in Supabase under **Authentication → URL Configuration** as the Site URL and an allowed Redirect URL. Guest use does not require authentication; this setting enables optional sign-up and login on the deployed site.
