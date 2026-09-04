/**
 * The 3-D implant figure — seegprep's `implant_3d` (`reports/figures.py`), rendered here rather than
 * screenshotted.
 *
 * **Why it is no longer a screenshot.** Up to 0.2.1 this figure was four `capture.screenshot` calls
 * around `capture.setView`, so it showed *the app's* 3-D view — its background, its lighting, its
 * contact glyphs, its slice planes. That can never be 1:1 with a pyvista glass brain, which is what
 * the owner asked for, so the screenshot path is gone. The figure is drawn from geometry: a
 * translucent brain built from a coarse mask sampled out of the open volume, and every electrode as
 * a coloured tube with sphere contacts, under an orthographic camera per view.
 *
 * **The renderer.** seegprep uses VTK: marching cubes, Taubin smoothing, three-light shading,
 * per-fragment depth. All four are here — `qc/isosurface.ts` builds and smooths the surface and this
 * file rasterises it as back-to-front translucent triangles, so gyri and the overlapping hemispheres
 * read as they do in the reference. The remaining differences are the mask's own resolution
 * ({@link BRAIN_STEP_MM}) and the painter's-algorithm ordering, which is per triangle rather than
 * per fragment.
 *
 * Everything a number can fix is seegprep's: {@link IMPLANT_PALETTE}, the brain colour and opacity,
 * the tube and contact radii, the four view directions, `zoom = 1.4`, the 2×2 grid, the capitalised
 * view titles, the bottom-centre legend and the suptitle text.
 */

import type { vec3 } from '@tetravox/module-sdk';
import { type Ctx2D } from './mpl';
import { meshBounds, type Mesh } from './isosurface';

/**
 * `_IMPLANT_PALETTE`, copied verbatim from `seegprep/reports/style.py`'s neighbour in
 * `reports/figures.py`. Not Okabe-Ito — those eight hues are too few and too muted to separate a
 * dozen dense shafts. `test/qc/implant3d.test.ts` pins these twelve strings.
 */
export const IMPLANT_PALETTE = [
  '#e6194B',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9A6324',
  '#808000',
  '#469990',
  '#000075',
  '#a9a9a9',
] as const;

/** The four views `implant_3d` renders, in the order it tiles them into the 2×2 grid. */
export const IMPLANT3D_VIEWS = ['superior', 'left', 'right', 'anterior'] as const;
export type Implant3dView = (typeof IMPLANT3D_VIEWS)[number];

/** `pv.Sphere(radius=contact_radius_mm)` — one sphere per localized contact. */
export const CONTACT_RADIUS_MM = 1.3;
/** `pv.Spline(...).tube(radius=0.45)` — the shaft between the contacts. */
export const TUBE_RADIUS_MM = 0.45;
/** `add_mesh(brain, color="#cfd2da", opacity=0.14)`. */
export const BRAIN_COLOR: [number, number, number] = [0xcf, 0xd2, 0xda];
export const BRAIN_OPACITY = 0.14;
/** `pl.camera.zoom(1.4)` after `reset_camera`. */
export const ZOOM = 1.4;
/**
 * How finely the brain mask is sampled for the isosurface, in millimetres.
 *
 * 1.4 mm over a brain-sized box is ~1.5 M points, inside `sampleVolume`'s 2 M cap, and gives the
 * marching cubes enough grid to carry gyri; `buildBrainMask` finds that box with a coarse first pass
 * rather than sampling the padded one.
 */
export const BRAIN_STEP_MM = 1.4;

/**
 * A view's screen basis in RAS millimetres: `right` runs left-to-right across the panel, `up` runs
 * bottom-to-top, and `forward` points **away from the camera**, so a larger dot product with
 * `forward` is farther away.
 *
 * These are pyvista's `camera_position` presets as `implant_3d` sets them: `"xy"` for superior,
 * `"yz"` (± an azimuth of 180°) for right/left, `"xz"` for anterior. RAS *is* the anatomical frame
 * (x = R, y = A, z = S), so the presets are anatomically correct for any input orientation once the
 * vertices are recentred — which is exactly the note seegprep's own code carries.
 */
