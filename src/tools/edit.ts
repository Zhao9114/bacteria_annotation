// Editing an existing cell: hit testing its outlines and pure vertex edits.
// Tolerances are in image pixels (callers convert from screen pixels).

import type { Point, Polygon } from '../io/schema';
import { MIN_POLYGON_POINTS } from './draw';

export type Ring = 'outer' | 'inner';

export interface VertexRef {
  ring: Ring;
  index: number;
}

export interface EdgeHit {
  ring: Ring;
  /** The edge runs from vertex `index` to `index + 1` (wrapping). */
  index: number;
  /** Closest point on that edge. */
  point: Point;
}

type CellShape = { outer: Polygon; inner: Polygon };

// The dark center sits inside the outer ring, so check it first: otherwise its
// small handles would be unreachable when they are near the outer ones.
const RINGS: Ring[] = ['inner', 'outer'];

export function hitVertex(cell: CellShape, p: Point, tolerance: number): VertexRef | null {
  for (const ring of RINGS) {
    let best: VertexRef | null = null;
    let bestD = tolerance;
    cell[ring].forEach(([x, y], index) => {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d <= bestD) {
        bestD = d;
        best = { ring, index };
      }
    });
    if (best) return best;
  }
  return null;
}

export function hitEdge(cell: CellShape, p: Point, tolerance: number): EdgeHit | null {
  for (const ring of RINGS) {
    const poly = cell[ring];
    let best: EdgeHit | null = null;
    let bestD = tolerance;
    for (let i = 0; i < poly.length; i++) {
      const q = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
      const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
      if (d <= bestD) {
        bestD = d;
        best = { ring, index: i, point: q };
      }
    }
    if (best) return best;
  }
  return null;
}

function closestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return [a[0] + t * dx, a[1] + t * dy];
}

export function moveVertex(poly: Polygon, index: number, p: Point): Polygon {
  return poly.map((v, i) => (i === index ? p : v));
}

/** Insert `p` after vertex `afterIndex`, i.e. on the edge afterIndex -> afterIndex + 1. */
export function insertVertex(poly: Polygon, afterIndex: number, p: Point): Polygon {
  return [...poly.slice(0, afterIndex + 1), p, ...poly.slice(afterIndex + 1)];
}

/** Remove a vertex; null if that would leave fewer than three points. */
export function deleteVertex(poly: Polygon, index: number): Polygon | null {
  if (poly.length <= MIN_POLYGON_POINTS) return null;
  return poly.filter((_, i) => i !== index);
}
