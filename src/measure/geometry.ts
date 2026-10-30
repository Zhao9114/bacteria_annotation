// Polygon geometry. Polygons are closed implicitly (last vertex joins the first)
// and may be in either winding order.

import type { Point, Polygon } from '../io/schema';

const EPS = 1e-9;

/** Shoelace area, positive for counter-clockwise in a y-up frame. */
export function signedArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

export function polygonArea(poly: Polygon): number {
  return Math.abs(signedArea(poly));
}

/** Area-weighted centroid. Falls back to the vertex mean for zero-area polygons. */
export function centroid(poly: Polygon): Point {
  const a = signedArea(poly);
  if (Math.abs(a) < EPS) {
    let sx = 0;
    let sy = 0;
    for (const [x, y] of poly) {
      sx += x;
      sy += y;
    }
    return [sx / poly.length, sy / poly.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

export function perimeter(poly: Polygon): number {
  let p = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [x0, y0] = poly[i];
    const [x1, y1] = poly[(i + 1) % n];
    p += Math.hypot(x1 - x0, y1 - y0);
  }
  return p;
}

/** Diameter of the circle with the same area. */
export function equivDiameter(area: number): number {
  return 2 * Math.sqrt(area / Math.PI);
}

/** Longest distance between any two vertices. */
export function maxFeret(poly: Polygon): number {
  let best = 0;
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      best = Math.max(best, Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]));
    }
  }
  return best;
}

/** 4*pi*area / perimeter^2: 1 for a circle, smaller for anything else. */
export function circularity(area: number, perim: number): number {
  return perim > 0 ? (4 * Math.PI * area) / (perim * perim) : 0;
}

/**
 * Distance from `origin` along the ray at `angle` (radians, image axes: 0 = +x,
 * pi/2 = +y i.e. down on screen) to the polygon outline, or null if it misses.
 *
 * A non-convex outline can be crossed several times; we take the FARTHEST
 * crossing so a small inward dent never cuts the measurement short.
 */
export function farthestRayHit(origin: Point, angle: number, poly: Polygon): number | null {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best: number | null = null;
  for (let i = 0, n = poly.length; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    const ex = bx - ax;
    const ey = by - ay;
    const denom = dx * ey - dy * ex; // cross(d, e)
    if (Math.abs(denom) < EPS) continue; // parallel
    const wx = ax - origin[0];
    const wy = ay - origin[1];
    const t = (wx * ey - wy * ex) / denom; // cross(w, e) / cross(d, e)
    const u = (wx * dy - wy * dx) / denom; // cross(w, d) / cross(d, e)
    if (t < -EPS || u < -EPS || u > 1 + EPS) continue;
    if (best === null || t > best) best = Math.max(0, t);
  }
  return best;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Point, poly: Polygon): boolean {
  const [px, py] = p;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True if every vertex of `inner` is inside `outer` and no edges cross. */
export function polygonInsidePolygon(inner: Polygon, outer: Polygon): boolean {
  if (!inner.every((p) => pointInPolygon(p, outer))) return false;
  for (let i = 0; i < inner.length; i++) {
    const a = inner[i];
    const b = inner[(i + 1) % inner.length];
    for (let j = 0; j < outer.length; j++) {
      if (segmentsCross(a, b, outer[j], outer[(j + 1) % outer.length])) return false;
    }
  }
  return true;
}

function orient(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Proper crossing: the segments intersect at a single interior point. */
function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export interface ShapeStats {
  area: number;
  perimeter: number;
  equiv_diameter: number;
  max_feret: number;
  circularity: number;
  centroid: Point;
}

export function shapeStats(poly: Polygon): ShapeStats {
  const area = polygonArea(poly);
  const perim = perimeter(poly);
  return {
    area,
    perimeter: perim,
    equiv_diameter: equivDiameter(area),
    max_feret: maxFeret(poly),
    circularity: circularity(area, perim),
    centroid: centroid(poly),
  };
}
