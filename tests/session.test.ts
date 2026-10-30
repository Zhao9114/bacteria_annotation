import { describe, expect, it, vi } from 'vitest';
import { AnnotationSession, type Tolerances } from '../src/annotation/session';
import type { Point } from '../src/io/schema';
import { circle } from './fixtures';

const W = 640;
const H = 400;
/** Image-pixel tolerances, as the screen would pass them at some zoom. */
const T: Tolerances = { handle: 2, close: 3, duplicate: 0.5, sample: 1, simplify: 1 };

function session(drawMode: 'points' | 'freehand' = 'points') {
  return new AnnotationSession({ width: W, height: H, drawMode });
}

/** Tap around both outlines of a cell, closing each by tapping its first point. */
function drawCell(s: AnnotationSession, cx: number, cy: number, r = 20): void {
  s.startCell();
  for (const ring of [circle(cx, cy, r, 12), circle(cx, cy, r * 0.4, 8)]) {
    for (const p of [...ring, ring[0]]) s.tap(p, 1, T);
  }
}

/** Press, drag through `path`, release. */
function trace(s: AnnotationSession, path: Point[]): boolean {
  if (!s.press(path[0], T)) return false;
  for (const p of path.slice(1)) s.drag(p, T);
  return s.release(T);
}

describe('drawing a cell', () => {
  it('outer ring then dark center makes one measured cell and starts the image', () => {
    const s = session();
    expect(s.status).toBe('not_started');
    drawCell(s, 100, 100);
    expect(s.cells).toHaveLength(1);
    expect(s.cells[0].measurements.gap_median).toBeGreaterThan(0);
    expect(s.cells[0].draw_mode).toBe('points');
    expect(s.draft).toBeNull();
    expect(s.selectedId).toBe(1);
    expect(s.status).toBe('in_progress');
  });

  it('ignores the second click of a double-click', () => {
    const s = session();
    s.startCell();
    s.tap([10, 10], 1, T);
    s.tap([10.2, 10.1], 1, T);
    expect(s.draft!.points).toHaveLength(1);
  });

  it('a double-tap closes the outline; with too few points it is refused', () => {
    const s = session();
    s.startCell();
    s.tap([10, 10], 1, T);
    s.tap([30, 10], 1, T);
    expect(s.tap([30, 10], 2, T)).toBe(false);
    expect(s.draft!.phase).toBe('outer');
    s.tap([30, 30], 1, T);
    expect(s.tap([30, 30], 2, T)).toBe(true);
    expect(s.draft!.phase).toBe('inner');
    expect(s.draft!.outer).toHaveLength(3);
  });

  it('refuses to finish an outline with fewer than three points', () => {
    const s = session();
    s.startCell();
    s.tap([10, 10], 1, T);
    s.tap([30, 10], 1, T);
    expect(s.finishShape()).toBe(false);
    expect(s.draft!.phase).toBe('outer');
  });

  it('clamps points to the image', () => {
    const s = session();
    s.startCell();
    s.tap([-50, 900], 1, T);
    expect(s.draft!.points[0]).toEqual([0, H]);
  });

  it('presses pan rather than draw in points mode', () => {
    const s = session();
    s.startCell();
    expect(s.press([10, 10], T)).toBe(false);
  });

  it('undo while drawing removes the last point; cancel drops the cell', () => {
    const s = session();
    s.startCell();
    s.tap([10, 10], 1, T);
    s.tap([30, 10], 1, T);
    expect(s.canUndo).toBe(true);
    s.undo();
    expect(s.draft!.points).toEqual([[10, 10]]);
    s.cancelCell();
    expect(s.draft).toBeNull();
    expect(s.cells).toHaveLength(0);
  });

  it('freehand: a traced loop becomes a cell; a tiny stroke is rejected', () => {
    const s = session('freehand');
    s.startCell();
    expect(trace(s, [[200, 200], [200.2, 200.1]])).toBe(false); // a stray click
    expect(s.draft!.phase).toBe('outer');
    for (const ring of [circle(200, 200, 30, 120), circle(200, 200, 10, 60)]) {
      expect(trace(s, [...ring, ring[0]])).toBe(true);
    }
    expect(s.cells).toHaveLength(1);
    expect(s.cells[0].draw_mode).toBe('freehand');
  });

  it('freehand: taps do nothing while drawing', () => {
    const s = session('freehand');
    s.startCell();
    s.tap([10, 10], 1, T);
    expect(s.draft).toMatchObject({ phase: 'outer', points: [], stroke: null });
  });

  it('a cancelled stroke (second finger landed) keeps the cell in progress', () => {
    const s = session('freehand');
    s.startCell();
    s.press([10, 10], T);
    s.drag([40, 40], T);
    s.cancelPress();
    expect(s.draft).toMatchObject({ phase: 'outer', stroke: null, points: [] });
  });

  it('switching draw mode mid-cell restarts the current outline', () => {
    const s = session();
    s.startCell();
    s.tap([10, 10], 1, T);
    s.setDrawMode('freehand');
    expect(s.draft!.points).toEqual([]);
    expect(s.press([10, 10], T)).toBe(true);
  });
});

