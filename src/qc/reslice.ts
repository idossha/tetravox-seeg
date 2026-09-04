/**
 * The per-electrode reslice plane's **geometry** — the half a synthetic straight lead can check
 * exactly. `qc/export.ts` is the half that samples the volumes and paints the figure.
 *
 * Every number here is seegprep's, from `reports/figures.py::electrode_reslice`:
 *
 *  * the plane basis — the PCA axis `u` and `v = cross(u, +z)` normalised;
 *  * `margin_mm = 12`, `width_mm = 22`, `res_mm = 0.4`;
 *  * the sample grid `su = arange(-length/2 - margin, length/2 + margin, res)` and
 *    `sv = arange(-width/2, width/2, res)`, where `length` is the **tip-to-tail** distance
 *    `|pts[-1] - pts[0]|` — not a fixed span. A 5-contact depth electrode and a 15-contact one
 *    therefore get panels of different data extents, which is what the reference figure shows.
 *
 * `numpy.arange` is half-open and counts by `ceil((stop - start) / step)`, so the count is computed
 * that way rather than by rounding a span: a grid one column wider than seegprep's would shift the
 * whole extent.
 */

import { contacts } from '@tetravox/module-sdk';
import type { vec3 } from '@tetravox/module-sdk';

const { fitLine, distanceMm } = contacts;

/** `res_mm` — the reslice sample spacing (`electrode_reslice`). */
export const RES_MM = 0.4;
/** `margin_mm` — how far past each end of the lead the plane is sampled. */
export const MARGIN_MM = 12;
/** `width_mm` — the full perpendicular extent of the plane. */
export const WIDTH_MM = 22;

export interface PlaneBasis {
  /** A point on the plane — the electrode's centroid, seegprep's `pts.mean(0)`. */
  origin: vec3;
  /** Unit vector along the fitted shaft axis (`u`). */
  along: vec3;
  /** Unit vector in-plane, perpendicular to `along` (`v = cross(u, +z)` normalised). */
  across: vec3;
}

function normalize(v: vec3): vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: vec3, b: vec3): vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * The plane containing the fitted shaft axis and `cross(axis, +z)`.
 *
 * Degenerate only for an axis exactly parallel to +z (`cross` is the zero vector), which a real
 * shaft never is; the fallback is `cross(axis, +x)`, kept so the function stays total. seegprep
 * divides by `norm + 1e-9` and would emit a zero vector there instead — a blank panel rather than a
 * wrong one, and a blank panel is the worse answer.
 */
export function planeBasisFor(positions: readonly vec3[]): PlaneBasis | null {
  const fit = fitLine(positions);
  if (fit === null) return null;
  // Orient the axis so the **tip** (the first contact) is at negative `along`, i.e. on the left of
  // the panel. An SVD's singular vector has an arbitrary sign, so without this the panel is mirrored
  // for about half the leads — and seegprep's own reference figure has the tip on the left in every
  // one of its twelve panels, so pinning the sign is what makes the two figures overlay.
  const first = positions[0] as vec3;
  const last = positions[positions.length - 1] as vec3;
  const forward =
    (last[0] - first[0]) * fit.axis[0] +
    (last[1] - first[1]) * fit.axis[1] +
    (last[2] - first[2]) * fit.axis[2];
  const along: vec3 =
    forward < 0 ? [-fit.axis[0], -fit.axis[1], -fit.axis[2]] : fit.axis;
  let across = normalize(cross(along, [0, 0, 1]));
  if (across[0] === 0 && across[1] === 0 && across[2] === 0) {
    across = normalize(cross(along, [1, 0, 0]));
  }
  return { origin: fit.centroid, along, across };
}

/** `numpy.arange(start, stop, step)` — half-open, and counted the way numpy counts it. */
export function arange(start: number, stop: number, step: number): number[] {
  const n = Math.max(0, Math.ceil((stop - start) / step));
  const out: number[] = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = start + i * step;
  return out;
}

