import { describe, expect, it } from 'vitest';
import {
  fitToWindow,
  imageToScreen,
  MAX_SCALE,
  pan,
  pinchViewport,
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

  describe('pinchViewport', () => {
    const start: Viewport = { scale: 2, tx: 10, ty: 20 };

    it('spreading the fingers to twice the distance doubles the scale', () => {
      const v = pinchViewport(start, [100, 100], [200, 100], [50, 100], [250, 100]);
      expect(v.scale).toBeCloseTo(4, 10);
    });

    it('keeps the image point under the midpoint fixed', () => {
      const mid0: [number, number] = [150, 100];
      const before = screenToImage(start, mid0);
      const v = pinchViewport(start, [100, 100], [200, 100], [120, 60], [180, 140]);
      const after = screenToImage(v, [150, 100]);
      expect(after[0]).toBeCloseTo(before[0], 10);
      expect(after[1]).toBeCloseTo(before[1], 10);
    });

    it('moving both fingers together pans without zooming', () => {
      const v = pinchViewport(start, [100, 100], [200, 100], [130, 140], [230, 140]);
      expect(v.scale).toBeCloseTo(2, 10);
      expect(v.tx).toBeCloseTo(40, 10);
      expect(v.ty).toBeCloseTo(60, 10);
    });

    it('clamps the scale', () => {
      const v = pinchViewport(start, [100, 100], [101, 100], [0, 100], [1000, 100]);
      expect(v.scale).toBe(MAX_SCALE);
    });
  });
});
