import { describe, expect, it } from 'vitest';
import {
  addPoint,
  canClose,
  clampToImage,
  closePolygon,
  isNearFirstPoint,
  removeLastPoint,
  startDraft,
  type Draft,
} from '../src/tools/draw';

function withPoints(d: Draft, pts: [number, number][]): Draft {
  return pts.reduce(addPoint, d);
}

describe('draw tool', () => {
  it('needs three points to close', () => {
    let d = withPoints(startDraft(), [[0, 0], [10, 0]]);
    expect(canClose(d)).toBe(false);
    expect(closePolygon(d)).toBeNull();
    d = addPoint(d, [10, 10]);
    expect(canClose(d)).toBe(true);
  });

  it('closing the outer ring moves on to the dark center, then finishes the cell', () => {
    const outer: [number, number][] = [[0, 0], [30, 0], [30, 30], [0, 30]];
    const inner: [number, number][] = [[10, 10], [20, 10], [15, 20]];
    const first = closePolygon(withPoints(startDraft(), outer));
    expect(first?.kind).toBe('next');
    if (first?.kind !== 'next') return;
    expect(first.draft).toEqual({ phase: 'inner', outer, points: [] });

    const second = closePolygon(withPoints(first.draft, inner));
    expect(second).toEqual({ kind: 'done', outer, inner });
  });

  it('removeLastPoint undoes one click', () => {
    const d = withPoints(startDraft(), [[0, 0], [5, 5]]);
    expect(removeLastPoint(d).points).toEqual([[0, 0]]);
    expect(removeLastPoint(startDraft()).points).toEqual([]);
  });

  it('detects a click near the first point only when closable', () => {
    const two = withPoints(startDraft(), [[0, 0], [10, 0]]);
    expect(isNearFirstPoint(two, [1, 1], 3)).toBe(false);
    const three = addPoint(two, [10, 10]);
    expect(isNearFirstPoint(three, [1, 1], 3)).toBe(true);
    expect(isNearFirstPoint(three, [5, 5], 3)).toBe(false);
  });

  it('clamps points into the image', () => {
    expect(clampToImage([-4, 50], 100, 40)).toEqual([0, 40]);
    expect(clampToImage([12.5, 7], 100, 40)).toEqual([12.5, 7]);
  });
});
