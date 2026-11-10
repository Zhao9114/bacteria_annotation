-- Videos: frames picked from phone videos and annotated like images.
-- Run once, after 0001_init.sql: Supabase dashboard -> SQL Editor -> New query
-- -> paste -> Run. Existing images and annotations are not changed.
--
-- Model
--   videos   one row per video someone picked frames from. The video file itself
--            is not stored, only its details (phone, frame rate, ...).
--   images   a saved frame is an ordinary image with video_id, frame_index
--            (display order from 0, as OpenCV numbers them) and frame_time
--            (seconds). Frames follow their video's sharing, kept in sync by
--            the triggers below, so the image, annotation and storage rules
--            from 0001 apply to frames unchanged.

-- ---------------------------------------------------------------- tables

create table public.videos (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name    text,
  filename      text not null,
  sha256        text not null,
  phone         text not null default '',
  pixel_size_um real check (pixel_size_um > 0),
  width         integer not null check (width > 0),
  height        integer not null check (height > 0),
  fps           real not null check (fps >= 0),
  frame_count   integer not null check (frame_count > 0),
  duration      real not null check (duration >= 0),
  shared        boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (owner_id, sha256)
);

create index videos_shared_idx on public.videos (shared) where shared;

alter table public.images
  add column video_id    uuid references public.videos (id) on delete cascade,
  add column frame_index integer check (frame_index >= 0),
  add column frame_time  real check (frame_time >= 0),
  add constraint images_frame_complete check (
    (video_id is null and frame_index is null and frame_time is null)
    or (video_id is not null and frame_index is not null and frame_time is not null)
  );

create index images_video_idx on public.images (video_id) where video_id is not null;

-- ---------------------------------------------------------------- row-level security

alter table public.videos enable row level security;

create policy "videos: read own or shared" on public.videos
  for select to authenticated
  using (owner_id = auth.uid() or shared);

create policy "videos: insert own" on public.videos
  for insert to authenticated
  with check (owner_id = auth.uid());

create policy "videos: update own" on public.videos
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "videos: delete own" on public.videos
  for delete to authenticated
  using (owner_id = auth.uid());

-- Frames can only be added to your own videos.
create policy "images: frames only on own videos" on public.images
  as restrictive for insert to authenticated
  with check (
    video_id is null
    or exists (select 1 from public.videos v where v.id = video_id and v.owner_id = auth.uid())
  );

-- ---------------------------------------------------------------- sharing follows the video

-- A new frame is shared exactly when its video is.
create function public.frame_inherits_sharing() returns trigger
language plpgsql as $$
begin
  if new.video_id is not null then
    select v.shared into new.shared from public.videos v where v.id = new.video_id;
  end if;
  return new;
end $$;

create trigger images_frame_sharing
  before insert on public.images
  for each row execute function public.frame_inherits_sharing();

-- Sharing or unsharing a video does the same to all its frames.
create function public.video_shares_frames() returns trigger
language plpgsql as $$
begin
  update public.images set shared = new.shared where video_id = new.id;
  return new;
end $$;

create trigger videos_share_frames
  after update of shared on public.videos
  for each row when (old.shared is distinct from new.shared)
  execute function public.video_shares_frames();
