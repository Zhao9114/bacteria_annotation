import { describe, expect, it } from 'vitest';
import { frameFilename, guessPhone, guessPixelSize, percentRank, pickFrames, sharpness, toGray } from '../src/video/frames';

function image(w: number, h: number, f: (x: number, y: number) => number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = f(x, y);
  return g;
}

describe('sharpness', () => {
  it('is zero for a flat image and higher for crisp edges than blurred ones', () => {
    const flat = image(40, 40, () => 120);
    const crisp = image(40, 40, (x) => (x < 20 ? 40 : 200));
    const soft = image(40, 40, (x) => 40 + Math.max(0, Math.min(160, (x - 12) * 10)));
    expect(sharpness(flat, 40, 40)).toBe(0);
    expect(sharpness(crisp, 40, 40)).toBeGreaterThan(sharpness(soft, 40, 40));
    expect(sharpness(soft, 40, 40)).toBeGreaterThan(0);
  });

  it('matches OpenCV-style Laplacian variance on a known pattern', () => {
    // A single bright pixel: Laplacian is -4·255 there and +255 at its 4 neighbours.
    const g = image(5, 5, (x, y) => (x === 2 && y === 2 ? 255 : 0));
    const vals = [-4 * 255, 255, 255, 255, 255, 0, 0, 0, 0]; // the 3×3 interior
    const mean = vals.reduce((a, b) => a + b) / 9;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / 9;
    expect(sharpness(g, 5, 5)).toBeCloseTo(variance, 6);
  });

  it('converts RGBA to luma', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255]);
    expect([...toGray(rgba, 3, 1)]).toEqual([255, 0, 149]);
  });
});

describe('pickFrames', () => {
  const scores = [1, 9, 2, 3, 8, 1, 7, 2, 2, 6];

  it('sharpest: the sharpest frame in each equal stretch of the clip', () => {
    expect(pickFrames(scores, 2, 'sharpest', 'v')).toEqual([1, 6]);
    expect(pickFrames(scores, 5, 'sharpest', 'v')).toEqual([1, 3, 4, 6, 9]);
  });

  it('even: the middle frame of each stretch, ignoring sharpness', () => {
    expect(pickFrames(scores, 2, 'even', 'v')).toEqual([2, 7]);
    expect(pickFrames(scores, 5, 'even', 'v')).toEqual([0, 2, 4, 6, 8]);
  });

  it('random: one frame per stretch, the same for the same video, different for another', () => {
    const big = Array.from({ length: 747 }, (_, i) => Math.sin(i) + 2);
    const a = pickFrames(big, 10, 'random', 'sha-of-video-1');
    expect(pickFrames(big, 10, 'random', 'sha-of-video-1')).toEqual(a);
    expect(pickFrames(big, 10, 'random', 'sha-of-video-2')).not.toEqual(a);
    a.forEach((f, w) => {
      expect(f).toBeGreaterThanOrEqual(Math.floor((w * 747) / 10));
      expect(f).toBeLessThan(Math.floor(((w + 1) * 747) / 10));
    });
  });

  it('random picks are not drawn towards sharp frames', () => {
    // Every stretch has one very sharp frame; over many videos a random pick
    // should land on it about as often as on any other frame (1 in 75 here).
    const n = 750;
    const scores = Array.from({ length: n }, (_, i) => (i % 75 === 37 ? 100 : 1));
    let sharp = 0;
    let total = 0;
    for (let v = 0; v < 200; v++) {
      for (const f of pickFrames(scores, 10, 'random', `video-${v}`)) {
        total++;
        if (scores[f] === 100) sharp++;
      }
    }
    expect(sharp / total).toBeLessThan(0.05);
  });

  it('never picks more frames than the clip has, nor fewer than none', () => {
    expect(pickFrames(scores, 50, 'sharpest', 'v')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(pickFrames(scores, 0, 'random', 'v')).toEqual([]);
    expect(pickFrames([], 10, 'even', 'v')).toEqual([]);
  });

  it('skips frames that are already saved', () => {
    expect(pickFrames(scores, 2, 'sharpest', 'v', new Set([1, 6]))).toEqual([4, 9]);
    expect(pickFrames(scores, 2, 'even', 'v', new Set([2, 7]))).toEqual([1, 6]);
    const r = pickFrames(scores, 10, 'random', 'v', new Set([0, 1, 2]));
    expect(r).toEqual([3, 4, 5, 6, 7, 8, 9]);
  });

  it('ranks a score among the video\'s frames as a percentile', () => {
    const sorted = [1, 2, 2, 3, 9];
    expect(percentRank(sorted, 1)).toBe(0);
    expect(percentRank(sorted, 9)).toBe(100);
    expect(percentRank(sorted, 3)).toBe(75);
  });
});

describe('names from the file name', () => {
  it.each([
    ['iPhone 14 Pro.mp4', 'iPhone 14 Pro', null],
    ['iphone_13_pro_laura.mp4', 'iPhone 13 pro laura', null],
    ['iPhone_17_Pro  1_73μmpixel.mp4', 'iPhone 17 Pro', 1.73],
    ['Sax Redmi note 14  2,24 𝜇𝑚𝑝𝑖𝑥𝑒𝑙 .mp4', 'Sax Redmi note 14', 2.24],
    ['clip 2.44 µm.mov', 'clip', 2.44],
  ])('%s → %s', (file, phone, pixel) => {
    expect(guessPhone(file)).toBe(phone);
    expect(guessPixelSize(file)).toBe(pixel);
  });

  it('names a saved frame after its video and frame number', () => {
    expect(frameFilename('iPhone 14 Pro', 312)).toBe('iPhone 14 Pro · frame 312.png');
  });
});
