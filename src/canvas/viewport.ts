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
