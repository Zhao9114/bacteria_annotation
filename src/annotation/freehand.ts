// Freehand outlines: the user traces with the mouse held down; on release the
// raw stroke is clamped to the image and simplified into an ordinary polygon,
// so freehand cells measure and edit exactly like point-by-point ones.

import type { Point, Polygon } from '../io/schema';
import { polygonArea } from '../measure/geometry';
import { clampToImage, MIN_POLYGON_POINTS } from './draft';

const SMOOTH_RADIUS = 2;

/** Only keep a new sample if it is at least `minDist` from the previous one. */
export function shouldSample(stroke: Point[], p: Point, minDist: number): boolean {
  const last = stroke[stroke.length - 1];
  return !last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= minDist;
}

/**
 * Moving average over `radius` neighbours on each side. Takes out hand jitter
 * so the simplification below can keep few points without losing the shape.
 */
export function smoothStroke(points: Point[], radius: number): Point[] {
  return points.map((_, i) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(points.length - 1, i + radius); j++) {
      sx += points[j][0];
      sy += points[j][1];
      n++;
    }
    return [sx / n, sy / n];
  });
}

/** Ramer–Douglas–Peucker: drop points closer than `tolerance` to the simplified line. */
export function simplifyPath(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distToSegment(points[i], points[a], points[b]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx >= 0 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  // Start and end coincide for a closed stroke: fall back to point distance.
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Turn a finished stroke into a closed polygon, or null if it is too small to
 * be a deliberate outline (e.g. a stray click). `tolerance` is in image px.
 */
export function closeStroke(stroke: Point[], tolerance: number, width: number, height: number): Polygon | null {
  const clamped = stroke.map((p) => clampToImage(p, width, height));
  let poly = simplifyPath(smoothStroke(clamped, SMOOTH_RADIUS), tolerance);
  // The end usually lands near the start; drop it so the closing edge isn't doubled.
  if (poly.length > MIN_POLYGON_POINTS) {
    const [f, l] = [poly[0], poly[poly.length - 1]];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) <= tolerance * 2) poly = poly.slice(0, -1);
  }
  if (poly.length < MIN_POLYGON_POINTS) return null;
  if (polygonArea(poly) < 16 * tolerance * tolerance) return null;
  return poly;
}
