# Security — Android must NOT ship SERVICE_ROLE_KEY

Current web app `src/lib/supabase.ts:6` uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS). `supabase/schema.sql` has **no** `ENABLE ROW LEVEL SECURITY`. Shipping that key in `android/app/build.gradle.kts BuildConfig` = full DB pwn.

## Correct path for Android direct Supabase

### Option A — RLS + anon (preferred for direct)
In Supabase SQL editor run:

```sql
-- Enable RLS
alter table photos enable row level security;
alter table people enable row level security;
alter table photo_faces enable row level security;
alter table verification_tasks enable row level security;

-- Allow any authenticated user (via anon key) to read photos/people
create policy "read_all" on photos for select using (true);
create policy "read_people" on people for select using (true);
create policy "read_faces" on photo_faces for select using (true);

-- Allow authenticated inserts/updates for re-embedder (restrict by app role if you add custom JWT)
create policy "backfill_insert" on photo_faces for insert with check (true);
create policy "backfill_update" on photos for update using (true);
create policy "people_insert" on people for insert with check (true);
create policy "people_update" on people for update using (true);
-- Tighten later: using (auth.jwt() ->> 'app_role' = 'face_runner')

-- Create a dedicated anon user or use supabase auth signInAnonymously
```

Android then `createClient(supabaseUrl, supabaseAnonKey)` via `supabase-kt`.

### Option B — Edge Function proxy (most secure, keeps service_role server-side)
Create `supabase/functions/face-backfill/index.ts`:

```ts
import { createClient } from "@supabase/supabase-js"
Deno.serve(async (req)=>{
  const { photo_id, faces, width, height } = await req.json()
  // verify X-App-Token header == env APP_TOKEN
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  // same logic as src/app/api/photos/[id]/faces/backfill/route.ts:19
  // matchAndLinkFaces + update photos
})
```

Android calls that endpoint with `anon` + app token, never sees service_role.

### Google Drive token

`GOOGLE_REFRESH_TOKEN` is also secret. For Android, prefer to proxy Drive `alt=media` via your Next.js `GET /api/image/[fileId]:13` (already proxies with `Cache-Control: immutable`) — then Android fetches `https://your-vercel.app/api/image/{fileId}` with `eg_session` cookie, no Google creds on device. Or store refresh token in `EncryptedSharedPreferences`.

## Checklist

- [ ] Never put `SUPABASE_SERVICE_ROLE_KEY` or `GOOGLE_REFRESH_TOKEN` in `BuildConfig` / `local.properties` committed
- [ ] Add RLS or Edge Function before shipping APK outside debug
- [ ] Test `supabase-kt` with anon can `select photos where face_scan_status=pending`
