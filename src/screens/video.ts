// Video screen: the frames saved from one video, in frame order, with the
// video's details. The owner can rename the phone, add frames, share or delete.

import type { Backend, ImageSummary, VideoRecord } from '../storage/store';
import { imageCard } from '../ui/cards';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { mountUserMenu } from '../ui/user';
import { formatTime } from '../video/frames';
import { pickFrames } from './pick-frames';

const TEMPLATE = /* html */ `
<div class="app">
  <header class="topbar">
    <a class="brand" href="#/library"><span class="logo">${icon('logo')}</span><span class="brand-text">Cell Annotator</span></a>
    <a class="back-link" href="#/library" title="Back to the library">${icon('chevronLeft')}</a>
    <nav class="crumbs"><span>/</span><a href="#/library">Library</a><span>/</span><span class="current" data-ref="crumb">Loading…</span></nav>
    <span class="spacer"></span>
    <div class="group" data-ref="user"></div>
  </header>
  <main class="library">
    <div class="library-inner">
      <div class="library-head">
        <div>
          <h1 data-ref="title">Video</h1>
          <div class="muted" data-ref="summary"></div>
        </div>
        <span class="spacer"></span>
        <span class="video-actions hidden" data-ref="actions">
          <button data-ref="share" class="hidden">${icon('share')} <span data-ref="shareLabel">Share</span></button>
          <button class="danger" data-ref="delete">${icon('trash')} Delete video</button>
          <button class="primary" data-ref="add" title="Choose the same video file again to pick more frames">${icon('plus')} Add frames</button>
        </span>
        <input type="file" accept="video/mp4,video/quicktime,.mp4,.mov,.m4v" hidden data-ref="fileInput" />
      </div>
      <div class="video-details" data-ref="details">
        <label>Phone <input type="text" data-ref="phone" maxlength="80" /></label>
        <label title="The phone sensor's pixel size, as reported. Measurements stay in pixels.">Pixel size (µm)
          <input type="number" data-ref="pixel" min="0" step="0.01" placeholder="not set" /></label>
        <span class="muted" data-ref="facts"></span>
      </div>
      <div data-ref="content"></div>
    </div>
  </main>
</div>`;

