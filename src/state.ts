// State for the image currently open on the annotation screen.
// Plain mutable object plus a change signal; the screen re-renders on change.

import { DEFAULT_DISPLAY, type DisplaySettings } from './canvas/filters';
import type { Viewport } from './canvas/viewport';
import type { Cell, DrawMode, ImageStatus } from './io/schema';
import { DEFAULT_MEASUREMENT_SETTINGS, type MeasurementSettings } from './measure/measure';
import type { Draft } from './tools/draw';
import type { EdgeHit, VertexRef } from './tools/edit';

export interface LoadedImage {
  filename: string;
  width: number;
  height: number;
  /** Original pixels, never modified. */
  pixels: ImageData;
  /** Filtered copy that is actually drawn; rebuilt when display settings change. */
  display: HTMLCanvasElement;
}

export interface AppState {
  image: LoadedImage | null;
  viewport: Viewport;
  display: DisplaySettings;
  /** Last known cursor position in image pixels, or null when off the canvas. */
  cursor: [number, number] | null;
  /** Kind of the last pointer used on the canvas; touch gets larger targets. */
  pointerType: string;
  cells: Cell[];
  nextCellId: number;
  /** This user's progress on the image; saved with the annotation. */
  status: ImageStatus;
  /** Bumped on every change to `cells`, so views can skip work when nothing changed. */
  revision: number;
  /** Cell being added, or null when not drawing. */
  draft: Draft | null;
  /** How new cells are drawn: clicked point by point, or traced freehand. */
  drawMode: DrawMode;
  selectedId: number | null;
  /** Selected point on the selected cell (Delete removes it). */
  selectedVertex: VertexRef | null;
  /** What the cursor is over on the selected cell, for hover feedback. */
  hover: { vertex: VertexRef | null; edge: EdgeHit | null } | null;
  /** Shade the band between the outer ring and the dark center. */
  showBand: boolean;
  /** Draw the measurement rays of the selected cell. */
  showRays: boolean;
  measurement: MeasurementSettings;
}

export function createState(): AppState {
  return {
    image: null,
    viewport: { scale: 1, tx: 0, ty: 0 },
    display: { ...DEFAULT_DISPLAY },
    cursor: null,
    pointerType: 'mouse',
    cells: [],
    nextCellId: 1,
    status: 'not_started',
    revision: 0,
    draft: null,
    drawMode: localStorage.getItem('drawMode') === 'freehand' ? 'freehand' : 'points',
    selectedId: null,
    selectedVertex: null,
    hover: null,
    showBand: true,
    showRays: true,
    measurement: { ...DEFAULT_MEASUREMENT_SETTINGS },
  };
}

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notify(): void {
  for (const fn of listeners) fn();
}
