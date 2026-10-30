// Annotation screen: canvas with zoom/pan, sidebar, status bar.

import { applyDisplayFilters, CHANNELS } from '../canvas/filters';
import { CLOSE_RADIUS_PX, INNER_COLOR, OUTER_COLOR, render } from '../canvas/render';
import { fitToWindow, pan, screenToImage, zoomAt, type Point } from '../canvas/viewport';
import { createState, notify, subscribe, type AppState, type LoadedImage } from '../state';
import {
  addPoint,
  canClose,
  clampToImage,
  closePolygon,
  isNearFirstPoint,
  removeLastPoint,
  startDraft,
} from '../tools/draw';
import { pointInPolygon } from '../measure/geometry';
import { measureCell } from '../measure/measure';
import { mountCellPanel, mountDisplayControls, mountMeasurementControls } from '../ui/sidebar';

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/bmp', 'image/gif'];
/** A left-button press that moves less than this (screen px) is a click, not a pan. */
const CLICK_SLOP = 4;
/** A click this close (screen px) to the previous point is ignored rather than added twice. */
const DUPLICATE_PX = 3;

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
      <div class="prompt-banner hidden" data-ref="banner">
        <span class="swatch" data-ref="bannerSwatch"></span>
        <span class="text" data-ref="bannerText"></span>
        <button data-ref="bannerUndo" title="Remove the last point you clicked (Backspace)">Undo point</button>
        <button data-ref="bannerFinish" title="Close this shape (Enter)">Finish shape</button>
        <button data-ref="bannerCancel" title="Stop adding this cell (Esc)">Cancel</button>
      </div>
    </div>
    <aside class="sidebar">
      <section data-ref="cellsSection"></section>
      <section data-ref="measureSection"></section>
      <section data-ref="displaySection"></section>
    </aside>
  </main>
  <footer class="statusbar">
    <span data-ref="statusTool"></span>
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
  // Dev-only handle for poking at state from the console and browser tests.
  if (import.meta.env.DEV) (window as unknown as { __state: AppState }).__state = state;
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
    // Read the live size: the ResizeObserver may not have reported yet.
    state.viewport = fitToWindow(state.image.width, state.image.height, wrap.clientWidth, wrap.clientHeight);
    notify();
  }

  // ---------- image loading ----------
  async function loadFile(file: File): Promise<void> {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      alert(`"${file.name}" is not a supported image. Please use PNG, JPEG, WebP, BMP or GIF.`);
      return;
    }
    if (
      (state.cells.length > 0 || state.draft) &&
      !confirm('Opening another image will discard the cells marked on this one. Continue?')
    ) {
      return;
    }
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      alert(`Could not open "${file.name}". The file may be damaged.`);
      return;
    }
    const { width, height } = bitmap;
    const display = document.createElement('canvas');
    display.width = width;
    display.height = height;
    const dctx = display.getContext('2d', { willReadFrequently: true })!;
    dctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const pixels = dctx.getImageData(0, 0, width, height);
    state.image = { filename: file.name, width, height, pixels, display };
    state.cells = [];
    state.nextCellId = 1;
    state.draft = null;
    state.selectedId = null;
    state.revision++;
    refilter();
    fit();
  }

  // ---------- display filters ----------
  // Recomputed into the image's offscreen canvas only when settings change,
  // and at most once per frame while a slider is being dragged.
  let refilterRequested = false;
  function refilter(): void {
    if (state.image) applyFilters(state.image);
  }
  function requestRefilter(): void {
    if (refilterRequested) return;
    refilterRequested = true;
    requestAnimationFrame(() => {
      refilterRequested = false;
      refilter();
      notify();
    });
  }
  function applyFilters(img: LoadedImage): void {
    const out = new ImageData(img.width, img.height);
    applyDisplayFilters(img.pixels, state.display, out.data);
    img.display.getContext('2d')!.putImageData(out, 0, 0);
  }
  const displayControls = mountDisplayControls(ref('displaySection'), state.display, requestRefilter);

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

  function handleClick(screen: Point, clickCount: number): void {
    const img = state.image!;
    const d = state.draft;
    if (d) {
      // The first click of a double-click already placed a point; the second closes.
      if (clickCount >= 2) {
        if (d.points.length > 0) finishShape();
        return;
      }
      const p = clampToImage(screenToImage(state.viewport, screen), img.width, img.height);
      const last = d.points[d.points.length - 1];
      const tooClose = last && Math.hypot(p[0] - last[0], p[1] - last[1]) * state.viewport.scale < DUPLICATE_PX;
      if (isNearFirstPoint(d, p, CLOSE_RADIUS_PX / state.viewport.scale)) finishShape();
      else if (!tooClose) state.draft = addPoint(d, p);
      notify();
      return;
    }
    selectCell(cellAt(screenToImage(state.viewport, screen)));
  }

  /** The cell whose outer ring contains `p`; the smallest one if they overlap. */
  function cellAt(p: Point): number | null {
    let best: { id: number; area: number } | null = null;
    for (const c of state.cells) {
      if (!pointInPolygon(p, c.outer)) continue;
      const area = c.measurements.outer.area;
      if (!best || area < best.area) best = { id: c.id, area };
    }
    return best?.id ?? null;
  }

  // ---------- add-cell tool ----------
  function startAddCell(): void {
    if (!state.image || state.draft) return;
    state.draft = startDraft();
    state.selectedId = null;
    updateCursorStyle();
    notify();
  }

  function finishShape(): void {
    const d = state.draft;
    if (!d) return;
    const result = closePolygon(d);
    if (!result) {
      flashBanner();
      return;
    }
    if (result.kind === 'next') {
      state.draft = result.draft;
    } else {
      const id = state.nextCellId++;
      state.cells.push({
        id,
        outer: result.outer,
        inner: result.inner,
        flags: [],
        note: '',
        measurements: measureCell(result.outer, result.inner, state.measurement),
      });
      state.revision++;
      state.draft = null;
      state.selectedId = id;
      updateCursorStyle();
    }
    notify();
  }

  function undoPoint(): void {
    if (!state.draft) return;
    state.draft = removeLastPoint(state.draft);
    notify();
  }

  function cancelDraft(): void {
    if (!state.draft) return;
    state.draft = null;
    updateCursorStyle();
    notify();
  }

  function selectCell(id: number | null): void {
    state.selectedId = id;
    notify();
  }

  function deleteCell(id: number): void {
    if (!confirm(`Delete cell ${id}? This cannot be undone yet.`)) return;
    state.cells = state.cells.filter((c) => c.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    state.revision++;
    notify();
  }

  function updateCursorStyle(): void {
    canvas.style.cursor = drag?.panning ? 'grabbing' : spaceDown ? 'grab' : state.draft ? 'crosshair' : 'default';
  }

  const cellPanel = mountCellPanel(ref('cellsSection'), {
    onAdd: startAddCell,
    onSelect: (id) => selectCell(state.selectedId === id ? null : id),
    onDelete: deleteCell,
    onToggleBand: (show) => {
      state.showBand = show;
      notify();
    },
  });

  const measurementControls = mountMeasurementControls(ref('measureSection'), state, (settingsChanged) => {
    if (settingsChanged) remeasureAll();
    notify();
  });

  function remeasureAll(): void {
    for (const c of state.cells) c.measurements = measureCell(c.outer, c.inner, state.measurement);
    state.revision++;
  }

  ref('bannerUndo').addEventListener('click', undoPoint);
  ref('bannerFinish').addEventListener('click', finishShape);
  ref('bannerCancel').addEventListener('click', cancelDraft);

  window.addEventListener('beforeunload', (e) => {
    // Nothing is saved yet (storage arrives in milestone 6), so warn before losing work.
    if (state.cells.length > 0 || state.draft) e.preventDefault();
  });

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
    const key = e.key.toLowerCase();
    if (key === 'enter' && state.draft) {
      e.preventDefault(); // don't also activate a focused button
      finishShape();
    } else if (key === 'escape') {
      if (state.draft) cancelDraft();
      else selectCell(null);
    } else if (key === 'backspace' && state.draft) {
      e.preventDefault();
      undoPoint();
    } else if (key === 'n') startAddCell();
    else if (key === 'r') {
      state.showRays = !state.showRays;
      measurementControls.sync();
      notify();
    } else if (key === 'f') fit();
    else if (key === 'g') {
      state.display.channel = CHANNELS[(CHANNELS.indexOf(state.display.channel) + 1) % CHANNELS.length];
      displayControls.sync();
      requestRefilter();
    }
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
  const statusTool = ref('statusTool');
  const statusZoom = ref('statusZoom');
  const statusCursor = ref('statusCursor');
  const banner = ref('banner');
  const bannerSwatch = ref('bannerSwatch');
  const bannerText = ref('bannerText');
  const bannerUndo = ref<HTMLButtonElement>('bannerUndo');
  const bannerFinish = ref<HTMLButtonElement>('bannerFinish');

  function flashBanner(): void {
    banner.animate(
      [{ transform: 'translateX(-50%)' }, { transform: 'translateX(calc(-50% - 8px))' }, { transform: 'translateX(-50%)' }],
      { duration: 180, iterations: 2 },
    );
  }

  function updateBanner(): void {
    const d = state.draft;
    banner.classList.toggle('hidden', !d);
    if (!d) return;
    const outer = d.phase === 'outer';
    bannerSwatch.style.background = outer ? OUTER_COLOR : INNER_COLOR;
    const remaining = Math.max(0, 3 - d.points.length);
    const how =
      remaining > 0
        ? `Place at least ${remaining} more point${remaining === 1 ? '' : 's'}.`
        : 'To finish, click the first point, double-click, or press Enter.';
    bannerText.innerHTML = outer
      ? `<b>Step 1 of 2:</b> Click around the <b>outer ring</b>.<small>${how}</small>`
      : `<b>Step 2 of 2:</b> Now click around the <b>dark center</b>.<small>${how}</small>`;
    bannerUndo.disabled = d.points.length === 0;
    bannerFinish.disabled = !canClose(d);
  }

  function updateChrome(): void {
    const img = state.image;
    filenameEl.textContent = img ? `${img.filename}  (${img.width} × ${img.height})` : '';
    emptyHint.classList.toggle('hidden', !!img);
    updateBanner();
    cellPanel.update(state);
    statusTool.textContent = !img
      ? ''
      : state.draft
        ? state.draft.phase === 'outer'
          ? 'Adding cell: outer ring'
          : 'Adding cell: dark center'
        : 'Ready';
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

const NON_TEXT_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color']);

/** True when keystrokes should go to a form field rather than the shortcuts. */
function isTyping(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(target.type)) ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}
