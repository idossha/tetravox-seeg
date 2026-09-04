/**
 * Marching cubes and Taubin smoothing — the glass brain's surface, from a mask.
 *
 * seegprep builds its brain with `skimage.measure.marching_cubes` and then
 * `smooth_taubin(n_iter=30, pass_band=0.05).decimate(0.6)`. A module bundle may import nothing, so
 * both are here. The output is what `qc/implant3d.ts` rasterises as translucent triangles, which is
 * what makes gyri and the two overlapping hemispheres read the way they do in the reference figure —
 * a point splat could only ever produce a silhouette.
 *
 * **The 256-case table is computed, not typed.** The usual `triTable` is 256 rows of hand-copied
 * integers, and a single wrong entry is a hole in the surface that no test would obviously catch.
 * {@link caseTable} derives the same table from the cube's own topology: on each of the six faces,
 * walked anticlockwise as seen from outside, a corner pair that straddles the isolevel is a crossing;
 * the crossings pair up into directed segments (inside→outside, then the next outside→inside), and
 * chaining those segments across shared edges closes the loops the surface makes through the cell.
 * Each loop is fanned into triangles. That also fixes the ambiguous cases deterministically — the
 * anticlockwise pairing is the choice — and it is checkable: `test/qc/isosurface.test.ts` meshes a
 * sphere and compares its area and enclosed volume with the analytic ones.
 */

