import { describe, expect, it } from 'vitest';
import {
  fitToWindow,
  imageToScreen,
  MAX_SCALE,
  pan,
  screenToImage,
  zoomAt,
  type Viewport,
} from '../src/canvas/viewport';

describe('viewport', () => {
  const v: Viewport = { scale: 2.5, tx: -40, ty: 13 };

  it('round-trips image -> screen -> image', () => {
    const p: [number, number] = [123.4, 56.7];
    const back = screenToImage(v, imageToScreen(v, p));
    expect(back[0]).toBeCloseTo(p[0], 10);
    expect(back[1]).toBeCloseTo(p[1], 10);
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const cursor: [number, number] = [300, 200];
    const before = screenToImage(v, cursor);
    const z = zoomAt(v, cursor, 1.7);
    expect(z.scale).toBeCloseTo(2.5 * 1.7, 10);
    const after = screenToImage(z, cursor);
    expect(after[0]).toBeCloseTo(before[0], 10);
    expect(after[1]).toBeCloseTo(before[1], 10);
  });

  it('zoomAt clamps the scale', () => {
    const z = zoomAt(v, [0, 0], 1e6);
    expect(z.scale).toBe(MAX_SCALE);
  });

  it('pan shifts the translation only', () => {
    expect(pan(v, 10, -5)).toEqual({ scale: 2.5, tx: -30, ty: 8 });
  });

  it('fitToWindow fits and centers a wide image', () => {
    const f = fitToWindow(2000, 1000, 1040, 1040, 20);
    expect(f.scale).toBeCloseTo(0.5, 10);
    // image spans 1000x500 on screen, centered in 1040x1040
    expect(imageToScreen(f, [0, 0])).toEqual([20, 270]);
    expect(imageToScreen(f, [2000, 1000])).toEqual([1020, 770]);
  });
});
