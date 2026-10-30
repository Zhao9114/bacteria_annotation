// Types shared by the app and the JSON formats.
// All coordinates are in original image pixel space, never screen space.

import type { CellMeasurements, MeasurementSettings } from '../measure/measure';

export type Point = [number, number];
export type Polygon = Point[];

/** Single source of truth for allowed per-cell flags. */
export const FLAGS = ['rim_cut', 'unsure', 'out_of_focus', 'overlapping'] as const;
export type Flag = (typeof FLAGS)[number];

export type DrawMode = 'points' | 'freehand';

export interface Cell {
  id: number;
  /** Outer dark ring. */
  outer: Polygon;
  /** Edge of the dark central blob. */
  inner: Polygon;
  flags: Flag[];
  note: string;
  /** How the outlines were drawn: clicked point by point, or traced freehand (less precise). */
  draw_mode: DrawMode;
  /** Derived from the polygons; recomputed whenever they or the settings change. */
  measurements: CellMeasurements;
}

export type ImageStatus = 'not_started' | 'in_progress' | 'done';

export const SCHEMA_VERSION = 1;

/** One person's annotation of one image, as stored and exported. */
export interface AnnotationDoc {
  schema_version: typeof SCHEMA_VERSION;
  image: { filename: string; sha256: string; width: number; height: number };
  annotator: string;
  status: ImageStatus;
  created: string;
  modified: string;
  scale: { px_per_unit: number | null; unit: string | null; reference: string | null };
  measurement_settings: MeasurementSettings;
  cells: Cell[];
}
