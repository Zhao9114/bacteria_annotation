// Library screen: everyone's starting point. Upload images and videos, see
// progress, open one to annotate, share or delete your own.

import { compareImages, compareVideos, videoStatus, type Backend, type ImageSummary, type LibraryScope, type VideoSummary } from '../storage/store';
import { prepareImage } from '../storage/upload';
import { imageCard, videoCard } from '../ui/cards';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { mountUserMenu } from '../ui/user';
import { pickFrames } from './pick-frames';

const TEMPLATE = /* html */ `
<div class="app">
  <header class="topbar">
    <a class="brand" href="#/library"><span class="logo">${icon('logo')}</span><span class="brand-text">Cell Annotator</span></a>
    <span class="spacer"></span>
    <span class="pill plain where-pill" data-ref="where"></span>
    <div class="group" data-ref="user"></div>
  </header>
  <main class="library" data-ref="main">
    <div class="library-inner">
      <div class="library-head">
        <div>
          <h1>Library</h1>
          <div class="muted" data-ref="summary"></div>
        </div>
        <span class="spacer"></span>
        <span class="upload-progress" data-ref="progress"></span>
        <button class="primary" data-ref="upload" title="Add microscope photos, or a video to pick frames from">${icon('upload')} Upload images or video</button>
        <input type="file" accept="image/*,video/mp4,video/quicktime,.mp4,.mov,.m4v" multiple hidden data-ref="fileInput" />
      </div>
      <div class="library-tools">
        <div class="segmented hidden" data-ref="scope">
          <button data-scope="mine">${icon('image')} My images</button>
          <button data-scope="shared">${icon('users')} Shared with me</button>
        </div>
        <input type="search" placeholder="Search by name or phone…" data-ref="search" />
        <select data-ref="status" title="Show only images and videos with this status">
          <option value="">All statuses</option>
          <option value="not_started">Not started</option>
          <option value="in_progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </div>
      <div data-ref="content"></div>
    </div>
  </main>
</div>`;

const isVideo = (f: File) => f.type.startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(f.name);

