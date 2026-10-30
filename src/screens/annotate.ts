// Annotation screen: loads the image and its annotation, then wires the DOM to
// the annotation session (what is being annotated), the gesture recognizer
// (what the pointer means), the annotation file (autosave) and the renderer
// (what is drawn).

import { AnnotationSession, type Tolerances } from '../annotation/session';
import { applyDisplayFilters, CHANNELS } from '../canvas/filters';
import { INNER_COLOR, OUTER_COLOR, render, type Scene } from '../canvas/render';
import { fitToWindow, pan, pinchViewport, screenToImage, zoomAt, type Point, type Viewport } from '../canvas/viewport';
import { GestureRecognizer, type GestureEvent, type PointerKind } from '../input/gestures';
import type { DrawMode } from '../io/schema';
import { createViewState, type LoadedImage, type ViewState } from '../state';
import { AnnotationFile } from '../storage/annotation-file';
import { compareImages, type Backend, type ImageSummary } from '../storage/store';
import { icon } from '../ui/icons';
import { mountCellPanel, mountDisplayControls, mountMeasurementControls } from '../ui/sidebar';
import { toast } from '../ui/toast';
import { annotatorName, mountUserMenu } from '../ui/user';

/**
 * Press targets in screen px, larger for fingers: grabbing a point or outline
 * of the selected cell, and closing an outline at its first point.
 */
const TARGET_PX: Record<PointerKind, { handle: number; close: number }> = {
  mouse: { handle: 8, close: 10 },
  pen: { handle: 8, close: 10 },
  touch: { handle: 18, close: 22 },
};
/** A click this close (screen px) to the previous point is ignored rather than added twice. */
const DUPLICATE_PX = 3;
/** Freehand: spacing of stroke samples and simplification tolerance, in screen px. */
const STROKE_SAMPLE_PX = 1.5;
const STROKE_SIMPLIFY_PX = 2;
const ZOOM_STEP = 1.25;
const DISPLAY_KEY = 'display';
const DRAW_MODE_KEY = 'drawMode';

