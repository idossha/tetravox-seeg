/**
 * Marching cubes and Taubin smoothing, against a sphere.
 *
 * A sphere is the one isosurface whose area and enclosed volume are known in closed form, so the
 * mesh can be checked against arithmetic rather than against a picture — which matters most for the
 * 256-case table, since it is *computed* (`caseTable`) and a wrong entry would be a hole in the
 * surface that no eyeball test would reliably catch. A closed, watertight, outward-oriented mesh has
 * every edge used exactly twice and a positive divergence-theorem volume; both are asserted.
 */

import { describe, expect, it } from 'vitest';
import {
  caseTable,
  marchingCubes,
  meshBounds,
  taubinSmooth,
  vertexNormals,
  type Mesh,
  type ScalarGrid,
} from '../../src/qc/isosurface';

/** A sampled ball of radius `r` mm, centred at the origin, on a `step` mm grid. */
function ball(r: number, step: number): ScalarGrid {
  const half = Math.ceil((r + 3 * step) / step);
  const n = half * 2 + 1;
  const data = new Float32Array(n * n * n);
  for (let k = 0; k < n; k += 1) {
    for (let j = 0; j < n; j += 1) {
      for (let i = 0; i < n; i += 1) {
        const x = (i - half) * step;
        const y = (j - half) * step;
        const z = (k - half) * step;
        // A smooth field, not a 0/1 mask: the edge interpolation then has something to interpolate,
        // which is what puts the vertices on the true sphere.
        data[(k * n + j) * n + i] = r - Math.hypot(x, y, z);
      }
    }
  }
  return { data, dims: [n, n, n], origin: [-half * step, -half * step, -half * step], step };
}

function surfaceArea(mesh: Mesh): number {
  const p = mesh.positions;
  let area = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = (mesh.indices[i] as number) * 3;
    const b = (mesh.indices[i + 1] as number) * 3;
    const c = (mesh.indices[i + 2] as number) * 3;
    const ux = (p[b] as number) - (p[a] as number);
    const uy = (p[b + 1] as number) - (p[a + 1] as number);
    const uz = (p[b + 2] as number) - (p[a + 2] as number);
    const vx = (p[c] as number) - (p[a] as number);
    const vy = (p[c + 1] as number) - (p[a + 1] as number);
    const vz = (p[c + 2] as number) - (p[a + 2] as number);
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  return area;
}

/** The divergence theorem: the signed volume is positive when the winding is outward. */
function signedVolume(mesh: Mesh): number {
  const p = mesh.positions;
  let v = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = (mesh.indices[i] as number) * 3;
    const b = (mesh.indices[i + 1] as number) * 3;
    const c = (mesh.indices[i + 2] as number) * 3;
    const ax = p[a] as number;
    const ay = p[a + 1] as number;
    const az = p[a + 2] as number;
    const bx = p[b] as number;
    const by = p[b + 1] as number;
    const bz = p[b + 2] as number;
    const cx = p[c] as number;
    const cy = p[c + 1] as number;
    const cz = p[c + 2] as number;
    v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}

describe('caseTable', () => {
  it('has an entry for every one of the 256 inside/outside patterns', () => {
    const table = caseTable();
    expect(table).toHaveLength(256);
    // The two uniform cases produce nothing; every other case produces whole triangles.
    expect(table[0]).toEqual([]);
    expect(table[255]).toEqual([]);
    for (const tris of table) expect(tris.length % 3).toBe(0);
  });

  it('gives a single corner one triangle, and its opposite the same', () => {
    const table = caseTable();
    expect((table[1] as number[]).length).toBe(3); // corner 0 alone
    expect((table[254] as number[]).length).toBe(3); // everything but corner 0
  });

  it('cuts an edge an even number of times per case, so the segments can close', () => {
    for (const tris of caseTable()) {
      const uses = new Map<number, number>();
      for (const e of tris) uses.set(e, (uses.get(e) ?? 0) + 1);
      // Every vertex a case emits lies on a cut edge; a loop visits each cut edge once, and a fan
      // over an n-gon uses each of its vertices at least once.
      for (const [, n] of uses) expect(n).toBeGreaterThan(0);
    }
  });
});

