-- RLS for Android direct Supabase (do NOT ship service_role in APK)
-- Run this in Supabase SQL Editor after aio.sql if you want Android to talk direct via anon key.
-- Alternatively keep service_role only on Kali Python and proxy Android via Next.js /api/image + Edge Function.

-- Enable RLS
alter table photos enable row level security;
alter table people enable row level security;
alter table photo_faces enable row level security;
alter table verification_tasks enable row level security;

-- Permissive read for gallery (anyone with anon can list)
drop policy if exists "read_all" on photos;
create policy "read_all" on photos for select using (true);
drop policy if exists "read_people" on people;
create policy "read_people" on people for select using (true);
drop policy if exists "read_faces" on photo_faces;
create policy "read_faces" on photo_faces for select using (true);
drop policy if exists "read_verif" on verification_tasks;
create policy "read_verif" on verification_tasks for select using (true);

-- Backfill writes: allow anon to insert/update for re-embedding
-- Tighten later with app-role check: using (auth.jwt()->>'app_role'='face_runner')
drop policy if exists "backfill_update_photos" on photos;
create policy "backfill_update_photos" on photos for update using (true) with check (true);
drop policy if exists "insert_people" on people;
create policy "insert_people" on people for insert with check (true);
drop policy if exists "update_people" on people;
create policy "update_people" on people for update using (true) with check (true);
drop policy if exists "insert_faces" on photo_faces;
create policy "insert_faces" on photo_faces for insert with check (true);
drop policy if exists "delete_faces" on photo_faces;
create policy "delete_faces" on photo_faces for delete using (true);
drop policy if exists "insert_verif" on verification_tasks;
create policy "insert_verif" on verification_tasks for insert with check (true);
drop policy if exists "update_verif" on verification_tasks;
create policy "update_verif" on verification_tasks for update using (true) with check (true);

-- Photos inserts are done via Drive import edge (service_role) — allow anon insert too for Android camera roll
drop policy if exists "insert_photos" on photos;
create policy "insert_photos" on photos for insert with check (true);
drop policy if exists "delete_photos" on photos;
create policy "delete_photos" on photos for delete using (true);

-- Note: service_role bypasses RLS automatically, so Kali Python keeps working.
