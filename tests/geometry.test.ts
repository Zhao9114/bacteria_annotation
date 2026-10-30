import { describe, expect, it } from 'vitest';
import {
  centroid,
  circularity,
  equivDiameter,
  farthestRayHit,
  maxFeret,
  perimeter,
  pointInPolygon,
  polygonArea,
  polygonInsidePolygon,
} from '../src/measure/geometry';
import type { Polygon } from '../src/io/schema';
import { circle } from './fixtures';

const square: Polygon = [[0, 0], [2, 0], [2, 2], [0, 2]];
const lShape: Polygon = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]];
// Box from x=-1..4 with a notch cut down from the top between x=2..3 to y=-0.5.
const notched: Polygon = [[-1, -1], [4, -1], [4, 1], [3, 1], [3, -0.5], [2, -0.5], [2, 1], [-1, 1]];

describe('polygon shape', () => {
  it('area, perimeter and centroid of a square', () => {
    expect(polygonArea(square)).toBe(4);
    expect(polygonArea([...square].reverse())).toBe(4);
    expect(perimeter(square)).toBe(8);
    expect(centroid(square)).toEqual([1, 1]);
  });

  it('area-weighted centroid of an L shape', () => {
    expect(polygonArea(lShape)).toBe(3);
    const [x, y] = centroid(lShape);
    expect(x).toBeCloseTo(5 / 6, 12);
    expect(y).toBeCloseTo(5 / 6, 12);
  });

  it('degenerate polygon falls back to the vertex mean', () => {
    expect(centroid([[0, 0], [1, 1], [2, 2]])).toEqual([1, 1]);
  });

  it('circle-like polygon: equivalent diameter, feret, circularity', () => {
    const c = circle(0, 0, 10, 360);
    const a = polygonArea(c);
    expect(a).toBeCloseTo(Math.PI * 100, 0);
    expect(equivDiameter(a)).toBeCloseTo(20, 1);
    expect(maxFeret(c)).toBeCloseTo(20, 6);
    expect(circularity(a, perimeter(c))).toBeGreaterThan(0.999);
    expect(maxFeret(square)).toBeCloseTo(2 * Math.SQRT2, 12);
    expect(circularity(4, 8)).toBeCloseTo(Math.PI / 4, 12);
  });
});

describe('farthestRayHit', () => {
  it('hits a square from its center', () => {
    expect(farthestRayHit([1, 1], 0, square)).toBeCloseTo(1, 12);
    expect(farthestRayHit([1, 1], Math.PI / 2, square)).toBeCloseTo(1, 12);
    expect(farthestRayHit([1, 1], Math.PI / 4, square)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('uses the farthest crossing on a non-convex polygon', () => {
    // From the origin along +x the ray crosses x=2, x=3 and x=4.
    expect(farthestRayHit([0, 0], 0, notched)).toBeCloseTo(4, 12);
  });

  it('returns null when the ray misses', () => {
    expect(farthestRayHit([5, 1], 0, square)).toBeNull();
  });
});

describe('containment', () => {
  it('pointInPolygon', () => {
    expect(pointInPolygon([1, 1], square)).toBe(true);
    expect(pointInPolygon([3, 1], square)).toBe(false);
    expect(pointInPolygon([2.5, 0.5], notched)).toBe(false); // inside the notch
    expect(pointInPolygon([2.5, -0.8], notched)).toBe(true);
  });

  it('polygonInsidePolygon', () => {
    expect(polygonInsidePolygon(circle(0, 0, 5, 16), circle(0, 0, 10, 16))).toBe(true);
    expect(polygonInsidePolygon(circle(8, 0, 5, 16), circle(0, 0, 10, 16))).toBe(false);
    // All vertices inside, but an edge crosses the notch.
    expect(polygonInsidePolygon([[1.5, 0.5], [3.5, 0.5], [2.5, -0.8]], notched)).toBe(false);
  });
});
