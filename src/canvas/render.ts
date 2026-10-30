// Draws one frame: the image under the viewport transform, then overlays in
// screen space so line widths and labels keep a constant on-screen size.

import type { Cell, Point } from '../io/schema';
import type { CellMeasurements } from '../measure/measure';
import type { AppState } from '../state';
import { imageToScreen, type Viewport } from './viewport';

/** Colourblind-safe pair that reads on green and grey backgrounds. */
export const OUTER_COLOR = '#ff3fd0';
export const INNER_COLOR = '#ffd400';
const UNDERLAY = 'rgba(0, 0, 0, 0.8)';
const BAND_FILL = 'rgba(0, 190, 255, 0.28)';
const SELECTED_GLOW = 'rgba(255, 255, 255, 0.95)';
export const RAY_KEPT_COLOR = '#00e5ff';
export const RAY_REJECTED_COLOR = '#ff5a36';

/** Screen distance (px) within which a click on the first point closes the shape. */
export const CLOSE_RADIUS_PX = 10;

export function render(ctx: CanvasRenderingContext2D, state: AppState, cssW: number, cssH: number): void {
  ctx.clearRect(0, 0, cssW, cssH); // the stage's CSS background shows through

  const img = state.image;
  if (!img) return;

  const v = state.viewport;
  ctx.save();
  ctx.translate(v.tx, v.ty);
  ctx.scale(v.scale, v.scale);
  // Show crisp pixels when zoomed in far enough to see them.
  ctx.imageSmoothingEnabled = v.scale < 2;
  ctx.drawImage(img.display, 0, 0);
  ctx.restore();

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const cell of state.cells) {
    drawCell(ctx, v, cell, cell.id === state.selectedId, state.showBand);
  }
  const selected = state.cells.find((c) => c.id === state.selectedId);
  if (selected && state.showRays) drawRays(ctx, v, selected.measurements);
  if (selected) drawHandles(ctx, v, selected, state);
  drawDraft(ctx, state);
}

function drawCell(ctx: CanvasRenderingContext2D, v: Viewport, cell: Cell, selected: boolean, showBand: boolean): void {
  const outer = cell.outer.map((p) => imageToScreen(v, p));
  const inner = cell.inner.map((p) => imageToScreen(v, p));

  if (showBand) {
    ctx.beginPath();
    tracePath(ctx, outer, true);
    tracePath(ctx, inner, true);
    ctx.fillStyle = BAND_FILL;
    ctx.fill('evenodd');
  }

  const width = selected ? 2.5 : 1.75;
  if (selected) {
    tracePathNew(ctx, outer, true);
    strokeWith(ctx, SELECTED_GLOW, width + 6);
  }
  tracePathNew(ctx, outer, true);
  strokeOutlined(ctx, OUTER_COLOR, width);
  tracePathNew(ctx, inner, true);
  strokeOutlined(ctx, INNER_COLOR, width);


  const m = cell.measurements;
  const gap = m.gap_median === null ? '?' : `${m.gap_median.toFixed(1)} px`;
  drawLabel(ctx, outer, `${m.inner_inside_outer ? '' : '⚠ '}${cell.id} · ${gap}`);
}

/** Measurement rays: faint spoke to the dark-center edge, then the measured gap. */
function drawRays(ctx: CanvasRenderingContext2D, v: Viewport, m: CellMeasurements): void {
  const center = imageToScreen(v, m.center);
  for (let k = 0; k < m.num_rays; k++) {
    const angle = (2 * Math.PI * k) / m.num_rays;
    const at = (r: number) => imageToScreen(v, [m.center[0] + r * Math.cos(angle), m.center[1] + r * Math.sin(angle)]);
    const ri = m.inner_hits[k];
    const ro = m.outer_hits[k];
    if (ri !== null) {
      const p = at(ri);
      ctx.beginPath();
      ctx.moveTo(center[0], center[1]);
      ctx.lineTo(p[0], p[1]);
      strokeWith(ctx, 'rgba(255, 255, 255, 0.35)', 1);
    }
    if (m.ray_status[k] === 'invalid' || ri === null || ro === null) continue;
    const a = at(ri);
    const b = at(ro);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    if (m.ray_status[k] === 'rejected') ctx.setLineDash([4, 3]);
    strokeOutlined(ctx, m.ray_status[k] === 'kept' ? RAY_KEPT_COLOR : RAY_REJECTED_COLOR, 1.5);
    ctx.setLineDash([]);
  }
  // Center marker
  ctx.beginPath();
  ctx.moveTo(center[0] - 6, center[1]);
  ctx.lineTo(center[0] + 6, center[1]);
  ctx.moveTo(center[0], center[1] - 6);
  ctx.lineTo(center[0], center[1] + 6);
  strokeOutlined(ctx, '#ffffff', 1.5);
}

