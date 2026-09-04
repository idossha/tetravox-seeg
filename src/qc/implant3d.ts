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
 * per-fragment depth. This is a splat-and-depth-buffer stand-in — each brain voxel is projected to a
 * screen-space square, the front and back depths are kept per pixel, and the surface normal comes
 * from the gradient of that front-depth map. It reproduces the *look* (a soft grey translucent shell
 * with the leads showing through) and not the surface: a mask sampled at {@link BRAIN_STEP_MM} has
 * no gyral detail, and the silhouette is that of the mask, not of a smoothed isosurface.
 *
 * Everything a number can fix is seegprep's: {@link IMPLANT_PALETTE}, the brain colour and opacity,
 * the tube and contact radii, the four view directions, `zoom = 1.4`, the 2×2 grid, the capitalised
 * view titles, the bottom-centre legend and the suptitle text.
 */

import type { vec3 } from '@tetravox/module-sdk';
import { type Ctx2D } from './mpl';

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
 * How much wider than the fitted bounding sphere the panel actually is, measured off seegprep's own
 * `sub-P076_desc-implant3d_qc.png`: the brain spans ~55% of a panel's width there, and a plain
 * `bounding sphere / zoom` fit puts it at ~66%. The remainder is VTK's default view-angle padding
 * plus the pyvista window being imshow'd into a differently-shaped axes — neither of which this
 * renderer has. Calibrated against that file rather than derived, and named so.
 */
export const FIT_MARGIN = 1.1;
/** How coarsely the brain mask is sampled, in millimetres. See the header on what this costs. */
export const BRAIN_STEP_MM = 2.0;

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
  let center: vec3 = [0, 0, 0];
  if (points.length > 0) {
    for (const p of points) {
      center[0] += p[0];
      center[1] += p[1];
      center[2] += p[2];
    }
    center = [center[0] / points.length, center[1] / points.length, center[2] / points.length];
  }
  let radius = 1;
  for (const p of points) {
    const d = sub(p, center);
    radius = Math.max(radius, Math.hypot(d[0], d[1], d[2]));
  }
  // VTK's `reset_camera` fits the scene's bounding **sphere** to the shorter viewport dimension, and
  // `camera.zoom(1.4)` then magnifies by 1.4 — the sphere being wider than the projection is exactly
  // what leaves the brain filling the panel with a small margin, as in the reference figure.
  const mmPerPx = ((2 * radius) / Math.min(width, height) / zoom) * FIT_MARGIN;
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

/** A separable box blur over the finite entries of a depth map, in place. */
function blurDepth(depth: Float32Array, width: number, height: number, radius: number): void {
  const tmp = new Float32Array(depth.length);
  const pass = (src: Float32Array, dst: Float32Array, stride: number, count: number, runs: number): void => {
    for (let r = 0; r < runs; r += 1) {
      const base = r * (stride === 1 ? width : 1);
      for (let i = 0; i < count; i += 1) {
        const at = base + i * stride;
        if (!Number.isFinite(src[at] as number)) {
          dst[at] = src[at] as number;
          continue;
        }
        let sum = 0;
        let n = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const j = i + k;
          if (j < 0 || j >= count) continue;
          const v = src[base + j * stride] as number;
          if (Number.isFinite(v)) {
            sum += v;
            n += 1;
          }
        }
        dst[at] = n === 0 ? (src[at] as number) : sum / n;
      }
    }
  };
  pass(depth, tmp, 1, width, height);
  pass(tmp, depth, width, height, width);
}

/**
 * Splats the brain mask into a front-depth and back-depth buffer, then composites it as a
 * translucent shell over whatever the panel already holds.
 *
 * Two crossings of a `BRAIN_OPACITY` shell give `1 - (1 - a)²` of coverage, which is what a
 * translucent closed surface looks like in VTK; the front surface is shaded and the back is not, so
 * the silhouette reads as a volume rather than a flat wash. An electrode nearer than the front
 * surface is left alone — it is in front of the glass, not behind it.
 */
