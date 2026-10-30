// Per-cell measurements. The same function measures doctor annotations and NN
// predictions, so the comparison is apples to apples.
//
// Ray-based gap, matching the `inner2outer` method in measure_bacteria.py:
//   1. Center = area-weighted centroid of the INNER polygon (stands in for the
//      pipeline's dark-blob centroid).
//   2. `num_rays` rays at angles 2*pi*k/num_rays (k = 0..n-1), image axes:
//      ray 0 points +x, angles increase clockwise on screen (y points down).
//   3. Distance along each ray to the farthest crossing of the inner and
//      outer polygons.
//   4. Gap = outer - inner. Rays with a missing hit or gap <= 0 are invalid.
//   5. MAD outlier rejection with the pipeline's exact rule (madKeepMask).
// Gap statistics use the kept rays only. Lengths are in image pixels.

import type { Point, Polygon } from '../io/schema';
import { farthestRayHit, polygonInsidePolygon, shapeStats, type ShapeStats } from './geometry';

export interface MeasurementSettings {
  num_rays: number;
  center: 'inner_centroid';
  mad_reject: boolean;
}

export const DEFAULT_MEASUREMENT_SETTINGS: MeasurementSettings = {
  num_rays: 32,
  center: 'inner_centroid',
  mad_reject: true,
};

/** Same threshold as the Python pipeline: keep |gap - median| < 3 * MAD. */
export const MAD_THRESHOLD = 3.0;

export type RayStatus = 'kept' | 'rejected' | 'invalid';

export interface CellMeasurements extends GapStats {
  center: Point;
  num_rays: number;
  /** Distance from the center to the dark-center edge, per ray (null = no hit). */
  inner_hits: (number | null)[];
  /** Distance from the center to the outer ring, per ray (null = no hit). */
  outer_hits: (number | null)[];
  /** outer - inner per ray, in angle order; null for invalid rays. MAD-rejected rays keep their value. */
  gaps_per_ray: (number | null)[];
  ray_status: RayStatus[];
  /** Rays with a valid positive gap, before outlier rejection. */
  n_rays_valid: number;
  /** Valid rays removed by MAD rejection. Stats use n_rays_valid - n_rays_rejected rays. */
  n_rays_rejected: number;
  inner: ShapeStats;
  outer: ShapeStats;
  /** gap_median / outer equivalent radius. */
  gap_over_outer_radius: number | null;
  /** inner equivalent diameter / outer equivalent diameter. */
  inner_over_outer_diameter: number | null;
  /** (outer area - inner area) / outer area. */
  ring_area_fraction: number | null;
  /** Distance between inner and outer centroids / outer equivalent radius. */
  center_offset: number | null;
  /** False when the dark center pokes outside the outer ring (shown as a warning). */
  inner_inside_outer: boolean;
}

/** Linear-interpolated percentile of an ascending array, like numpy's default. */
export function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 1) return sorted[0];
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function median(values: number[]): number {
  return percentile([...values].sort((a, b) => a - b), 50);
}

/**
 * Port of the pipeline's rejection:
 *   med = median(gaps); mad = median(|gaps - med|) + 1e-6
 *   keep = |gaps - med| < 3 * mad;  if fewer than 3 kept, keep all.
 */
export function madKeepMask(gaps: number[]): boolean[] {
  if (gaps.length === 0) return [];
  const med = median(gaps);
  const mad = median(gaps.map((g) => Math.abs(g - med))) + 1e-6;
  const keep = gaps.map((g) => Math.abs(g - med) < MAD_THRESHOLD * mad);
  return keep.filter(Boolean).length < 3 ? gaps.map(() => true) : keep;
}

/** Summary of the kept gaps; all null when no ray is valid. */
export interface GapStats {
  gap_median: number | null;
  gap_mean: number | null;
  /** Population standard deviation (numpy default). */
  gap_std: number | null;
  gap_min: number | null;
  gap_max: number | null;
  gap_p10: number | null;
  gap_p90: number | null;
}

/** Outlier rejection plus summary stats over the valid gaps, as in the pipeline. */
export function summarizeGaps(gaps: number[], madReject: boolean): { keep: boolean[]; stats: GapStats } {
  const keep = madReject ? madKeepMask(gaps) : gaps.map(() => true);
  const kept = gaps.filter((_, j) => keep[j]).sort((a, b) => a - b);
  if (kept.length === 0) {
    const none = null;
    return {
      keep,
      stats: { gap_median: none, gap_mean: none, gap_std: none, gap_min: none, gap_max: none, gap_p10: none, gap_p90: none },
    };
  }
  const mean = kept.reduce((s, g) => s + g, 0) / kept.length;
  return {
    keep,
    stats: {
      gap_median: percentile(kept, 50),
      gap_mean: mean,
      gap_std: Math.sqrt(kept.reduce((s, g) => s + (g - mean) ** 2, 0) / kept.length),
      gap_min: kept[0],
      gap_max: kept[kept.length - 1],
      gap_p10: percentile(kept, 10),
      gap_p90: percentile(kept, 90),
    },
  };
}

export function measureCell(outer: Polygon, inner: Polygon, settings: MeasurementSettings): CellMeasurements {
  const innerStats = shapeStats(inner);
  const outerStats = shapeStats(outer);
  const center = innerStats.centroid;
  const n = settings.num_rays;

  const inner_hits: (number | null)[] = [];
  const outer_hits: (number | null)[] = [];
  const gaps_per_ray: (number | null)[] = [];
  for (let k = 0; k < n; k++) {
    const angle = (2 * Math.PI * k) / n;
    const ri = farthestRayHit(center, angle, inner);
    const ro = farthestRayHit(center, angle, outer);
    inner_hits.push(ri);
    outer_hits.push(ro);
    gaps_per_ray.push(ri !== null && ro !== null && ro - ri > 0 ? ro - ri : null);
  }

  const validIdx = gaps_per_ray.flatMap((g, i) => (g === null ? [] : [i]));
  const validGaps = validIdx.map((i) => gaps_per_ray[i]!);
  const { keep, stats } = summarizeGaps(validGaps, settings.mad_reject);

  const ray_status: RayStatus[] = gaps_per_ray.map(() => 'invalid');
  validIdx.forEach((rayIdx, j) => (ray_status[rayIdx] = keep[j] ? 'kept' : 'rejected'));

  const outerRadius = outerStats.equiv_diameter / 2;
  const hasOuter = outerStats.area > 0;
  const [icx, icy] = innerStats.centroid;
  const [ocx, ocy] = outerStats.centroid;

  return {
    center,
    num_rays: n,
    inner_hits,
    outer_hits,
    gaps_per_ray,
    ray_status,
    ...stats,
    n_rays_valid: validGaps.length,
    n_rays_rejected: keep.filter((k) => !k).length,
    inner: innerStats,
    outer: outerStats,
    gap_over_outer_radius: hasOuter && stats.gap_median !== null ? stats.gap_median / outerRadius : null,
    inner_over_outer_diameter: hasOuter ? innerStats.equiv_diameter / outerStats.equiv_diameter : null,
    ring_area_fraction: hasOuter ? (outerStats.area - innerStats.area) / outerStats.area : null,
    center_offset: hasOuter ? Math.hypot(icx - ocx, icy - ocy) / outerRadius : null,
    inner_inside_outer: polygonInsidePolygon(inner, outer),
  };
}