describe('editing', () => {
  it('a tap selects the smallest of overlapping cells, or nothing', () => {
    const s = session();
    drawCell(s, 100, 100, 60);
    drawCell(s, 110, 100, 15);
    s.tap([110, 100], 1, T);
    expect(s.selectedId).toBe(2);
    s.tap([60, 100], 1, T);
    expect(s.selectedId).toBe(1);
    s.tap([600, 380], 1, T);
    expect(s.selectedId).toBeNull();
  });

  it('a click on a point without moving it is not an undo step', () => {
    const s = session();
    drawCell(s, 100, 100);
    const p = s.cells[0].outer[3];
    expect(s.press(p, T)).toBe(true);
    s.release(T);
    expect(s.selectedVertex).toEqual({ ring: 'outer', index: 3 });
    // Undo removes the cell, not a phantom point move.
    s.undo();
    expect(s.cells).toHaveLength(0);
  });

  it('dragging a point moves it, re-measures, and undoes in one step', () => {
    const s = session();
    drawCell(s, 100, 100);
    const before = s.cells[0].outer[0];
    const hitBefore = s.cells[0].measurements.outer_hits[0];
    expect(s.isDragging).toBe(false);
    s.press(before, T);
    expect(s.isDragging).toBe(true);
    s.drag([before[0] + 5, before[1]], T);
    s.drag([before[0] + 10, before[1]], T);
    s.release(T);
    expect(s.isDragging).toBe(false);
    expect(s.cells[0].outer[0]).toEqual([before[0] + 10, before[1]]);
    expect(s.cells[0].measurements.outer_hits[0]).toBeGreaterThan(hitBefore! + 9);
    s.undo();
    expect(s.cells[0].outer[0]).toEqual(before);
  });

  it('dragging keeps the point inside the image', () => {
    const s = session();
    drawCell(s, 30, 30);
    s.press(s.cells[0].outer[6], T);
    s.drag([-100, -100], T);
    expect(s.cells[0].outer[6]).toEqual([0, 0]);
  });

  it('pressing on an outline inserts a point there, undone in one step', () => {
    const s = session();
    drawCell(s, 100, 100);
    const [a, b] = s.cells[0].outer;
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    expect(s.press(mid, T)).toBe(true);
    expect(s.cells[0].outer).toHaveLength(13);
    expect(s.selectedVertex).toEqual({ ring: 'outer', index: 1 });
    s.release(T);
    s.undo();
    expect(s.cells[0].outer).toHaveLength(12);
  });

  it('pressing away from the selected cell takes nothing (the screen pans)', () => {
    const s = session();
    drawCell(s, 100, 100);
    expect(s.press([400, 300], T)).toBe(false);
    expect(s.isDragging).toBe(false);
  });

  it('deleting points stops at three', () => {
    const s = session();
    s.startCell();
    for (const p of [[0, 0], [50, 0], [50, 50]] as Point[]) s.tap(p, 1, T);
    s.finishShape();
    for (const p of [[20, 20], [30, 20], [25, 30]] as Point[]) s.tap(p, 1, T);
    s.finishShape();
    s.press([0, 0], T);
    s.release(T);
    expect(s.deletePoint()).toBe('too_few');
    expect(s.cells[0].outer).toHaveLength(3);
  });

  it('deselect steps back: the point first, then the cell', () => {
    const s = session();
    drawCell(s, 100, 100);
    s.press(s.cells[0].outer[0], T);
    s.release(T);
    s.deselect();
    expect(s.selectedVertex).toBeNull();
    expect(s.selectedId).toBe(1);
    s.deselect();
    expect(s.selectedId).toBeNull();
  });

  it('deleting a cell can be undone and redone', () => {
    const s = session();
    drawCell(s, 100, 100);
    drawCell(s, 300, 200);
    s.deleteCell(1);
    expect(s.cells.map((c) => c.id)).toEqual([2]);
    s.undo();
    expect(s.cells.map((c) => c.id)).toEqual([1, 2]);
    s.redo();
    expect(s.cells.map((c) => c.id)).toEqual([2]);
  });

  it('nothing to grab while a cell is being drawn', () => {
    const s = session();
    drawCell(s, 100, 100);
    s.startCell();
    expect(s.hoverTarget(s.cells[0].outer[0], 2)).toBeNull();
    expect(s.press(s.cells[0].outer[0], T)).toBe(false);
  });
});

describe('settings, status and change signal', () => {
  it('changing the number of rays re-measures every cell', () => {
    const s = session();
    drawCell(s, 100, 100);
    s.setMeasurement({ num_rays: 8 });
    expect(s.cells[0].measurements.num_rays).toBe(8);
  });

  it('undo after a settings change keeps the new settings', () => {
    const s = session();
    drawCell(s, 100, 100);
    drawCell(s, 300, 200);
    s.setMeasurement({ num_rays: 8 });
    s.undo(); // removes cell 2
    expect(s.cells.map((c) => c.measurements.num_rays)).toEqual([8]);
  });

  it('revision moves on content changes only; listeners hear everything', () => {
    const s = session();
    const heard = vi.fn();
    const off = s.subscribe(heard);
    s.startCell();
    expect(s.revision).toBe(0); // drawing hasn't changed saved content yet
    expect(heard).toHaveBeenCalled();
    s.cancelCell();
    drawCell(s, 100, 100);
    const r = s.revision;
    s.setStatus('done');
    expect(s.revision).toBe(r + 1);
    off();
    heard.mockClear();
    s.setStatus('in_progress');
    expect(heard).not.toHaveBeenCalled();
  });

  it('continues a saved annotation and re-measures it', () => {
    const s1 = session();
    drawCell(s1, 100, 100);
    const s2 = new AnnotationSession({ width: W, height: H, content: s1.toContent() });
    expect(s2.cells[0].measurements).toEqual(s1.cells[0].measurements);
    drawCell(s2, 300, 200);
    expect(s2.cells.map((c) => c.id)).toEqual([1, 2]);
  });
});
