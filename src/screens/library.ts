// Library screen: everyone's starting point. Upload images, see progress,
// open one to annotate, share or delete your own.

import type { ImageStatus } from '../io/schema';
import { compareImages, type ImageSummary, type LibraryScope, type Store } from '../storage/store';
import { prepareImage } from '../storage/upload';
import { icon } from '../ui/icons';
import { toast } from '../ui/toast';
import { mountUserMenu } from '../ui/user';

const STATUS_LABEL: Record<ImageStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  done: 'Done',
};
const STATUS_CLASS: Record<ImageStatus, string> = { not_started: '', in_progress: 'warn', done: 'ok' };

const TEMPLATE = /* html */ `
<div class="app">
  <header class="topbar">
    <a class="brand" href="#/library"><span class="logo">${icon('logo')}</span>Cell Annotator</a>
    <span class="spacer"></span>
    <span class="pill plain" data-ref="where"></span>
    <div class="group" data-ref="user"></div>
  </header>
  <main class="library" data-ref="main">
    <div class="library-inner">
      <div class="library-head">
        <div>
          <h1>Images</h1>
          <div class="muted" data-ref="summary"></div>
        </div>
        <span class="spacer"></span>
        <span class="upload-progress" data-ref="progress"></span>
        <button class="primary" data-ref="upload" title="Add microscope photos to the library">${icon('upload')} Upload images</button>
        <input type="file" accept="image/*" multiple hidden data-ref="fileInput" />
      </div>
      <div class="library-tools">
        <div class="segmented hidden" data-ref="scope">
          <button data-scope="mine">${icon('image')} My images</button>
          <button data-scope="shared">${icon('users')} Shared with me</button>
        </div>
        <input type="search" placeholder="Search by name…" data-ref="search" />
        <select data-ref="status" title="Show only images with this status">
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

export function mountLibraryScreen(root: HTMLElement, store: Store): () => void {
  root.innerHTML = TEMPLATE;
  const ref = <T extends HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const abort = new AbortController();
  const { signal } = abort;

  let scope: LibraryScope = (sessionStorage.getItem('libraryScope') as LibraryScope) || 'mine';
  if (store.kind === 'local') scope = 'mine';
  let images: ImageSummary[] = [];
  let loading = true;

  const main = ref('main');
  const content = ref('content');
  const search = ref<HTMLInputElement>('search');
  const statusFilter = ref<HTMLSelectElement>('status');
  const fileInput = ref<HTMLInputElement>('fileInput');
  const scopeSwitch = ref('scope');

  ref('where').innerHTML =
    store.kind === 'local'
      ? `${icon('hardDrive')} Saved in this browser only`
      : `${icon('cloud')} Saved online`;
  ref('where').title =
    store.kind === 'local'
      ? 'Images and annotations are stored in this browser on this computer. Clearing browser data deletes them.'
      : 'Images and annotations are stored in the online database.';
  mountUserMenu(ref('user'), store);
  scopeSwitch.classList.toggle('hidden', store.kind === 'local');

  async function load(): Promise<void> {
    loading = true;
    draw();
    try {
      images = await store.listImages(scope);
    } catch (e) {
      toast(`Could not load the library: ${(e as Error).message}`, 'error');
      images = [];
    }
    loading = false;
    draw();
  }

  function visible(): ImageSummary[] {
    const q = search.value.trim().toLowerCase();
    const st = statusFilter.value;
    return images.filter((i) => (!q || i.filename.toLowerCase().includes(q)) && (!st || i.status === st)).sort(compareImages);
  }

  function draw(): void {
    for (const b of scopeSwitch.querySelectorAll<HTMLElement>('[data-scope]')) {
      b.classList.toggle('active', b.dataset.scope === scope);
    }
    const done = images.filter((i) => i.status === 'done').length;
    ref('summary').textContent = loading
      ? 'Loading…'
      : images.length
        ? `${images.length} image${images.length === 1 ? '' : 's'} · ${done} done`
        : '';

    if (loading) {
      content.innerHTML = '';
      return;
    }
    if (images.length === 0) {
      content.innerHTML =
        scope === 'shared'
          ? `<div class="dropzone">${icon('users')}<div>Nothing has been shared with you yet.</div></div>`
          : /* html */ `<div class="dropzone" data-ref="drop">
              <div class="big-icon" style="display:grid;place-items:center;width:54px;height:54px;border-radius:16px;background:var(--accent-soft);color:var(--accent-hover)">${icon('upload')}</div>
              <h2 style="margin:0;color:var(--text)">Add your first images</h2>
              <div>Drag microscope photos anywhere on this page, or</div>
              <button class="primary" data-act="upload">${icon('upload')} Choose images</button>
            </div>`;
      return;
    }
    const list = visible();
    if (list.length === 0) {
      content.innerHTML = `<div class="dropzone"><div>No images match your search.</div></div>`;
      return;
    }
    content.innerHTML = `<div class="grid">${list.map(card).join('')}</div>`;
  }

  function card(i: ImageSummary): string {
    const mine = i.owner_id === store.currentUser()?.id;
    const shareBtn =
      mine && store.kind === 'supabase'
        ? `<button class="${i.shared ? 'on' : ''}" data-act="share" title="${
            i.shared ? 'Shared with everyone signed in. Click to make private.' : 'Private. Click to share with everyone signed in.'
          }">${icon('share')}</button>`
        : '';
    const deleteBtn = mine ? `<button data-act="delete" title="Delete this image and its annotations">${icon('trash')}</button>` : '';
    const owner = !mine
      ? `<span class="pill info plain">${icon('users')} ${escapeHtml(i.owner_name ?? 'Someone')}</span>`
      : i.shared
        ? `<span class="pill info plain">${icon('share')} Shared</span>`
        : '';
    return /* html */ `
      <article class="card" data-id="${i.id}" tabindex="0" title="Open ${escapeHtml(i.filename)}">
        <div class="thumb" style="background-image: url('${i.thumbUrl}')"></div>
        <div class="actions">${shareBtn}${deleteBtn}</div>
        <div class="meta">
          <div class="title">${escapeHtml(i.filename)}</div>
          <div class="row">
            <span class="pill ${STATUS_CLASS[i.status]}">${STATUS_LABEL[i.status]}</span>
            <span>${i.cellCount} cell${i.cellCount === 1 ? '' : 's'}</span>
            ${owner}
          </div>
        </div>
      </article>`;
  }

  // ---------- upload ----------
  async function upload(files: File[]): Promise<void> {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    const progress = ref('progress');
    let added = 0;
    let dupes = 0;
    for (let k = 0; k < images.length; k++) {
      progress.textContent = `Adding ${k + 1} of ${images.length}…`;
      try {
        const res = await store.addImage(await prepareImage(images[k]));
        if (res === 'duplicate') dupes++;
        else added++;
      } catch (e) {
        toast((e as Error).message, 'error', 6000);
      }
    }
    progress.textContent = '';
    if (added) toast(`Added ${added} image${added === 1 ? '' : 's'}.`);
    if (dupes) toast(`${dupes} image${dupes === 1 ? ' was' : 's were'} already in your library.`);
    if (scope !== 'mine') scope = 'mine';
    await load();
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
    const cardEl = target.closest<HTMLElement>('.card');
    if (!cardEl) return;
    const img = images.find((i) => i.id === cardEl.dataset.id)!;
    if (target.closest('[data-act="delete"]')) {
      if (!confirm(`Delete "${img.filename}" and all its annotations? This cannot be undone.`)) return;
      try {
        await store.deleteImage(img.id);
        toast(`Deleted ${img.filename}.`);
      } catch (err) {
        toast(`Could not delete: ${(err as Error).message}`, 'error');
      }
      await load();
    } else if (target.closest('[data-act="share"]')) {
      try {
        await store.setShared(img.id, !img.shared);
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
    if (cardEl && e.key === 'Enter') location.hash = `#/image/${cardEl.dataset.id}`;
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

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