/** Corner offsets, in the standard marching-cubes numbering. */
const CORNERS: readonly [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

/** Edge `e` joins `EDGES[e][0]` and `EDGES[e][1]`, in the standard numbering. */
const EDGES: readonly [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [4, 5],
  [5, 6],
  [6, 7],
  [7, 4],
  [0, 4],
  [1, 5],
  [2, 6],
  [3, 7],
];

/**
 * The six faces, each as its four corners walked **anticlockwise seen from outside the cube**.
 *
 * The orientation is what makes the generated triangles face outward, so a lit surface is lit on the
 * side you can see.
 */
const FACES: readonly (readonly number[])[] = [
  [0, 3, 2, 1], // z = 0, outward -z
  [4, 5, 6, 7], // z = 1, outward +z
  [0, 1, 5, 4], // y = 0, outward -y
  [3, 7, 6, 2], // y = 1, outward +y
  [0, 4, 7, 3], // x = 0, outward -x
  [1, 2, 6, 5], // x = 1, outward +x
];

function edgeBetween(a: number, b: number): number {
  for (let e = 0; e < EDGES.length; e += 1) {
    const [p, q] = EDGES[e] as [number, number];
    if ((p === a && q === b) || (p === b && q === a)) return e;
  }
  throw new Error(`no cube edge joins corners ${a} and ${b}`);
}

/**
 * The marching-cubes case table: for each of the 256 inside/outside patterns, the edges each
 * triangle's three vertices lie on.
 *
 * Bit `i` of the case index is set when corner `i` is **inside** (at or above the isolevel).
 */
export function caseTable(): number[][] {
  const table: number[][] = [];
  for (let code = 0; code < 256; code += 1) {
    const inside = (c: number): boolean => (code & (1 << c)) !== 0;
    // One directed segment per face crossing: it leaves at the edge where the walk goes
    // inside → outside and arrives at the next edge where it goes outside → inside.
    const next = new Map<number, number>();
    for (const face of FACES) {
      const exits: number[] = [];
      const entries: number[] = [];
      for (let i = 0; i < face.length; i += 1) {
        const a = face[i] as number;
        const b = face[(i + 1) % face.length] as number;
        if (inside(a) === inside(b)) continue;
        (inside(a) ? exits : entries).push(edgeBetween(a, b));
      }
      // Walking anticlockwise, every exit is followed by exactly one entry; pairing them in that
      // order is the deterministic resolution of the ambiguous four-crossing faces.
      for (let i = 0; i < exits.length; i += 1) {
        next.set(exits[i] as number, entries[i] as number);
      }
    }
    const triangles: number[] = [];
    const seen = new Set<number>();
    for (const start of next.keys()) {
      if (seen.has(start)) continue;
      const loop: number[] = [];
      let at: number | undefined = start;
      while (at !== undefined && !seen.has(at)) {
        seen.add(at);
        loop.push(at);
        at = next.get(at);
      }
      // Fanned with the loop reversed: chaining exit → entry traces the contour with the *inside*
      // on the left as seen from outside the cube, which winds the fan inward. The sphere test
      // (a positive divergence-theorem volume) is what pins this.
      for (let i = 1; i + 1 < loop.length; i += 1) {
        triangles.push(loop[0] as number, loop[i + 1] as number, loop[i] as number);
      }
    }
    table.push(triangles);
  }
  return table;
}

const TABLE = caseTable();

/** A triangle mesh in world millimetres. */
export interface Mesh {
  /** `xyz` per vertex. */
  positions: Float32Array;
  /** Three vertex indices per triangle. */
  indices: Uint32Array;
}

/** A scalar field on a regular grid, with its world placement. */
export interface ScalarGrid {
  data: ArrayLike<number>;
  dims: [number, number, number];
  origin: [number, number, number];
  step: number;
}

/**
 * The isosurface of `grid` at `level`, by marching cubes.
 *
 * Vertices are placed by linear interpolation along the cut edge and shared between the cells that
 * meet on it (keyed by the edge's own grid position), so the mesh is welded and smoothing has
 * something to smooth. A field that is a 0/1 mask puts every vertex at the edge midpoint, which is
 * the blocky surface Taubin smoothing then rounds off — the same two-step seegprep uses.
 */
export function marchingCubes(grid: ScalarGrid, level = 0.5): Mesh {
  const [nx, ny, nz] = grid.dims;
  const at = (x: number, y: number, z: number): number =>
    grid.data[(z * ny + y) * nx + x] as number;
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexAt = new Map<number, number>();

  const interpolate = (
    x: number,
    y: number,
    z: number,
    edge: number
  ): number => {
    const [ca, cb] = EDGES[edge] as [number, number];
    const oa = CORNERS[ca] as [number, number, number];
    const ob = CORNERS[cb] as [number, number, number];
    const ax = x + oa[0];
    const ay = y + oa[1];
    const az = z + oa[2];
    const bx = x + ob[0];
    const by = y + ob[1];
    const bz = z + ob[2];
    // The key is the pair of grid corners the vertex sits between, lowest first, so the two cells
    // sharing this edge produce one vertex rather than two coincident ones.
    const ia = (az * ny + ay) * nx + ax;
    const ib = (bz * ny + by) * nx + bx;
    const key = ia < ib ? ia * (nx * ny * nz) + ib : ib * (nx * ny * nz) + ia;
    const existing = vertexAt.get(key);
    if (existing !== undefined) return existing;
    const va = at(ax, ay, az);
    const vb = at(bx, by, bz);
    const t = vb === va ? 0.5 : Math.min(1, Math.max(0, (level - va) / (vb - va)));
    const index = positions.length / 3;
    positions.push(
      grid.origin[0] + (ax + t * (bx - ax)) * grid.step,
      grid.origin[1] + (ay + t * (by - ay)) * grid.step,
      grid.origin[2] + (az + t * (bz - az)) * grid.step
    );
    vertexAt.set(key, index);
    return index;
  };

  for (let z = 0; z + 1 < nz; z += 1) {
    for (let y = 0; y + 1 < ny; y += 1) {
      for (let x = 0; x + 1 < nx; x += 1) {
        let code = 0;
        for (let c = 0; c < 8; c += 1) {
          const o = CORNERS[c] as [number, number, number];
          if (at(x + o[0], y + o[1], z + o[2]) >= level) code |= 1 << c;
        }
        const tris = TABLE[code] as number[];
        for (let i = 0; i < tris.length; i += 1) {
          indices.push(interpolate(x, y, z, tris[i] as number));
        }
      }
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/**
 * Taubin's λ/μ smoothing — `pyvista`'s `smooth_taubin`.
 *
 * Two Laplacian passes per iteration, one with a positive weight and one with a slightly larger
 * negative weight, so the surface relaxes without the shrinkage plain Laplacian smoothing causes. A
 * shrunk brain would read as the wrong size in a figure whose whole point is where the leads sit
 * inside it.
 */
export function taubinSmooth(mesh: Mesh, iterations = 15, lambda = 0.5, mu = -0.53): Mesh {
  const n = mesh.positions.length / 3;
  if (n === 0) return mesh;
  // Neighbour lists, built once: a compressed adjacency, because a Map per vertex over a
  // 300 000-vertex brain is most of the run time.
  const degree = new Uint32Array(n);
  const tri = mesh.indices;
  for (let i = 0; i < tri.length; i += 3) {
    for (let k = 0; k < 3; k += 1) {
      const v = tri[i + k] as number;
      degree[v] = (degree[v] as number) + 2;
    }
  }
  const offset = new Uint32Array(n + 1);
  for (let v = 0; v < n; v += 1) offset[v + 1] = (offset[v] as number) + (degree[v] as number);
  const neighbours = new Uint32Array(offset[n] as number);
  const fill = new Uint32Array(n);
  const add = (a: number, b: number): void => {
    neighbours[(offset[a] as number) + (fill[a] as number)] = b;
    fill[a] = (fill[a] as number) + 1;
  };
  for (let i = 0; i < tri.length; i += 3) {
    const a = tri[i] as number;
    const b = tri[i + 1] as number;
    const c = tri[i + 2] as number;
    add(a, b);
    add(a, c);
    add(b, a);
    add(b, c);
    add(c, a);
    add(c, b);
  }

  let positions = new Float32Array(mesh.positions);
  const scratch = new Float32Array(positions.length);
  const pass = (weight: number): void => {
    for (let v = 0; v < n; v += 1) {
      const start = offset[v] as number;
      const end = offset[v + 1] as number;
      if (end === start) {
        for (let c = 0; c < 3; c += 1) scratch[v * 3 + c] = positions[v * 3 + c] as number;
        continue;
      }
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let k = start; k < end; k += 1) {
        const u = neighbours[k] as number;
        sx += positions[u * 3] as number;
        sy += positions[u * 3 + 1] as number;
        sz += positions[u * 3 + 2] as number;
      }
      const count = end - start;
      for (let c = 0; c < 3; c += 1) {
        const p = positions[v * 3 + c] as number;
        const mean = (c === 0 ? sx : c === 1 ? sy : sz) / count;
        scratch[v * 3 + c] = p + weight * (mean - p);
      }
    }
    positions = new Float32Array(scratch);
  };
  for (let i = 0; i < iterations; i += 1) {
    pass(lambda);
    pass(mu);
  }
  return { positions, indices: mesh.indices };
}

/** Area-weighted vertex normals, unit length — what gives the surface its smooth shading. */
export function vertexNormals(mesh: Mesh): Float32Array {
  const normals = new Float32Array(mesh.positions.length);
  const p = mesh.positions;
  const tri = mesh.indices;
  for (let i = 0; i < tri.length; i += 3) {
    const a = (tri[i] as number) * 3;
    const b = (tri[i + 1] as number) * 3;
    const c = (tri[i + 2] as number) * 3;
    const ux = (p[b] as number) - (p[a] as number);
    const uy = (p[b + 1] as number) - (p[a + 1] as number);
    const uz = (p[b + 2] as number) - (p[a + 2] as number);
    const vx = (p[c] as number) - (p[a] as number);
    const vy = (p[c + 1] as number) - (p[a + 1] as number);
    const vz = (p[c + 2] as number) - (p[a + 2] as number);
    // Not normalised: the cross product's length is twice the triangle's area, which is the weight.
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      normals[v] = (normals[v] as number) + nx;
      normals[v + 1] = (normals[v + 1] as number) + ny;
      normals[v + 2] = (normals[v + 2] as number) + nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const len = Math.hypot(normals[v] as number, normals[v + 1] as number, normals[v + 2] as number);
    if (len < 1e-12) continue;
    normals[v] = (normals[v] as number) / len;
    normals[v + 1] = (normals[v + 1] as number) / len;
    normals[v + 2] = (normals[v + 2] as number) / len;
  }
  return normals;
}

/** The mesh's axis-aligned bounds, `[lo, hi]`, or `null` for an empty mesh. */
export function meshBounds(
  mesh: Mesh
): { lo: [number, number, number]; hi: [number, number, number] } | null {
  if (mesh.positions.length === 0) return null;
  const lo: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.positions.length; i += 3) {
    for (let c = 0; c < 3; c += 1) {
      const v = mesh.positions[i + c] as number;
      if (v < (lo[c] as number)) lo[c] = v;
      if (v > (hi[c] as number)) hi[c] = v;
    }
  }
  return { lo, hi };
}
