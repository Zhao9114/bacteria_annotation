// The annotation session: everything about editing one person's annotation of
// one image, with no DOM. The screen reports taps and drags (in image pixels)
// and the commands below; it renders what the session exposes. Tests drive the
// same interface.
//
// Owns: cells, the cell being drawn (draft), selection, undo/redo, status and
// measurement settings. Every cell is re-measured whenever its outlines or the
// settings change.

import type { AnnotationContent } from '../io/annotation';
import type { Cell, DrawMode, ImageStatus, Point } from '../io/schema';
import { pointInPolygon } from '../measure/geometry';
import { DEFAULT_MEASUREMENT_SETTINGS, measureCell, type MeasurementSettings } from '../measure/measure';
import { addPoint, canClose, clampToImage, closePolygon, isNearFirstPoint, removeLastPoint, startDraft, type Draft } from './draft';
import { deleteVertex, hitEdge, hitVertex, insertVertex, moveVertex, type EdgeHit, type VertexRef } from './edit';
import { closeStroke, shouldSample } from './freehand';
import { History, type Snapshot } from './history';

export interface SessionInit {
  width: number;
  height: number;
  /** A saved annotation to continue, if any. */
  content?: AnnotationContent | null;
  drawMode?: DrawMode;
}

/**
 * Distances in image pixels at the current zoom. The screen derives them from
 * screen-pixel sizes and the pointer (fingers get larger targets).
 */
export interface Tolerances {
  /** Grab a point of the selected cell, or press its outline to insert one. */
  handle: number;
  /** Close an outline by tapping near its first point. */
  close: number;
  /** A point this close to the previous one (the second click of a double-click) is ignored. */
  duplicate: number;
  /** Freehand: spacing of the samples kept while tracing. */
  sample: number;
  /** Freehand: how far the finished outline may stray from the trace when simplified. */
  simplify: number;
}

/** What hovering over the selected cell would grab. */
export interface HoverTarget {
  vertex: VertexRef | null;
  edge: EdgeHit | null;
}

export class AnnotationSession {
  private _cells: Cell[];
  private nextCellId: number;
  private _status: ImageStatus;
  private _measurement: MeasurementSettings;
  private _drawMode: DrawMode;
  private _draft: Draft | null = null;
  private _selectedId: number | null = null;
  private _selectedVertex: VertexRef | null = null;
  /** The selected point is being dragged; `moved` defers its undo entry until it actually moves. */
  private grabbed: { moved: boolean } | null = null;
  private readonly history = new History();
  private _revision = 0;
  private readonly listeners = new Set<() => void>();
  readonly width: number;
  readonly height: number;

  constructor(init: SessionInit) {
    this.width = init.width;
    this.height = init.height;
    const c = init.content;
    this._measurement = { ...DEFAULT_MEASUREMENT_SETTINGS, ...c?.measurement };
    this._cells = (c?.cells ?? []).map((cell) => this.measured(cell));
    this.nextCellId = this._cells.reduce((m, x) => Math.max(m, x.id), 0) + 1;
    this._status = c?.status ?? 'not_started';
    this._drawMode = init.drawMode ?? 'points';
  }

  // ------------------------------------------------------------ reading

  get cells(): readonly Cell[] {
    return this._cells;
  }
  get draft(): Readonly<Draft> | null {
    return this._draft;
  }
  get drawMode(): DrawMode {
    return this._drawMode;
  }
  get selectedId(): number | null {
    return this._selectedId;
  }
  get selectedVertex(): VertexRef | null {
    return this._selectedVertex;
  }
  get selectedCell(): Cell | null {
    return this._cells.find((c) => c.id === this._selectedId) ?? null;
  }
  get status(): ImageStatus {
    return this._status;
  }
  get measurement(): Readonly<MeasurementSettings> {
    return this._measurement;
  }
  /** Bumped whenever saved content (cells, status, settings) changes. */
  get revision(): number {
    return this._revision;
  }
  get canUndo(): boolean {
    return this.history.canUndo || (this._draft?.points.length ?? 0) > 0;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }
  /** True when the current outline can be closed. */
  get canFinishShape(): boolean {
    return !!this._draft && canClose(this._draft);
  }
  /** True while a point is being dragged. */
  get isDragging(): boolean {
    return this.grabbed !== null;
  }

  /** What gets saved. */
  toContent(): AnnotationContent {
    return { cells: this._cells, status: this._status, measurement: { ...this._measurement } };
  }

  /** What a press at `p` on the selected cell would grab; null when nothing is selected or a cell is being drawn. */
  hoverTarget(p: Point, tolerance: number): HoverTarget | null {
    const cell = this.selectedCell;
    if (!cell || this._draft) return null;
    const vertex = hitVertex(cell, p, tolerance);
    return { vertex, edge: vertex ? null : hitEdge(cell, p, tolerance) };
  }