function compositeBrain(panel: Panel, cam: Camera, mask: BrainMask): void {
  const n = panel.width * panel.height;
  const front = new Float32Array(n).fill(Infinity);
  const back = new Float32Array(n).fill(-Infinity);
  const [nx, ny, nz] = mask.dims;
  const half = Math.max(1, Math.round(mask.step / cam.mmPerPx / 2));
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      const row = (k * ny + j) * nx;
      for (let i = 0; i < nx; i += 1) {
        if ((mask.data[row + i] as number) === 0) continue;
        const p: vec3 = [
          mask.origin[0] + i * mask.step,
          mask.origin[1] + j * mask.step,
          mask.origin[2] + k * mask.step,
        ];
        const s = project(cam, p);
        const cx = Math.round(s.x);
        const cy = Math.round(s.y);
        for (let y = cy - half; y <= cy + half; y += 1) {
          if (y < 0 || y >= panel.height) continue;
          for (let x = cx - half; x <= cx + half; x += 1) {
            if (x < 0 || x >= panel.width) continue;
            const idx = y * panel.width + x;
            if (s.z < (front[idx] as number)) front[idx] = s.z;
            if (s.z > (back[idx] as number)) back[idx] = s.z;
          }
        }
      }
    }
  }

  // Blur the front depths before the normals are taken. The splat quantises depth to the voxel step,
  // and the gradient of that terraced surface draws the mask's own sample grid across the brain as a
  // hatch of light and dark lines. The blur radius follows the splat, so the terraces disappear
  // while the silhouette does not move.
  blurDepth(front, panel.width, panel.height, Math.max(2, half * 2));
  blurDepth(front, panel.width, panel.height, Math.max(2, half));

  // A gyrified surface is crossed several times by a ray, not twice: `1 - (1 - a)^4` is what makes
  // the shell as visibly grey as the reference figure's rather than a whisper over white.
  const coverage = 1 - (1 - BRAIN_OPACITY) ** 4;
  for (let y = 0; y < panel.height; y += 1) {
    for (let x = 0; x < panel.width; x += 1) {
      const idx = y * panel.width + x;
      const zf = front[idx] as number;
      if (!Number.isFinite(zf)) continue;
      // The normal of the front-depth map: depth rises away from the camera, so the screen-space
      // gradient of `front` is the surface tilt, and the remainder points at the viewer.
      const zl = front[idx - (x > 0 ? 1 : 0)] as number;
      const zr = front[idx + (x < panel.width - 1 ? 1 : 0)] as number;
      const zu = front[idx - (y > 0 ? panel.width : 0)] as number;
      const zd = front[idx + (y < panel.height - 1 ? panel.width : 0)] as number;
      const gx = Number.isFinite(zl) && Number.isFinite(zr) ? (zr - zl) / (2 * cam.mmPerPx) : 0;
      const gy = Number.isFinite(zu) && Number.isFinite(zd) ? (zd - zu) / (2 * cam.mmPerPx) : 0;
      const inv = 1 / Math.hypot(gx, gy, 1);
      const shade = threeLightShade(-gx * inv, gy * inv, inv, 0.15);
      const alpha = coverage;
      const dz = panel.depth[idx] as number;
      // Only the part of the shell in front of the opaque geometry tints it.
      const a = dz < zf ? 0 : alpha;
      for (let c = 0; c < 3; c += 1) {
        const brain = Math.min(255, (BRAIN_COLOR[c] as number) * shade);
        const at = idx * 3 + c;
        panel.rgb[at] = (panel.rgb[at] as number) * (1 - a) + brain * a;
      }
    }
  }
}

/**
 * Six points on the mask's own bounding **sphere** — its occupied centroid plus and minus the
 * farthest occupied voxel's distance, along each axis.
 *
 * A sphere and not the occupied box: a box's corner sits well outside a brain, and fitting the box
 * corners renders the brain a third smaller than VTK's `reset_camera`, which fits the mesh's
 * vertices. These six points give {@link fitCamera} the same radius from a mask.
 */