export function mountVideoScreen(root: HTMLElement, { library, account, auth }: Backend, videoId: string): () => void {
  root.innerHTML = TEMPLATE;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const abort = new AbortController();
  const { signal } = abort;
  mountUserMenu(ref('user'), account, auth);

  let video: VideoRecord | null = null;
  let frames: ImageSummary[] = [];
  const content = ref('content');
  const phoneInput = ref<HTMLInputElement>('phone');
  const pixelInput = ref<HTMLInputElement>('pixel');

  async function load(): Promise<void> {
    try {
      [video, frames] = await Promise.all([library.getVideo(videoId), library.listFrames(videoId)]);
    } catch (e) {
      if (signal.aborted) return;
      ref('title').textContent = 'Could not open this video';
      ref('summary').textContent = (e as Error).message;
      ref('details').classList.add('hidden');
      return;
    }
    if (!signal.aborted) draw();
  }

  const isMine = () => !!video && video.owner_id === account.currentUser()?.id;

  function draw(): void {
    const v = video!;
    const name = v.phone || v.filename;
    ref('crumb').textContent = name;
    ref('title').textContent = name;
    const done = frames.filter((f) => f.status === 'done').length;
    ref('summary').textContent = `${frames.length} frame${frames.length === 1 ? '' : 's'} saved · ${done} done`;
    ref('facts').textContent =
      `${v.filename} · ${v.frame_count} frames · ${v.fps.toFixed(Number.isInteger(v.fps) ? 0 : 2)} fps · ` +
      `${formatTime(v.duration)} · ${v.width}×${v.height}`;
    const mine = isMine();
    ref('actions').classList.toggle('hidden', !mine);
    ref('share').classList.toggle('hidden', !mine || !library.canShare);
    ref('share').classList.toggle('on', v.shared);
    ref('shareLabel').textContent = v.shared ? 'Shared' : 'Share';
    ref('share').title = v.shared
      ? 'This video and its frames are shared with everyone signed in. Click to make them private.'
      : 'Share this video and all its frames with everyone signed in.';
    if (document.activeElement !== phoneInput) phoneInput.value = v.phone;
    if (document.activeElement !== pixelInput) pixelInput.value = v.pixel_size_um === null ? '' : String(v.pixel_size_um);
    phoneInput.disabled = pixelInput.disabled = !mine;

    content.innerHTML = frames.length
      ? `<div class="grid">${frames.map((f) => imageCard(f, { mine, canShare: library.canShare })).join('')}</div>`
      : /* html */ `<div class="dropzone">${icon('film')}<div>No frames saved from this video yet.</div>
          ${mine ? '<div>Click <b>Add frames</b> and choose the same video file.</div>' : ''}</div>`;
  }

  // ---------- details ----------
  async function saveDetails(): Promise<void> {
    if (!video || !isMine()) return;
    const phone = phoneInput.value.trim();
    const text = pixelInput.value.trim();
    const pixel = text === '' ? null : Number(text);
    if (pixel !== null && !(pixel > 0)) {
      toast('The pixel size should be a positive number of micrometres, or empty.', 'error');
      return;
    }
    if (phone === video.phone && pixel === video.pixel_size_um) return;
    try {
      await library.updateVideo(video.id, { phone, pixel_size_um: pixel });
      video = { ...video, phone, pixel_size_um: pixel };
      toast('Saved the video details.');
      draw();
    } catch (e) {
      toast(`Could not save: ${(e as Error).message}`, 'error');
    }
  }
  phoneInput.addEventListener('change', () => void saveDetails());
  pixelInput.addEventListener('change', () => void saveDetails());

  // ---------- actions ----------
  const fileInput = ref<HTMLInputElement>('fileInput');
  ref('add').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const saved = await pickFrames(file, library);
    if (signal.aborted || !saved) return;
    if (saved.id !== videoId) {
      toast('That was a different video, so it was added as a new video.');
      location.hash = `#/video/${saved.id}`;
    } else await load();
  });

  ref('share').addEventListener('click', async () => {
    if (!video) return;
    try {
      await library.setVideoShared(video.id, !video.shared);
      video = { ...video, shared: !video.shared };
      toast(video.shared ? 'The video and its frames are now shared with everyone signed in.' : 'The video and its frames are now private.');
      draw();
    } catch (e) {
      toast(`Could not change sharing: ${(e as Error).message}`, 'error');
    }
  });

  ref('delete').addEventListener('click', async () => {
    if (!video) return;
    const name = video.phone || video.filename;
    if (!confirm(`Delete "${name}", its ${frames.length} saved frames and all their annotations? This cannot be undone.`)) return;
    try {
      await library.deleteVideo(video.id);
      toast(`Deleted ${name}.`);
      location.hash = '#/library';
    } catch (e) {
      toast(`Could not delete: ${(e as Error).message}`, 'error');
    }
  });

  // ---------- frame cards ----------
  content.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.card[data-id]');
    if (!card) return;
    const frame = frames.find((f) => f.id === card.dataset.id)!;
    if (target.closest('[data-act="delete"]')) {
      if (!confirm(`Delete frame ${frame.frame?.index} and its annotations? This cannot be undone.`)) return;
      try {
        await library.deleteImage(frame.id);
        frames = frames.filter((f) => f.id !== frame.id);
        draw();
      } catch (err) {
        toast(`Could not delete: ${(err as Error).message}`, 'error');
      }
    } else {
      location.hash = `#/image/${frame.id}`;
    }
  });
  content.addEventListener('keydown', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.card[data-id]');
    if (card && e.key === 'Enter') location.hash = `#/image/${card.dataset.id}`;
  });

  void load();
  return () => abort.abort();
}
