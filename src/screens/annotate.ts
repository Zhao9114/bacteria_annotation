// Annotation screen: canvas with zoom/pan, floating toolbar, inspector.

import { applyDisplayFilters, CHANNELS } from '../canvas/filters';
import { closeRadiusPx, INNER_COLOR, OUTER_COLOR, render } from '../canvas/render';
import { fitToWindow, pan, pinchViewport, screenToImage, zoomAt, type Point, type Viewport } from '../canvas/viewport';
import { History, type Snapshot } from '../history';
import { fromDoc, toDoc } from '../io/annotation';
import type { Cell, DrawMode } from '../io/schema';
import { pointInPolygon } from '../measure/geometry';
import { measureCell } from '../measure/measure';
import { createState, notify, subscribe, type AppState, type LoadedImage } from '../state';
import { compareImages, type ImageRecord, type ImageSummary, type Store } from '../storage/store';
import {
  addPoint,
  canClose,
  clampToImage,
  closePolygon,
  isNearFirstPoint,
  removeLastPoint,
  startDraft,
} from '../tools/draw';
import { closeStroke, shouldSample } from '../tools/freehand';
import { deleteVertex, hitEdge, hitVertex, insertVertex, moveVertex, type Ring } from '../tools/edit';
import { icon } from '../ui/icons';
import { mountCellPanel, mountDisplayControls, mountMeasurementControls } from '../ui/sidebar';
import { toast } from '../ui/toast';
import { annotatorName, mountUserMenu } from '../ui/user';

/** A left-button press that moves less than this (screen px) is a click, not a pan. */
const CLICK_SLOP = { mouse: 4, touch: 8 };
/** A click this close (screen px) to the previous point is ignored rather than added twice. */
const DUPLICATE_PX = 3;
/** Grab radius (screen px) for points and edges of the selected cell. */
const HANDLE_PX = { mouse: 8, touch: 18 };
const ZOOM_STEP = 1.25;
/** A click arriving this soon (ms) after a drag, stroke or pinch belongs to it and is ignored. */
const CLICK_AFTER_GESTURE_MS = 350;
/** Autosave this long after the last change. */
const SAVE_DELAY_MS = 800;
const SAVE_RETRY_MS = 5000;
const DISPLAY_KEY = 'display';
/** Freehand: spacing of stroke samples and simplification tolerance, in screen px. */
const STROKE_SAMPLE_PX = 1.5;
const STROKE_SIMPLIFY_PX = 2;