const TEMPLATE = /* html */ `
<div class="app">
  <header class="topbar">
    <a class="brand" href="#/library"><span class="logo">${icon('logo')}</span><span class="brand-text">Cell Annotator</span></a>
    <a class="back-link" href="#/library" title="Back to the library">${icon('chevronLeft')}</a>
    <nav class="crumbs">
      <span>/</span><a href="#/library">Library</a><span>/</span><span class="current" data-ref="crumbFile">Loading…</span>
    </nav>
    <span class="spacer"></span>
    <span class="hidden" data-ref="savePill"></span>
    <div class="group">
      <button class="ghost icon-btn" data-ref="prev" disabled title="Previous image (←)">${icon('chevronLeft')}</button>
      <span class="muted num position" data-ref="position"></span>
      <button class="ghost icon-btn" data-ref="next" disabled title="Next image (→)">${icon('chevronRight')}</button>
    </div>
    <button class="done-btn" data-ref="done" disabled title="Mark this image as finished. You can still change it later.">${icon('check')} <span class="label">Mark as done</span></button>
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

type Ref = <T extends HTMLElement = HTMLElement>(name: string) => T;

export function mountAnnotateScreen(root: HTMLElement, backend: Backend, imageId: string): () => void {
  root.innerHTML = TEMPLATE;
  // Everything registered on window is removed when the screen is left.
  const abort = new AbortController();
  const ref: Ref = <T extends HTMLElement>(name: string) => {
    const el = root.querySelector<T>(`[data-ref="${name}"]`);
    if (!el) throw new Error(`missing ref ${name}`);
    return el;
  };
  mountUserMenu(ref('user'), backend.account, backend.auth);

  let closeEditor: (() => void) | null = null;
  void (async () => {
    try {
      const file = await AnnotationFile.open(backend.library, imageId, {
        annotator: () => annotatorName(backend.account.currentUser()),
        onError: (e) => toast(`Could not save: ${e.message}. Retrying…`, 'error'),
      });
      const image = await decodeImage(file.record.filename, file.blob);
      if (!abort.signal.aborted) closeEditor = mountEditor(root, ref, backend, file, image, abort.signal);
    } catch (e) {
      if (abort.signal.aborted) return;
      ref('loadTitle').textContent = 'Could not open this image';
      ref('loadMsg').textContent = (e as Error).message;
      ref('loadBack').classList.remove('hidden');
    }
  })();

  return () => {
    abort.abort();
    closeEditor?.();
  };
}

async function decodeImage(filename: string, blob: Blob): Promise<LoadedImage> {
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const display = document.createElement('canvas');
  display.width = width;
  display.height = height;
  const dctx = display.getContext('2d', { willReadFrequently: true })!;
  dctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { filename, width, height, pixels: dctx.getImageData(0, 0, width, height), display };
}

/** The loaded screen: one image, its annotation session and the file it saves to. */
function mountEditor(
  root: HTMLElement,
  ref: Ref,
  { library, account }: Backend,
  file: AnnotationFile,
  image: LoadedImage,
  signal: AbortSignal,
): () => void {
  const session = new AnnotationSession({
    width: image.width,
    height: image.height,
    content: file.initial,
    drawMode: localStorage.getItem(DRAW_MODE_KEY) === 'freehand' ? 'freehand' : 'points',
  });
  const view: ViewState = createViewState();
  try {
    Object.assign(view.display, JSON.parse(localStorage.getItem(DISPLAY_KEY) ?? '{}'));
  } catch {
    // Ignore unreadable saved display settings.
  }

  const wrap = ref<HTMLDivElement>('wrap');
  const canvas = ref<HTMLCanvasElement>('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas not supported');
  const toolbar = ref('toolbar');
  const crumbFile = ref('crumbFile');
  crumbFile.textContent = image.filename;
  crumbFile.title = `${image.filename} (${image.width} × ${image.height} px)`;
  ref('emptyHint').classList.add('hidden');
  toolbar.classList.remove('hidden');

  // ---------- drawing ----------
  let cssW = 0;
  let cssH = 0;
  let frameRequested = false;

  /** Update the controls now and redraw the canvas on the next frame. */
  function invalidate(): void {
    updateChrome();
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      const dpr = window.devicePixelRatio || 1;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      render(ctx!, scene(), cssW, cssH);
    });
  }

  function scene(): Scene {
    const sel = session.selectedCell;
    const draft = session.draft;
    return {
      image: image.display,
      viewport: view.viewport,
      cells: session.cells,
      showBand: view.showBand,
      selection: sel ? { cell: sel, vertex: session.selectedVertex, hover: view.hover, rays: view.showRays } : null,
      drawing: draft ? { draft, cursor: view.cursor, closeRadiusPx: TARGET_PX[view.pointerType].close } : null,
    };
  }

  const resizeObserver = new ResizeObserver(() => {
    const dpr = window.devicePixelRatio || 1;
    cssW = wrap.clientWidth;
    cssH = wrap.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    // Rotating a phone or resizing the window keeps a fitted image fitted.
    if (fitted) fit();
    invalidate();
  });
  resizeObserver.observe(wrap);

  // ---------- viewport ----------
  /** True while the view is exactly "fit to window"; any zoom or pan clears it. */
  let fitted = false;

  function setViewport(v: Viewport): void {
    view.viewport = v;
    fitted = false;
    invalidate();
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
    // Read live sizes: the ResizeObserver may not have reported yet.
    const { top, bottom } = fitInsets();
    const pad = wrap.clientWidth < 600 ? 10 : 20;
    const v = fitToWindow(image.width, image.height, wrap.clientWidth, wrap.clientHeight - top - bottom, pad);
    view.viewport = { ...v, ty: v.ty + top };
    fitted = true;
    invalidate();
  }

  const zoomBy = (factor: number) => setViewport(zoomAt(view.viewport, [wrap.clientWidth / 2, wrap.clientHeight / 2], factor));

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const toImage = (p: Point): Point => screenToImage(view.viewport, p);

  /** The session's tolerances at the current zoom, for the pointer in use. */
  function tolerances(kind: PointerKind = view.pointerType): Tolerances {
    const px = 1 / view.viewport.scale;
    return {
      handle: TARGET_PX[kind].handle * px,
      close: TARGET_PX[kind].close * px,
      duplicate: DUPLICATE_PX * px,
      sample: STROKE_SAMPLE_PX * px,
      simplify: STROKE_SIMPLIFY_PX * px,
    };
  }

  // ---------- autosave ----------
  let savedRevision = session.revision;
  session.subscribe(() => {
    if (session.revision !== savedRevision) {
      savedRevision = session.revision;
      file.changed(session.toContent());
    }
    updateHover();
    invalidate();
  });
  file.onState(updateSavePill);

  const savePill = ref('savePill');
  function updateSavePill(): void {
    const [cls, text] =
      file.state === 'failed'
        ? ['bad', "Couldn't save · retrying"]
        : file.state === 'saving'
          ? ['info', 'Saving…']
          : ['ok', library.location === 'browser' ? 'Saved in this browser' : 'Saved'];
    savePill.className = `pill ${cls} save-pill`;
    savePill.textContent = text;
    savePill.title = text;
    savePill.setAttribute('aria-label', text);
  }

  window.addEventListener(
    'beforeunload',
    (e) => {
      // Only warn while a change hasn't reached storage yet.
      if (file.pending) {
        void file.flush();
        e.preventDefault();
      }
    },
    { signal },
  );

  // ---------- status + previous / next ----------
  const doneBtn = ref<HTMLButtonElement>('done');
  doneBtn.disabled = false;
  doneBtn.addEventListener('click', () => {
    session.setStatus(session.status === 'done' ? 'in_progress' : 'done');
    if (session.status === 'done') toast('Marked as done.');
  });

  let neighbours: ImageSummary[] = [];
  async function loadNeighbours(): Promise<void> {
    const scope = file.record.owner_id === account.currentUser()?.id ? 'mine' : 'shared';
    try {
      neighbours = (await library.listImages(scope)).sort(compareImages);
    } catch {
      neighbours = [];
    }
    // The user may have left this screen while the list was loading.
    if (!signal.aborted) updateNav();
  }
  function neighbourIndex(): number {
    return neighbours.findIndex((n) => n.id === file.record.id);
  }
  function updateNav(): void {
    const i = neighbourIndex();
    ref<HTMLButtonElement>('prev').disabled = i <= 0;
    ref<HTMLButtonElement>('next').disabled = i < 0 || i >= neighbours.length - 1;
    ref('position').textContent = i >= 0 ? `${i + 1} / ${neighbours.length}` : '';
  }
  async function go(delta: number): Promise<void> {
    const target = neighbours[neighbourIndex() + delta];
    if (!target || session.draft) return;
    await file.flush();
    location.hash = `#/image/${target.id}`;
  }
  ref('prev').addEventListener('click', () => void go(-1));
  ref('next').addEventListener('click', () => void go(1));

  // ---------- display filters ----------
  // Recomputed into the image's offscreen canvas only when settings change,
  // and at most once per frame while a slider is being dragged.
  let refilterRequested = false;
  function refilter(): void {
    const out = new ImageData(image.width, image.height);
    applyDisplayFilters(image.pixels, view.display, out.data);
    image.display.getContext('2d')!.putImageData(out, 0, 0);
  }
  function displayChanged(): void {
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(view.display));
    if (refilterRequested) return;
    refilterRequested = true;
    requestAnimationFrame(() => {
      refilterRequested = false;
      refilter();
      invalidate();
    });
  }
  const displayControls = mountDisplayControls(ref('displaySection'), view.display, displayChanged);

  ref('fit').addEventListener('click', fit);
  ref('zoomIn').addEventListener('click', () => zoomBy(ZOOM_STEP));
  ref('zoomOut').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));

  // ---------- wheel and trackpad zoom ----------
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      // Normalise line/page deltas to pixels. Trackpad pinch arrives as ctrl+wheel
      // with small deltas, so it gets a stronger factor.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cssH : 1;
      const k = e.ctrlKey ? 0.01 : 0.0015;
      setViewport(zoomAt(view.viewport, screenPoint(e), Math.exp(-e.deltaY * unit * k)));
    },
    { passive: false },
  );

  // Safari trackpad pinch uses non-standard gesture events.
  let gestureStartScale = 1;
  canvas.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureStartScale = view.viewport.scale;
  });
  canvas.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const ge = e as unknown as { scale: number; clientX: number; clientY: number };
    setViewport(zoomAt(view.viewport, screenPoint(ge), (gestureStartScale * ge.scale) / view.viewport.scale));
  });

  // ---------- pointer gestures ----------
  // The recognizer decides tap vs drag vs pan vs pinch; the session decides
  // what a tap or a drag means for the annotation.
  let spaceDown = false;
  let pinchStartViewport: Viewport = view.viewport;
  const gestures = new GestureRecognizer({
    pressStart: (p, kind) => session.press(toImage(p), tolerances(kind)),
    dragMove: (p) => session.drag(toImage(p), tolerances()),
    dragEnd: () => {
      if (!session.release(tolerances())) flashBanner();
    },
    dragCancel: () => session.cancelPress(),
    tap: (p, count, kind) => {
      if (!session.tap(toImage(p), count, tolerances(kind))) flashBanner();
    },
    pan: (dx, dy) => setViewport(pan(view.viewport, dx, dy)),
    pinchStart() {
      pinchStartViewport = view.viewport;
      view.cursor = null;
      view.hover = null;
      invalidate();
    },
    pinchMove: (a0, b0, a1, b1) => setViewport(pinchViewport(pinchStartViewport, a0, b0, a1, b1)),
    pinchEnd() {},
    hover(p) {
      view.cursor = p ? toImage(p) : null;
      updateHover();
      invalidate();
    },
  });

  const feed = (type: GestureEvent['type']) => (e: PointerEvent) => {
    if (type === 'down') {
      if (e.button === 1) e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
    }
    const pointerType: PointerKind = e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse';
    view.pointerType = pointerType;
    gestures.handle({ type, id: e.pointerId, p: screenPoint(e), pointerType, button: e.button, panKey: spaceDown, time: e.timeStamp });
    updateCursorStyle();
  };
  canvas.addEventListener('pointerdown', feed('down'));
  canvas.addEventListener('pointermove', feed('move'));
  canvas.addEventListener('pointerup', feed('up'));
  canvas.addEventListener('pointercancel', feed('cancel'));
  canvas.addEventListener('pointerleave', feed('leave'));

  /** What a press at the cursor would grab, for hover feedback (mouse and pen only). */
  function updateHover(): void {
    const busy = gestures.dragging || gestures.panning || gestures.pinching;
    view.hover =
      view.cursor && !busy && view.pointerType !== 'touch' ? session.hoverTarget(view.cursor, tolerances().handle) : null;
    updateCursorStyle();
  }

  function updateCursorStyle(): void {
    canvas.style.cursor = gestures.panning
      ? 'grabbing'
      : session.isDragging || view.hover?.vertex
        ? 'move'
        : spaceDown
          ? 'grab'
          : session.draft || view.hover?.edge
            ? 'crosshair'
            : 'default';
  }

  // ---------- commands ----------
  function setDrawMode(mode: DrawMode): void {
    localStorage.setItem(DRAW_MODE_KEY, mode);
    session.setDrawMode(mode);
  }

  function finishShape(): void {
    if (!session.finishShape()) flashBanner();
  }

  function deleteCell(id: number): void {
    if (confirm(`Delete cell ${id}? You can bring it back with Undo.`)) session.deleteCell(id);
  }

  /** Delete key: the selected point if there is one, otherwise the selected cell. */
  function deleteSelection(): void {
    const result = session.deletePoint();
    if (result === 'too_few') toast('An outline needs at least 3 points. Delete the whole cell instead.', 'error');
    else if (result === 'none' && session.selectedId !== null) deleteCell(session.selectedId);
  }

  function toggleRays(show: boolean): void {
    view.showRays = show;
    measurementControls.sync({ showRays: show, settings: session.measurement });
    invalidate();
  }

  const cellPanel = mountCellPanel(ref('cellsSection'), {
    onAdd: () => session.startCell(),
    onSelect: (id) => session.select(session.selectedId === id ? null : id),
    onDelete: deleteCell,
    onToggleBand: (show) => {
      view.showBand = show;
      invalidate();
    },
  });

  const measurementControls = mountMeasurementControls(ref('measureSection'), {
    rays: toggleRays,
    settings: (change) => {
      session.setMeasurement(change);
      measurementControls.sync({ showRays: view.showRays, settings: session.measurement });
    },
  });
  measurementControls.sync({ showRays: view.showRays, settings: session.measurement });

  ref('toolSelect').addEventListener('click', () => session.cancelCell());
  ref('toolAdd').addEventListener('click', () => session.startCell());
  ref('undo').addEventListener('click', () => session.undo());
  ref('redo').addEventListener('click', () => session.redo());
  ref('modeSwitch').addEventListener('click', (e) => {
    const mode = (e.target as HTMLElement).closest<HTMLElement>('[data-mode]')?.dataset.mode;
    if (mode === 'points' || mode === 'freehand') setDrawMode(mode);
  });
  ref('bannerUndo').addEventListener('click', () => session.undoPoint());
  ref('bannerFinish').addEventListener('click', finishShape);
  ref('bannerCancel').addEventListener('click', () => session.cancelCell());

  // ---------- keyboard ----------
  window.addEventListener(
    'keydown',
    (e) => {
      if (isTyping(e.target)) return;
      if (e.code === 'Space') {
        spaceDown = true;
        updateCursorStyle();
        e.preventDefault();
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (key === 'z' && !e.shiftKey) session.undo();
        else if ((key === 'z' && e.shiftKey) || key === 'y') session.redo();
        else return;
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const drawing = !!session.draft;
      if (key === 'enter' && drawing) {
        e.preventDefault(); // don't also activate a focused button
        finishShape();
      } else if (key === 'escape') {
        if (drawing) session.cancelCell();
        else session.deselect();
      } else if (key === 'backspace' && drawing) {
        e.preventDefault();
        session.undoPoint();
      } else if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (key === 'n') session.startCell();
      else if (key === 'd') setDrawMode(session.drawMode === 'freehand' ? 'points' : 'freehand');
      else if (key === 'r') toggleRays(!view.showRays);
      else if (key === 'f') fit();
      else if (key === 'g') {
        view.display.channel = CHANNELS[(CHANNELS.indexOf(view.display.channel) + 1) % CHANNELS.length];
        displayControls.sync();
        displayChanged();
      } else if (key === 'arrowleft' && !drawing) void go(-1);
      else if (key === 'arrowright' && !drawing) void go(1);
    },
    { signal },
  );
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
    const d = session.draft;
    banner.classList.toggle('hidden', !d);
    if (!d) return;
    const touch = view.pointerType === 'touch';
    const outer = d.phase === 'outer';
    bannerSwatch.style.background = outer ? OUTER_COLOR : INNER_COLOR;
    const freehand = session.drawMode === 'freehand';
    bannerUndo.classList.toggle('hidden', freehand);
    bannerFinish.classList.toggle('hidden', freehand);
    if (freehand) {
      const what = outer ? 'outer ring' : 'dark center';
      const tip = touch
        ? 'Keep your finger down, go all the way around, then lift it. Pinch with two fingers to zoom or move.'
        : 'Hold the mouse button, go all the way around, then let go. Scroll or Space+drag to move the view.';
      bannerText.innerHTML = `<b>Step ${outer ? 1 : 2} of 2</b> · Trace around the <b>${what}</b><small>${tip}</small>`;
      return;
    }
    const remaining = Math.max(0, 3 - d.points.length);
    const how =
      remaining > 0
        ? `Place at least ${remaining} more point${remaining === 1 ? '' : 's'}.`
        : touch
          ? 'To finish, tap the first point or press Finish.'
          : 'To finish, click the first point, double-click, or press Enter.';
    const verb = touch ? 'Tap' : 'Click';
    bannerText.innerHTML = outer
      ? `<b>Step 1 of 2</b> · ${verb} around the <b>outer ring</b><small>${how}</small>`
      : `<b>Step 2 of 2</b> · ${verb} around the <b>dark center</b><small>${how}</small>`;
    bannerUndo.disabled = d.points.length === 0;
    bannerFinish.disabled = !session.canFinishShape;
  }

  function updateChrome(): void {
    const drawing = !!session.draft;
    toolSelect.classList.toggle('active', !drawing);
    toolAdd.classList.toggle('active', drawing);
    for (const b of modeSwitch.querySelectorAll<HTMLElement>('[data-mode]')) {
      b.classList.toggle('active', b.dataset.mode === session.drawMode);
    }
    zoomLabel.textContent = `${Math.round(view.viewport.scale * 100)}%`;
    undoBtn.disabled = !session.canUndo;
    redoBtn.disabled = !session.canRedo;
    cellCount.textContent = String(session.cells.length);
    const done = session.status === 'done';
    doneBtn.classList.toggle('active', done);
    doneBtn.innerHTML = `${icon('check')} <span class="label">${done ? 'Done' : 'Mark as done'}</span>`;
    sheetTitle.textContent = `Cells · ${session.cells.length}`;
    const sel = session.selectedCell;
    sheetSummary.textContent = sel
      ? `Cell ${sel.id}: ${sel.measurements.gap_median === null ? '—' : `${sel.measurements.gap_median.toFixed(1)} px`}`
      : '';
    updateBanner();
    cellPanel.update({
      drawing,
      cells: session.cells,
      selectedId: session.selectedId,
      revision: session.revision,
      showBand: view.showBand,
    });

    const c = view.cursor;
    const inImage = c && c[0] >= 0 && c[1] >= 0 && c[0] < image.width && c[1] < image.height;
    hud.textContent = `${image.width} × ${image.height} px${inImage ? `   ·   x ${Math.floor(c[0])}, y ${Math.floor(c[1])}` : ''}`;
  }

  // Dev-only handle for poking at the screen from the console and browser tests.
  if (import.meta.env.DEV) {
    (window as unknown as { __state: object }).__state = {
      image,
      get viewport() { return view.viewport; },
      set viewport(v: Viewport) { setViewport(v); },
      get cells() { return session.cells; },
      get draft() { return session.draft; },
      get selectedId() { return session.selectedId; },
      get selectedVertex() { return session.selectedVertex; },
      get measurement() { return session.measurement; },
      get status() { return session.status; },
      get drawMode() { return session.drawMode; },
      get revision() { return session.revision; },
      get showRays() { return view.showRays; },
    };
  }

  refilter();
  updateSavePill();
  fit();
  void loadNeighbours();

  return () => {
    void file.close(); // flushes anything pending; finishes in the background
    resizeObserver.disconnect();
    if (import.meta.env.DEV) delete (window as unknown as { __state?: object }).__state;
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