export function occupiedSphere(mask: BrainMask): vec3[] {
  const [nx, ny, nz] = mask.dims;
  let count = 0;
  const centre: vec3 = [0, 0, 0];
  const each = (fn: (p: vec3) => void): void => {
    for (let k = 0; k < nz; k += 1) {
      for (let j = 0; j < ny; j += 1) {
        const row = (k * ny + j) * nx;
        for (let i = 0; i < nx; i += 1) {
          if ((mask.data[row + i] as number) === 0) continue;
          fn([
            mask.origin[0] + i * mask.step,
            mask.origin[1] + j * mask.step,
            mask.origin[2] + k * mask.step,
          ]);
        }
      }
    }
  };
  each((p) => {
    centre[0] += p[0];
    centre[1] += p[1];
    centre[2] += p[2];
    count += 1;
  });
  if (count === 0) return [];
  for (let c = 0; c < 3; c += 1) centre[c] = (centre[c] as number) / count;
  let radius = mask.step;
  each((p) => {
    const d = sub(p, centre);
    radius = Math.max(radius, Math.hypot(d[0], d[1], d[2]));
  });
  return [
    [centre[0] + radius, centre[1], centre[2]],
    [centre[0] - radius, centre[1], centre[2]],
    [centre[0], centre[1] + radius, centre[2]],
    [centre[0], centre[1] - radius, centre[2]],
    [centre[0], centre[1], centre[2] + radius],
    [centre[0], centre[1], centre[2] - radius],
  ];
}

/**
 * One view, rendered into an RGBA buffer over white.
 *
 * Draw order is geometry first, glass second, which is what makes the leads show *through* the
 * brain instead of being clipped by it.
 */
export function renderImplantView(
  view: Implant3dView,
  leads: readonly Lead[],
  mask: BrainMask | null,
  width: number,
  height: number
): Uint8ClampedArray {
  const all: vec3[] = [];
  for (const lead of leads) all.push(...lead.points);
  if (mask !== null) {
    // The occupied bounding **sphere**, not the sampled grid: the grid is padded well past the head,
    // and fitting either the padding or the box corners shrinks the brain well below seegprep's.
    for (const p of occupiedSphere(mask)) all.push(p);
  }
  const cam = fitCamera(all, view, width, height);
  const panel = newPanel(width, height);
  for (const lead of leads) {
    const rgb = hexRgb(lead.color);
    for (let i = 1; i < lead.points.length; i += 1) {
      drawTube(panel, cam, lead.points[i - 1]!, lead.points[i]!, TUBE_RADIUS_MM, rgb);
    }
    for (const p of lead.points) drawSphere(panel, cam, p, CONTACT_RADIUS_MM, rgb);
  }
  if (mask !== null) compositeBrain(panel, cam, mask);
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
  const rowHeight = opts.fontPx * 1.9;
  const markerRadius = opts.fontPx * 0.45;
  const gap = opts.fontPx * 1.4;
  ctx.save();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (let row = 0; row < rows; row += 1) {
    const inRow = entries.slice(row * ncol, row * ncol + ncol);
    const widths = inRow.map((e) => markerRadius * 2 + opts.fontPx * 0.6 + opts.measure(e.name));
    const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, inRow.length - 1);
    let x = (figureWidthPx - total) / 2;
    const y = bottomPx - (rows - row - 0.5) * rowHeight;
    inRow.forEach((entry, i) => {
      ctx.fillStyle = entry.color;
      ctx.beginPath();
      ctx.arc(x + markerRadius, y, markerRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.fillText(entry.name, x + markerRadius * 2 + opts.fontPx * 0.6, y);
      x += (widths[i] as number) + gap;
    });
  }
  ctx.restore();
}

/** `f"sEEG implant — {n} depth electrodes, {m} contacts"`, seegprep's own default title. */
export function implantSuptitle(leads: readonly Lead[]): string {
  const contacts = leads.reduce((sum, lead) => sum + lead.points.length, 0);
  return `sEEG implant — ${leads.length} depth electrodes, ${contacts} contacts`;
}
