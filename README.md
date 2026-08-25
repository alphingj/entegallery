# Ente Gallery

A personal Google Photos alternative. Photos are stored in **your** Google Drive
(your quota), metadata lives in Supabase Postgres with pgvector, and all face
recognition runs **in the browser** — $0 AI cost.

## How it works

```
Browser                          Next.js API                     Google
───────                          ───────────                     ──────
1. face detection (InsightFace
   512d: det_500m SCRFD + w600k_mbf)
2. POST /api/upload/init  ─────► resumable session URI ◄──────── Drive
        ◄──── {uploadUri}
3. XHR PUT uploadUri ───────────────────────────────────────────► file bytes land in YOUR Drive
        ◄──── {fileId}
4. POST /api/upload/confirm ───► grant link-share permission,
                                 insert photo row,
                                 match_person_top2(512d) via
                                 pgvector cosine < 0.28
        ◄──── tagged people names
```
- **Max-precision re-embedders** (new): Kali AMD Python `local-runner-py/` and Android Kotlin `android/` talk **direct** to Supabase + Drive with `glintr100` 250MB (antelopev2, ResNet100) + `det_500m` 205MB for max precision. See [`local-runner-py/README.md`](local-runner-py/README.md) and [`android/README.md`](android/README.md). Wipe mode `python -m src.wipe --yes && python -m src.run --all` truncates `people`/`photo_faces` and reprocesses every photo with 5-point warp (not squarify).

- Gallery grid uses Google's thumbnail CDN (`drive.google.com/thumbnail?id=…`),
  so it never expires and costs no Vercel bandwidth.
- Full resolution streams through `/api/image/[fileId]` with immutable caching.
- Faces render as CSS crops derived from stored normalized bounding boxes —
  searching "John" shows John's actual face even in group photos.
- Auto-tagging requires the best cosine distance < threshold **and** a margin
  over the second-best match; otherwise the face goes to "Unknown" instead of
  risking a wrong merge. Every face can be moved between people manually.

## Setup

### 1. Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), run it.
3. Copy `Project URL` and `service_role` key (**Settings → API**) into `.env.local`.

### 2. Google Drive OAuth

1. [console.cloud.google.com](https://console.cloud.google.com) → new project → **Enable the Google Drive API**.
2. **Credentials → Create credentials → OAuth client ID → Desktop app.**
3. Copy the client id/secret into `.env.local`, plus your target folder ID
   (the last path segment of the folder's URL).
4. Generate the refresh token once:

   ```bash
   pnpm token          # opens a consent flow on localhost:51337
   ```

5. Paste the printed `GOOGLE_REFRESH_TOKEN=` into `.env.local`.

### 3. Run

```bash
pnpm install
cp .env.example .env.local   # fill it in per above
pnpm models                  # download face-api + w600k_mbf (~12MB); for max precision: FORCE_GLINTR=1 pnpm models (adds glintr100 250MB + det_500m 205MB)
pnpm dev
```

#### Max-precision re-embedding (Kali + Android, 200MB+ models)

```bash
# Kali Python (AMD Radeon, CPU provider — stable, no CUDA needed)
cd local-runner-py
python3 -m venv .venv && source .venv/bin/activate
pip install -e . && pip install insightface  # antelopev2 wraps glintr100+scrfd cleanly
bash ../scripts/download-models.sh  # or FORCE_GLINTR=1 bash ../scripts/download-models.sh
ln -sf ../.env.local .env.local
python -m src.wipe --yes                # wipe people/photo_faces, reset photos->pending
python -m src.run --all --concurrency 2 --threshold 0.28 --margin 0.06  # full re-embed
# See local-runner-py/README.md for --limit, --dry-run, --photo-id

# Android 12GB (Kotlin + onnxruntime-android + NNAPI)
# Open android/ in Android Studio, push models to device, set supabase anon key per android/SECURITY.md
# See android/README.md
```

Open http://localhost:3000 and sign in with `ACCESS_PASSWORD`.

### Deploy to Vercel

1. Push to GitHub → import the repo on Vercel.
2. Add every variable from `.env.example` in **Project → Settings → Environment Variables**.
3. Deploy. No other configuration needed — uploads bypass serverless limits by
   streaming straight from the browser to Drive.

## Environment variables

See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | DB access (server-only; Android uses `SUPABASE_ANON_KEY` + RLS per `supabase/rls-face-runner.sql` or Edge Function `supabase/functions/face-backfill/`) |
| `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | Drive OAuth acting as you |
| `GOOGLE_DRIVE_FOLDER_ID` | destination folder for uploads |
| `ACCESS_PASSWORD` | site-wide login gate (unset = open) |
| `NEXT_PUBLIC_FACE_MATCH_THRESHOLD` | cosine-distance cutoff (browser 0.30, glintr100 local 0.28) |
| `NEXT_PUBLIC_FACE_MATCH_MARGIN` | second-best margin (0.06) |
| `FACE_AUTO_FLOOR` | auto-trust floor for glintr100 (0.20) |

## Notes & limits

- Supported formats: JPEG, PNG, WebP, GIF (browser-decodable). HEIC needs an
  extra transcode step (future work).
- Face models (~12MB) are served once from `/public/models` and cached.
- Vercel Hobby bandwidth: full-res views stream through functions; thumbnails don't.