const TEMPLATE = /* html */ `
<div class="app">
  <header class="topbar">
    <a class="brand" href="#/library"><span class="logo">${icon('logo')}</span><span class="brand-text">Cell Annotator</span></a>
    <a class="back-link" href="#/library" title="Back to the library">${icon('chevronLeft')}</a>
    <nav class="crumbs">
      <span>/</span><a href="#/library">Library</a><span>/</span><span class="current" data-ref="crumbFile">Loading…</span>
    </nav>
    <span class="spacer"></span>
    <span class="pill" data-ref="savePill"></span>
    <div class="group">
      <button class="ghost icon-btn" data-ref="prev" title="Previous image (←)">${icon('chevronLeft')}</button>
      <span class="muted num position" data-ref="position"></span>
      <button class="ghost icon-btn" data-ref="next" title="Next image (→)">${icon('chevronRight')}</button>
    </div>
    <button class="done-btn" data-ref="done" title="Mark this image as finished. You can still change it later.">${icon('check')} <span class="label">Mark as done</span></button>
    <div class="group" data-ref="user"></div>
  </header>
  <main class="workspace">
    <div class="stage" data-ref="wrap">
      <canvas data-ref="canvas"></canvas>
      <div class="empty-state" data-ref="emptyHint">
        <div class="card glass">
          <div class="big-icon">${icon('image')}</div>
          <h2 data-ref="loadTitle">Loading image…</h2>
          <div data-ref="loadMsg"></div>
          <a href="#/library" class="hidden" data-ref="loadBack"><button>${icon('chevronLeft')} Back to library</button></a>
        </div>
      </div>
      <div class="toolbar glass hidden" data-ref="toolbar">
        <button class="ghost icon-btn" data-ref="toolSelect" title="Select cells and move the image (Esc)">${icon('pointer')}</button>
        <button class="ghost" data-ref="toolAdd" title="Add a cell (N)">${icon('plus')} <span class="label">Add cell</span></button>
        <div class="segmented" data-ref="modeSwitch" title="How to draw outlines (D to switch)">
          <button data-mode="points" title="Click points around each outline. Most precise.">${icon('points')} <span class="label">Points</span></button>
          <button data-mode="freehand" title="Hold the mouse button (or your finger) and trace around each outline. Quicker, less precise.">${icon('pencil')} <span class="label">Freehand</span></button>
        </div>
        <span class="sep"></span>
        <button class="ghost icon-btn" data-ref="undo" title="Undo (Ctrl+Z)">${icon('undo')}</button>
        <button class="ghost icon-btn" data-ref="redo" title="Redo (Ctrl+Shift+Z)">${icon('redo')}</button>
        <span class="sep zoom-group"></span>
        <button class="ghost icon-btn zoom-group" data-ref="zoomOut" title="Zoom out (or scroll)">${icon('zoomOut')}</button>
        <span class="zoom zoom-group" data-ref="zoomLabel"></span>
        <button class="ghost icon-btn zoom-group" data-ref="zoomIn" title="Zoom in (or scroll)">${icon('zoomIn')}</button>
        <button class="ghost icon-btn" data-ref="fit" title="Fit the whole image (F)">${icon('fit')}</button>
      </div>
      <div class="prompt glass hidden" data-ref="banner">
        <span class="swatch" data-ref="bannerSwatch"></span>
        <span class="text" data-ref="bannerText"></span>
        <button class="ghost" data-ref="bannerUndo" title="Remove the last point you clicked (Backspace)">${icon('undo')} <span class="label">Point</span></button>
        <button data-ref="bannerFinish" title="Close this shape (Enter)">${icon('check')} <span class="label">Finish</span></button>
        <button class="ghost icon-btn" data-ref="bannerCancel" title="Stop adding this cell (Esc)">${icon('x')}</button>
      </div>
      <div class="hud glass" data-ref="hud"></div>
    </div>
    <aside class="inspector" data-ref="inspector">
      <button class="sheet-header" data-ref="sheetHeader" title="Show or hide the cell list and settings">
        <span class="grip"></span>
        <span class="sheet-title" data-ref="sheetTitle">Cells</span>
        <span class="sheet-summary" data-ref="sheetSummary"></span>
      </button>
      <details class="panel" open>
        <summary>Cells <span class="count" data-ref="cellCount">0</span></summary>
        <div class="body" data-ref="cellsSection"></div>
      </details>
      <details class="panel" open>
        <summary>Measurement</summary>
        <div class="body" data-ref="measureSection"></div>
      </details>
      <details class="panel">
        <summary>Display</summary>
        <div class="body" data-ref="displaySection"></div>
      </details>
    </aside>
  </main>
</div>`;

