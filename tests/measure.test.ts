import { describe, expect, it } from 'vitest';
import type { Polygon } from '../src/io/schema';
import { DEFAULT_MEASUREMENT_SETTINGS, madKeepMask, measureCell, percentile, summarizeGaps } from '../src/measure/measure';
import { circle } from './fixtures';

const settings = DEFAULT_MEASUREMENT_SETTINGS; // 32 rays, MAD rejection on

describe('percentile (numpy linear interpolation)', () => {
  it('matches numpy on a small array', () => {
    const s = [1, 2, 3, 4];
    expect(percentile(s, 50)).toBe(2.5);
    expect(percentile(s, 10)).toBeCloseTo(1.3, 12);
    expect(percentile(s, 90)).toBeCloseTo(3.7, 12);
    expect(percentile([7], 90)).toBe(7);
  });
});

describe('madKeepMask (same rule as measure_bacteria.py)', () => {
  it('drops a single outlier among identical gaps', () => {
    const gaps = [...Array(31).fill(15), 40];
    const keep = madKeepMask(gaps);
    expect(keep.filter(Boolean).length).toBe(31);
    expect(keep[31]).toBe(false);
  });

  it('keeps everything when fewer than 3 would survive', () => {
    expect(madKeepMask([10, 50])).toEqual([true, true]);
  });
});

describe('summarizeGaps matches measure_bacteria.py (numpy) exactly', () => {
  // Expected values computed with the pipeline's numpy aggregation code:
  // median, MAD rejection, then np.median / mean / std / min / max / percentile.
  const cases = [
    {
      gaps: [12.0, 13.5, 14.0, 14.2, 15.0, 15.1, 16.3, 30.0, 2.0, 14.8],
      expected: { median: 14.8, mean: 14.7, std: 0.8451542547285168, min: 13.5, max: 16.3, p10: 13.8, p90: 15.58, n_kept: 7 },
    },
    {
      gaps: [9.0, 11.0, 10.0, 10.5, 9.5, 25.0, 10.2, 9.8],
      expected: { median: 10.0, mean: 10.0, std: 0.6071008388821649, min: 9.0, max: 11.0, p10: 9.3, p90: 10.7, n_kept: 7 },
    },
    {
      gaps: [5.0, 5.0, 100.0, 200.0],
      expected: { median: 5.0, mean: 36.666666666666664, std: 44.78342947514801, min: 5.0, max: 100.0, p10: 5.0, p90: 81.0, n_kept: 3 },
    },
    {
      gaps: [7.25, 8.5],
      expected: { median: 7.875, mean: 7.875, std: 0.625, min: 7.25, max: 8.5, p10: 7.375, p90: 8.375, n_kept: 2 },
    },
  ];
  for (const { gaps, expected: e } of cases) {
    it(`[${gaps.join(', ')}]`, () => {
      const { keep, stats } = summarizeGaps(gaps, true);
      expect(keep.filter(Boolean).length).toBe(e.n_kept);
      expect(stats.gap_median).toBeCloseTo(e.median, 10);
      expect(stats.gap_mean).toBeCloseTo(e.mean, 10);
      expect(stats.gap_std).toBeCloseTo(e.std, 10);
      expect(stats.gap_min).toBeCloseTo(e.min, 10);
      expect(stats.gap_max).toBeCloseTo(e.max, 10);
      expect(stats.gap_p10).toBeCloseTo(e.p10, 10);
      expect(stats.gap_p90).toBeCloseTo(e.p90, 10);
    });
  }

  it('all stats are null when there are no valid gaps', () => {
    expect(summarizeGaps([], true).stats.gap_median).toBeNull();
  });
});