export const VIEW_BASIS: Record<Implant3dView, { right: vec3; up: vec3; forward: vec3 }> = {
  superior: { right: [1, 0, 0], up: [0, 1, 0], forward: [0, 0, -1] },
  left: { right: [0, -1, 0], up: [0, 0, 1], forward: [1, 0, 0] },
  right: { right: [0, 1, 0], up: [0, 0, 1], forward: [-1, 0, 0] },
  anterior: { right: [1, 0, 0], up: [0, 0, 1], forward: [0, 1, 0] },
};

export interface LegendEntry {
  name: string;
  color: string;
}

/** One lead: its label, its palette colour and its contacts, already recentred. */
export interface Lead {
  label: string;
  color: string;
  points: vec3[];
}

/** A coarse brain occupancy grid in world millimetres — the stand-in for the marching-cubes mesh. */
export interface BrainMask {
  /** World position of voxel `(0,0,0)`. */
  origin: vec3;
  /** Isotropic sample step, millimetres. */
  step: number;
  dims: [number, number, number];
  /** One byte per sample, non-zero inside the brain. */
  data: Uint8Array;
}

/** The legend entries `implant_3d` puts at the bottom centre: one per lead, in palette order. */
export function legendOf(leads: readonly Lead[]): LegendEntry[] {
  return leads.map((lead) => ({ name: lead.label, color: lead.color }));
}

/** `_IMPLANT_PALETTE[i % len]` — the colour of the `i`-th lead. */
export function paletteColor(index: number): string {
  return IMPLANT_PALETTE[index % IMPLANT_PALETTE.length] as string;
}

/**
 * Otsu's threshold over a 256-bin histogram of the finite samples.
 *
 * Used only when no tissue label map is open: without labels there is no "brain" to select, and the
 * T1's bimodal background/tissue split is the one threshold that needs no tuning per subject.
 * Returns `null` when nothing is finite.
 */
export function otsuThreshold(values: ArrayLike<number>): number | null {
  let lo = Infinity;
  let hi = -Infinity;
  let count = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    count += 1;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (count === 0 || !(hi > lo)) return null;
  const bins = 256;
  const hist = new Float64Array(bins);
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (!Number.isFinite(v)) continue;
    const b = Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins));
    hist[b] = (hist[b] as number) + 1;
  }
  let total = 0;
  let sum = 0;
  for (let b = 0; b < bins; b += 1) {
    total += hist[b] as number;
    sum += b * (hist[b] as number);
  }
  let wB = 0;
  let sumB = 0;
  let best = 0;
  let bestVar = -1;
  for (let b = 0; b < bins; b += 1) {
    wB += hist[b] as number;
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * (hist[b] as number);
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = b;
    }
  }
  return lo + ((best + 0.5) / bins) * (hi - lo);
}

/** A `#rrggbb` string as an RGB triple, 0..255. */
export function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

interface Camera {
  basis: { right: vec3; up: vec3; forward: vec3 };
  /** World millimetres per screen pixel — orthographic, so it is one number. */
  mmPerPx: number;
  center: vec3;
  width: number;
  height: number;
}