/** Editable points of the selected cell, plus hover and selection feedback. */
function drawHandles(ctx: CanvasRenderingContext2D, v: Viewport, cell: Cell, state: AppState): void {
  const hv = state.hover?.vertex;
  const sv = state.selectedVertex;
  for (const ring of ['outer', 'inner'] as const) {
    const color = ring === 'outer' ? OUTER_COLOR : INNER_COLOR;
    cell[ring].forEach((p, i) => {
      const s = imageToScreen(v, p);
      const isHover = hv?.ring === ring && hv.index === i;
      const isSel = sv?.ring === ring && sv.index === i;
      drawVertex(ctx, s, color, isHover || isSel ? 5.5 : 3.5);
      if (isSel) {
        ctx.beginPath();
        ctx.arc(s[0], s[1], 9, 0, Math.PI * 2);
        strokeOutlined(ctx, '#ffffff', 1.5);
      }
    });
  }
  const edge = state.hover?.edge;
  if (edge && !hv) {
    // Ghost point where a click would insert a new one.
    const s = imageToScreen(v, edge.point);
    ctx.beginPath();
    ctx.arc(s[0], s[1], 4.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = UNDERLAY;
    ctx.stroke();
  }
}

function drawDraft(ctx: CanvasRenderingContext2D, state: AppState): void {
  const d = state.draft;
  if (!d) return;
  const v = state.viewport;

  if (d.outer) {
    tracePathNew(ctx, d.outer.map((p) => imageToScreen(v, p)), true);
    strokeOutlined(ctx, OUTER_COLOR, 1.75);
  }

  const color = d.phase === 'outer' ? OUTER_COLOR : INNER_COLOR;
  const pts = d.points.map((p) => imageToScreen(v, p));
  if (pts.length > 1) {
    tracePathNew(ctx, pts, false);
    strokeOutlined(ctx, color, 2);
  }

  const cursor = state.cursor ? imageToScreen(v, state.cursor) : null;
  const first = pts[0];
  const nearFirst =
    !!cursor && !!first && pts.length >= 3 && Math.hypot(cursor[0] - first[0], cursor[1] - first[1]) <= CLOSE_RADIUS_PX;

  // Rubber band from the last point to the cursor (or to the first point when about to close).
  if (cursor && pts.length > 0) {
    const last = pts[pts.length - 1];
    const target = nearFirst ? first : cursor;
    ctx.beginPath();
    ctx.moveTo(last[0], last[1]);
    ctx.lineTo(target[0], target[1]);
    ctx.setLineDash([6, 5]);
    strokeOutlined(ctx, color, 1.5);
    ctx.setLineDash([]);
  }

  pts.forEach((p, i) => drawVertex(ctx, p, color, i === 0 ? 6 : 3.5));
  if (nearFirst) {
    ctx.beginPath();
    ctx.arc(first[0], first[1], CLOSE_RADIUS_PX + 2, 0, Math.PI * 2);
    strokeOutlined(ctx, '#ffffff', 2);
  }
}

function drawLabel(ctx: CanvasRenderingContext2D, outer: Point[], text: string): void {
  if (outer.length === 0) return;
  let minY = Infinity;
  let sumX = 0;
  for (const [x, y] of outer) {
    minY = Math.min(minY, y);
    sumX += x;
  }
  const x = sumX / outer.length;
  const y = minY - 8;
  ctx.font = '600 13px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - 17, w, 19, 4);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, x, y - 3);
}

function drawVertex(ctx: CanvasRenderingContext2D, p: Point, color: string, r: number): void {
  ctx.beginPath();
  ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = UNDERLAY;
  ctx.stroke();
}

function tracePath(ctx: CanvasRenderingContext2D, pts: Point[], close: boolean): void {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (close) ctx.closePath();
}

function tracePathNew(ctx: CanvasRenderingContext2D, pts: Point[], close: boolean): void {
  ctx.beginPath();
  tracePath(ctx, pts, close);
}

/** Dark underlay then the colour on top, so lines read on any background. */
function strokeOutlined(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  strokeWith(ctx, UNDERLAY, width + 2.5);
  strokeWith(ctx, color, width);
}

function strokeWith(ctx: CanvasRenderingContext2D, color: string, width: number): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}