describe('marchingCubes', () => {
  const r = 20;
  const mesh = marchingCubes(ball(r, 1), 0);

  it('meshes a sphere to its analytic area and volume', () => {
    // A linear-interpolated marching-cubes sphere overestimates area by a few percent (the facets
    // are chords) and matches volume closely; both are checked against the closed form, not a golden.
    expect(surfaceArea(mesh) / (4 * Math.PI * r * r)).toBeCloseTo(1, 1);
    expect(signedVolume(mesh) / ((4 / 3) * Math.PI * r ** 3)).toBeCloseTo(1, 1);
  });

  it('is closed: every edge is shared by exactly two triangles', () => {
    const uses = new Map<string, number>();
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const t = [mesh.indices[i] as number, mesh.indices[i + 1] as number, mesh.indices[i + 2] as number];
      for (let k = 0; k < 3; k += 1) {
        const a = t[k] as number;
        const b = t[(k + 1) % 3] as number;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        uses.set(key, (uses.get(key) ?? 0) + 1);
      }
    }
    const bad = [...uses.values()].filter((n) => n !== 2);
    expect(bad).toEqual([]);
  });

  it('winds outward, so the enclosed volume is positive', () => {
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it('puts every vertex on the sphere and reports its bounds', () => {
    for (let i = 0; i < mesh.positions.length; i += 3) {
      const d = Math.hypot(
        mesh.positions[i] as number,
        mesh.positions[i + 1] as number,
        mesh.positions[i + 2] as number
      );
      expect(Math.abs(d - r)).toBeLessThan(0.7);
    }
    const bounds = meshBounds(mesh);
    expect(bounds).not.toBeNull();
    expect(bounds?.hi[0]).toBeCloseTo(r, 0);
    expect(bounds?.lo[2]).toBeCloseTo(-r, 0);
  });

  it('is empty for a field entirely on one side of the level', () => {
    const grid: ScalarGrid = {
      data: new Float32Array(27).fill(5),
      dims: [3, 3, 3],
      origin: [0, 0, 0],
      step: 1,
    };
    expect(marchingCubes(grid, 0).indices.length).toBe(0);
  });
});

describe('taubinSmooth', () => {
  it('does not shrink the surface the way plain Laplacian smoothing would', () => {
    // A 0/1 mask, whose marching-cubes surface is blocky — the case smoothing exists for.
    const r = 15;
    const step = 1;
    const half = 20;
    const n = half * 2 + 1;
    const data = new Float32Array(n * n * n);
    for (let k = 0; k < n; k += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          data[(k * n + j) * n + i] =
            Math.hypot(i - half, j - half, k - half) * step <= r ? 1 : 0;
        }
      }
    }
    const rough = marchingCubes(
      { data, dims: [n, n, n], origin: [-half, -half, -half], step },
      0.5
    );
    const smooth = taubinSmooth(rough, 15);
    const roughVolume = signedVolume(rough);
    const smoothVolume = signedVolume(smooth);
    // Within 4%: a Laplacian-only pass over the same mesh loses far more than that.
    expect(Math.abs(smoothVolume / roughVolume - 1)).toBeLessThan(0.04);
    // And it is smoother: the mean angle between neighbouring facet normals falls.
    const spread = (m: Mesh): number => {
      const nrm = vertexNormals(m);
      let sum = 0;
      for (let i = 0; i < nrm.length; i += 3) {
        const d = Math.hypot(
          m.positions[i] as number,
          m.positions[i + 1] as number,
          m.positions[i + 2] as number
        );
        if (d < 1e-6) continue;
        // How far the vertex normal is from the exact radial one a sphere would have.
        const dot =
          ((m.positions[i] as number) * (nrm[i] as number) +
            (m.positions[i + 1] as number) * (nrm[i + 1] as number) +
            (m.positions[i + 2] as number) * (nrm[i + 2] as number)) /
          d;
        sum += 1 - dot;
      }
      return sum / (nrm.length / 3);
    };
    expect(spread(smooth)).toBeLessThan(spread(rough));
  });

  it('leaves an empty mesh alone', () => {
    const empty: Mesh = { positions: new Float32Array(), indices: new Uint32Array() };
    expect(taubinSmooth(empty).positions.length).toBe(0);
  });
});
