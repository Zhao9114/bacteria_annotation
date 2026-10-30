import { describe, expect, it } from 'vitest';
import { applyDisplayFilters, buildLut, histogramPercentile, type DisplaySettings } from '../src/canvas/filters';

const plain: DisplaySettings = { channel: 'rgb', stretch: false, brightness: 0, contrast: 0 };

function buffer(pixels: [number, number, number, number][]) {
  return { data: new Uint8ClampedArray(pixels.flat()), width: pixels.length, height: 1 };
}

describe('display filters', () => {
  it('identity settings leave the image unchanged', () => {
    const src = buffer([[10, 200, 30, 255], [0, 128, 255, 100]]);
    const out = new Uint8ClampedArray(src.data.length);
    applyDisplayFilters(src, plain, out);
    expect([...out]).toEqual([...src.data]);
  });

  it('single channel mode shows that channel as grey and keeps alpha', () => {
    const src = buffer([[10, 200, 30, 255], [0, 128, 255, 100]]);
    const out = new Uint8ClampedArray(src.data.length);
    applyDisplayFilters(src, { ...plain, channel: 'green' }, out);
    expect([...out]).toEqual([200, 200, 200, 255, 128, 128, 128, 100]);
  });

  it('histogramPercentile finds the low and high ends', () => {
    const hist = new Uint32Array(256);
    hist[50] = 1;
    hist[100] = 98;
    hist[200] = 1;
    expect(histogramPercentile(hist, 100, 1)).toBe(50);
    expect(histogramPercentile(hist, 100, 50)).toBe(100);
    expect(histogramPercentile(hist, 100, 99)).toBe(100);
    expect(histogramPercentile(hist, 100, 100)).toBe(200);
  });

  it('stretch maps the 1st..99th percentile onto the full range', () => {
    // 100 green values 100..199: 1st percentile is 100, 99th is 198.
    const px: [number, number, number, number][] = [];
    for (let v = 100; v < 200; v++) px.push([0, v, 0, 255]);
    const src = buffer(px);
    const out = new Uint8ClampedArray(src.data.length);
    applyDisplayFilters(src, { ...plain, channel: 'green', stretch: true }, out);
    expect(out[1]).toBe(0); // value 100
    expect(out[98 * 4 + 1]).toBe(255); // value 198
    expect(out[99 * 4 + 1]).toBe(255); // value 199 clamps
  });

  it('colour mode stretches all channels with one shared range', () => {
    // Channels span 50..150 together, so a pixel's hue relationships survive.
    const px: [number, number, number, number][] = [];
    for (let v = 50; v <= 150; v++) px.push([v, v, 100, 255]);
    const src = buffer(px);
    const out = new Uint8ClampedArray(src.data.length);
    applyDisplayFilters(src, { ...plain, stretch: true }, out);
    const mid = 50 * 4; // pixel (100, 100, 100)
    expect(out[mid]).toBe(out[mid + 1]);
    expect(out[mid + 1]).toBe(out[mid + 2]);
  });

  it('brightness shifts and contrast scales around mid-grey', () => {
    const bright = buildLut(0, 255, { stretch: false, brightness: 50, contrast: 0 });
    expect(bright[100]).toBe(164);
    const contrast = buildLut(0, 255, { stretch: false, brightness: 0, contrast: 50 });
    expect(contrast[128]).toBe(128);
    expect(contrast[138]).toBe(148);
    expect(contrast[118]).toBe(108);
  });
});
