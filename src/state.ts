// State for the image currently open on the annotation screen.
// Plain mutable object plus a change signal; the screen re-renders on change.

import type { Viewport } from './canvas/viewport';

export interface LoadedImage {
  filename: string;
  width: number;
  height: number;
  bitmap: ImageBitmap;
}

export interface AppState {
  image: LoadedImage | null;
  viewport: Viewport;
  /** Last known cursor position in image pixels, or null when off the canvas. */
  cursor: [number, number] | null;
}

export function createState(): AppState {
  return {
    image: null,
    viewport: { scale: 1, tx: 0, ty: 0 },
    cursor: null,
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
