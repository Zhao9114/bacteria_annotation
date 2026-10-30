// Converting between the editor's cells and the stored annotation document.

import { DEFAULT_MEASUREMENT_SETTINGS, measureCell, type MeasurementSettings } from '../measure/measure';
import { SCHEMA_VERSION, type AnnotationDoc, type Cell, type ImageStatus } from './schema';

export interface AnnotationContent {
  cells: Cell[];
  status: ImageStatus;
  measurement: MeasurementSettings;
}

export function toDoc(
  content: AnnotationContent,
  image: AnnotationDoc['image'],
  annotator: string,
  created: string | null,
  now = new Date().toISOString(),
): AnnotationDoc {
  return {
    schema_version: SCHEMA_VERSION,
    image,
    annotator,
    status: content.status,
    created: created ?? now,
    modified: now,
    scale: { px_per_unit: null, unit: null, reference: null },
    measurement_settings: { ...content.measurement },
    cells: content.cells,
  };
}

/**
 * Read a stored document. Measurements are recomputed rather than trusted, and
 * fields added after a document was written get their defaults.
 */
export function fromDoc(doc: AnnotationDoc): AnnotationContent {
  const measurement = { ...DEFAULT_MEASUREMENT_SETTINGS, ...doc.measurement_settings };
  const cells: Cell[] = doc.cells.map((c) => ({
    id: c.id,
    outer: c.outer,
    inner: c.inner,
    flags: c.flags ?? [],
    note: c.note ?? '',
    draw_mode: c.draw_mode ?? 'points',
    measurements: measureCell(c.outer, c.inner, measurement),
  }));
  return { cells, status: doc.status ?? 'in_progress', measurement };
}
