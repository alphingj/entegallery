-- ============================================================
-- Ente Gallery — Supabase schema
-- Run this in the Supabase dashboard: SQL Editor → New query
-- ============================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

-- ---------- photos ----------
create table if not exists photos (
  id                   uuid primary key default gen_random_uuid(),
  google_drive_file_id text unique not null,
  file_name            text,
  mime_type            text,
  width                integer,
  height               integer,
  byte_size            bigint,
  thumbnail_url        text,
  created_at           timestamptz not null default now()
);

create index if not exists idx_photos_created on photos (created_at desc);

-- ---------- people ----------
create table if not exists people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Unknown',
  descriptor vector(128) not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_people_name_trgm on people using gin (name gin_trgm_ops);

-- ---------- photo_faces ----------
-- One row per detected face, so a single image can contain many people and
-- each person's crop can be recovered from bounding_box.
create table if not exists photo_faces (
  id           uuid primary key default gen_random_uuid(),
  photo_id     uuid not null references photos(id) on delete cascade,
  person_id    uuid not null references people(id) on delete cascade,
  bounding_box jsonb not null,          -- { x, y, width, height } normalized 0..1, squarified
  descriptor   vector(128) not null,
  created_at   timestamptz not null default now()
);

create index if not exists idx_faces_photo  on photo_faces (photo_id);
create index if not exists idx_faces_person on photo_faces (person_id);
-- hnsw is exact enough for <10k vectors and avoids ivfflat 0-distance artifacts on small tables
drop index if exists idx_faces_descriptor;
create index if not exists idx_faces_descriptor_hnsw on photo_faces using hnsw (descriptor vector_cosine_ops);

-- ---------- matching ----------
-- Compare a new descriptor against EVERY stored face of each person.
-- Returns the closest person below max_dist (cosine distance), else no rows.
create or replace function match_person(
  q vector(128),
  max_dist float default 0.4
)
returns table (person_id uuid, name text, distance float)
language sql stable as $$
  select f.person_id, p.name, min(f.descriptor <=> q)::float as distance
  from photo_faces f
  join people p on p.id = f.person_id
  group by f.person_id, p.name
  having min(f.descriptor <=> q) < max_dist
  order by distance asc
  limit 1;
$$;

-- Photos containing a person, newest first.
create or replace function photos_of_person(pid uuid)
returns setof photos
language sql stable as $$
  select distinct ph.* from photos ph
  join photo_faces f on f.photo_id = ph.id
  where f.person_id = pid
  order by ph.created_at desc;
$$;

-- Fuzzy person search by name (typo-tolerant via pg_trgm).
create or replace function search_people(query text, result_limit int default 20)
returns setof people
language sql stable as $$
  select * from people
  where name % query or name ilike '%' || query || '%'
  order by greatest(similarity(name, query), 0) desc, created_at asc
  limit result_limit;
$$;

-- ---------- matching v2: top-2 with margin ----------
-- Returns the two closest people so the app can require a margin between
-- best and second-best before auto-tagging (prevents wrong merges).
create or replace function match_person_top2(
  q vector(128),
  max_dist float default 0.4
)
returns table (person_id uuid, name text, distance float)
language sql stable as $$
  select f.person_id, p.name, min(f.descriptor <=> q)::float as distance
  from photo_faces f
  join people p on p.id = f.person_id
  group by f.person_id, p.name
  having min(f.descriptor <=> q) < max_dist
  order by distance asc
  limit 2;
$$;

-- ---------- migration: face-scan tracking + duplicate detection ----------
-- face_scan_status: 'pending' | 'done' | 'unsupported'
--   pending     → queued for browser face scan (continue-identification queue)
--   done        → scanned (faces linked or none found)
--   unsupported → HEIC/HEIF etc., cannot be decoded in-browser; never queued
alter table photos add column if not exists face_scan_status text not null default 'pending';
alter table photos add column if not exists md5_checksum text;

create index if not exists idx_photos_face_scan on photos (face_scan_status);
create index if not exists idx_photos_md5 on photos (md5_checksum) where md5_checksum is not null;

-- Photos that already have faces are considered scanned.
update photos p
set face_scan_status = 'done'
where exists (select 1 from photo_faces f where f.photo_id = p.id);

-- ---------- migration: InsightFace 512d (buffalo_sc) ----------
-- Run this after wiping people/photo_faces (you already did). Converts 128d -> 512d.
-- If you already wiped, the USING casts are no-ops (0 rows to convert).
drop index if exists idx_faces_descriptor_hnsw;
drop index if exists idx_faces_descriptor;
alter table people alter column descriptor type vector(512) using descriptor::text::vector(512);
alter table photo_faces alter column descriptor type vector(512) using descriptor::text::vector(512);
create index if not exists idx_faces_descriptor_hnsw on photo_faces using hnsw (descriptor vector_cosine_ops);

-- Update match functions to 512d
create or replace function match_person(
  q vector(512),
  max_dist float default 0.30
)
returns table (person_id uuid, name text, distance float)
language sql stable as $$
  select f.person_id, p.name, min(f.descriptor <=> q)::float as distance
  from photo_faces f
  join people p on p.id = f.person_id
  group by f.person_id, p.name
  having min(f.descriptor <=> q) < max_dist
  order by distance asc
  limit 1;
$$;

create or replace function match_person_top2(
  q vector(512),
  max_dist float default 0.30
)
returns table (person_id uuid, name text, distance float)
language sql stable as $$
  select f.person_id, p.name, min(f.descriptor <=> q)::float as distance
  from photo_faces f
  join people p on p.id = f.person_id
  group by f.person_id, p.name
  having min(f.descriptor <=> q) < max_dist
  order by distance asc
  limit 2;
$$;

-- ---------- verification tasks (Google Photos–style human review) ----------
create table if not exists verification_tasks (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('same_person','face_name','bulk_name_entry','swipe_validation')),
  face_a_id uuid references photo_faces(id) on delete cascade,
  face_b_id uuid references photo_faces(id) on delete cascade,
  person_id uuid references people(id) on delete set null,
  best_distance float,
  second_distance float,
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','skipped')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  skip_session_id text,
  person_group_id uuid,
  unique (kind, face_a_id, face_b_id),
  unique (kind, face_a_id, person_id)
);
create index if not exists idx_verif_status on verification_tasks(status, kind);
create index if not exists idx_verif_face_a on verification_tasks(face_a_id);
create index if not exists idx_verif_skip_session on verification_tasks(skip_session_id);
create index if not exists idx_verif_person_group on verification_tasks(person_group_id);
