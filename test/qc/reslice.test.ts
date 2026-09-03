/**
 * Reslice plane construction and distance labels, from a synthetic straight lead (§T1). The
 * expected 3-D gaps are computed independently of `qc/tsv.ts`'s `distanceMm` — plain Euclidean
 * distance on the fixture's own coordinates — so this is not comparing the module against itself.
 */

import { describe, expect, it } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import type { vec3 } from '@tetravox/module-sdk';
import {
  GRID_SPACING_MM,
  MARGIN_ACROSS_MM,
  MARGIN_ALONG_MM,
  planeBasisFor,
  planeToPixel,
  projectToPlane,
  resliceGrid,
  resliceMarks,
} from '../../src/qc/reslice';

function euclid(a: vec3, b: vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe.skipIf(!HAS_CONTACTS)('planeBasisFor', () => {
  it('is null for fewer than two points', () => {
    expect(planeBasisFor([[0, 0, 0]])).toBeNull();
  });

  it('constructs a right-handed, orthonormal, axis-containing basis for a straight lead', () => {
    const positions: vec3[] = Array.from({ length: 8 }, (_v, i) => [i * 3.5, 5, -10]);
    const basis = planeBasisFor(positions);
    expect(basis).not.toBeNull();
    if (basis === null) return;

    const lenAlong = Math.hypot(...basis.along);
    const lenAcross = Math.hypot(...basis.across);
    expect(lenAlong).toBeCloseTo(1, 6);
    expect(lenAcross).toBeCloseTo(1, 6);
    // The lead runs along +x, so the fitted axis is parallel to +x (sign is not pinned by the fit).
    expect(Math.abs(basis.along[0])).toBeCloseTo(1, 6);
    expect(basis.along[1]).toBeCloseTo(0, 6);
    expect(basis.along[2]).toBeCloseTo(0, 6);
    // `across` is perpendicular to `along` and lies in the plane cross(axis, +z) spans — i.e. it has
    // no z component.
    const dot = basis.along[0] * basis.across[0] + basis.along[1] * basis.across[1] + basis.along[2] * basis.across[2];
    expect(dot).toBeCloseTo(0, 6);
    expect(basis.across[2]).toBeCloseTo(0, 6);
  });
});

describe.skipIf(!HAS_CONTACTS)('resliceGrid', () => {
  it('spans the requested margins at the requested spacing', () => {
    const basis = planeBasisFor(
      Array.from({ length: 4 }, (_v, i) => [i * 3.5, 0, 0] as vec3)
    );
    if (basis === null) throw new Error('fit failed');
    const grid = resliceGrid(basis);
    expect(grid.spacingMm).toBe(GRID_SPACING_MM);
    expect(grid.nAlong).toBe(Math.round((2 * MARGIN_ALONG_MM) / GRID_SPACING_MM) + 1);
    expect(grid.nAcross).toBe(Math.round((2 * MARGIN_ACROSS_MM) / GRID_SPACING_MM) + 1);
    expect(grid.points.length).toBe(grid.nAlong * grid.nAcross * 3);
  });

  it('projectToPlane/planeToPixel round-trips a point back to the grid centre', () => {
    const basis = planeBasisFor(
      Array.from({ length: 4 }, (_v, i) => [i * 3.5, 0, 0] as vec3)
    );
    if (basis === null) throw new Error('fit failed');
    const grid = resliceGrid(basis);
    const pixel = planeToPixel(projectToPlane(basis.origin, basis), grid);
    expect(pixel.x).toBeCloseTo(MARGIN_ACROSS_MM / GRID_SPACING_MM, 3);
    expect(pixel.y).toBeCloseTo(MARGIN_ALONG_MM / GRID_SPACING_MM, 3);
  });
});

describe.skipIf(!HAS_CONTACTS)('resliceMarks', () => {
  it('labels consecutive contacts with their independently-computed 3-D distance', () => {
    const ordered = [
      { name: 'A01', ordinal: 1, position: [0, 0, 0] as vec3 },
      { name: 'A02', ordinal: 2, position: [3.5, 0, 0] as vec3 },
      { name: 'A03', ordinal: 3, position: [7.0, 0, 4.2] as vec3 }, // an off-axis contact
    ];
    const basis = planeBasisFor(ordered.map((c) => c.position));
    if (basis === null) throw new Error('fit failed');
    const grid = resliceGrid(basis);
    const { marks, labels } = resliceMarks(ordered, basis, grid);

    expect(marks).toHaveLength(3);
    expect(labels).toHaveLength(2);
    expect(labels[0]?.distanceMm).toBeCloseTo(euclid(ordered[0]!.position, ordered[1]!.position), 6);
    expect(labels[1]?.distanceMm).toBeCloseTo(euclid(ordered[1]!.position, ordered[2]!.position), 6);
    // The 3.5 mm gap between contacts 1 and 2 is exact by construction.
    expect(labels[0]?.distanceMm).toBeCloseTo(3.5, 6);
  });
});
