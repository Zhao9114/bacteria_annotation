// Display-only filters: channel selection, percentile contrast stretch,
// brightness and contrast. Never applied to stored images.
//
// Works on a plain RGBA pixel buffer so it can be unit tested without a DOM.
// Each output channel goes through a 256-entry lookup table, so the cost per
// pixel is a few array reads regardless of settings.

export type Channel = 'rgb' | 'red' | 'green' | 'blue';
export const CHANNELS: Channel[] = ['rgb', 'red', 'green', 'blue'];

export interface DisplaySettings {
  channel: Channel;
  /** Map the 1st..99th percentile of the shown channel(s) to 0..255. */
  stretch: boolean;
  /** -100..100, shifts all values. */
  brightness: number;
  /** -100..100, scales values around mid-grey. */
  contrast: number;
}

/** The photo exactly as taken; users can switch to green or boost contrast. */
export const DEFAULT_DISPLAY: DisplaySettings = {
  channel: 'rgb',
  stretch: false,
  brightness: 0,
  contrast: 0,
};

export interface PixelBuffer {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const STRETCH_LO_PCT = 1;
const STRETCH_HI_PCT = 99;

/** Value at percentile `pct` (0..100) of a 256-bin histogram holding `total` samples. */
export function histogramPercentile(hist: ArrayLike<number>, total: number, pct: number): number {
  const target = (pct / 100) * total;
  let cum = 0;
  for (let v = 0; v < 256; v++) {
    cum += hist[v];
    if (cum >= target && cum > 0) return v;
  }
  return 255;
}

/** Lookup table: optional stretch of [lo, hi] to [0, 255], then contrast and brightness. */
export function buildLut(lo: number, hi: number, s: Pick<DisplaySettings, 'stretch' | 'brightness' | 'contrast'>): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256);
  const span = Math.max(1, hi - lo);
  const gain = Math.pow(2, s.contrast / 50); // 0.25x .. 4x
  const offset = s.brightness * 1.28; // about +-128
  for (let v = 0; v < 256; v++) {
    const base = s.stretch ? ((v - lo) / span) * 255 : v;
    lut[v] = (base - 128) * gain + 128 + offset; // Uint8ClampedArray rounds and clamps
  }
  return lut;
}

/** Histogram over the given channel offsets (0 = red, 1 = green, 2 = blue). */
function histogram(src: PixelBuffer, offsets: number[]): { hist: Uint32Array; total: number } {
  const hist = new Uint32Array(256);
  const d = src.data;
  for (const offset of offsets) {
    for (let i = offset; i < d.length; i += 4) hist[d[i]]++;
  }
  return { hist, total: (d.length / 4) * offsets.length };
}

function lutFor(src: PixelBuffer, offsets: number[], s: DisplaySettings): Uint8ClampedArray {
  if (!s.stretch) return buildLut(0, 255, s);
  const { hist, total } = histogram(src, offsets);
  const lo = histogramPercentile(hist, total, STRETCH_LO_PCT);
  const hi = histogramPercentile(hist, total, STRETCH_HI_PCT);
  return buildLut(lo, hi, s);
}

/** Writes the filtered image into `out` (same length as src.data). */
export function applyDisplayFilters(src: PixelBuffer, s: DisplaySettings, out: Uint8ClampedArray): void {
  const d = src.data;
  if (s.channel === 'rgb') {
    // One shared range for all three channels. Stretching them separately
    // turns the green-tinted footage into false colours.
    const lut = lutFor(src, [0, 1, 2], s);
    for (let i = 0; i < d.length; i += 4) {
      out[i] = lut[d[i]];
      out[i + 1] = lut[d[i + 1]];
      out[i + 2] = lut[d[i + 2]];
      out[i + 3] = d[i + 3];
    }
    return;
  }
  const offset = s.channel === 'red' ? 0 : s.channel === 'green' ? 1 : 2;
  const lut = lutFor(src, [offset], s);
  for (let i = 0; i < d.length; i += 4) {
    const g = lut[d[i + offset]];
    out[i] = g;
    out[i + 1] = g;
    out[i + 2] = g;
    out[i + 3] = d[i + 3];
  }
}
