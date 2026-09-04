/**
 * Reslice plane construction and distance labels, from a synthetic straight lead (§T1). The
 * expected 3-D gaps are computed independently — plain Euclidean distance on the fixture's own
 * coordinates — so this is not comparing the module against itself.
 *
 * The grid extents are checked against `numpy.arange`'s own arithmetic rather than a rounded span:
 * seegprep's panels are sized by `arange`, and an off-by-one column would shift the whole extent.
 */

import { describe, expect, it } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import type { vec3 } from '@tetravox/module-sdk';
import {
  MARGIN_MM,
  RES_MM,
  WIDTH_MM,
  arange,
  planeBasisFor,
  projectToPlane,
  resliceGrid,
  resliceMarks,
} from '../../src/qc/reslice';

function euclid(a: vec3, b: vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

describe('arange', () => {
  it('is half-open and counted the way numpy counts it', () => {
    expect(arange(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75]);
    expect(arange(-11, 11, 0.4)).toHaveLength(55);
    expect(arange(0, 0, 1)).toEqual([]);
  });
});

describe.skipIf(!HAS_CONTACTS)('planeBasisFor', () => {
  it('is null for fewer than two points', () => {
    expect(planeBasisFor([[0, 0, 0]])).toBeNull();
  });

  it('constructs an orthonormal, axis-containing basis for a straight lead', () => {
    const positions: vec3[] = Array.from({ length: 8 }, (_v, i) => [i * 3.5, 5, -10]);
    const basis = planeBasisFor(positions);
    expect(basis).not.toBeNull();
    if (basis === null) return;

    expect(Math.hypot(...basis.along)).toBeCloseTo(1, 6);
    expect(Math.hypot(...basis.across)).toBeCloseTo(1, 6);
    // The lead runs along +x, so the fitted axis is parallel to +x (sign is not pinned by the fit).
    expect(Math.abs(basis.along[0])).toBeCloseTo(1, 6);
    expect(basis.along[1]).toBeCloseTo(0, 6);
    expect(basis.along[2]).toBeCloseTo(0, 6);
    const dot =
      basis.along[0] * basis.across[0] +
      basis.along[1] * basis.across[1] +
      basis.along[2] * basis.across[2];
    expect(dot).toBeCloseTo(0, 6);
    // `across = cross(axis, +z)` normalised, so it has no z component.
    expect(basis.across[2]).toBeCloseTo(0, 6);
  });
});

describe.skipIf(!HAS_CONTACTS)('resliceGrid', () => {
  it("spans seegprep's own arange extents, sized by the lead's tip-to-tail length", () => {
    const positions = Array.from({ length: 4 }, (_v, i) => [i * 3.5, 0, 0] as vec3);
    const basis = planeBasisFor(positions);
    if (basis === null) throw new Error('fit failed');
    const grid = resliceGrid(basis, positions);
    const length = 3 * 3.5; // |pts[-1] - pts[0]|, by construction
    expect(grid.spacingMm).toBe(RES_MM);
    expect(grid.nAlong).toBe(arange(-length / 2 - MARGIN_MM, length / 2 + MARGIN_MM, RES_MM).length);
    expect(grid.nAcross).toBe(arange(-WIDTH_MM / 2, WIDTH_MM / 2, RES_MM).length);
    expect(grid.points.length).toBe(grid.nAlong * grid.nAcross * 3);
    expect(grid.su[0]).toBeCloseTo(-length / 2 - MARGIN_MM, 9);
    expect(grid.sv[0]).toBeCloseTo(-WIDTH_MM / 2, 9);
  });

  it('samples the plane in (along, across) row-major order at the requested spacing', () => {
    const positions = [
      [0, 0, 0],
      [10, 0, 0],
    ] as vec3[];
    const basis = planeBasisFor(positions);
    if (basis === null) throw new Error('fit failed');
    const grid = resliceGrid(basis, positions);
    // Neighbouring samples within a row differ by one `across` step; across rows, one `along` step.
    const p0: vec3 = [grid.points[0]!, grid.points[1]!, grid.points[2]!];
    const p1: vec3 = [grid.points[3]!, grid.points[4]!, grid.points[5]!];
    expect(euclid(p0, p1)).toBeCloseTo(RES_MM, 5);
    const nextRow = grid.nAcross * 3;
    const q: vec3 = [grid.points[nextRow]!, grid.points[nextRow + 1]!, grid.points[nextRow + 2]!];
    expect(euclid(p0, q)).toBeCloseTo(RES_MM, 5);
  });

  it('projects the plane origin to (0, 0) in the panel', () => {
    const positions = Array.from({ length: 4 }, (_v, i) => [i * 3.5, 0, 0] as vec3);
    const basis = planeBasisFor(positions);
    if (basis === null) throw new Error('fit failed');
    const at = projectToPlane(basis.origin, basis);
    expect(at.along).toBeCloseTo(0, 9);
    expect(at.across).toBeCloseTo(0, 9);
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
    const { marks, labels } = resliceMarks(ordered, basis);

    expect(marks).toHaveLength(3);
    expect(labels).toHaveLength(2);
    expect(labels[0]?.distanceMm).toBeCloseTo(euclid(ordered[0]!.position, ordered[1]!.position), 6);
    expect(labels[1]?.distanceMm).toBeCloseTo(euclid(ordered[1]!.position, ordered[2]!.position), 6);
    expect(labels[0]?.distanceMm).toBeCloseTo(3.5, 6);
    // The label sits at the midpoint of the two rings in panel coordinates — seegprep's
    // `(duv[i] + duv[i+1]) / 2`, before the +0.6 mm the painter adds.
    expect(labels[0]?.mm.along).toBeCloseTo(
      ((marks[0]?.mm.along ?? 0) + (marks[1]?.mm.along ?? 0)) / 2,
      9
    );
  });

  it('reports the true 3-D gap, never the shorter in-plane one', () => {
    // A contact lifted out of the reslice plane: its in-plane separation understates the real gap.
    const ordered = [
      { name: 'B01', ordinal: 1, position: [0, 0, 0] as vec3 },
      { name: 'B02', ordinal: 2, position: [4, 0, 0] as vec3 },
      { name: 'B03', ordinal: 3, position: [8, 0, 0] as vec3 },
      { name: 'B04', ordinal: 4, position: [12, 0, 3] as vec3 },
    ];
    const basis = planeBasisFor(ordered.map((c) => c.position));
    if (basis === null) throw new Error('fit failed');
    const { marks, labels } = resliceMarks(ordered, basis);
    const last = labels[labels.length - 1]!;
    const inPlane = Math.hypot(
      marks[3]!.mm.along - marks[2]!.mm.along,
      marks[3]!.mm.across - marks[2]!.mm.across
    );
    expect(last.distanceMm).toBeCloseTo(5, 6); // sqrt(4^2 + 3^2)
    expect(last.distanceMm).toBeGreaterThan(inPlane);
  });
});