  /** Called after every change (content, draft or selection). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ------------------------------------------------------------ pointer input

  /**
   * A tap (count 2 = double-tap). Not drawing: select the cell under `p`.
   * Drawing in points mode: place a point, or close the outline when tapping
   * its first point; a double-tap closes it. False when a double-tap could not
   * close the outline (too few points).
   */
  tap(p: Point, count: number, t: Tolerances): boolean {
    const d = this._draft;
    if (!d) {
      this.select(this.cellAt(p));
      return true;
    }
    if (this._drawMode === 'freehand') return true; // traces are drags
    // The first tap of a double-tap already placed a point; the second closes.
    if (count >= 2) return d.points.length === 0 || this.finishShape();
    this.placePoint(clampToImage(p, this.width, this.height), t);
    return true;
  }

  /**
   * A press began at `p`. True if the session takes the drag that may follow:
   * a freehand trace, or a point of the selected cell (pressing its outline
   * inserts a point there). Otherwise the screen pans or waits for a tap.
   */
  press(p: Point, t: Tolerances): boolean {
    const d = this._draft;
    if (!d) return this.grab(p, t.handle);
    if (this._drawMode !== 'freehand') return false;
    this._draft = { ...d, stroke: [p] };
    this.emit();
    return true;
  }

  /** The taken drag moved to `p`. */
  drag(p: Point, t: Tolerances): void {
    const stroke = this._draft?.stroke;
    if (stroke) {
      if (!shouldSample(stroke, p, t.sample)) return;
      this._draft = { ...this._draft!, stroke: [...stroke, p] };
      this.emit();
    } else if (this.grabbed) {
      this.dragPoint(p);
    }
  }

  /** The taken drag ended. False when a trace was too small to be an outline. */
  release(t: Tolerances): boolean {
    this.grabbed = null;
    const d = this._draft;
    if (!d?.stroke) return true;
    const poly = closeStroke(d.stroke, t.simplify, this.width, this.height);
    this._draft = { ...d, stroke: null, points: poly ?? [] };
    if (poly) return this.finishShape();
    this.emit();
    return false;
  }

  /** The taken drag was interrupted (a second finger landed): a trace is dropped, a moved point stays. */
  cancelPress(): void {
    this.grabbed = null;
    if (!this._draft?.stroke) return;
    this._draft = { ...this._draft, stroke: null };
    this.emit();
  }

  // ------------------------------------------------------------ drawing a cell

  /** Start adding a cell (outer ring first). False if one is already being drawn. */
  startCell(): boolean {
    if (this._draft) return false;
    this._draft = startDraft();
    this.setSelection(null);
    this.emit();
    return true;
  }

  /** Switching mode mid-cell restarts only the outline being drawn now. */
  setDrawMode(mode: DrawMode): void {
    this._drawMode = mode;
    if (this._draft) this._draft = { ...this._draft, points: [], stroke: null };
    this.emit();
  }

  /** Close the current outline. False if it has fewer than three points. */
  finishShape(): boolean {
    const d = this._draft;
    if (!d) return false;
    const result = closePolygon(d);
    if (!result) return false;
    if (result.kind === 'next') {
      this._draft = result.draft;
      this.emit();
      return true;
    }
    this.history.record(this.snapshot());
    const id = this.nextCellId++;
    const cell = { id, outer: result.outer, inner: result.inner, flags: [], note: '', draw_mode: this._drawMode };
    this._cells = [...this._cells, this.measured(cell)];
    this._draft = null;
    this.setSelection(id);
    this.contentChanged();
    return true;
  }

  /** Remove the last placed point of the outline being drawn. */
  undoPoint(): void {
    if (!this._draft) return;
    this._draft = removeLastPoint(this._draft);
    this.emit();
  }

  /** Abandon the cell being drawn. */
  cancelCell(): void {
    if (!this._draft) return;
    this._draft = null;
    this.emit();
  }

  // ------------------------------------------------------------ selecting and editing

  select(id: number | null): void {
    this.setSelection(id);
    this.emit();
  }

  /** Step back one level: deselect the selected point, or else the cell. */
  deselect(): void {
    if (this._selectedVertex) this._selectedVertex = null;
    else this.setSelection(null);
    this.emit();
  }

  /** Delete the selected point. 'too_few' when the outline would drop below three points. */
  deletePoint(): 'deleted' | 'too_few' | 'none' {
    const cell = this.selectedCell;
    const sv = this._selectedVertex;
    if (!cell || !sv) return 'none';
    const next = deleteVertex(cell[sv.ring], sv.index);
    if (!next) return 'too_few';
    this.history.record(this.snapshot());
    this.updateCell(cell.id, (c) => ({ ...c, [sv.ring]: next }));
    this._selectedVertex = null;
    this.contentChanged();
    return 'deleted';
  }

