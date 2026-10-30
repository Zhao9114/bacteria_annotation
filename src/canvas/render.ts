// Draws one frame: the image under the viewport transform, then overlays in
// screen space so line widths and labels keep a constant on-screen size.

import type { AppState } from '../state';

export function render(ctx: CanvasRenderingContext2D, state: AppState, cssW: number, cssH: number): void {
  ctx.fillStyle = '#1d1f21';
  ctx.fillRect(0, 0, cssW, cssH);

  const img = state.image;
  if (!img) return;

  const v = state.viewport;
  ctx.save();
  ctx.translate(v.tx, v.ty);
  ctx.scale(v.scale, v.scale);
  // Show crisp pixels when zoomed in far enough to see them.
  ctx.imageSmoothingEnabled = v.scale < 2;
  ctx.drawImage(img.bitmap, 0, 0);
  ctx.restore();
}
