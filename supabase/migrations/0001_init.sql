-- Bacteria Cell Annotation: database schema, row-level security and storage.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
--
-- Model
--   images       one row per uploaded photo, owned by the uploader. Private
--                unless `shared` is true, then every signed-in user can see it.
--   annotations  one row per (image, annotator): each person's cells are kept
--                separately, so doctor, student and NN results can be compared.
--   storage      bucket "images" (private): <owner_id>/<image_id>.<ext> and
--                <owner_id>/<image_id>_thumb.jpg

-- ---------------------------------------------------------------- tables

create table public.images (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name   text,
  filename     text not null,
  mime         text not null,
  width        integer not null check (width > 0),
  height       integer not null check (height > 0),
  sha256       text not null,
  storage_path text not null,
  thumb_path   text not null,
  shared       boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (owner_id, sha256)
);

create index images_shared_idx on public.images (shared) where shared;

create table public.annotations (
  image_id       uuid not null references public.images (id) on delete cascade,
  annotator_id   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  annotator_name text,
  status         text not null default 'in_progress'
                   check (status in ('not_started', 'in_progress', 'done')),
  cell_count     integer not null default 0,
  doc            jsonb not null,
  updated_at     timestamptz not null default now(),
  primary key (image_id, annotator_id)
);

create index annotations_annotator_idx on public.annotations (annotator_id);

-- ---------------------------------------------------------------- row-level security

alter table public.images enable row level security;
alter table public.annotations enable row level security;

-- Images: owners see their own; everyone signed in sees shared ones.
create policy "images: read own or shared" on public.images
  for select to authenticated
  using (owner_id = auth.uid() or shared);

create policy "images: insert own" on public.images
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "images: update own" on public.images
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "images: delete own" on public.images
  for delete to authenticated
  using (owner_id = auth.uid());

-- Annotations: you read your own, and an image's owner can read everyone's
-- annotations of that image (e.g. to review students' work).
create policy "annotations: read own or on my images" on public.annotations
  for select to authenticated
  using (
    annotator_id = auth.uid()
    or exists (select 1 from public.images i where i.id = image_id and i.owner_id = auth.uid())
  );

-- You can only write your own annotation, and only on an image you can see.
create policy "annotations: insert own on visible image" on public.annotations
  for insert to authenticated
  with check (
    annotator_id = auth.uid()
    and exists (select 1 from public.images i where i.id = image_id and (i.owner_id = auth.uid() or i.shared))
  );

create policy "annotations: update own on visible image" on public.annotations
  for update to authenticated
  using (annotator_id = auth.uid())
  with check (
    annotator_id = auth.uid()
    and exists (select 1 from public.images i where i.id = image_id and (i.owner_id = auth.uid() or i.shared))
  );

create policy "annotations: delete own" on public.annotations
  for delete to authenticated
  using (annotator_id = auth.uid());

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('images', 'images', false)
on conflict (id) do nothing;

-- Files live under a folder named after the owner's user id.
create policy "image files: read own or shared" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'images'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.images i
        where i.shared and (i.storage_path = storage.objects.name or i.thumb_path = storage.objects.name)
      )
    )
  );

create policy "image files: upload to own folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "image files: delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'images' and (storage.foldername(name))[1] = auth.uid()::text);