export function mountLibraryScreen(root: HTMLElement, { library, account, auth }: Backend): () => void {
  root.innerHTML = TEMPLATE;
  const ref = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const abort = new AbortController();
  const { signal } = abort;

  let scope: LibraryScope = (sessionStorage.getItem('libraryScope') as LibraryScope) || 'mine';
  if (!library.canShare) scope = 'mine';
  let images: ImageSummary[] = [];
  let videos: VideoSummary[] = [];
  let loading = true;

  const main = ref('main');
  const content = ref('content');
  const search = ref<HTMLInputElement>('search');
  const statusFilter = ref<HTMLSelectElement>('status');
  const fileInput = ref<HTMLInputElement>('fileInput');
  const scopeSwitch = ref('scope');

  ref('where').innerHTML =
    library.location === 'browser'
      ? `${icon('hardDrive')} <span class="label">Saved in this browser only</span>`
      : `${icon('cloud')} <span class="label">Saved online</span>`;
  ref('where').title =
    library.location === 'browser'
      ? 'Images and annotations are stored in this browser on this computer. Clearing browser data deletes them.'
      : 'Images and annotations are stored in the online database.';
  mountUserMenu(ref('user'), account, auth);
  scopeSwitch.classList.toggle('hidden', !library.canShare);

  async function load(): Promise<void> {
    loading = true;
    draw();
    try {
      [images, videos] = await Promise.all([library.listImages(scope), library.listVideos(scope)]);
    } catch (e) {
      toast(`Could not load the library: ${(e as Error).message}`, 'error');
      images = [];
      videos = [];
    }
    loading = false;
    draw();
  }

  const mine = (ownerId: string) => ownerId === account.currentUser()?.id;

  function draw(): void {
    // Async work (loading, uploads) can finish after the user has left this screen.
    if (signal.aborted) return;
    for (const b of scopeSwitch.querySelectorAll<HTMLElement>('[data-scope]')) {
      b.classList.toggle('active', b.dataset.scope === scope);
    }
    const done = images.filter((i) => i.status === 'done').length + videos.filter((v) => videoStatus(v) === 'done').length;
    const parts = [
      images.length ? `${images.length} image${images.length === 1 ? '' : 's'}` : '',
      videos.length ? `${videos.length} video${videos.length === 1 ? '' : 's'}` : '',
    ].filter(Boolean);
    ref('summary').textContent = loading ? 'Loading…' : parts.length ? `${parts.join(' · ')} · ${done} done` : '';

    if (loading) {
      content.innerHTML = '';
      return;
    }
    if (images.length === 0 && videos.length === 0) {
      content.innerHTML =
        scope === 'shared'
          ? `<div class="dropzone">${icon('users')}<div>Nothing has been shared with you yet.</div></div>`
          : /* html */ `<div class="dropzone" data-ref="drop">
              <div class="big-icon" style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:var(--accent-soft);color:var(--accent-hover)">${icon('upload')}</div>
              <h2 style="margin:0;color:var(--text)">Add your first images</h2>
              <div>Drag microscope photos or a video anywhere on this page, or</div>
              <button class="primary" data-act="upload">${icon('upload')} Choose files</button>
            </div>`;
      return;
    }
    const q = search.value.trim().toLowerCase();
    const st = statusFilter.value;
    const shownVideos = videos
      .filter((v) => (!q || `${v.phone} ${v.filename}`.toLowerCase().includes(q)) && (!st || videoStatus(v) === st))
      .sort(compareVideos);
    const shownImages = images
      .filter((i) => (!q || i.filename.toLowerCase().includes(q)) && (!st || i.status === st))
      .sort(compareImages);
    if (shownVideos.length === 0 && shownImages.length === 0) {
      content.innerHTML = `<div class="dropzone"><div>Nothing matches your search.</div></div>`;
      return;
    }
    const section = (title: string, cards: string) =>
      `${title ? `<h2 class="section-title">${title}</h2>` : ''}<div class="grid">${cards}</div>`;
    content.innerHTML =
      (shownVideos.length ? section('Videos', shownVideos.map((v) => videoCard(v, { mine: mine(v.owner_id) })).join('')) : '') +
      (shownImages.length
        ? section(
            shownVideos.length ? 'Images' : '',
            shownImages.map((i) => imageCard(i, { mine: mine(i.owner_id), canShare: library.canShare })).join(''),
          )
        : '');
  }

  // ---------- upload ----------
  async function upload(files: File[]): Promise<void> {
    const videoFiles = files.filter(isVideo);
    const imageFiles = files.filter((f) => !isVideo(f) && f.type.startsWith('image/'));
    const progress = ref('progress');
    let added = 0;
    let dupes = 0;
    for (let k = 0; k < imageFiles.length; k++) {
      progress.textContent = `Adding ${k + 1} of ${imageFiles.length}…`;
      try {
        const res = await library.addImage(await prepareImage(imageFiles[k]));
        if (res === 'duplicate') dupes++;
        else added++;
      } catch (e) {
        toast((e as Error).message, 'error', 6000);
      }
    }
    progress.textContent = '';
    if (added) toast(`Added ${added} image${added === 1 ? '' : 's'}.`);
    if (dupes) toast(`${dupes} image${dupes === 1 ? ' was' : 's were'} already in your library.`);
    let lastVideo: string | null = null;
    for (const f of videoFiles) {
      if (signal.aborted) return;
      const video = await pickFrames(f, library);
      if (video) lastVideo = video.id;
    }
    if (scope !== 'mine') scope = 'mine';
    // One video: go straight to its frames. Otherwise stay on the library.
    if (videoFiles.length === 1 && lastVideo && imageFiles.length === 0) location.hash = `#/video/${lastVideo}`;
    else await load();
  }

  ref('upload').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    void upload([...(fileInput.files ?? [])]);
    fileInput.value = '';
  });
  main.addEventListener('dragover', (e) => {
    e.preventDefault();
    root.querySelector('[data-ref="drop"]')?.classList.add('dragover');
  });
  main.addEventListener('dragleave', () => root.querySelector('[data-ref="drop"]')?.classList.remove('dragover'));
  main.addEventListener('drop', (e) => {
    e.preventDefault();
    void upload([...(e.dataTransfer?.files ?? [])]);
  });

  // ---------- card actions ----------
  content.addEventListener('click', async (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-act="upload"]')) {
      fileInput.click();
      return;
    }
    const videoEl = target.closest<HTMLElement>('.card[data-video]');
    if (videoEl) {
      location.hash = `#/video/${videoEl.dataset.video}`;
      return;
    }
    const cardEl = target.closest<HTMLElement>('.card[data-id]');
    if (!cardEl) return;
    const img = images.find((i) => i.id === cardEl.dataset.id)!;
    if (target.closest('[data-act="delete"]')) {
      if (!confirm(`Delete "${img.filename}" and all its annotations? This cannot be undone.`)) return;
      try {
        await library.deleteImage(img.id);
        toast(`Deleted ${img.filename}.`);
      } catch (err) {
        toast(`Could not delete: ${(err as Error).message}`, 'error');
      }
      await load();
    } else if (target.closest('[data-act="share"]')) {
      try {
        await library.setShared(img.id, !img.shared);
        img.shared = !img.shared;
        toast(img.shared ? `${img.filename} is now shared with everyone signed in.` : `${img.filename} is now private.`);
        draw();
      } catch (err) {
        toast(`Could not change sharing: ${(err as Error).message}`, 'error');
      }
    } else {
      location.hash = `#/image/${img.id}`;
    }
  });
  content.addEventListener('keydown', (e) => {
    const cardEl = (e.target as HTMLElement).closest<HTMLElement>('.card');
    if (!cardEl || e.key !== 'Enter') return;
    location.hash = cardEl.dataset.video ? `#/video/${cardEl.dataset.video}` : `#/image/${cardEl.dataset.id}`;
  });

  scopeSwitch.addEventListener('click', (e) => {
    const s = (e.target as HTMLElement).closest<HTMLElement>('[data-scope]')?.dataset.scope as LibraryScope | undefined;
    if (!s || s === scope) return;
    scope = s;
    sessionStorage.setItem('libraryScope', s);
    void load();
  });
  search.addEventListener('input', draw, { signal });
  statusFilter.addEventListener('change', draw, { signal });

  void load();
  return () => abort.abort();
}