  deleteCell(id: number): void {
    if (!this._cells.some((c) => c.id === id)) return;
    this.history.record(this.snapshot());
    this._cells = this._cells.filter((c) => c.id !== id);
    if (this._selectedId === id) this.setSelection(null);
    this.contentChanged();
  }

  // ------------------------------------------------------------ undo / redo

  /** Undo the last change; while drawing, removes the last placed point instead. */
  undo(): void {
    if (this._draft) return this.undoPoint();
    this.restore(this.history.undo(this.snapshot()));
  }

  redo(): void {
    this.restore(this.history.redo(this.snapshot()));
  }

  // ------------------------------------------------------------ status and settings

  setStatus(status: ImageStatus): void {
    if (status === this._status) return;
    this._status = status;
    this.contentChanged();
  }

  /** Change measurement settings; every cell is re-measured. */
  setMeasurement(settings: Partial<MeasurementSettings>): void {
    this._measurement = { ...this._measurement, ...settings };
    this._cells = this._cells.map((c) => this.measured(c));
    this.contentChanged();
  }

  // ------------------------------------------------------------ internals

  /** The cell whose outer ring contains `p`; the smallest one where cells overlap. */
  private cellAt(p: Point): number | null {
    let best: Cell | null = null;
    for (const c of this._cells) {
      if (pointInPolygon(p, c.outer) && (!best || c.measurements.outer.area < best.measurements.outer.area)) best = c;
    }
    return best?.id ?? null;
  }

  /** Points mode: add `p`, or close the outline when it lands on the first point. */
  private placePoint(p: Point, t: Tolerances): void {
    const d = this._draft!;
    if (isNearFirstPoint(d, p, t.close)) {
      this.finishShape();
      return;
    }
    const last = d.points[d.points.length - 1];
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < t.duplicate) return;
    this._draft = addPoint(d, p);
    this.emit();
  }

  /** Grab a point of the selected cell, or insert one on its outline and grab that. */
  private grab(p: Point, tolerance: number): boolean {
    const cell = this.selectedCell;
    const target = this.hoverTarget(p, tolerance);
    if (!cell || !target) return false;
    if (target.vertex) {
      this._selectedVertex = target.vertex;
      this.grabbed = { moved: false };
      this.emit();
      return true;
    }
    const edge = target.edge;
    if (!edge) return false;
    this.history.record(this.snapshot());
    this.updateCell(cell.id, (c) => ({ ...c, [edge.ring]: insertVertex(c[edge.ring], edge.index, edge.point) }));
    this._selectedVertex = { ring: edge.ring, index: edge.index + 1 };
    this.grabbed = { moved: true };
    this.contentChanged();
    return true;
  }

  /** Move the grabbed (selected) point to `p`, kept inside the image. */
  private dragPoint(p: Point): void {
    const cell = this.selectedCell;
    const v = this._selectedVertex;
    if (!cell || !v) return;
    if (!this.grabbed!.moved) {
      // Only now: a click on a point without moving it is not an edit.
      this.history.record(this.snapshot());
      this.grabbed!.moved = true;
    }
    const q = clampToImage(p, this.width, this.height);
    this.updateCell(cell.id, (c) => ({ ...c, [v.ring]: moveVertex(c[v.ring], v.index, q) }));
    this.contentChanged();
  }

  private setSelection(id: number | null): void {
    if (id !== this._selectedId) this._selectedVertex = null;
    this._selectedId = id;
  }

  private snapshot(): Snapshot {
    return { cells: this._cells, nextCellId: this.nextCellId };
  }

  private restore(s: Snapshot | null): void {
    if (!s) return;
    // Settings may have changed since the snapshot was taken.
    this._cells = s.cells.map((c) => this.measured(c));
    this.nextCellId = s.nextCellId;
    if (!this._cells.some((c) => c.id === this._selectedId)) this._selectedId = null;
    this._selectedVertex = null;
    this.grabbed = null;
    this.contentChanged();
  }

  private measured(c: Omit<Cell, 'measurements'>): Cell {
    return { ...c, measurements: measureCell(c.outer, c.inner, this._measurement) };
  }

  private updateCell(id: number, change: (c: Cell) => Omit<Cell, 'measurements'>): void {
    this._cells = this._cells.map((c) => (c.id === id ? this.measured(change(c)) : c));
  }

  private contentChanged(): void {
    if (this._status === 'not_started' && this._cells.length > 0) this._status = 'in_progress';
    this._revision++;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}
