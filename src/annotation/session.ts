// The annotation session: everything about editing one person's annotation of
// one image, with no DOM. The screen turns input into the intents below and
// renders what the session exposes; tests drive the same interface.
//
// Owns: cells, the cell being drawn (draft), selection, undo/redo, status and
// measurement settings. Every cell is re-measured whenever its outlines or the
// settings change. All coordinates are image pixels; tolerances are given by
// the caller in image pixels (it knows the zoom and the pointer type).

import { History, type Snapshot } from '../history';
import type { AnnotationContent } from '../io/annotation';
import type { Cell, DrawMode, ImageStatus, Point } from '../io/schema';
import { pointInPolygon } from '../measure/geometry';
import { DEFAULT_MEASUREMENT_SETTINGS, measureCell, type MeasurementSettings } from '../measure/measure';
import {
  addPoint,
  canClose,
  clampToImage,
  closePolygon,
  isNearFirstPoint,
  removeLastPoint,
  startDraft,
  type Draft,
} from '../tools/draw';
import { deleteVertex, hitEdge, hitVertex, insertVertex, moveVertex, type EdgeHit, type VertexRef } from '../tools/edit';
import { closeStroke, shouldSample } from '../tools/freehand';

export interface SessionInit {
  width: number;
  height: number;
  /** A saved annotation to continue, if any. */
  content?: (AnnotationContent & { nextCellId?: number }) | null;
  drawMode?: DrawMode;
}