function dot(a: vec3, b: vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub(a: vec3, b: vec3): vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/**
 * `reset_camera` then `camera.zoom(1.4)` for an orthographic camera.
 *
 * The fit is on the scene's **projected** extent, not on its 3-D bounding sphere: a sphere
 * circumscribing a head-sized box has a radius 1.7 times the head's, and fitting that left the brain
 * occupying a third of the panel with white all around it — nothing like the reference figure.
 */
export function fitCamera(
  points: readonly vec3[],
  view: Implant3dView,
  width: number,
  height: number,
  zoom = ZOOM
): Camera {
  const basis = VIEW_BASIS[view];
  // The **bounds** centre and half-diagonal, which is what `vtkRenderer::ResetCamera` uses — not the
  // centroid of the points. With a centroid, a hundred contacts clustered in one lobe drag the focal
  // point off the brain's middle and inflate the radius, which framed the brain 30% small and
  // off-centre in exactly the two views the implant is densest in.
  if (points.length === 0) {
    return { basis, center: [0, 0, 0], mmPerPx: 1 / zoom, width, height };
  }
  const lo: vec3 = [Infinity, Infinity, Infinity];
  const hi: vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let c = 0; c < 3; c += 1) {
      if ((p[c] as number) < (lo[c] as number)) lo[c] = p[c] as number;
      if ((p[c] as number) > (hi[c] as number)) hi[c] = p[c] as number;
    }
  }
  const center: vec3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  const radius = Math.max(
    1,
    Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 2
  );
  // Fitted to the shorter viewport dimension, then magnified by `camera.zoom(1.4)`.
  const mmPerPx = (2 * radius) / Math.min(width, height) / zoom;
  return { basis, center, mmPerPx, width, height };
}

/** World point to screen pixel plus a depth (larger = farther from the camera). */
export function project(cam: Camera, p: vec3): { x: number; y: number; z: number } {
  const d = sub(p, cam.center);
  return {
    x: cam.width / 2 + dot(d, cam.basis.right) / cam.mmPerPx,
    y: cam.height / 2 - dot(d, cam.basis.up) / cam.mmPerPx,
    z: dot(d, cam.basis.forward),
  };
}

/**
 * `lighting="three lights"`: a key light over the camera's shoulder plus two fills, combined with
 * the ambient term VTK's default property carries. `n` is the surface normal in camera space
 * (`+z` toward the camera).
 */
function threeLightShade(nx: number, ny: number, nz: number, specular: number): number {
  const lights: [number, number, number, number][] = [
    // direction (camera space) and intensity — VTK's key / fill / back triad.
    [0.35, 0.35, 0.87, 1.0],
    [-0.6, 0.1, 0.79, 0.45],
    [0.1, -0.6, 0.79, 0.45],
  ];
  let diffuse = 0;
  let spec = 0;
  let total = 0;
  for (const [lx, ly, lz, intensity] of lights) {
    total += intensity;
    const nl = nx * lx + ny * ly + nz * lz;
    if (nl <= 0) continue;
    diffuse += intensity * nl;
    // Blinn-Phong against a view vector of (0, 0, 1): the half vector is the light plus the eye.
    const hx = lx;
    const hy = ly;
    const hz = lz + 1;
    const hl = Math.hypot(hx, hy, hz) || 1;
    const nh = Math.max(0, (nx * hx + ny * hy + nz * hz) / hl);
    spec += intensity * specular * nh ** 20;
  }
  // Normalised by the lights' total intensity so a fully-lit facet reads as its own colour rather
  // than as white: three unnormalised lights blew the pale brain grey straight to 255.
  return Math.min(1.25, 0.28 + 0.72 * (diffuse / total) + spec);
}

/** A panel's pixel buffers: colour over white, plus the opaque geometry's depth. */
interface Panel {
  width: number;
  height: number;
  rgb: Float32Array;
  depth: Float32Array;
}

function newPanel(width: number, height: number): Panel {
  const rgb = new Float32Array(width * height * 3).fill(255);
  const depth = new Float32Array(width * height).fill(Infinity);
  return { width, height, rgb, depth };
}