export interface ResliceGrid {
  /** World-space xyz triples, `nAlong * nAcross` points, ordered `(along, across)` row-major. */
  points: Float32Array;
  /** Sample offsets along the shaft axis, in mm — seegprep's `su`. */
  su: number[];
  /** Sample offsets perpendicular to it, in mm — seegprep's `sv`. */
  sv: number[];
  nAlong: number;
  nAcross: number;
  spacingMm: number;
}

/**
 * The sample grid for one electrode's reslice plane.
 *
 * `positions` is needed as well as the basis because the along-extent depends on the lead's own
 * tip-to-tail length; the basis alone could only produce a fixed-size plane.
 */
export function resliceGrid(
  basis: PlaneBasis,
  positions: readonly vec3[],
  opts: { spacingMm?: number; marginMm?: number; widthMm?: number } = {}
): ResliceGrid {
  const step = opts.spacingMm ?? RES_MM;
  const margin = opts.marginMm ?? MARGIN_MM;
  const width = opts.widthMm ?? WIDTH_MM;
  const first = positions[0] ?? ([0, 0, 0] as vec3);
  const last = positions[positions.length - 1] ?? first;
  const length = distanceMm(first, last);
  const su = arange(-length / 2 - margin, length / 2 + margin, step);
  const sv = arange(-width / 2, width / 2, step);
  const points = new Float32Array(su.length * sv.length * 3);
  let k = 0;
  for (const t of su) {
    for (const s of sv) {
      points[k++] = basis.origin[0] + t * basis.along[0] + s * basis.across[0];
      points[k++] = basis.origin[1] + t * basis.along[1] + s * basis.across[1];
      points[k++] = basis.origin[2] + t * basis.along[2] + s * basis.across[2];
    }
  }
  return { points, su, sv, nAlong: su.length, nAcross: sv.length, spacingMm: step };
}

/** Where `worldPoint` lands in the plane's own `(u, v)` millimetre coordinates — seegprep's `duv`. */
export function projectToPlane(
  worldPoint: vec3,
  basis: PlaneBasis
): { along: number; across: number } {
  const d: vec3 = [
    worldPoint[0] - basis.origin[0],
    worldPoint[1] - basis.origin[1],
    worldPoint[2] - basis.origin[2],
  ];
  return {
    along: d[0] * basis.along[0] + d[1] * basis.along[1] + d[2] * basis.along[2],
    across: d[0] * basis.across[0] + d[1] * basis.across[1] + d[2] * basis.across[2],
  };
}

export interface ContactMark {
  name: string;
  ordinal: number;
  /** Data coordinates in the panel: x = along the shaft (mm), y = perpendicular (mm). */
  mm: { along: number; across: number };
}

export interface DistanceLabel {
  /** The midpoint of the two rings, in the same data coordinates — `(duv[i] + duv[i+1]) / 2`. */
  mm: { along: number; across: number };
  /** The **3-D** centre-to-centre distance, never the in-plane separation. See below. */
  distanceMm: number;
}

/**
 * Ring positions for an ordered electrode, plus the 3-D distance between consecutive contacts.
 *
 * The distance is the true world-space one (`contacts.distanceMm`), matching seegprep's
 * `np.linalg.norm(np.diff(pts, axis=0))`: the in-plane `duv` separation would understate a gap for
 * any lead not perfectly flat in its own reslice plane, and the number a reader quotes has to be the
 * real one.
 */
export function resliceMarks(
  ordered: Array<{ name: string; ordinal: number; position: vec3 }>,
  basis: PlaneBasis
): { marks: ContactMark[]; labels: DistanceLabel[] } {
  const marks: ContactMark[] = ordered.map((c) => ({
    name: c.name,
    ordinal: c.ordinal,
    mm: projectToPlane(c.position, basis),
  }));
  const labels: DistanceLabel[] = [];
  for (let i = 1; i < ordered.length; i += 1) {
    const a = ordered[i - 1]!;
    const b = ordered[i]!;
    const pa = marks[i - 1]!.mm;
    const pb = marks[i]!.mm;
    labels.push({
      mm: { along: (pa.along + pb.along) / 2, across: (pa.across + pb.across) / 2 },
      distanceMm: distanceMm(a.position, b.position),
    });
  }
  return { marks, labels };
}
