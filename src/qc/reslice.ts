/**
 * The per-electrode reslice plane — `sub-{id}_desc-reslice_qc.png` — mirroring seegprep's
 * `electrode_reslice` (`reports/figures.py`): the plane containing the fitted shaft axis and the
 * in-plane perpendicular from `cross(axis, +z)`, sampled on a regular grid.
 *
 * This file is the **geometry only** — the plane basis, the sample grid, and where a contact ring
 * and its distance label land in that plane — because that half is what a synthetic straight lead
 * can check exactly. `qc/export.ts` is the half that calls `host.scene.sampleVolume` and composites
 * an `OffscreenCanvas`, which has no meaningful synthetic-fixture check outside a running host.
 */

import { contacts } from '@tetravox/module-sdk';
import type { vec3 } from '@tetravox/module-sdk';

const { fitLine, distanceMm } = contacts;

/** Grid spacing and margins, seegprep's own (`reports/figures.py::electrode_reslice`). */
export const GRID_SPACING_MM = 0.4;
export const MARGIN_ALONG_MM = 12;
export const MARGIN_ACROSS_MM = 11;

export interface PlaneBasis {
  /** A point on the plane — the electrode's centroid. */
  origin: vec3;
  /** Unit vector along the fitted shaft axis. */
  along: vec3;
  /** Unit vector in-plane, perpendicular to `along`. */
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
 * shaft never is; the fallback is `cross(axis, +x)`, kept so the function stays total.
 */
export function planeBasisFor(positions: readonly vec3[]): PlaneBasis | null {
  const fit = fitLine(positions);
  if (fit === null) return null;
  const along = fit.axis;
  let across = normalize(cross(along, [0, 0, 1]));
  if (across[0] === 0 && across[1] === 0 && across[2] === 0) {
    across = normalize(cross(along, [1, 0, 0]));
  }
  return { origin: fit.centroid, along, across };
}

export interface ResliceGrid {
  /** World-space xyz triples, row-major, `nAlong * nAcross` points. */
  points: Float32Array;
  nAlong: number;
  nAcross: number;
  spacingMm: number;
}

/** The sample grid for one electrode's reslice plane. */
export function resliceGrid(
  basis: PlaneBasis,
  opts: {
    spacingMm?: number;
    marginAlongMm?: number;
    marginAcrossMm?: number;
  } = {}
): ResliceGrid {
  const spacing = opts.spacingMm ?? GRID_SPACING_MM;
  const marginAlong = opts.marginAlongMm ?? MARGIN_ALONG_MM;
  const marginAcross = opts.marginAcrossMm ?? MARGIN_ACROSS_MM;
  const nAlong = Math.round((2 * marginAlong) / spacing) + 1;
  const nAcross = Math.round((2 * marginAcross) / spacing) + 1;
  const points = new Float32Array(nAlong * nAcross * 3);
  let k = 0;
  for (let i = 0; i < nAlong; i++) {
    const t = -marginAlong + i * spacing;
    for (let j = 0; j < nAcross; j++) {
      const s = -marginAcross + j * spacing;
      points[k++] = basis.origin[0] + t * basis.along[0] + s * basis.across[0];
      points[k++] = basis.origin[1] + t * basis.along[1] + s * basis.across[1];
      points[k++] = basis.origin[2] + t * basis.along[2] + s * basis.across[2];
    }
  }
  return { points, nAlong, nAcross, spacingMm: spacing };
}

/** Where `worldPoint` lands in the reslice plane's own (along, across) millimetre coordinates. */
export function projectToPlane(worldPoint: vec3, basis: PlaneBasis): { along: number; across: number } {
  const d: vec3 = [
    worldPoint[0] - basis.origin[0],
    worldPoint[1] - basis.origin[1],
    worldPoint[2] - basis.origin[2],
  ];
  const along = d[0] * basis.along[0] + d[1] * basis.along[1] + d[2] * basis.along[2];
  const across = d[0] * basis.across[0] + d[1] * basis.across[1] + d[2] * basis.across[2];
  return { along, across };
}

/** Plane (along, across) millimetres to pixel coordinates in a grid of `grid`'s shape. */
export function planeToPixel(
  coord: { along: number; across: number },
  grid: Pick<ResliceGrid, 'nAlong' | 'nAcross' | 'spacingMm'>,
  marginAlongMm = MARGIN_ALONG_MM,
  marginAcrossMm = MARGIN_ACROSS_MM
): { x: number; y: number } {
  return {
    x: (coord.across + marginAcrossMm) / grid.spacingMm,
    y: (coord.along + marginAlongMm) / grid.spacingMm,
  };
}

export interface ContactMark {
  name: string;
  ordinal: number;
  pixel: { x: number; y: number };
}

export interface DistanceLabel {
  /** Midpoint between the two contacts, in pixel space. */
  pixel: { x: number; y: number };
  distanceMm: number;
}

/** Ring/label positions for an ordered electrode, plus the 3-D distance labels between neighbours. */
export function resliceMarks(
  ordered: Array<{ name: string; ordinal: number; position: vec3 }>,
  basis: PlaneBasis,
  grid: ResliceGrid
): { marks: ContactMark[]; labels: DistanceLabel[] } {
  const marks: ContactMark[] = ordered.map((c) => ({
    name: c.name,
    ordinal: c.ordinal,
    pixel: planeToPixel(projectToPlane(c.position, basis), grid),
  }));
  const labels: DistanceLabel[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1]!;
    const b = ordered[i]!;
    const pa = marks[i - 1]!.pixel;
    const pb = marks[i]!.pixel;
    labels.push({
      pixel: { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 },
      distanceMm: distanceMm(a.position, b.position),
    });
  }
  return { marks, labels };
}
