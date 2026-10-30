import { describe, expect, it } from 'vitest';
import type { Polygon } from '../src/io/schema';
import { deleteVertex, hitEdge, hitVertex, insertVertex, moveVertex } from '../src/tools/edit';

const outer: Polygon = [[0, 0], [100, 0], [100, 100], [0, 100]];
const inner: Polygon = [[40, 40], [60, 40], [60, 60], [40, 60]];
const cell = { outer, inner };

describe('hit testing', () => {
  it('finds the nearest vertex within tolerance', () => {
    expect(hitVertex(cell, [98, 3], 5)).toEqual({ ring: 'outer', index: 1 });
    expect(hitVertex(cell, [59, 59], 5)).toEqual({ ring: 'inner', index: 2 });
    expect(hitVertex(cell, [50, 20], 5)).toBeNull();
  });

  it('prefers the inner ring when both are in range', () => {
    const tight = { outer: [[0, 0], [10, 0], [10, 10]] as Polygon, inner: [[1, 1], [5, 1], [5, 5]] as Polygon };
    expect(hitVertex(tight, [0.6, 0.6], 2)?.ring).toBe('inner');
  });

  it('finds an edge and the point on it', () => {
    const h = hitEdge(cell, [50, 2], 5);
    expect(h).toEqual({ ring: 'outer', index: 0, point: [50, 0] });
    // Closing edge, from the last vertex back to the first.
    expect(hitEdge(cell, [1, 50], 5)).toEqual({ ring: 'outer', index: 3, point: [0, 50] });
    expect(hitEdge(cell, [50, 30], 5)).toBeNull();
  });
});

describe('vertex edits', () => {
  it('moves without touching the original', () => {
    const moved = moveVertex(outer, 2, [120, 110]);
    expect(moved[2]).toEqual([120, 110]);
    expect(outer[2]).toEqual([100, 100]);
  });

  it('inserts after the given index', () => {
    expect(insertVertex(outer, 0, [50, 0])).toEqual([[0, 0], [50, 0], [100, 0], [100, 100], [0, 100]]);
    expect(insertVertex(outer, 3, [0, 50])).toEqual([[0, 0], [100, 0], [100, 100], [0, 100], [0, 50]]);
  });

  it('deletes but never below three points', () => {
    expect(deleteVertex(outer, 1)).toEqual([[0, 0], [100, 100], [0, 100]]);
    expect(deleteVertex([[0, 0], [1, 0], [0, 1]], 0)).toBeNull();
  });
});
