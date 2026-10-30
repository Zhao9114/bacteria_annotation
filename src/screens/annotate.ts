// Annotation screen: canvas with zoom/pan, sidebar, status bar.

import { render } from '../canvas/render';
import { fitToWindow, pan, screenToImage, zoomAt, type Point } from '../canvas/viewport';
import { createState, notify, subscribe, type AppState } from '../state';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];
/** A left-button press that moves less than this (screen px) is a click, not a pan. */
const CLICK_SLOP = 4;

const TEMPLATE = /* html */ `
<div class="app">
  <header class="topbar">
    <h1>Bacteria Cell Annotation</h1>
    <span class="filename" data-ref="filename"></span>
    <span class="spacer"></span>
    <button data-ref="fit" title="Show the whole image (F)">Fit to window</button>
    <button class="primary" data-ref="open" title="Open an image from your computer">Open image…</button>
    <input type="file" accept="image/*" data-ref="fileInput" hidden />
  </header>
  <main class="workspace">
    <div class="canvas-wrap" data-ref="wrap">
      <canvas data-ref="canvas"></canvas>
      <div class="empty-hint" data-ref="emptyHint">
        <div>Drag an image here, or</div>
        <button class="primary" data-ref="openEmpty">Open image…</button>
      </div>
    </div>
    <aside class="sidebar" data-ref="sidebar"></aside>
  </main>
  <footer class="statusbar">
    <span data-ref="statusZoom"></span>
    <span data-ref="statusCursor"></span>
  </footer>
</div>`;

export function mountAnnotateScreen(root: HTMLElement): void {
  root.innerHTML = TEMPLATE;
  const ref = <T extends HTMLElement>(name: string): T => {
    const el = root.querySelector<T>(`[data-ref="${name}"]`);
    if (!el) throw new Error(`missing ref ${name}`);
    return el;
  };

  const state: AppState = createState();
  const wrap = ref<HTMLDivElement>('wrap');
  const canvas = ref<HTMLCanvasElement>('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const fileInput = ref<HTMLInputElement>('fileInput');

  // ---------- canvas sizing + redraw ----------
  let cssW = 0;
  let cssH = 0;
  let frameRequested = false;

  function requestRedraw(): void {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      const dpr = window.devicePixelRatio || 1;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx!, state, cssW, cssH);
    });
  }

  new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1;
    cssW = wrap.clientWidth;
    cssH = wrap.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    requestRedraw();
  }).observe(wrap);

  function fit(): void {
    if (!state.image) return;
    state.viewport = fitToWindow(state.image.width, state.image.height, cssW, cssH);
    notify();
  }

  // ---------- image loading ----------
  async function loadFile(file: File): Promise<void> {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      alert(`"${file.name}" is not a supported image. Please use PNG, JPEG, WebP, BMP or GIF.`);
      return;
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      alert(`Could not open "${file.name}". The file may be damaged.`);
      return;
    }
    state.image?.bitmap.close();
    state.image = { filename: file.name, width: bitmap.width, height: bitmap.height, bitmap };
    fit();
  }

  const openPicker = () => fileInput.click();
  ref('open').addEventListener('click', openPicker);
  ref('openEmpty').addEventListener('click', openPicker);
  ref('fit').addEventListener('click', fit);
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadFile(file);
    fileInput.value = '';
  });

  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    wrap.classList.add('dragover');
  });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('dragover'));
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.classList.remove('dragover');
    const file = e.dataTransfer?.files[0];
    if (file) void loadFile(file);
  });

  // ---------- zoom ----------
  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      if (!state.image) return;
      // Normalise line/page deltas to pixels. Trackpad pinch arrives as ctrl+wheel
      // with small deltas, so it gets a stronger factor.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cssH : 1;
      const k = e.ctrlKey ? 0.01 : 0.0015;
      state.viewport = zoomAt(state.viewport, screenPoint(e), Math.exp(-e.deltaY * unit * k));
      notify();
    },
    { passive: false },
  );

  // Safari trackpad pinch uses non-standard gesture events.
  let gestureStartScale = 1;
  canvas.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureStartScale = state.viewport.scale;
  });
  canvas.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const ge = e as unknown as { scale: number; clientX: number; clientY: number };
    const factor = (gestureStartScale * ge.scale) / state.viewport.scale;
    state.viewport = zoomAt(state.viewport, screenPoint(ge), factor);
    notify();
  });

  // ---------- pan + click ----------
  // Middle-drag or Space+drag pans at once. A left-drag also pans once it moves
  // past CLICK_SLOP, so the image can be moved with a plain mouse; a left press
  // that stays put is treated as a click.
  let spaceDown = false;
  let drag: { id: number; startX: number; startY: number; lastX: number; lastY: number; panning: boolean } | null =
    null;
  let suppressClick = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const [x, y] = screenPoint(e);
    drag = { id: e.pointerId, startX: x, startY: y, lastX: x, lastY: y, panning: e.button === 1 || spaceDown };
    updateCursorStyle();
  });

  canvas.addEventListener('pointermove', (e) => {
    const p = screenPoint(e);
    if (drag && drag.id === e.pointerId) {
      if (!drag.panning && Math.hypot(p[0] - drag.startX, p[1] - drag.startY) > CLICK_SLOP) {
        drag.panning = true;
        updateCursorStyle();
      }
      if (drag.panning) {
        state.viewport = pan(state.viewport, p[0] - drag.lastX, p[1] - drag.lastY);
      }
      drag.lastX = p[0];
      drag.lastY = p[1];
    }
    state.cursor = state.image ? screenToImage(state.viewport, p) : null;
    notify();
  });

  const endDrag = (e: PointerEvent) => {
    if (!drag || drag.id !== e.pointerId) return;
    suppressClick = drag.panning;
    drag = null;
    updateCursorStyle();
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    state.cursor = null;
    notify();
  });

  canvas.addEventListener('click', (e) => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    if (!state.image) return;
    handleClick(screenPoint(e), e.detail);
  });

  function handleClick(_screen: Point, _clickCount: number): void {
    // Tools hook in here (drawing arrives in milestone 3).
  }

  function updateCursorStyle(): void {
    canvas.style.cursor = drag?.panning ? 'grabbing' : spaceDown ? 'grab' : 'default';
  }

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (e.code === 'Space') {
      spaceDown = true;
      updateCursorStyle();
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') fit();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spaceDown = false;
      updateCursorStyle();
    }
  });

  // ---------- chrome (top bar, status bar) ----------
  const filenameEl = ref('filename');
  const emptyHint = ref('emptyHint');
  const statusZoom = ref('statusZoom');
  const statusCursor = ref('statusCursor');

  function updateChrome(): void {
    const img = state.image;
    filenameEl.textContent = img ? `${img.filename}  (${img.width} × ${img.height})` : '';
    emptyHint.classList.toggle('hidden', !!img);
    statusZoom.textContent = img ? `Zoom ${Math.round(state.viewport.scale * 100)}%` : '';
    const c = state.cursor;
    statusCursor.textContent =
      c && img && c[0] >= 0 && c[1] >= 0 && c[0] < img.width && c[1] < img.height
        ? `Pixel x ${Math.floor(c[0])}, y ${Math.floor(c[1])}`
        : '';
  }

  subscribe(() => {
    updateChrome();
    requestRedraw();
  });
  updateChrome();
}

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
