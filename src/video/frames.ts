// Choosing which frames of a video to annotate: a sharpness score per frame,
// suggestions spread across the clip, and names guessed from the file name.
// Pure functions; the browser-side decoding lives in clip.ts.

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
 * The sharpest frame in each of `count` equal stretches of the clip, so the
 * suggestions cover the whole video and are never near-duplicates.
 * Returns frame indices in increasing order; frames in `exclude` (already
 * saved) are never suggested.
 */
export function suggestFrames(scores: ArrayLike<number>, count: number, exclude: ReadonlySet<number> = new Set()): number[] {
  const n = scores.length;
  const k = Math.max(0, Math.min(Math.round(count), n));
  const picks: number[] = [];
  for (let w = 0; w < k; w++) {
    const start = Math.floor((w * n) / k);
    const end = Math.floor(((w + 1) * n) / k);
    let best = -1;
    for (let i = start; i < end; i++) {
      if (!exclude.has(i) && (best < 0 || scores[i] > scores[best])) best = i;
    }
    if (best >= 0) picks.push(best);
  }
  return picks;
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
