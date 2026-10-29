# Deploying WorkLens

Three pieces, all on free or credit-covered tiers:

| Piece | Runs | Holds |
| --- | --- | --- |
| Vercel | `apps/web` (Next.js) | the findings view, the upload page, the bundled replay sample |
| Supabase (project `worklens`, us-east-1) | Postgres + Storage | `runs` table (status, progress, run.json), buckets `uploads` (recordings) and `runs` (frames, BPMN) |
| Modal | `services/worker/modal_app.py` | the pipeline: ffmpeg, SAM 3.1 and Muse Spark calls; CPU only |

The browser uploads straight to Supabase storage through a one-off signed URL (the service key stays server-side); the web app then asks the Modal endpoint to process the run; the run page polls the row every 2 s and switches to the findings view when the status is `built`.

## 1. Supabase

Schema is in `services/worker/supabase/migrations/0001_runs.sql` (already applied to the live project). You need two values from the dashboard, Settings → API:

- `SUPABASE_URL` = `https://<ref>.supabase.co`
- `SUPABASE_SERVICE_KEY` = the **service_role** key (secret; never in the browser or the repo)

## 2. Modal

```bash
pip install modal && modal setup                      # one-time login
modal secret create worklens \
  MODEL_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
  WORKLENS_WORKER_SECRET=$(openssl rand -hex 16)      # shared secret the web app sends
cd services/worker && modal deploy modal_app.py       # prints the enqueue URL, e.g. https://<workspace>--worklens-enqueue.modal.run
```

## 3. Web app

Environment variables (Vercel → Project → Settings → Environment Variables, or `apps/web/.env.local` for dev):

```
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_KEY=...
WORKLENS_WORKER_URL=https://<workspace>--worklens-enqueue.modal.run
WORKLENS_WORKER_SECRET=<same value as in the Modal secret>
```

Vercel: import the repo, root directory `apps/web`, defaults otherwise (the build runs `scripts/sync-samples.mjs`, which bundles the replay sample). Without the four variables the site still works: it serves the replay sample and says uploads are off.

## Test the whole path

```bash
cd apps/web && npm run dev          # with .env.local set
# open http://localhost:3000, drop samples/synthetic-invoice.mp4, watch the stages, land on the findings view
```
