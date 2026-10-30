import type { Polygon } from '../src/io/schema';

/** Regular n-gon approximating a circle; vertex 0 is at angle 0 (pointing +x). */
export function circle(cx: number, cy: number, r: number, n: number): Polygon {
  const pts: Polygon = [];
  for (let k = 0; k < n; k++) {
    const t = (2 * Math.PI * k) / n;
    pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
  }
  return pts;
}