/** A shaded sphere, z-buffered — the analytic form, since a contact is a perfect sphere. */
function drawSphere(panel: Panel, cam: Camera, center: vec3, radiusMm: number, rgb: [number, number, number]): void {
  const c = project(cam, center);
  const r = radiusMm / cam.mmPerPx;
  const x0 = Math.max(0, Math.floor(c.x - r));
  const x1 = Math.min(panel.width - 1, Math.ceil(c.x + r));
  const y0 = Math.max(0, Math.floor(c.y - r));
  const y1 = Math.min(panel.height - 1, Math.ceil(c.y + r));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const dx = (x + 0.5 - c.x) / r;
      const dy = (y + 0.5 - c.y) / r;
      const rr = dx * dx + dy * dy;
      if (rr > 1) continue;
      const nz = Math.sqrt(1 - rr);
      const z = c.z - nz * radiusMm;
      const i = y * panel.width + x;
      if (z >= (panel.depth[i] as number)) continue;
      panel.depth[i] = z;
      const shade = threeLightShade(dx, -dy, nz, 0.5);
      panel.rgb[i * 3] = Math.min(255, rgb[0] * shade);
      panel.rgb[i * 3 + 1] = Math.min(255, rgb[1] * shade);
      panel.rgb[i * 3 + 2] = Math.min(255, rgb[2] * shade);
    }
  }
}

/** A shaded cylinder between two contacts — `pv.Spline(...).tube(radius=0.45)`, segment by segment. */
function drawTube(panel: Panel, cam: Camera, a: vec3, b: vec3, radiusMm: number, rgb: [number, number, number]): void {
  const pa = project(cam, a);
  const pb = project(cam, b);
  const r = radiusMm / cam.mmPerPx;
  const dx = pb.x - pa.x;
  const dy = pb.y - pa.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const ux = dx / len;
  const uy = dy / len;
  const x0 = Math.max(0, Math.floor(Math.min(pa.x, pb.x) - r - 1));
  const x1 = Math.min(panel.width - 1, Math.ceil(Math.max(pa.x, pb.x) + r + 1));
  const y0 = Math.max(0, Math.floor(Math.min(pa.y, pb.y) - r - 1));
  const y1 = Math.min(panel.height - 1, Math.ceil(Math.max(pa.y, pb.y) + r + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const px = x + 0.5 - pa.x;
      const py = y + 0.5 - pa.y;
      const t = (px * ux + py * uy) / len;
      if (t < 0 || t > 1) continue;
      const perp = px * -uy + py * ux;
      const s = perp / r;
      if (Math.abs(s) > 1) continue;
      const nz = Math.sqrt(1 - s * s);
      const z = pa.z + t * (pb.z - pa.z) - nz * radiusMm;
      const i = y * panel.width + x;
      if (z >= (panel.depth[i] as number)) continue;
      panel.depth[i] = z;
      // The cylinder's normal is the in-plane perpendicular tilted out of the screen by `nz`.
      const shade = threeLightShade(-uy * s, ux * s * -1, nz, 0.3);
      panel.rgb[i * 3] = Math.min(255, rgb[0] * shade);
      panel.rgb[i * 3 + 1] = Math.min(255, rgb[1] * shade);
      panel.rgb[i * 3 + 2] = Math.min(255, rgb[2] * shade);
    }
  }
}

/**
 * The brain, rasterised as translucent triangles, back to front.
 *
 * This is what a point splat could not do. Each triangle is filled at {@link BRAIN_OPACITY} with
 * smooth three-light shading from interpolated vertex normals, and because the far surface is drawn
 * first, the near one composites *over* it: the two hemispheres overlap into a denser grey, sulci
 * read as darker creases, and gyri stand out — the look of the reference figure.
 *
 * Sorting is by the triangle centroid's depth. That is the standard painter's-algorithm
 * approximation and it is wrong for interpenetrating triangles; an isosurface has none, so the only
 * artefacts are at near-coincident facets, where the two orderings differ by less than the
 * per-triangle alpha.
 */
