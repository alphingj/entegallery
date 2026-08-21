# Ente Gallery

A personal Google Photos alternative. Photos are stored in **your** Google Drive
(your quota), metadata lives in Supabase Postgres with pgvector, and all face
recognition runs **in the browser** — $0 AI cost.

## How it works

```
Browser                          Next.js API                     Google
───────                          ───────────                     ──────
1. face detection (@vladmandic/
   face-api, 128d descriptors)
2. POST /api/upload/init  ─────► resumable session URI ◄──────── Drive
        ◄──── {uploadUri}
3. XHR PUT uploadUri ───────────────────────────────────────────► file bytes land in YOUR Drive
        ◄──── {fileId}
4. POST /api/upload/confirm ───► grant link-share permission,
                                 insert photo row,
                                 match_person(descriptor) via
                                 pgvector cosine < 0.4
        ◄──── tagged people names
```

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
pnpm models                  # download face-api weights into public/models (~12MB)
pnpm dev
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
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | DB access (server-only) |
| `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN` | Drive OAuth acting as you |
| `GOOGLE_DRIVE_FOLDER_ID` | destination folder for uploads |
| `ACCESS_PASSWORD` | site-wide login gate (unset = open) |
| `NEXT_PUBLIC_FACE_MATCH_THRESHOLD` | cosine-distance cutoff (default 0.4) |

## Notes & limits

- Supported formats: JPEG, PNG, WebP, GIF (browser-decodable). HEIC needs an
  extra transcode step (future work).
- Face models (~12MB) are served once from `/public/models` and cached.
- Vercel Hobby bandwidth: full-res views stream through functions; thumbnails don't.
