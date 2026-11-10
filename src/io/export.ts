// Exporting results to compare with the neural network, per phone and frame:
//   CSV  - one row per cell: where it came from and every measurement
//   JSON - every annotation document in full, outlines included
// Measurements are recomputed from the outlines (fromDoc), as everywhere else.

import type { ImageRecord, LibraryScope, LibraryStore, VideoRecord } from '../storage/store';
import { compareImages, compareVideos } from '../storage/store';
import { fromDoc } from './annotation';
import type { AnnotationDoc, Cell } from './schema';

/** One image or video frame with the current user's annotation of it (null if none). */
export interface ExportItem {
  image: ImageRecord;
  video: VideoRecord | null;
  doc: AnnotationDoc | null;
}

type Value = string | number | boolean | null | undefined;

/** Columns: name and how to read it from an item and one of its cells. */
const COLUMNS: [string, (item: ExportItem, cell: Cell) => Value][] = [
  ['source', (i) => (i.video ? 'video frame' : 'image')],
  ['phone', (i) => i.video?.phone],
  ['video_file', (i) => i.video?.filename],
  ['sensor_pixel_size_um', (i) => i.video?.pixel_size_um],
  ['frame_index', (i) => i.image.frame?.index],
  ['frame_time_s', (i) => i.image.frame?.time],
  ['image_file', (i) => i.image.filename],
  ['image_sha256', (i) => i.image.sha256],
  ['image_width', (i) => i.image.width],
  ['image_height', (i) => i.image.height],
  ['annotator', (i) => i.doc?.annotator],
  ['status', (i) => i.doc?.status],
  ['cell_id', (_, c) => c.id],
  ['draw_mode', (_, c) => c.draw_mode],
  ['flags', (_, c) => c.flags.join(';')],
  ['note', (_, c) => c.note],
  ['inner_inside_outer', (_, c) => c.measurements.inner_inside_outer],
  ['gap_median_px', (_, c) => c.measurements.gap_median],
  ['gap_mean_px', (_, c) => c.measurements.gap_mean],
  ['gap_std_px', (_, c) => c.measurements.gap_std],
  ['gap_min_px', (_, c) => c.measurements.gap_min],
  ['gap_max_px', (_, c) => c.measurements.gap_max],
  ['gap_p10_px', (_, c) => c.measurements.gap_p10],
  ['gap_p90_px', (_, c) => c.measurements.gap_p90],
  ['num_rays', (_, c) => c.measurements.num_rays],
  ['rays_valid', (_, c) => c.measurements.n_rays_valid],
  ['rays_rejected', (_, c) => c.measurements.n_rays_rejected],
  ['outer_area_px2', (_, c) => c.measurements.outer.area],
  ['outer_equiv_diameter_px', (_, c) => c.measurements.outer.equiv_diameter],
  ['outer_max_feret_px', (_, c) => c.measurements.outer.max_feret],
  ['outer_circularity', (_, c) => c.measurements.outer.circularity],
  ['inner_area_px2', (_, c) => c.measurements.inner.area],
  ['inner_equiv_diameter_px', (_, c) => c.measurements.inner.equiv_diameter],
  ['inner_max_feret_px', (_, c) => c.measurements.inner.max_feret],
  ['inner_circularity', (_, c) => c.measurements.inner.circularity],
  ['gap_over_outer_radius', (_, c) => c.measurements.gap_over_outer_radius],
  ['inner_over_outer_diameter', (_, c) => c.measurements.inner_over_outer_diameter],
  ['ring_area_fraction', (_, c) => c.measurements.ring_area_fraction],
  ['center_offset', (_, c) => c.measurements.center_offset],
];

/** RFC 4180 field: quoted when it contains a comma, quote or line break. */
function field(v: Value): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? (Number.isFinite(v) ? String(Math.round(v * 1e6) / 1e6) : '') : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per marked cell; images without cells add no rows. */
export function toCsv(items: ExportItem[]): string {
  const lines = [COLUMNS.map(([name]) => name).join(',')];
  for (const item of items) {
    if (!item.doc) continue;
    for (const cell of fromDoc(item.doc).cells) {
      lines.push(COLUMNS.map(([, get]) => field(get(item, cell))).join(','));
    }
  }
  return lines.join('\r\n') + '\r\n';
}

/** Everything, outlines included, for comparing shapes with the network's masks. */
export function toJson(items: ExportItem[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify(
    {
      exported_at: exportedAt,
      note: 'Coordinates are pixels of the stored image (frames: of the video frame). Measurements are in pixels.',
      items: items.map(({ image, video, doc }) => ({
        image: { filename: image.filename, sha256: image.sha256, width: image.width, height: image.height },
        video: video && {
          filename: video.filename,
          phone: video.phone,
          sensor_pixel_size_um: video.pixel_size_um,
          fps: video.fps,
          frame_count: video.frame_count,
          width: video.width,
          height: video.height,
        },
        frame: image.frame && { index: image.frame.index, time_s: image.frame.time },
        annotation: doc && { ...doc, cells: fromDoc(doc).cells },
      })),
    },
    null,
    1,
  );
}

/**
 * Gather what to export: one video's frames, or everything in the library
 * scope (images, then each video's frames). Annotations are the current
 * user's.
 */
export async function gatherExport(
  library: LibraryStore,
  what: { videoId: string } | { scope: LibraryScope },
): Promise<ExportItem[]> {
  const parts: { video: VideoRecord | null; images: ImageRecord[] }[] = [];
  if ('videoId' in what) {
    const [video, frames] = await Promise.all([library.getVideo(what.videoId), library.listFrames(what.videoId)]);
    parts.push({ video, images: frames });
  } else {
    const [images, videos] = await Promise.all([library.listImages(what.scope), library.listVideos(what.scope)]);
    parts.push({ video: null, images: [...images].sort(compareImages) });
    for (const video of [...videos].sort(compareVideos)) parts.push({ video, images: await library.listFrames(video.id) });
  }
  const items: ExportItem[] = [];
  for (const { video, images } of parts) {
    const docs = await Promise.all(images.map((image) => library.getAnnotation(image.id)));
    images.forEach((image, k) => items.push({ image, video, doc: docs[k] }));
  }
  return items;
}

/** Hand a file to the browser to save. */
export function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
