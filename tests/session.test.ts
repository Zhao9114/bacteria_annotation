import { describe, expect, it, vi } from 'vitest';
import { AnnotationSession } from '../src/annotation/session';
import type { Point } from '../src/io/schema';
import { circle } from './fixtures';

const W = 640;
const H = 400;
const CLOSE = 3; // image px
const DUP = 0.5;

function session(drawMode: 'points' | 'freehand' = 'points') {
  return new AnnotationSession({ width: W, height: H, drawMode });
}

/** Click around both outlines of a cell, closing each by clicking its first point. */
function drawCell(s: AnnotationSession, cx: number, cy: number, r = 20): void {
  s.startCell();
  for (const ring of [circle(cx, cy, r, 12), circle(cx, cy, r * 0.4, 8)]) {
    for (const p of ring) s.placePoint(p, CLOSE, DUP);
    expect(s.placePoint(ring[0], CLOSE, DUP)).toBe('closed');
  }
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
    s.placePoint([10, 10], CLOSE, DUP);
    expect(s.placePoint([10.2, 10.1], CLOSE, DUP)).toBe('ignored');
    expect(s.draft!.points).toHaveLength(1);
  });

  it('refuses to close an outline with fewer than three points', () => {
    const s = session();
    s.startCell();
    s.placePoint([10, 10], CLOSE, DUP);
    s.placePoint([30, 10], CLOSE, DUP);
    expect(s.finishShape()).toBe(false);
    expect(s.draft!.phase).toBe('outer');
  });

  it('clamps points to the image', () => {
    const s = session();
    s.startCell();
    s.placePoint([-50, 900], CLOSE, DUP);
    expect(s.draft!.points[0]).toEqual([0, H]);
  });

  it('undo while drawing removes the last point; cancel drops the cell', () => {
    const s = session();
    s.startCell();
    s.placePoint([10, 10], CLOSE, DUP);
    s.placePoint([30, 10], CLOSE, DUP);
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
    s.beginStroke([200, 200]);
    s.extendStroke([200.2, 200.1], 1);
    expect(s.endStroke(1)).toBe(false); // a stray click
    expect(s.draft!.phase).toBe('outer');
    for (const ring of [circle(200, 200, 30, 120), circle(200, 200, 10, 60)]) {
      s.beginStroke(ring[0]);
      for (const p of ring.slice(1)) s.extendStroke(p, 1);
      s.extendStroke(ring[0], 1);
      expect(s.endStroke(1)).toBe(true);
    }
    expect(s.cells).toHaveLength(1);
    expect(s.cells[0].draw_mode).toBe('freehand');
  });

  it('a cancelled stroke (second finger landed) keeps the cell in progress', () => {
    const s = session('freehand');
    s.startCell();
    s.beginStroke([10, 10]);
    s.extendStroke([40, 40], 1);
    s.cancelStroke();
    expect(s.draft).toMatchObject({ phase: 'outer', stroke: null, points: [] });
  });
});

describe('editing', () => {
  it('a click on a point without moving it is not an undo step', () => {
    const s = session();
    drawCell(s, 100, 100);
    const undoable = s.canUndo; // the cell itself
    const p = s.cells[0].outer[3];
    expect(s.grab(p, 2)).toBe(true);
    s.release();
    expect(s.selectedVertex).toEqual({ ring: 'outer', index: 3 });
    // Undo removes the cell, not a phantom point move.
    expect(undoable).toBe(true);
    s.undo();
    expect(s.cells).toHaveLength(0);
  });

  it('dragging a point moves it, re-measures, and undoes in one step', () => {
    const s = session();
    drawCell(s, 100, 100);
    const before = s.cells[0].outer[0];
    const gapBefore = s.cells[0].measurements.gap_median;
    s.grab(before, 2);
    s.dragTo([before[0] + 5, before[1]]);
    s.dragTo([before[0] + 10, before[1]]);
    s.release();
    expect(s.cells[0].outer[0]).toEqual([before[0] + 10, before[1]]);
    expect(s.cells[0].measurements.gap_max).not.toBe(gapBefore);
    s.undo();
    expect(s.cells[0].outer[0]).toEqual(before);
  });

  it('dragging keeps the point inside the image', () => {
    const s = session();
    drawCell(s, 30, 30);
    s.grab(s.cells[0].outer[6], 2);
    s.dragTo([-100, -100]);
    expect(s.cells[0].outer[6]).toEqual([0, 0]);
  });

  it('pressing on an outline inserts a point there, undone in one step', () => {
    const s = session();
    drawCell(s, 100, 100);
    const [a, b] = s.cells[0].outer;
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    expect(s.grab(mid, 2)).toBe(true);
    expect(s.cells[0].outer).toHaveLength(13);
    expect(s.selectedVertex).toEqual({ ring: 'outer', index: 1 });
    s.release();
    s.undo();
    expect(s.cells[0].outer).toHaveLength(12);
  });

  it('deleting points stops at three', () => {
    const s = session();
    s.startCell();
    for (const p of [[0, 0], [50, 0], [50, 50]] as Point[]) s.placePoint(p, CLOSE, DUP);
    s.finishShape();
    for (const p of [[20, 20], [30, 20], [25, 30]] as Point[]) s.placePoint(p, CLOSE, DUP);
    s.finishShape();
    s.grab([0, 0], 2);
    s.release();
    expect(s.deletePoint()).toBe('too_few');
    expect(s.cells[0].outer).toHaveLength(3);
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

  it('selectAt picks the smallest of overlapping cells', () => {
    const s = session();
    drawCell(s, 100, 100, 60);
    drawCell(s, 110, 100, 15);
    expect(s.selectAt([110, 100])).toBe(2);
    expect(s.selectAt([60, 100])).toBe(1);
    expect(s.selectAt([600, 380])).toBeNull();
  });

  it('nothing to grab while a cell is being drawn', () => {
    const s = session();
    drawCell(s, 100, 100);
    s.startCell();
    expect(s.hoverTarget(s.cells[0].outer[0], 2)).toBeNull();
    expect(s.grab(s.cells[0].outer[0], 2)).toBe(false);
  });
});

describe('settings, status and change signal', () => {
  it('changing the number of rays re-measures every cell', () => {
    const s = session();
    drawCell(s, 100, 100);
    s.setMeasurement({ num_rays: 8 });
    expect(s.cells[0].measurements.num_rays).toBe(8);
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
