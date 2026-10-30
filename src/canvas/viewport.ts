// Viewport transform between image pixel space and screen (canvas CSS pixel) space.
//
//   screen = image * scale + (tx, ty)
//
// Every tool works in image coordinates; this file is the only place that knows
// how they map to the screen. Functions are pure and return new viewports.

export type Point = [number, number];

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 64;

export function imageToScreen(v: Viewport, p: Point): Point {
  return [p[0] * v.scale + v.tx, p[1] * v.scale + v.ty];
}

export function screenToImage(v: Viewport, p: Point): Point {
  return [(p[0] - v.tx) / v.scale, (p[1] - v.ty) / v.scale];
}

/** Zoom by `factor`, keeping the image point under `screenPt` fixed on screen. */
export function zoomAt(v: Viewport, screenPt: Point, factor: number): Viewport {
  const scale = clamp(v.scale * factor, MIN_SCALE, MAX_SCALE);
  const [ix, iy] = screenToImage(v, screenPt);
  return { scale, tx: screenPt[0] - ix * scale, ty: screenPt[1] - iy * scale };
}

export function pan(v: Viewport, dx: number, dy: number): Viewport {
  return { scale: v.scale, tx: v.tx + dx, ty: v.ty + dy };
}

/** Fit the whole image inside the view, centered, with `padding` screen px on each side. */
export function fitToWindow(
  imgW: number,
  imgH: number,
  viewW: number,
  viewH: number,
  padding = 20,
): Viewport {
  const availW = Math.max(1, viewW - 2 * padding);
  const availH = Math.max(1, viewH - 2 * padding);
  const scale = clamp(Math.min(availW / imgW, availH / imgH), MIN_SCALE, MAX_SCALE);
  return { scale, tx: (viewW - imgW * scale) / 2, ty: (viewH - imgH * scale) / 2 };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

/**
 * Two-finger pinch. Fingers were at a0/b0 when `start` was current and are now
 * at a1/b1 (screen px). Scales by the change in finger distance and keeps the
 * image point under the starting midpoint under the current midpoint, so one
 * gesture zooms and pans together.
 */
export function pinchViewport(start: Viewport, a0: Point, b0: Point, a1: Point, b1: Point): Viewport {
  const d0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  const scale = clamp(start.scale * (d0 > 0 ? d1 / d0 : 1), MIN_SCALE, MAX_SCALE);
  const [ix, iy] = screenToImage(start, [(a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2]);
  const mx = (a1[0] + b1[0]) / 2;
  const my = (a1[1] + b1[1]) / 2;
  return { scale, tx: mx - ix * scale, ty: my - iy * scale };
}
