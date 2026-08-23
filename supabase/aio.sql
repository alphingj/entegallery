-- ============================================================
-- Ente Gallery — ALL-IN-ONE migration (idempotent)
-- Paste this ENTIRE file into Supabase → SQL Editor → Run
-- Works on fresh DB AND on existing DB at any old state.
-- Safe to run multiple times.
-- ============================================================

-- 0) Extensions
create extension if not exists vector;
create extension if not exists pg_trgm;

-- ============================================================
-- 1) photos
-- ============================================================
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

-- add columns that may be missing on an old DB
alter table photos add column if not exists face_scan_status text not null default 'pending';
alter table photos add column if not exists md5_checksum text;
create index if not exists idx_photos_face_scan on photos (face_scan_status);
create index if not exists idx_photos_md5 on photos (md5_checksum) where md5_checksum is not null;

-- mark already-scanned photos as done (idempotent)
update photos p
set face_scan_status = 'done'
where p.face_scan_status = 'pending'
  and exists (select 1 from photo_faces f where f.photo_id = p.id);

-- ============================================================
-- 2) people  (512d)
-- ============================================================
create table if not exists people (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Unknown',
  descriptor vector(512) not null,
  created_at timestamptz not null default now()
);
-- if table already existed as vector(128), migrate to 512d
do $$
begin
  -- check current type via pg_attribute
  if exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_type t on t.oid = a.atttypid
    where c.relname = 'people' and a.attname = 'descriptor'
      and t.typname = 'vector' and a.atttypmod <> 512 + 4 -- typmod = dim+4 for vector
  ) then
    -- drop dependent index/functions first, then alter
    drop index if exists idx_faces_descriptor_hnsw;
    drop index if exists idx_faces_descriptor;
    -- functions depend on vector dim, drop them temporarily
    drop function if exists match_person(vector, float);
    drop function if exists match_person_top2(vector, float);
    alter table people alter column descriptor type vector(512) using descriptor::text::vector(512);
  end if;
exception when others then
  -- fallback: try direct alter (works if 128d with 0 rows or already 512d)
  begin
    drop index if exists idx_faces_descriptor_hnsw;
    drop index if exists idx_faces_descriptor;
    drop function if exists match_person(vector, float);
    drop function if exists match_person_top2(vector, float);
    alter table people alter column descriptor type vector(512) using descriptor::text::vector(512);
  exception when others then null;
  end;
end $$;

create index if not exists idx_people_name_trgm on people using gin (name gin_trgm_ops);

-- ============================================================
-- 3) photo_faces  (512d)
-- ============================================================
create table if not exists photo_faces (
  id           uuid primary key default gen_random_uuid(),
  photo_id     uuid not null references photos(id) on delete cascade,
  person_id    uuid not null references people(id) on delete cascade,
  bounding_box jsonb not null,
  descriptor   vector(512) not null,
  created_at   timestamptz not null default now()
);

-- migrate 128d -> 512d if needed (same guard as above)
do $$
begin
  if exists (
    select 1 from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_type t on t.oid = a.atttypid
    where c.relname = 'photo_faces' and a.attname = 'descriptor'
      and t.typname = 'vector' and a.atttypmod <> 512 + 4
  ) then
    drop index if exists idx_faces_descriptor_hnsw;
    drop index if exists idx_faces_descriptor;
    drop function if exists match_person(vector, float);
    drop function if exists match_person_top2(vector, float);
    alter table photo_faces alter column descriptor type vector(512) using descriptor::text::vector(512);
  end if;
exception when others then
  begin
    drop index if exists idx_faces_descriptor_hnsw;
    drop index if exists idx_faces_descriptor;
    drop function if exists match_person(vector, float);
    drop function if exists match_person_top2(vector, float);
    alter table photo_faces alter column descriptor type vector(512) using descriptor::text::vector(512);
  exception when others then null;
  end;
end $$;

create index if not exists idx_faces_photo  on photo_faces (photo_id);
create index if not exists idx_faces_person on photo_faces (person_id);
create index if not exists idx_faces_descriptor_hnsw on photo_faces using hnsw (descriptor vector_cosine_ops);

-- ============================================================
-- 4) Helper functions  (512d, 0.30 threshold)
-- ============================================================
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

create or replace function photos_of_person(pid uuid)
returns setof photos
language sql stable as $$
  select distinct ph.* from photos ph
  join photo_faces f on f.photo_id = ph.id
  where f.person_id = pid
  order by ph.created_at desc;
$$;

create or replace function search_people(query text, result_limit int default 20)
returns setof people
language sql stable as $$
  select * from people
  where name % query or name ilike '%' || query || '%'
  order by greatest(similarity(name, query), 0) desc, created_at asc
  limit result_limit;
$$;

-- ============================================================
-- 5) verification_tasks  (full fix: adds missing cols, fixes checks)
-- ============================================================
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

-- add columns that are missing on an old table (created before 2026-08-23)
alter table verification_tasks add column if not exists skip_session_id text;
alter table verification_tasks add column if not exists person_group_id uuid;
alter table verification_tasks add column if not exists best_distance float;
alter table verification_tasks add column if not exists second_distance float;
alter table verification_tasks add column if not exists person_id uuid references people(id) on delete set null;
alter table verification_tasks add column if not exists face_b_id uuid references photo_faces(id) on delete cascade;

-- fix check constraints (older tables may only allow 2 kinds / 3 statuses)
do $$
begin
  alter table verification_tasks drop constraint if exists verification_tasks_kind_check;
  alter table verification_tasks add constraint verification_tasks_kind_check
    check (kind in ('same_person','face_name','bulk_name_entry','swipe_validation'));
exception when others then null;
end $$;

do $$
begin
  alter table verification_tasks drop constraint if exists verification_tasks_status_check;
  alter table verification_tasks add constraint verification_tasks_status_check
    check (status in ('pending','confirmed','rejected','skipped'));
exception when others then null;
end $$;

-- ensure unique constraints exist (older tables may not have the second one)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'verification_tasks_kind_face_a_id_face_b_id_key') then
    alter table verification_tasks add constraint verification_tasks_kind_face_a_id_face_b_id_key unique (kind, face_a_id, face_b_id);
  end if;
exception when others then null;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'verification_tasks_kind_face_a_id_person_id_key') then
    alter table verification_tasks add constraint verification_tasks_kind_face_a_id_person_id_key unique (kind, face_a_id, person_id);
  end if;
exception when others then null;
end $$;

create index if not exists idx_verif_status on verification_tasks(status, kind);
create index if not exists idx_verif_face_a on verification_tasks(face_a_id);
create index if not exists idx_verif_skip_session on verification_tasks(skip_session_id);
create index if not exists idx_verif_person_group on verification_tasks(person_group_id);

-- ============================================================
-- 6) Optional helpers for debugging
-- ============================================================
-- Uncomment to reset face-scan queue so all non-HEIC photos are re-scanned with 512d:
-- update photos set face_scan_status = 'pending'
-- where face_scan_status in ('done','unsupported') and mime_type not in ('image/heic','image/heif')
--   and file_name not ilike '%.heic' and file_name not ilike '%.heif';

-- Uncomment to wipe all verification tasks and re-generate:
-- delete from verification_tasks where status = 'pending';

-- ============================================================
-- Done — verify with:
-- select column_name, data_type, udt_name from information_schema.columns
-- where table_name='verification_tasks' order by ordinal_position;
-- select attname, format_type(atttypid, atttypmod) from pg_attribute
-- where attrelid='people'::regclass and attname='descriptor';
-- ============================================================