export function mountAnnotateScreen(root: HTMLElement, store: Store, imageId: string): () => void {
  root.innerHTML = TEMPLATE;
  // Everything registered on window is removed when the screen is left.
  const abort = new AbortController();
  const { signal } = abort;
  const ref = <T extends HTMLElement>(name: string): T => {
    const el = root.querySelector<T>(`[data-ref="${name}"]`);
    if (!el) throw new Error(`missing ref ${name}`);
    return el;
  };

  const state: AppState = createState();
  try {
    Object.assign(state.display, JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? '{}'));
  } catch {
    // Ignore unreadable saved display settings.
  }
  // Dev-only handle for poking at state from the console and browser tests.
  if (import.meta.env.DEV) (window as unknown as { __state: AppState }).__state = state;
  const wrap = ref<HTMLDivElement>('wrap');
  const canvas = ref<HTMLCanvasElement>('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');

  // ---------- undo / redo ----------
  const history = new History();
  const snapshot = (): Snapshot => ({ cells: state.cells, nextCellId: state.nextCellId });
  /** Call before every change to the cells. */
  const recordUndo = () => history.record(snapshot());

  function restore(s: Snapshot | null): void {
    if (!s) return;
    state.cells = s.cells;
    state.nextCellId = s.nextCellId;
    // Settings may have changed since the snapshot was taken.
    for (const c of state.cells) c.measurements = measureCell(c.outer, c.inner, state.measurement);
    if (!state.cells.some((c) => c.id === state.selectedId)) state.selectedId = null;
    state.selectedVertex = null;
    state.hover = null;
    state.revision++;
    notify();
  }
  const undo = () => (state.draft ? undoPoint() : restore(history.undo(snapshot())));
  const redo = () => restore(history.redo(snapshot()));

  /** Apply `change` to a cell's outlines, then re-measure it. */
  function updateCell(id: number, change: (c: Cell) => void): void {
    const c = state.cells.find((x) => x.id === id);
    if (!c) return;
    change(c);
    c.measurements = measureCell(c.outer, c.inner, state.measurement);
    state.revision++;
  }

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

  const resizeObserver = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1;
    cssW = wrap.clientWidth;
    cssH = wrap.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Rotating a phone or resizing the window keeps a fitted image fitted.
    if (fitted) fit();
    requestRedraw();
  });
  resizeObserver.observe(wrap);

  /** True while the view is exactly "fit to window"; any zoom or pan clears it. */
  let fitted = false;

  function setViewport(v: Viewport): void {
    state.viewport = v;
    fitted = false;
  }

  /**
   * Space taken over the canvas by floating UI: the toolbar at the top on
   * desktop; on phones the bottom dock and the collapsed bottom sheet.
   */
  function fitInsets(): { top: number; bottom: number } {
    const w = wrap.getBoundingClientRect();
    let top = 0;
    let bottom = 0;
    for (const el of [toolbar, ref('sheetHeader')]) {
      const r = el.getBoundingClientRect();
      if (r.height === 0 || r.right <= w.left || r.left >= w.right || r.bottom <= w.top || r.top >= w.bottom) continue;
      if (r.top - w.top < w.height / 2) top = Math.max(top, r.bottom - w.top);
      else bottom = Math.max(bottom, w.bottom - r.top);
    }
    return { top, bottom };
  }

  function fit(): void {
    if (!state.image) return;
    // Read live sizes: the ResizeObserver may not have reported yet.
    const { top, bottom } = fitInsets();
    const pad = wrap.clientWidth < 600 ? 10 : 20;
    const v = fitToWindow(state.image.width, state.image.height, wrap.clientWidth, wrap.clientHeight - top - bottom, pad);
    state.viewport = { ...v, ty: v.ty + top };
    fitted = true;
    notify();
  }

  function zoomBy(factor: number): void {
    if (!state.image) return;
    setViewport(zoomAt(state.viewport, [wrap.clientWidth / 2, wrap.clientHeight / 2], factor));
    notify();
  }

  // ---------- image loading ----------
  let record: ImageRecord | null = null;
  /** Creation time of this user's annotation, kept across saves. */
  let annotationCreated: string | null = null;

  async function loadImage(): Promise<void> {
    try {
      const [{ record: rec, blob }, doc] = await Promise.all([store.getImage(imageId), store.getAnnotation(imageId)]);
      const bitmap = await createImageBitmap(blob);
      if (signal.aborted) return bitmap.close();
      const { width, height } = bitmap;
      const display = document.createElement('canvas');
      display.width = width;
      display.height = height;
      const dctx = display.getContext('2d', { willReadFrequently: true })!;
      dctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      const pixels = dctx.getImageData(0, 0, width, height);

      record = rec;
      state.image = { filename: rec.filename, width, height, pixels, display };
      if (doc) {
        const content = fromDoc(doc);
        // Keep the same settings object: the measurement panel holds a reference to it.
        Object.assign(state.measurement, content.measurement);
        state.cells = content.cells;
        state.nextCellId = content.nextCellId;
        state.status = content.status;
        annotationCreated = doc.created;
      }
      state.revision++;
      savedRevision = state.revision;
      measurementControls.sync();
      refilter();
      fit();
      void loadNeighbours(rec);
    } catch (e) {
      if (signal.aborted) return;
      ref('loadTitle').textContent = 'Could not open this image';
      ref('loadMsg').textContent = (e as Error).message;
      ref('loadBack').classList.remove('hidden');
    }
  }

  // ---------- autosave ----------
  let savedRevision = 0;
  let saving = false;
  let saveFailed = false;
  let saveTimer = 0;

  function scheduleSave(delay = SAVE_DELAY_MS): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveNow(), delay);
  }

  async function saveNow(): Promise<void> {
    clearTimeout(saveTimer);
    if (!record || saving || state.revision === savedRevision) return;
    const rev = state.revision;
    const doc = toDoc(
      { cells: state.cells, status: state.status, measurement: state.measurement },
      { filename: record.filename, sha256: record.sha256, width: record.width, height: record.height },
      annotatorName(store.currentUser()),
      annotationCreated,
    );
    saving = true;
    updateSavePill();
    try {
      await store.saveAnnotation(record.id, doc);
      annotationCreated = doc.created;
      savedRevision = rev;
      saveFailed = false;
    } catch (e) {
      if (!saveFailed) toast(`Could not save: ${(e as Error).message}. Retrying…`, 'error');
      saveFailed = true;
      scheduleSave(SAVE_RETRY_MS);
    } finally {
      saving = false;
      if (!saveFailed && state.revision !== savedRevision) scheduleSave();
      updateSavePill();
    }
  }

  const savePill = ref('savePill');
  function updateSavePill(): void {
    if (!record) {
      savePill.className = 'hidden';
      return;
    }
    const pending = saving || state.revision !== savedRevision;
    const [cls, text] = saveFailed
      ? ['bad', "Couldn't save · retrying"]
      : pending
        ? ['info', 'Saving…']
        : ['ok', store.kind === 'local' ? 'Saved in this browser' : 'Saved'];
    savePill.className = `pill ${cls} save-pill`;
    savePill.textContent = text;
    savePill.title = text;
    savePill.setAttribute('aria-label', text);
  }

  // ---------- status + previous / next ----------
  const doneBtn = ref<HTMLButtonElement>('done');
  doneBtn.addEventListener('click', () => {
    state.status = state.status === 'done' ? 'in_progress' : 'done';
    state.revision++;
    notify();
    if (state.status === 'done') toast('Marked as done.');
  });

  let neighbours: ImageSummary[] = [];
  async function loadNeighbours(rec: ImageRecord): Promise<void> {
    const scope = rec.owner_id === store.currentUser()?.id ? 'mine' : 'shared';
    try {
      neighbours = (await store.listImages(scope)).sort(compareImages);
    } catch {
      neighbours = [];
    }
    // The user may have left this screen while the list was loading.
    if (!signal.aborted) updateNav();
  }
  function neighbourIndex(): number {
    return neighbours.findIndex((n) => n.id === imageId);
  }
  function updateNav(): void {
    const i = neighbourIndex();
    ref<HTMLButtonElement>('prev').disabled = i <= 0;
    ref<HTMLButtonElement>('next').disabled = i < 0 || i >= neighbours.length - 1;
    ref('position').textContent = i >= 0 ? `${i + 1} / ${neighbours.length}` : '';
  }
  async function go(delta: number): Promise<void> {
    const target = neighbours[neighbourIndex() + delta];
    if (!target || state.draft) return;
    await saveNow();
    location.hash = `#/image/${target.id}`;
  }
  ref('prev').addEventListener('click', () => void go(-1));
  ref('next').addEventListener('click', () => void go(1));
  mountUserMenu(ref('user'), store);

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
  function displayChanged(): void {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(state.display));
    requestRefilter();
  }
  const displayControls = mountDisplayControls(ref('displaySection'), state.display, displayChanged);

  ref('fit').addEventListener('click', fit);
  ref('zoomIn').addEventListener('click', () => zoomBy(ZOOM_STEP));
  ref('zoomOut').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));

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
      setViewport(zoomAt(state.viewport, screenPoint(e), Math.exp(-e.deltaY * unit * k)));
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
    setViewport(zoomAt(state.viewport, screenPoint(ge), factor));
    notify();
  });

  // ---------- pan + click ----------
  // Middle-drag or Space+drag pans at once. A left-drag (or one finger) also
  // pans once it moves past the click slop, so the image can be moved with a
  // plain mouse or a finger; a press that stays put is a click / tap.
  // Two fingers pinch to zoom and pan.
  let spaceDown = false;
  let drag: { id: number; startX: number; startY: number; lastX: number; lastY: number; panning: boolean } | null =
    null;
  /** Clicks before this time come from a drag, stroke or pinch that just ended. */
  let ignoreClicksUntil = 0;
  const swallowNextClick = () => (ignoreClicksUntil = performance.now() + CLICK_AFTER_GESTURE_MS);
  /** Point of the selected cell being dragged; `moved` defers the undo entry until it actually moves. */
  let vertexDrag: { id: number; ring: Ring; index: number; moved: boolean } | null = null;
  /** Fingers currently on the canvas, in screen px. */
  const pointers = new Map<number, Point>();
  let pinch: { start: Viewport; a: number; b: number; a0: Point; b0: Point } | null = null;
  const isTouch = () => state.pointerType === 'touch';
  const handlePx = () => (isTouch() ? HANDLE_PX.touch : HANDLE_PX.mouse);
  const clickSlop = () => (isTouch() ? CLICK_SLOP.touch : CLICK_SLOP.mouse);

  /** A second finger landed: drop whatever the first one started and pinch instead. */
  function startPinch(): void {
    drag = null;
    vertexDrag = null; // a move already made stays, with its undo entry
    if (state.draft?.stroke) state.draft = { ...state.draft, stroke: null }; // discard, don't close
    const [[a, a0], [b, b0]] = [...pointers.entries()];
    pinch = { start: state.viewport, a, b, a0, b0 };
    state.cursor = null;
    state.hover = null;
    notify();
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    if (e.button === 1) e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    state.pointerType = e.pointerType || 'mouse';
    const [x, y] = screenPoint(e);
    if (e.pointerType === 'touch') {
      pointers.set(e.pointerId, [x, y]);
      if (pointers.size === 2) return startPinch();
      if (pointers.size > 2 || pinch) return;
    }
    if (e.button === 0 && !spaceDown && startVertexDrag([x, y])) return;
    if (e.button === 0 && !spaceDown && state.draft?.mode === 'freehand') {
      state.draft = { ...state.draft, stroke: [screenToImage(state.viewport, [x, y])] };
      notify();
      return;
    }
    drag = { id: e.pointerId, startX: x, startY: y, lastX: x, lastY: y, panning: e.button === 1 || spaceDown };
    updateCursorStyle();
  });

  /** Grab a point of the selected cell, or press on an edge to add one there. */
  function startVertexDrag(screen: Point): boolean {
    const cell = state.cells.find((c) => c.id === state.selectedId);
    if (!cell || state.draft || !state.image) return false;
    const p = screenToImage(state.viewport, screen);
    const tol = handlePx() / state.viewport.scale;
    const v = hitVertex(cell, p, tol);
    if (v) {
      vertexDrag = { id: cell.id, ...v, moved: false };
      state.selectedVertex = v;
      notify();
      return true;
    }
    const edge = hitEdge(cell, p, tol);
    if (edge) {
      recordUndo();
      updateCell(cell.id, (c) => (c[edge.ring] = insertVertex(c[edge.ring], edge.index, edge.point)));
      vertexDrag = { id: cell.id, ring: edge.ring, index: edge.index + 1, moved: true };
      state.selectedVertex = { ring: edge.ring, index: edge.index + 1 };
      state.hover = null;
      notify();
      return true;
    }
    return false;
  }

  canvas.addEventListener('pointermove', (e) => {
    const p = screenPoint(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
    if (pinch) {
      const a1 = pointers.get(pinch.a);
      const b1 = pointers.get(pinch.b);
      if (a1 && b1) setViewport(pinchViewport(pinch.start, pinch.a0, pinch.b0, a1, b1));
      notify();
      return;
    }
    if (e.pointerType === 'touch' && !pointers.has(e.pointerId)) return;
    if (state.draft?.stroke) {
      const ip = screenToImage(state.viewport, p);
      const stroke = state.draft.stroke;
      if (shouldSample(stroke, ip, STROKE_SAMPLE_PX / state.viewport.scale)) stroke.push(ip);
    } else if (vertexDrag) {
      const img = state.image!;
      const ip = clampToImage(screenToImage(state.viewport, p), img.width, img.height);
      if (!vertexDrag.moved) {
        recordUndo();
        vertexDrag.moved = true;
      }
      const { ring, index } = vertexDrag;
      updateCell(vertexDrag.id, (c) => (c[ring] = moveVertex(c[ring], index, ip)));
    } else if (drag && drag.id === e.pointerId) {
      if (!drag.panning && Math.hypot(p[0] - drag.startX, p[1] - drag.startY) > clickSlop()) {
        drag.panning = true;
        updateCursorStyle();
      }
      if (drag.panning) {
        setViewport(pan(state.viewport, p[0] - drag.lastX, p[1] - drag.lastY));
      }
      drag.lastX = p[0];
      drag.lastY = p[1];
    }
    state.cursor = state.image ? screenToImage(state.viewport, p) : null;
    updateHover();
    notify();
  });

  function updateHover(): void {
    const cell = state.cells.find((c) => c.id === state.selectedId);
    // Fingers don't hover, so there is nothing to preview for touch.
    if (!cell || !state.cursor || state.draft || drag || vertexDrag || isTouch()) {
      state.hover = null;
    } else {
      const tol = handlePx() / state.viewport.scale;
      const vertex = hitVertex(cell, state.cursor, tol);
      state.hover = { vertex, edge: vertex ? null : hitEdge(cell, state.cursor, tol) };
    }
    updateCursorStyle();
  }

  const endDrag = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (e.pointerType === 'touch') {
      // No hover after the finger lifts: drop the cursor so nothing sticks there.
      state.cursor = null;
      state.hover = null;
      notify();
    }
    if (pinch) {
      // Stay in the pinch until every finger has lifted.
      if (pointers.size === 0) pinch = null;
      swallowNextClick();
      return;
    }
    if (state.draft?.stroke) {
      finishStroke();
      swallowNextClick();
      return;
    }
    if (vertexDrag) {
      vertexDrag = null;
      swallowNextClick();
      updateCursorStyle();
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    if (drag.panning) swallowNextClick();
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
    if (performance.now() < ignoreClicksUntil) return;
    if (!state.image) return;
    handleClick(screenPoint(e), e.detail);
  });

  function handleClick(screen: Point, clickCount: number): void {
    const img = state.image!;
    const d = state.draft;
    if (d?.mode === 'freehand') return; // strokes are handled by pointerdown/up
    if (d) {
      // The first click of a double-click already placed a point; the second closes.
      if (clickCount >= 2) {
        if (d.points.length > 0) finishShape();
        return;
      }
      const p = clampToImage(screenToImage(state.viewport, screen), img.width, img.height);
      const last = d.points[d.points.length - 1];
      const tooClose = last && Math.hypot(p[0] - last[0], p[1] - last[1]) * state.viewport.scale < DUPLICATE_PX;
      if (isNearFirstPoint(d, p, closeRadiusPx(state.pointerType) / state.viewport.scale)) finishShape();
      else if (!tooClose) state.draft = addPoint(d, p);
      notify();
      return;
    }
    selectCell(cellAt(screenToImage(state.viewport, screen)));
    updateHover();
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
    state.draft = startDraft(state.drawMode);
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
      recordUndo();
      const id = state.nextCellId++;
      state.cells.push({
        id,
        outer: result.outer,
        inner: result.inner,
        flags: [],
        note: '',
        draw_mode: d.mode,
        measurements: measureCell(result.outer, result.inner, state.measurement),
      });
      state.revision++;
      state.draft = null;
      state.selectedId = id;
      updateCursorStyle();
    }
    notify();
  }

  /** Freehand: the mouse was released, so close the traced outline. */
  function finishStroke(): void {
    const d = state.draft!;
    const img = state.image!;
    const poly = closeStroke(d.stroke!, STROKE_SIMPLIFY_PX / state.viewport.scale, img.width, img.height);
    state.draft = { ...d, stroke: null, points: poly ?? [] };
    if (poly) finishShape();
    else flashBanner();
    notify();
  }

  function setDrawMode(mode: DrawMode): void {
    state.drawMode = mode;
    localStorage.setItem('drawMode', mode);
    // Switching mid-cell restarts only the outline being drawn now.
    if (state.draft) state.draft = { ...state.draft, mode, points: [], stroke: null };
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
    if (id !== state.selectedId) state.selectedVertex = null;
    state.selectedId = id;
    notify();
  }

  function deleteCell(id: number): void {
    if (!confirm(`Delete cell ${id}? You can bring it back with Undo.`)) return;
    recordUndo();
    state.cells = state.cells.filter((c) => c.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    state.selectedVertex = null;
    state.revision++;
    notify();
  }

  /** Delete key: the selected point if there is one, otherwise the selected cell. */
  function deleteSelection(): void {
    const id = state.selectedId;
    if (id === null) return;
    const sv = state.selectedVertex;
    if (!sv) {
      deleteCell(id);
      return;
    }
    const cell = state.cells.find((c) => c.id === id)!;
    const next = deleteVertex(cell[sv.ring], sv.index);
    if (!next) {
      toast('An outline needs at least 3 points. Delete the whole cell instead.', 'error');
      return;
    }
    recordUndo();
    updateCell(id, (c) => (c[sv.ring] = next));
    state.selectedVertex = null;
    notify();
  }

  function updateCursorStyle(): void {
    canvas.style.cursor =
      drag?.panning
        ? 'grabbing'
        : vertexDrag || state.hover?.vertex
          ? 'move'
          : spaceDown
            ? 'grab'
            : state.draft || state.hover?.edge
              ? 'crosshair'
              : 'default';
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

  ref('toolSelect').addEventListener('click', () => cancelDraft());
  ref('toolAdd').addEventListener('click', startAddCell);
  ref('undo').addEventListener('click', undo);
  ref('modeSwitch').addEventListener('click', (e) => {
    const mode = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
    if (mode === 'points' || mode === 'freehand') setDrawMode(mode);
  });
  ref('redo').addEventListener('click', redo);
  ref('bannerUndo').addEventListener('click', undoPoint);
  ref('bannerFinish').addEventListener('click', finishShape);
  ref('bannerCancel').addEventListener('click', cancelDraft);

  window.addEventListener(
    'beforeunload',
    (e) => {
      // Only warn while a change hasn't reached storage yet.
      if (saving || state.revision !== savedRevision) {
        void saveNow();
        e.preventDefault();
      }
    },
    { signal },
  );

  // ---------- keyboard ----------
  window.addEventListener('keydown', (e) => {
    if (isTyping(e.target)) return;
    if (e.code === 'Space') {
      spaceDown = true;
      updateCursorStyle();
      e.preventDefault();
      return;
    }
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      if (key === 'z' && !e.shiftKey) undo();
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo();
      else return;
      e.preventDefault();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (key === 'enter' && state.draft) {
      e.preventDefault(); // don't also activate a focused button
      finishShape();
    } else if (key === 'escape') {
      if (state.draft) cancelDraft();
      else if (state.selectedVertex) {
        state.selectedVertex = null;
        notify();
      } else selectCell(null);
    } else if (key === 'backspace' && state.draft) {
      e.preventDefault();
      undoPoint();
    } else if (key === 'delete' || key === 'backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (key === 'n') startAddCell();
    else if (key === 'd') setDrawMode(state.drawMode === 'points' ? 'freehand' : 'points');
    else if (key === 'r') {
      state.showRays = !state.showRays;
      measurementControls.sync();
      notify();
    } else if (key === 'f') fit();
    else if (key === 'g') {
      state.display.channel = CHANNELS[(CHANNELS.indexOf(state.display.channel) + 1) % CHANNELS.length];
      displayControls.sync();
      displayChanged();
    } else if (key === 'arrowleft' && !state.draft) void go(-1);
    else if (key === 'arrowright' && !state.draft) void go(1);
  }, { signal });
  window.addEventListener(
    'keyup',
    (e) => {
      if (e.code === 'Space') {
        spaceDown = false;
        updateCursorStyle();
      }
    },
    { signal },
  );

  // ---------- chrome (top bar, toolbar, prompt, HUD) ----------
  const crumbFile = ref('crumbFile');
  const emptyHint = ref('emptyHint');
  const toolbar = ref('toolbar');
  const toolSelect = ref('toolSelect');
  const toolAdd = ref<HTMLButtonElement>('toolAdd');
  const modeSwitch = ref('modeSwitch');
  const zoomLabel = ref('zoomLabel');
  const undoBtn = ref<HTMLButtonElement>('undo');
  const redoBtn = ref<HTMLButtonElement>('redo');
  const hud = ref('hud');
  const cellCount = ref('cellCount');
  const banner = ref('banner');
  const bannerSwatch = ref('bannerSwatch');
  const bannerText = ref('bannerText');
  const bannerUndo = ref<HTMLButtonElement>('bannerUndo');
  const bannerFinish = ref<HTMLButtonElement>('bannerFinish');
  const sheetTitle = ref('sheetTitle');
  const sheetSummary = ref('sheetSummary');
  // Phones: the inspector is a bottom sheet; its header toggles it open.
  const workspace = root.querySelector<HTMLElement>('.workspace')!;
  ref('sheetHeader').addEventListener('click', () => workspace.classList.toggle('sheet-open'));

  function flashBanner(): void {
    // `translate` stacks on top of whatever `transform` positions the banner.
    banner.animate([{ translate: '0' }, { translate: '-8px 0' }, { translate: '0' }], { duration: 180, iterations: 2 });
  }

  function updateBanner(): void {
    const d = state.draft;
    banner.classList.toggle('hidden', !d);
    if (!d) return;
    const outer = d.phase === 'outer';
    bannerSwatch.style.background = outer ? OUTER_COLOR : INNER_COLOR;
    const freehand = d.mode === 'freehand';
    bannerUndo.classList.toggle('hidden', freehand);
    bannerFinish.classList.toggle('hidden', freehand);
    if (freehand) {
      const what = outer ? 'outer ring' : 'dark center';
      const tip = isTouch()
        ? 'Keep your finger down, go all the way around, then lift it. Pinch with two fingers to zoom or move.'
        : 'Hold the mouse button, go all the way around, then let go. Scroll or Space+drag to move the view.';
      bannerText.innerHTML = `<b>Step ${outer ? 1 : 2} of 2</b> · Trace around the <b>${what}</b><small>${tip}</small>`;
      return;
    }
    const remaining = Math.max(0, 3 - d.points.length);
    const how =
      remaining > 0
        ? `Place at least ${remaining} more point${remaining === 1 ? '' : 's'}.`
        : isTouch()
          ? 'To finish, tap the first point or press Finish.'
          : 'To finish, click the first point, double-click, or press Enter.';
    const verb = isTouch() ? 'Tap' : 'Click';
    bannerText.innerHTML = outer
      ? `<b>Step 1 of 2</b> · ${verb} around the <b>outer ring</b><small>${how}</small>`
      : `<b>Step 2 of 2</b> · ${verb} around the <b>dark center</b><small>${how}</small>`;
    bannerUndo.disabled = d.points.length === 0;
    bannerFinish.disabled = !canClose(d);
  }

  function updateChrome(): void {
    const img = state.image;
    crumbFile.textContent = img ? img.filename : 'Loading…';
    crumbFile.title = img ? `${img.filename} (${img.width} × ${img.height} px)` : '';
    emptyHint.classList.toggle('hidden', !!img);
    toolbar.classList.toggle('hidden', !img);
    toolSelect.classList.toggle('active', !state.draft);
    toolAdd.classList.toggle('active', !!state.draft);
    for (const b of modeSwitch.querySelectorAll<HTMLElement>('[data-mode]')) {
      b.classList.toggle('active', b.dataset.mode === state.drawMode);
    }
    zoomLabel.textContent = `${Math.round(state.viewport.scale * 100)}%`;
    undoBtn.disabled = !history.canUndo && !(state.draft && state.draft.points.length > 0);
    redoBtn.disabled = !history.canRedo;
    cellCount.textContent = String(state.cells.length);
    doneBtn.classList.toggle('active', state.status === 'done');
    doneBtn.disabled = !img;
    doneBtn.innerHTML = `${icon('check')} <span class="label">${state.status === 'done' ? 'Done' : 'Mark as done'}</span>`;
    sheetTitle.textContent = `Cells · ${state.cells.length}`;
    const sel = state.cells.find((x) => x.id === state.selectedId);
    sheetSummary.textContent = sel
      ? `Cell ${sel.id}: ${sel.measurements.gap_median === null ? '—' : `${sel.measurements.gap_median.toFixed(1)} px`}`
      : '';
    updateSavePill();
    updateBanner();
    cellPanel.update(state);

    const c = state.cursor;
    const inImage = c && img && c[0] >= 0 && c[1] >= 0 && c[0] < img.width && c[1] < img.height;
    hud.textContent = img
      ? `${img.width} × ${img.height} px${inImage ? `   ·   x ${Math.floor(c[0])}, y ${Math.floor(c[1])}` : ''}`
      : '';
  }

  let lastRevision = state.revision;
  const unsubscribe = subscribe(() => {
    if (state.revision !== lastRevision) {
      lastRevision = state.revision;
      if (state.status === 'not_started' && state.cells.length > 0) state.status = 'in_progress';
      scheduleSave();
    }
    updateChrome();
    requestRedraw();
  });
  updateChrome();
  void loadImage();

  return () => {
    void saveNow(); // flush anything pending; it finishes in the background
    abort.abort();
    resizeObserver.disconnect();
    unsubscribe();
  };
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