describe('measureCell', () => {
  // 64-vertex circles have a vertex on every one of the 32 ray directions,
  // so ray hits land exactly on vertices at the true radius.
  const outer25 = circle(0, 0, 25, 64);
  const inner10 = circle(0, 0, 10, 64);

  it('concentric circles r=10 and r=25 give a gap of 15 on every ray', () => {
    const m = measureCell(outer25, inner10, settings);
    expect(m.gaps_per_ray).toHaveLength(32);
    for (const g of m.gaps_per_ray) expect(g).toBeCloseTo(15, 9);
    expect(m.n_rays_valid).toBe(32);
    expect(m.n_rays_rejected).toBe(0);
    for (const k of ['gap_median', 'gap_mean', 'gap_min', 'gap_max', 'gap_p10', 'gap_p90'] as const) {
      expect(m[k]).toBeCloseTo(15, 9);
    }
    expect(m.gap_std).toBeCloseTo(0, 9);
    expect(m.center[0]).toBeCloseTo(0, 9);
    expect(m.center[1]).toBeCloseTo(0, 9);
    expect(m.inner_inside_outer).toBe(true);
  });

  it('scale-free ratios for concentric circles', () => {
    const m = measureCell(outer25, inner10, settings);
    expect(m.inner_over_outer_diameter).toBeCloseTo(0.4, 12);
    expect(m.ring_area_fraction).toBeCloseTo(1 - 0.16, 12);
    expect(m.center_offset).toBeCloseTo(0, 9);
    // 64-gon equivalent radius is just under 25.
    expect(m.gap_over_outer_radius).toBeCloseTo(15 / 25, 2);
  });

  it('offset inner circle gives the expected min and max gap', () => {
    // Inner r=10 centered at (5, 0) inside outer r=25 at the origin. Rays start
    // at the inner centroid, so the gap is 25-5-10 = 10 towards +x and
    // 25+5-10 = 20 towards -x.
    const outer = circle(0, 0, 25, 720);
    const inner = circle(5, 0, 10, 720);
    const m = measureCell(outer, inner, settings);
    expect(m.n_rays_valid).toBe(32);
    expect(m.n_rays_rejected).toBe(0);
    expect(m.gaps_per_ray[0]).toBeCloseTo(10, 2);
    expect(m.gaps_per_ray[16]).toBeCloseTo(20, 2);
    expect(m.gap_min).toBeCloseTo(10, 2);
    expect(m.gap_max).toBeCloseTo(20, 2);
    expect(m.center_offset).toBeCloseTo(5 / 25, 2);
  });

  it('MAD rejection removes an injected outlier ray', () => {
    const spiked: Polygon = outer25.map((p) => [p[0], p[1]]);
    spiked[0] = [40, 0]; // ray 0 now reaches 40 instead of 25
    const m = measureCell(spiked, inner10, settings);
    expect(m.gaps_per_ray[0]).toBeCloseTo(30, 9);
    expect(m.ray_status[0]).toBe('rejected');
    expect(m.n_rays_valid).toBe(32);
    expect(m.n_rays_rejected).toBe(1);
    expect(m.gap_max).toBeCloseTo(15, 9);

    const noMad = measureCell(spiked, inner10, { ...settings, mad_reject: false });
    expect(noMad.n_rays_rejected).toBe(0);
    expect(noMad.gap_max).toBeCloseTo(30, 9);
  });

  it('discards rays where the dark center reaches past the outer ring', () => {
    const dented: Polygon = outer25.map((p) => [p[0], p[1]]);
    dented[0] = [5, 0]; // ray 0 hits the outer ring before the dark center
    const m = measureCell(dented, inner10, settings);
    expect(m.gaps_per_ray[0]).toBeNull();
    expect(m.ray_status[0]).toBe('invalid');
    expect(m.n_rays_valid).toBe(31);
    expect(m.inner_inside_outer).toBe(false);
  });

  it('honours num_rays', () => {
    const m = measureCell(outer25, inner10, { ...settings, num_rays: 8 });
    expect(m.gaps_per_ray).toHaveLength(8);
    expect(m.num_rays).toBe(8);
  });
});
