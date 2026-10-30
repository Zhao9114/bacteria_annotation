import { describe, expect, it } from 'vitest';
import { fromDoc, toDoc } from '../src/io/annotation';
import type { AnnotationDoc, Cell } from '../src/io/schema';
import { DEFAULT_MEASUREMENT_SETTINGS, measureCell } from '../src/measure/measure';
import { circle } from './fixtures';

const settings = { ...DEFAULT_MEASUREMENT_SETTINGS, num_rays: 16 };
const image = { filename: 'cell3.png', sha256: 'abc', width: 642, height: 404 };

function cell(id: number, draw_mode: Cell['draw_mode']): Cell {
  const outer = circle(100 + id * 60, 100, 25, 40);
  const inner = circle(100 + id * 60, 100, 9, 20);
  return { id, outer, inner, flags: ['unsure'], note: 'n', draw_mode, measurements: measureCell(outer, inner, settings) };
}

describe('annotation document', () => {
  it('round-trips cells, status and settings exactly', () => {
    const cells = [cell(1, 'points'), cell(4, 'freehand')];
    const doc = toDoc({ cells, status: 'done', measurement: settings }, image, 'Dr. Smith', null, '2026-10-30T14:00:00.000Z');
    // Through JSON, as it is stored.
    const back = fromDoc(JSON.parse(JSON.stringify(doc)) as AnnotationDoc);
    expect(back.cells).toEqual(cells);
    expect(back.status).toBe('done');
    expect(back.measurement).toEqual(settings);
    expect(back.nextCellId).toBe(5);
    expect(doc).toMatchObject({ schema_version: 1, image, annotator: 'Dr. Smith', created: doc.modified });
  });

  it('keeps the original creation time', () => {
    const doc = toDoc({ cells: [], status: 'in_progress', measurement: settings }, image, 'A', '2026-01-01T00:00:00.000Z');
    expect(doc.created).toBe('2026-01-01T00:00:00.000Z');
    expect(doc.modified).not.toBe(doc.created);
  });

  it('recomputes measurements and fills defaults for older documents', () => {
    const c = cell(2, 'points');
    const old = {
      ...toDoc({ cells: [], status: 'in_progress', measurement: settings }, image, 'A', null),
      cells: [{ id: 2, outer: c.outer, inner: c.inner, measurements: { gap_median: -1 } }],
    } as unknown as AnnotationDoc;
    const back = fromDoc(old);
    expect(back.cells[0].draw_mode).toBe('points');
    expect(back.cells[0].flags).toEqual([]);
    expect(back.cells[0].measurements.gap_median).toBeCloseTo(c.measurements.gap_median!, 9);
  });
});
