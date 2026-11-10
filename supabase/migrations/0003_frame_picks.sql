-- How each saved video frame was chosen, and how sharp it is, so annotations
-- used as ground truth can be analysed by sampling method and image quality.
-- Run once, after 0002_videos.sql: Supabase dashboard -> SQL Editor -> New query
-- -> paste -> Run. Frames saved before this have these columns empty.

alter table public.images
  add column frame_picked_by     text check (frame_picked_by in ('random', 'even', 'sharpest', 'manual')),
  add column frame_sharpness     real check (frame_sharpness >= 0),
  add column frame_sharpness_pct real check (frame_sharpness_pct between 0 and 100);
