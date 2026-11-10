// Choosing which frames of a video to annotate: a sharpness score per frame,
// picks spread across the clip, and names guessed from the file name.
// Pure functions; the browser-side decoding lives in clip.ts.

import type { FramePick } from '../storage/store';

/** How frames are picked automatically (a frame added by hand is 'manual'). */
export type PickMethod = Exclude<FramePick, 'manual'>;

/** Luma of RGBA pixels (BT.601), one byte per pixel. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < out.length; i++, j += 4) {
    out[i] = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000;
  }
  return out;
}

/**
 * Focus measure: variance of the 4-neighbour Laplacian over the interior
 * pixels. Higher means sharper edges; motion blur and defocus lower it. Only
 * comparable between frames of the same video (it also grows with noise and
 * resolution).
 */
export function sharpness(gray: Uint8Array, width: number, height: number): number {
  if (width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSq = 0;
  let n = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const i = row + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

/**
 * One frame from each of `count` equal stretches of the clip, so picks cover
 * the whole video and are never near-duplicates:
 *   random   - a random frame of each stretch; unbiased, so suited to ground
 *              truth. Reproducible: the same `seed` gives the same frames.
 *   even     - the middle frame of each stretch.
 *   sharpest - the sharpest frame of each stretch; easiest to annotate but
 *              better than a typical frame.
 * Returns frame indices in increasing order; frames in `exclude` (already
 * saved) are never picked.
 */
export function pickFrames(
  scores: ArrayLike<number>,
  count: number,
  method: PickMethod,
  seed: string,
  exclude: ReadonlySet<number> = new Set(),
): number[] {
  const n = scores.length;
  const k = Math.max(0, Math.min(Math.round(count), n));
  const random = mulberry32(hashString(`${seed}:${k}`));
  const picks: number[] = [];
  for (let w = 0; w < k; w++) {
    const start = Math.floor((w * n) / k);
    const end = Math.floor(((w + 1) * n) / k);
    const open: number[] = [];
    for (let i = start; i < end; i++) if (!exclude.has(i)) open.push(i);
    if (open.length === 0) continue;
    if (method === 'sharpest') picks.push(open.reduce((best, i) => (scores[i] > scores[best] ? i : best)));
    else if (method === 'random') picks.push(open[Math.floor(random() * open.length)]);
    else {
      const middle = (start + end - 1) / 2;
      picks.push(open.reduce((best, i) => (Math.abs(i - middle) < Math.abs(best - middle) ? i : best)));
    }
  }
  return picks;
}

/** Percentile (0–100) of `score` among `sorted` (ascending): the share of frames less sharp. */
export function percentRank(sorted: ArrayLike<number>, score: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < score) lo = mid + 1;
    else hi = mid;
  }
  return sorted.length > 1 ? (100 * lo) / (sorted.length - 1) : 100;
}

/** FNV-1a: a stable 32-bit seed from a string. */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/** Small seeded PRNG, uniform on [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The phone named in a video's file name, e.g. "iPhone_17_Pro  1_73μmpixel.mp4"
 * → "iPhone 17 Pro". Drops the extension and any pixel-size note.
 */
export function guessPhone(filename: string): string {
  let s = filename.normalize('NFKC').replace(/\.[a-z0-9]{2,4}$/i, '');
  s = s.replace(/\d+[.,_]\d+\s*[µμu]m.*$/i, ''); // "1_73μmpixel", "2,24 µm/pixel"
  s = s.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s.replace(/\biphone\b/i, 'iPhone').replace(/\bredmi\b/i, 'Redmi');
}

/** A pixel size in µm written in the file name ("1_73μmpixel" → 1.73), or null. */
export function guessPixelSize(filename: string): number | null {
  const m = /(\d+)[.,_](\d+)\s*[µμu]m/i.exec(filename.normalize('NFKC'));
  return m ? Number(`${m[1]}.${m[2]}`) : null;
}

/** File name of a saved frame, e.g. "iPhone 14 Pro · frame 312.png". */
export function frameFilename(videoName: string, index: number): string {
  return `${videoName} · frame ${index}.png`;
}

/** "10.4 s" */
export function formatTime(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}