/** What placing a point did. */
export type PlaceResult = 'added' | 'closed' | 'ignored';

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
  /** Point being dragged; `moved` defers the undo entry until it actually moves. */
  private grabbed: { id: number; ring: 'outer' | 'inner'; index: number; moved: boolean } | null = null;
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
    this.nextCellId = c?.nextCellId ?? this._cells.reduce((m, x) => Math.max(m, x.id), 0) + 1;
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

  /** What gets saved. */
  toContent(): AnnotationContent {
    return { cells: this._cells, status: this._status, measurement: { ...this._measurement } };
  }

  /** The cell whose outer ring contains `p`; the smallest one where cells overlap. */
  cellAt(p: Point): number | null {
    let best: Cell | null = null;
    for (const c of this._cells) {
      if (pointInPolygon(p, c.outer) && (!best || c.measurements.outer.area < best.measurements.outer.area)) best = c;
    }
    return best?.id ?? null;
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

  // ------------------------------------------------------------ drawing a cell

  /** Start adding a cell (outer ring first). False if one is already being drawn. */
  startCell(): boolean {
    if (this._draft) return false;
    this._draft = startDraft(this._drawMode);
    this.select(null, false);
    this.emit();
    return true;
  }

  /** Switching mode mid-cell restarts only the outline being drawn now. */
  setDrawMode(mode: DrawMode): void {
    this._drawMode = mode;
    if (this._draft) this._draft = { ...this._draft, mode, points: [], stroke: null };
    this.emit();
  }

  /**
   * Points mode: place a point, or close the outline when `p` is within
   * `closeTolerance` of its first point. A point within `duplicateTolerance`
   * of the previous one is ignored (the second click of a double-click).
   */
  placePoint(p: Point, closeTolerance: number, duplicateTolerance: number): PlaceResult {
    const d = this._draft;
    if (!d || d.mode !== 'points') return 'ignored';
    const q = clampToImage(p, this.width, this.height);
    if (isNearFirstPoint(d, q, closeTolerance)) {
      this.finishShape();
      return 'closed';
    }
    const last = d.points[d.points.length - 1];
    if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < duplicateTolerance) return 'ignored';
    this._draft = addPoint(d, q);
    this.emit();
    return 'added';
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
    this._cells = [
      ...this._cells,
      this.measured({ id, outer: result.outer, inner: result.inner, flags: [], note: '', draw_mode: d.mode }),
    ];
    this._draft = null;
    this.select(id, false);
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
    this.grabbed = null;
    this.emit();
  }

  /** Freehand: start tracing an outline at `p`. */
  beginStroke(p: Point): boolean {
    const d = this._draft;
    if (!d || d.mode !== 'freehand') return false;
    this._draft = { ...d, stroke: [p] };
    this.emit();
    return true;
  }

  /** Freehand: extend the trace; samples closer than `minSpacing` to the last one are skipped. */
  extendStroke(p: Point, minSpacing: number): void {
    const stroke = this._draft?.stroke;
    if (!stroke) return;
    if (shouldSample(stroke, p, minSpacing)) {
      stroke.push(p);
      this.emit();
    }
  }

  /** Freehand: the trace ended. Closes the outline, or rejects a stroke too small to be one. */
  endStroke(tolerance: number): boolean {
    const d = this._draft;
    if (!d?.stroke) return false;
    const poly = closeStroke(d.stroke, tolerance, this.width, this.height);
    this._draft = { ...d, stroke: null, points: poly ?? [] };
    if (poly) return this.finishShape();
    this.emit();
    return false;
  }

  /** Freehand: drop the trace in progress (e.g. a second finger landed). */
  cancelStroke(): void {
    if (!this._draft?.stroke) return;
    this._draft = { ...this._draft, stroke: null };
    this.emit();
  }

  // ------------------------------------------------------------ selecting and editing

  select(id: number | null, notify = true): void {
    if (id !== this._selectedId) this._selectedVertex = null;
    this._selectedId = id;
    if (notify) this.emit();
  }

  /** Select the cell under `p` (or nothing). */
  selectAt(p: Point): number | null {
    const id = this.cellAt(p);
    this.select(id);
    return id;
  }

  /** Deselect the selected point; false if none was selected. */
  clearPointSelection(): boolean {
    if (!this._selectedVertex) return false;
    this._selectedVertex = null;
    this.emit();
    return true;
  }

  /**
   * Press on the selected cell: grab a point within `tolerance`, or press on an
   * outline to insert a point there and grab it. False if nothing was grabbed.
   */
  grab(p: Point, tolerance: number): boolean {
    const cell = this.selectedCell;
    if (!cell || this._draft) return false;
    const v = hitVertex(cell, p, tolerance);
    if (v) {
      this.grabbed = { id: cell.id, ...v, moved: false };
      this._selectedVertex = v;
      this.emit();
      return true;
    }
    const edge = hitEdge(cell, p, tolerance);
    if (!edge) return false;
    this.history.record(this.snapshot());
    this.updateCell(cell.id, (c) => ({ ...c, [edge.ring]: insertVertex(c[edge.ring], edge.index, edge.point) }));
    this.grabbed = { id: cell.id, ring: edge.ring, index: edge.index + 1, moved: true };
    this._selectedVertex = { ring: edge.ring, index: edge.index + 1 };
    this.contentChanged();
    return true;
  }

  /** Move the grabbed point to `p` (kept inside the image). */
  dragTo(p: Point): void {
    const g = this.grabbed;
    if (!g) return;
    if (!g.moved) {
      // Only now: a click on a point without moving it is not an edit.
      this.history.record(this.snapshot());
      g.moved = true;
    }
    const q = clampToImage(p, this.width, this.height);
    this.updateCell(g.id, (c) => ({ ...c, [g.ring]: moveVertex(c[g.ring], g.index, q) }));
    this.contentChanged();
  }

  /** Let go of the grabbed point. */
  release(): void {
    this.grabbed = null;
  }

  get isDragging(): boolean {
    return this.grabbed !== null;
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
    if (this._selectedId === id) this.select(null, false);
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

  private measured(c: Omit<Cell, 'measurements'> & Partial<Pick<Cell, 'measurements'>>): Cell {
    return {
      id: c.id,
      outer: c.outer,
      inner: c.inner,
      flags: c.flags ?? [],
      note: c.note ?? '',
      draw_mode: c.draw_mode ?? 'points',
      measurements: measureCell(c.outer, c.inner, this._measurement),
    };
  }

  private updateCell(id: number, change: (c: Cell) => Cell): void {
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