function drawMeshTranslucent(
  panel: Panel,
  cam: Camera,
  mesh: Mesh,
  normals: Float32Array,
  rgb: [number, number, number],
  alpha: number
): void {
  const tri = mesh.indices;
  const count = tri.length / 3;
  if (count === 0) return;
  const p = mesh.positions;
  // Project every vertex once; the rasteriser then works in screen space.
  const n = p.length / 3;
  const sx = new Float32Array(n);
  const sy = new Float32Array(n);
  const sz = new Float32Array(n);
  for (let v = 0; v < n; v += 1) {
    const q = project(cam, [p[v * 3] as number, p[v * 3 + 1] as number, p[v * 3 + 2] as number]);
    sx[v] = q.x;
    sy[v] = q.y;
    sz[v] = q.z;
  }
  // Shade per vertex, in camera space: `right`/`up`/`-forward` is the camera basis, and `-forward`
  // points at the viewer.
  const shade = new Float32Array(n);
  const b = cam.basis;
  for (let v = 0; v < n; v += 1) {
    const nx = normals[v * 3] as number;
    const ny = normals[v * 3 + 1] as number;
    const nz = normals[v * 3 + 2] as number;
    const cx = nx * b.right[0] + ny * b.right[1] + nz * b.right[2];
    const cy = nx * b.up[0] + ny * b.up[1] + nz * b.up[2];
    const cz = -(nx * b.forward[0] + ny * b.forward[1] + nz * b.forward[2]);
    // A translucent shell is lit from both sides — a back-facing facet still scatters light — so the
    // normal is folded toward the viewer rather than being culled.
    shade[v] = threeLightShade(cx, cy, Math.abs(cz), 0.15);
  }

  const order = new Uint32Array(count);
  const depth = new Float32Array(count);
  for (let t = 0; t < count; t += 1) {
    order[t] = t;
    depth[t] =
      ((sz[tri[t * 3] as number] as number) +
        (sz[tri[t * 3 + 1] as number] as number) +
        (sz[tri[t * 3 + 2] as number] as number)) /
      3;
  }
  // Far first: a larger depth is farther from the camera (see `project`).
  const sorted = Array.from(order).sort((a, c) => (depth[c] as number) - (depth[a] as number));

  for (const t of sorted) {
    const i0 = tri[t * 3] as number;
    const i1 = tri[t * 3 + 1] as number;
    const i2 = tri[t * 3 + 2] as number;
    const x0 = sx[i0] as number;
    const y0 = sy[i0] as number;
    const x1 = sx[i1] as number;
    const y1 = sy[i1] as number;
    const x2 = sx[i2] as number;
    const y2 = sy[i2] as number;
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) continue;
    const inv = 1 / area;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const maxX = Math.min(panel.width - 1, Math.ceil(Math.max(x0, x1, x2)));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const maxY = Math.min(panel.height - 1, Math.ceil(Math.max(y0, y1, y2)));
    if (minX > maxX || minY > maxY) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        // Barycentric coordinates; the same sign test on all three admits either winding, which the
        // fold-toward-viewer shading above makes correct for a two-sided shell.
        const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * inv;
        const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * inv;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const idx = y * panel.width + x;
        const s =
          w0 * (shade[i0] as number) + w1 * (shade[i1] as number) + w2 * (shade[i2] as number);
        for (let c = 0; c < 3; c += 1) {
          const at = idx * 3 + c;
          const lit = Math.min(255, (rgb[c] as number) * s);
          panel.rgb[at] = (panel.rgb[at] as number) * (1 - alpha) + lit * alpha;
        }
      }
    }
  }
}

/**
 * One view, rendered into an RGBA buffer over white.
 *
 * The brain is drawn first and the leads over it, so a lead reads at its own colour rather than
 * dimmed through the glass — which is how the reference figure reads, and the opposite of what a
 * physically-ordered composite would give.
 */
