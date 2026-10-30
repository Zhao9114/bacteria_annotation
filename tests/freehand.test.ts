import { describe, expect, it } from 'vitest';
import type { Point } from '../src/io/schema';
import { polygonArea } from '../src/measure/geometry';
import { closeStroke, shouldSample, simplifyPath } from '../src/annotation/freehand';

/** A traced circle with deterministic wobble, ending back at its start. */
function wobblyCircle(cx: number, cy: number, r: number, n: number): Point[] {
  const pts: Point[] = [];
  for (let k = 0; k <= n; k++) {
    const t = (2 * Math.PI * k) / n;
    const rr = r + 0.3 * Math.sin(k * 7.3);
    pts.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
  }
  return pts;
}

describe('freehand', () => {
  it('simplifyPath collapses a nearly straight line to its ends', () => {
    const line: Point[] = [[0, 0], [1, 0.1], [2, -0.1], [3, 0.05], [4, 0]];
    expect(simplifyPath(line, 0.5)).toEqual([[0, 0], [4, 0]]);
  });

  it('simplifyPath keeps a corner', () => {
    const corner: Point[] = [[0, 0], [5, 0], [10, 0], [10, 5], [10, 10]];
    expect(simplifyPath(corner, 0.5)).toEqual([[0, 0], [10, 0], [10, 10]]);
  });

  it('a traced circle becomes a much smaller polygon with the same shape', () => {
    const stroke = wobblyCircle(100, 100, 50, 400);
    const poly = closeStroke(stroke, 1, 1000, 1000)!;
    expect(poly.length).toBeGreaterThan(8);
    expect(poly.length).toBeLessThan(80);
    expect(polygonArea(poly) / (Math.PI * 2500)).toBeGreaterThan(0.97);
  });

  it('a shaky trace still simplifies to a manageable number of points', () => {
    // Jitter of about 1.5 px around a radius-60 circle, like an unsteady hand.
    const shaky = wobblyCircle(100, 100, 60, 300).map(([x, y], i): Point => [x + 1.5 * Math.sin(i * 1.7), y + 1.5 * Math.cos(i * 2.3)]);
    const poly = closeStroke(shaky, 2, 1000, 1000)!;
    expect(poly.length).toBeLessThan(40);
    expect(polygonArea(poly) / (Math.PI * 3600)).toBeGreaterThan(0.95);
  });

  it('rejects strokes that are too small to be an outline', () => {
    expect(closeStroke([[10, 10]], 1, 100, 100)).toBeNull();
    expect(closeStroke([[10, 10], [11, 10], [10.5, 10.4]], 1, 100, 100)).toBeNull();
  });

  it('clamps strokes to the image', () => {
    const poly = closeStroke(wobblyCircle(5, 5, 20, 200), 0.5, 30, 30)!;
    for (const [x, y] of poly) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(30);
      expect(y).toBeLessThanOrEqual(30);
    }
  });

  it('shouldSample spaces samples out', () => {
    expect(shouldSample([], [0, 0], 2)).toBe(true);
    expect(shouldSample([[0, 0]], [1, 1], 2)).toBe(false);
    expect(shouldSample([[0, 0]], [2, 0], 2)).toBe(true);
  });
});
