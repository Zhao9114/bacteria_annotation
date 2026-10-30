// The cell being drawn: the outer ring first, then the dark center, each
// closed once it has enough points. Pure functions over a small draft object.

import type { Point, Polygon } from '../io/schema';

export const MIN_POLYGON_POINTS = 3;

export type DrawPhase = 'outer' | 'inner';

export interface Draft {
  phase: DrawPhase;
  /** Finished outer polygon, set once the first phase closes. */
  outer: Polygon | null;
  /** Points of the polygon currently being drawn. */
  points: Point[];
  /** Freehand only: raw samples of the stroke in progress (mouse held down). */
  stroke: Point[] | null;
}

export type CloseResult =
  | { kind: 'next'; draft: Draft }
  | { kind: 'done'; outer: Polygon; inner: Polygon };

export function startDraft(): Draft {
  return { phase: 'outer', outer: null, points: [], stroke: null };
}

export function addPoint(d: Draft, p: Point): Draft {
  return { ...d, points: [...d.points, p] };
}

export function removeLastPoint(d: Draft): Draft {
  return { ...d, points: d.points.slice(0, -1) };
}

export function canClose(d: Draft): boolean {
  return d.points.length >= MIN_POLYGON_POINTS;
}

/** Close the current polygon. Returns null if it has too few points. */
export function closePolygon(d: Draft): CloseResult | null {
  if (!canClose(d)) return null;
  if (d.phase === 'outer') {
    return { kind: 'next', draft: { ...d, phase: 'inner', outer: d.points, points: [], stroke: null } };
  }
  return { kind: 'done', outer: d.outer!, inner: d.points };
}

/** True if `p` is within `tolerance` of the first point and the polygon can close. */
export function isNearFirstPoint(d: Draft, p: Point, tolerance: number): boolean {
  if (!canClose(d)) return false;
  const [fx, fy] = d.points[0];
  return Math.hypot(p[0] - fx, p[1] - fy) <= tolerance;
}

/** Clamp a point into the image so polygons never leave it. */
export function clampToImage(p: Point, width: number, height: number): Point {
  return [Math.min(width, Math.max(0, p[0])), Math.min(height, Math.max(0, p[1]))];
}