export function renderImplantView(
  view: Implant3dView,
  leads: readonly Lead[],
  brain: { mesh: Mesh; normals: Float32Array } | null,
  width: number,
  height: number
): Uint8ClampedArray {
  const all: vec3[] = [];
  for (const lead of leads) all.push(...lead.points);
  if (brain !== null) {
    const bounds = meshBounds(brain.mesh);
    if (bounds !== null) {
      // VTK's `ResetCamera` frames the **bounds**, so the camera is fitted to their eight corners
      // and then magnified by `zoom`. Nothing is calibrated against a reference image any more.
      for (const x of [bounds.lo[0], bounds.hi[0]]) {
        for (const y of [bounds.lo[1], bounds.hi[1]]) {
          for (const z of [bounds.lo[2], bounds.hi[2]]) all.push([x, y, z]);
        }
      }
    }
  }
  const cam = fitCamera(all, view, width, height);
  const panel = newPanel(width, height);
  if (brain !== null) {
    drawMeshTranslucent(panel, cam, brain.mesh, brain.normals, BRAIN_COLOR, BRAIN_OPACITY);
  }
  for (const lead of leads) {
    const rgb = hexRgb(lead.color);
    for (let i = 1; i < lead.points.length; i += 1) {
      drawTube(panel, cam, lead.points[i - 1]!, lead.points[i]!, TUBE_RADIUS_MM, rgb);
    }
    for (const p of lead.points) drawSphere(panel, cam, p, CONTACT_RADIUS_MM, rgb);
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    out[i * 4] = panel.rgb[i * 3] as number;
    out[i * 4 + 1] = panel.rgb[i * 3 + 1] as number;
    out[i * 4 + 2] = panel.rgb[i * 3 + 2] as number;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * `fig.legend(loc="lower center", ncol=6, fontsize=9, frameon=False)` — round markers with the
 * lead's label beside each, laid out in rows of at most six and centred on the figure.
 */
export function drawImplantLegend(
  ctx: Ctx2D,
  entries: readonly LegendEntry[],
  figureWidthPx: number,
  bottomPx: number,
  opts: { fontPx: number; measure(text: string): number }
): void {
  if (entries.length === 0) return;
  const ncol = 6;
  const rows = Math.ceil(entries.length / ncol);
  const rowHeight = opts.fontPx * 2.4;
  const markerRadius = opts.fontPx * 0.42;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  // matplotlib's legend lays its columns on a **common pitch** — every column is as wide as the
  // widest entry in it — so the labels line up down the two rows. Sizing each cell to its own text
  // (what this did) made the reference's tidy grid read as a ragged run of words.
  const cellWidth: number[] = [];
  for (let c = 0; c < ncol; c += 1) {
    let widest = 0;
    for (let row = 0; row < rows; row += 1) {
      const entry = entries[row * ncol + c];
      if (entry !== undefined) widest = Math.max(widest, opts.measure(entry.name));
    }
    cellWidth.push(widest === 0 ? 0 : markerRadius * 2 + opts.fontPx * 0.8 + widest + opts.fontPx * 2.2);
  }
  const total = cellWidth.reduce((a, b) => a + b, 0);
  const left = (figureWidthPx - total) / 2;
  for (let row = 0; row < rows; row += 1) {
    const y = bottomPx - (rows - row - 0.5) * rowHeight;
    let x = left;
    for (let c = 0; c < ncol; c += 1) {
      const entry = entries[row * ncol + c];
      if (entry !== undefined) {
        ctx.fillStyle = entry.color;
        ctx.beginPath();
        ctx.arc(x + markerRadius, y, markerRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.fillText(entry.name, x + markerRadius * 2 + opts.fontPx * 0.8, y);
      }
      x += cellWidth[c] as number;
    }
  }
  ctx.restore();
}

/** `f"sEEG implant — {n} depth electrodes, {m} contacts"`, seegprep's own default title. */
export function implantSuptitle(leads: readonly Lead[]): string {
  const contacts = leads.reduce((sum, lead) => sum + lead.points.length, 0);
  return `sEEG implant — ${leads.length} depth electrodes, ${contacts} contacts`;
}
