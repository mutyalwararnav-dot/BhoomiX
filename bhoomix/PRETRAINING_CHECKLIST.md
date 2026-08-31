# BhoomiX pre-training checklist

## Automated checks

Run these commands from the project directory:

```bash
npm run preflight
npm run test:smoke
npm run check
```

- `preflight` validates required environment values, the private imagery bucket, database tables, and required RPCs.
- `test:smoke` checks the running dashboard, database health, cross-site request rejection, malformed input handling, and protected exports.
- `check` runs lint, TypeScript, dataset preparation tests, and the production build.

## Supabase

- Apply `supabase/00_init_and_rpc.sql` through `supabase/09_pretraining_integrity.sql` in numeric order.
- Keep `SUPABASE_SERVICE_ROLE_KEY` server-only and use the current **secret** key from Project Settings → API Keys.
- Confirm `drone_datasets` is private.
- Set the deployed site URL only at deployment time; local development uses `http://localhost:3000`.
- Configure database backups and a separate private-storage backup policy before collecting irreplaceable survey imagery.
- Schedule `select public.fail_stale_imagery_jobs();` through Supabase Cron if long-running asynchronous workers are enabled.

## Dataset acceptance

- Each usable image has a source filename, private storage path, pixel dimensions, and at least one approved polygon.
- Untouched demo polygons are excluded.
- Pending polygons are reviewed; rejected polygons are retained only for audit/negative-sample design.
- Reviewer identity and review timestamp are present whenever possible.
- Dataset licenses and land-data permissions are documented outside the repository.
- The generated report shows zero split-group leakage.
- Training, validation, and test images are from separate upload groups.

## Handoff to model training

Training can start only after the Dataset panel reports enough usable samples and all automated checks pass. The training step then consumes the generated JSONL manifests and retrieves source images from the private storage paths using server-side credentials.
