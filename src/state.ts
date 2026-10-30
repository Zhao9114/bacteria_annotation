// View state of the annotation screen: how the image is shown and where the
// pointer is. What is being annotated lives in the AnnotationSession.

import type { HoverTarget } from './annotation/session';
import { DEFAULT_DISPLAY, type DisplaySettings } from './canvas/filters';
import type { Point, Viewport } from './canvas/viewport';
import type { PointerKind } from './input/gestures';

export interface LoadedImage {
  filename: string;
  width: number;
  height: number;
  /** Original pixels, never modified. */
  pixels: ImageData;
  /** Filtered copy that is actually drawn; rebuilt when display settings change. */
  display: HTMLCanvasElement;
}

export interface ViewState {
  viewport: Viewport;
  display: DisplaySettings;
  /** Mouse or pen position in image pixels; null when off the canvas or using touch. */
  cursor: Point | null;
  /** Kind of the last pointer used on the canvas; touch gets larger targets. */
  pointerType: PointerKind;
  /** What a press at the cursor would grab on the selected cell. */
  hover: HoverTarget | null;
  /** Shade the band between the outer ring and the dark center. */
  showBand: boolean;
  /** Draw the measurement rays of the selected cell. */
  showRays: boolean;
}

export function createViewState(): ViewState {
  return {
    viewport: { scale: 1, tx: 0, ty: 0 },
    display: { ...DEFAULT_DISPLAY },
    cursor: null,
    pointerType: 'mouse',
    hover: null,
    showBand: true,
    showRays: true,
  };
}
