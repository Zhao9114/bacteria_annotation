import { describe, expect, it } from 'vitest';
import { toDoc } from '../src/io/annotation';
import { gatherExport, toCsv, toJson, type ExportItem } from '../src/io/export';
import type { Cell } from '../src/io/schema';
import { DEFAULT_MEASUREMENT_SETTINGS, measureCell } from '../src/measure/measure';
import type { ImageRecord, VideoRecord } from '../src/storage/store';
import { circle } from './fixtures';
import { MemoryLibrary } from './memory-library';

function cell(id: number, note = ''): Cell {
  const outer = circle(100, 100, 25, 40);
  const inner = circle(100, 100, 9, 20);
  return { id, outer, inner, flags: ['unsure'], note, draw_mode: 'points', measurements: measureCell(outer, inner, DEFAULT_MEASUREMENT_SETTINGS) };
}

const image = (over: Partial<ImageRecord> = {}): ImageRecord => ({
  id: 'i1', owner_id: 'me', owner_name: null, filename: 'cell3.png', mime: 'image/png', width: 640, height: 400,
  sha256: 'abc', shared: false, created: '', frame: null, ...over,
});
const video: VideoRecord = {
  id: 'v1', owner_id: 'me', owner_name: null, filename: 'iPhone 14 Pro.mp4', sha256: 'vs', phone: 'iPhone 14 Pro',
  pixel_size_um: 2.44, width: 320, height: 568, fps: 30, frame_count: 747, duration: 24.9, shared: false, created: '',
};
const doc = (cells: Cell[], filename = 'cell3.png') =>
  toDoc({ cells, status: 'done', measurement: DEFAULT_MEASUREMENT_SETTINGS }, { filename, sha256: 'abc', width: 640, height: 400 }, 'Dr. Smith', null);

describe('CSV export', () => {
  it('has one row per cell with its source and measurements', () => {
    const items: ExportItem[] = [
      { image: image(), video: null, doc: doc([cell(1), cell(2)]) },
      { image: image({ id: 'f', filename: 'iPhone 14 Pro · frame 312.png', frame: { video_id: 'v1', index: 312, time: 10.4 } }), video, doc: doc([cell(7)]) },
      { image: image({ id: 'empty' }), video: null, doc: null },
    ];
    const lines = toCsv(items).trimEnd().split('\r\n');
    const header = lines[0].split(',');
    expect(lines).toHaveLength(4); // header + 3 cells; the unannotated image adds none
    const row = (k: number) => Object.fromEntries(header.map((h, i) => [h, lines[k].split(',')[i]]));
    expect(row(1)).toMatchObject({ source: 'image', phone: '', image_file: 'cell3.png', cell_id: '1', annotator: 'Dr. Smith', status: 'done' });
    expect(row(3)).toMatchObject({ source: 'video frame', phone: 'iPhone 14 Pro', sensor_pixel_size_um: '2.44', frame_index: '312', frame_time_s: '10.4', cell_id: '7' });
    expect(Number(row(1).gap_median_px)).toBeCloseTo(cell(1).measurements.gap_median!, 5);
  });

  it('quotes fields with commas, quotes or line breaks', () => {
    const csv = toCsv([{ image: image({ filename: 'a, "b".png' }), video: null, doc: doc([cell(1, 'line 1\nline 2')]) }]);
    expect(csv).toContain('"a, ""b"".png"');
    expect(csv).toContain('"line 1\nline 2"');
  });
});

describe('JSON export', () => {
  it('includes outlines, frame and video details', () => {
    const json = JSON.parse(
      toJson([{ image: image({ frame: { video_id: 'v1', index: 5, time: 0.2 } }), video, doc: doc([cell(1)]) }], '2026-11-09T00:00:00Z'),
    );
    expect(json.exported_at).toBe('2026-11-09T00:00:00Z');
    const [item] = json.items;
    expect(item.video).toMatchObject({ phone: 'iPhone 14 Pro', sensor_pixel_size_um: 2.44, fps: 30 });
    expect(item.frame).toEqual({ index: 5, time_s: 0.2 });
    expect(item.annotation.cells[0].outer).toHaveLength(40);
  });
});

describe('gathering', () => {
  it('collects a video’s frames in order with the current user’s annotations', async () => {
    const lib = new MemoryLibrary();
    const v = await lib.addVideo({ ...video });
    lib.addRecord('b', 'f20.png', { video_id: v.id, index: 20, time: 0.7 });
    lib.addRecord('a', 'f3.png', { video_id: v.id, index: 3, time: 0.1 });
    lib.addRecord('img', 'cell3.png');
    await lib.saveAnnotation('a', doc([cell(1)]));
    const items = await gatherExport(lib, { videoId: v.id });
    expect(items.map((i) => i.image.frame?.index)).toEqual([3, 20]);
    expect(items.map((i) => !!i.doc)).toEqual([true, false]);
    expect(items[0].video?.phone).toBe('iPhone 14 Pro');

    const everything = await gatherExport(lib, { scope: 'mine' });
    expect(everything.map((i) => i.image.filename)).toEqual(['cell3.png', 'f3.png', 'f20.png']);
  });
});
