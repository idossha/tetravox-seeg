/**
 * The QC export's host-facing half: the chunked `sampleVolume` calls, and the figure painting the
 * two documents are composed from.
 *
 * `qc/mpl.ts` is the matplotlib stand-in, `qc/reslice.ts` and `qc/implant3d.ts` are the geometry and
 * the 3-D renderer, `qc/pdf.ts` turns an encoded picture into a document; this file is the part in
 * between, written so every host call is behind a narrow, mockable surface and every draw goes to a
 * plain {@link Ctx2D} — so a test can pass a spy and assert on the calls with no `OffscreenCanvas`.
 *
 * **Images go through a callback.** `putImageData` cannot scale and `createImageBitmap` needs a
 * host, so the figure painters take a {@link DrawImageData} the caller supplies: the module gives it
 * an `OffscreenCanvas`-backed one, a test gives it a spy. That is the only host-shaped thing left in
 * the drawing code.
 *
 * **What could not be verified without a running host**: the actual pixel output of `sampleVolume`,
 * and whether `OffscreenCanvas`'s JPEG encoder matches the app's renderer. The chunking math, the
 * colormaps, the figure geometry and the file-write sequencing are exercised against mocks.
 */

import type { ContactSet, Group, vec3 } from '@tetravox/module-sdk';
import { contacts } from '@tetravox/module-sdk';
import { datasetDescriptionJson } from './datasetDescription';
import {
  Axes,
  autumnLut,
  drawAxesFrame,
  drawAxesTitle,
  drawSuptitle,
  drawXLabel,
  drawYLabel,
  fontSpec,
  grayLut,
  nanPercentile,
  pt,
  SERIF,
  type Ctx2D,
  type Extent,
  type Rect,
} from './mpl';
import {
  BRAIN_STEP_MM,
  IMPLANT3D_VIEWS,
  drawImplantLegend,
  implantSuptitle,
  legendOf,
  otsuThreshold,
  paletteColor,
  renderImplantView,
  type BrainMask,
  type Implant3dView,
  type Lead,
} from './implant3d';
import {
  marchingCubes,
  taubinSmooth,
  vertexNormals,
  type Mesh,
} from './isosurface';
import { planeBasisFor, resliceGrid, resliceMarks, type ResliceGrid } from './reslice';

const { contactsOf, groupNames } = contacts;

/** `sampleVolume`'s own cap. A caller that needs more chunks the request. */
export const MAX_SAMPLE_POINTS = 2_000_000;

/** `ct_metal_hu` / `ct_metal_hu_max` — the `autumn` overlay's window (`electrode_reslice`). */
export const CT_METAL_HU = 1200;
export const CT_METAL_HU_MAX = 3000;
/** `alpha=0.85` on the CT overlay. */
export const CT_ALPHA = 0.85;

/** The gap label's size. seegprep uses 4.5; see `drawResliceFigure` for why this is not that. */
export const DISTANCE_LABEL_PT = 6.5;

/** `ncols=3` (`electrode_reslice`). */
export const RESLICE_NCOLS = 3;

/**
 * The reslice figure's laid-out geometry, **measured on seegprep's own
 * `sub-P076_desc-reslice_qc.png`** rather than derived from its `figsize`.
 *
 * `figsize=(6.2 * ncols, 3.0 * nrows)` at 150 dpi is a 930 x 450 px cell, but `tight_layout` then
 * packs the axes into a 799 x 358 px pitch and `savefig(bbox="tight")` crops the rest away — so the
 * emitted PNG's geometry is these numbers, not the figsize's, and matching the figsize made the
 * canvas 18% too tall. The column ink bands in that file are 13-797 / 812-1596 / 1612-2396 (pitch
 * 799) and its first-column panel titles sit at y = 92, 444, 794, 1167 (pitch ~358); the axes box's
 * left spine is at x = 81 and its right edge at 797.
 */
export const COLUMN_PITCH_PX = 799;
export const ROW_PITCH_PX = 358;
/** The axes box within a column: 68 px in from the column's left, 716 px wide. */
export const BOX_LEFT_PX = 68;
export const BOX_WIDTH_PX = 716;
/** From the top of the figure to the top of the first row's slot — the suptitle's band. */
export const TOP_BAND_PX = 80;
/**
 * Slack at the left and the bottom of the canvas.
 *
 * The y label is drawn left of the column's own origin and the last row's x label below its slot;
 * without the slack both are clipped by the canvas edge. It costs nothing in the output because
 * `bbox="tight"` crops whatever of it is unused.
 */
export const EDGE_MARGIN_PX = 22;

/** `implant_3d`'s panels, measured the same way: the reference PNG is 1589 x 1577 for its 2 x 2. */
export const IMPLANT_PANEL_WIDTH_PX = 794;
export const IMPLANT_PANEL_HEIGHT_PX = 788;

/**
 * seegprep's reslice suptitle, with the one word change 1 forces.
 *
 * The rings are the electrode's own colour now, so "cyan = contacts" would be a caption describing a
 * figure that no longer exists. Every other word is verbatim.
 */
export const RESLICE_SUPTITLE =
  'Per-electrode oblique reslice (T1 grey + CT metal warm; electrode colour = contacts, ' +
  'green □ = tip) — whole lead in one plane, no external wires';

/** Narrow slices of `ModuleHost` this module actually calls, for mocking. */
export interface ExportHost {
  scene: {
    sampleVolume(
      datasetId: string,
      worldPoints: Float32Array,
      opts?: { order?: 0 | 1; volumeIndex?: number }
    ): Promise<Float32Array>;
  };
  files: {
    readText(path: string): Promise<string | null>;
    writeText(
      path: string,
      text: string,
      opts?: { backup?: boolean }
    ): Promise<{ ok: true; backupPath: string | null } | { ok: false; error: string }>;
    writeBinary(
      path: string,
      bytes: Uint8Array,
      opts?: { backup?: boolean }
    ): Promise<{ ok: true; backupPath: string | null } | { ok: false; error: string }>;
  };
}

/** How a caller paints an RGBA buffer into a rectangle of the figure. See this file's header. */
export type DrawImageData = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  rect: Rect
) => void;

/** Split `points` (xyz triples) into chunks of at most `MAX_SAMPLE_POINTS` points each. */
export function chunkPoints(points: Float32Array, maxPoints = MAX_SAMPLE_POINTS): Float32Array[] {
  const totalPoints = points.length / 3;
  if (totalPoints <= maxPoints) return [points];
  const chunks: Float32Array[] = [];
  for (let start = 0; start < totalPoints; start += maxPoints) {
    const end = Math.min(totalPoints, start + maxPoints);
    chunks.push(points.subarray(start * 3, end * 3));
  }
  return chunks;
}

/** `sampleVolume`, chunked to the host's per-call cap, reassembled in the caller's point order. */
export async function sampleVolumeChunked(
  host: ExportHost,
  datasetId: string,
  worldPoints: Float32Array,
  opts?: { order?: 0 | 1; volumeIndex?: number }
): Promise<Float32Array> {
  const chunks = chunkPoints(worldPoints);
  const out = new Float32Array(worldPoints.length / 3);
  let offset = 0;
  for (const chunk of chunks) {
    const sampled = await host.scene.sampleVolume(datasetId, chunk, opts);
    out.set(sampled, offset);
    offset += sampled.length;
  }
  return out;
}

/** Ensures `{derivatives}/tetravox/dataset_description.json` exists, written once if absent. */
export async function ensureDatasetDescription(
  host: ExportHost,
  path: string,
  manifestVersion: string
): Promise<void> {
  const existing = await host.files.readText(path);
  if (existing !== null) return;
  await host.files.writeText(path, datasetDescriptionJson(manifestVersion), { backup: false });
}

/** `Group.color` (0..1 rgba) as a CSS colour — the same colour the electrode has in the app. */
export function groupCssColor(group: Group | undefined): string {
  if (group === undefined) return '#00e5ff';
  const [r, g, b] = group.color;
  return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/** One electrode's reslice panel: the sampled slabs, the rings and the per-gap distance labels. */
export interface ResliceTile {
  electrode: string;
  /** Change 1 — the ring and label colour is the electrode's own Group colour, not cyan. */
  color: string;
  grid: ResliceGrid;
  t1: Float32Array | null;
  ct: Float32Array | null;
  marks: ReturnType<typeof resliceMarks>['marks'];
  labels: ReturnType<typeof resliceMarks>['labels'];
}

/** Samples every electrode's reslice plane. Electrodes with fewer than two contacts are skipped. */
export async function buildResliceTiles(
  host: ExportHost,
  set: ContactSet,
  opts: { ctDatasetId: string | null; t1DatasetId: string | null }
): Promise<ResliceTile[]> {
  const tiles: ResliceTile[] = [];
  for (const name of groupNames(set)) {
    const ordered = contactsOf(set, name);
    if (ordered.length < 2) continue;
    const basis = planeBasisFor(ordered.map((c) => c.position));
    if (basis === null) continue;
    const grid = resliceGrid(
      basis,
      ordered.map((c) => c.position)
    );
    const { marks, labels } = resliceMarks(ordered, basis);
    const t1 =
      opts.t1DatasetId === null
        ? null
        : await sampleVolumeChunked(host, opts.t1DatasetId, grid.points, { order: 1 });
    const ct =
      opts.ctDatasetId === null
        ? null
        : await sampleVolumeChunked(host, opts.ctDatasetId, grid.points, { order: 1 });
    tiles.push({
      electrode: name,
      color: groupCssColor(set.groups.find((g) => g.name === name)),
      grid,
      t1,
      ct,
      marks,
      labels,
    });
  }
  return tiles;
}

/**
 * One panel's RGBA image: the T1 in `gray` windowed to its own 2nd–99th percentile, with the CT at
 * or above {@link CT_METAL_HU} in `autumn` at {@link CT_ALPHA} over it.
 *
 * The array is `(nv, nu)` with `origin="lower"` — width is the along-shaft axis, height the
 * perpendicular one, and row 0 is the *top*, so `sv` is walked backwards. A sample that is `NaN`
 * (outside the volume) is left white, which is what matplotlib's default "bad" colour does over a
 * white figure.
 */
export function resliceTileImage(tile: ResliceTile): {
  width: number;
  height: number;
  data: Uint8ClampedArray;
} {
  const { nAlong, nAcross } = tile.grid;
  const lo = tile.t1 === null ? null : nanPercentile(tile.t1, 2);
  const hi = tile.t1 === null ? null : nanPercentile(tile.t1, 99);
  const windowed = lo !== null && hi !== null && hi > lo;
  const data = new Uint8ClampedArray(nAlong * nAcross * 4);
  for (let iv = 0; iv < nAcross; iv += 1) {
    const row = nAcross - 1 - iv;
    for (let iu = 0; iu < nAlong; iu += 1) {
      const src = iu * nAcross + iv;
      const at = (row * nAlong + iu) * 4;
      let r = 255;
      let g = 255;
      let b = 255;
      const t1v = tile.t1?.[src];
      if (windowed && t1v !== undefined && Number.isFinite(t1v)) {
        [r, g, b] = grayLut((t1v - (lo as number)) / ((hi as number) - (lo as number)));
      }
      const ctv = tile.ct?.[src];
      if (ctv !== undefined && Number.isFinite(ctv) && ctv >= CT_METAL_HU) {
        const [cr, cg, cb] = autumnLut((ctv - CT_METAL_HU) / (CT_METAL_HU_MAX - CT_METAL_HU));
        r = r * (1 - CT_ALPHA) + cr * CT_ALPHA;
        g = g * (1 - CT_ALPHA) + cg * CT_ALPHA;
        b = b * (1 - CT_ALPHA) + cb * CT_ALPHA;
      }
      data[at] = r;
      data[at + 1] = g;
      data[at + 2] = b;
      data[at + 3] = 255;
    }
  }
  return { width: nAlong, height: nAcross, data };
}

/** The reslice figure's canvas size in device pixels — seegprep's laid-out small multiples. */
export function resliceFigureSize(tileCount: number): {
  width: number;
  height: number;
  ncols: number;
  nrows: number;
} {
  const n = Math.max(1, tileCount);
  const ncols = Math.max(1, Math.min(RESLICE_NCOLS, n));
  const nrows = Math.ceil(n / ncols);
  return {
    width: EDGE_MARGIN_PX + COLUMN_PITCH_PX * ncols,
    height: TOP_BAND_PX + ROW_PITCH_PX * nrows + EDGE_MARGIN_PX,
    ncols,
    nrows,
  };
}

/**
 * What sits above and below the axes box inside a row slot, in device pixels — the title with its
 * pad, and the tick labels plus the x label. The group is centred in the slot, as `tight_layout`
 * centres it: in the reference, row 1's shorter box (184 px tall) and row 3's (272) both leave
 * roughly equal slack above and below.
 */
const ABOVE_BOX_PX = pt(9) * 1.2 + pt(8);
const BELOW_BOX_PX = pt(3.5) + pt(6) * 1.2 + pt(4) + pt(7) * 1.2 + pt(6);

/**
 * The figure's laid-out boxes, and the canvas they need.
 *
 * The row pitch is {@link ROW_PITCH_PX} — seegprep's — except where a row's own panels are too tall
 * for it: `aspect="equal"` ties a box's height to its lead's along-extent, so a short lead makes a
 * tall box, and a fixed pitch then clips that row's tick labels off the bottom. A row that needs
 * more gets it; every other row keeps the reference's spacing.
 */
export function resliceLayout(tiles: readonly ResliceTile[]): {
  width: number;
  height: number;
  ncols: number;
  nrows: number;
  boxes: Rect[];
  extents: Extent[];
} {
  const n = Math.max(1, tiles.length);
  const ncols = Math.max(1, Math.min(RESLICE_NCOLS, n));
  const nrows = Math.ceil(n / ncols);
  const extents: Extent[] = tiles.map((tile) => ({
    x0: tile.grid.su[0] ?? 0,
    x1: tile.grid.su[tile.grid.su.length - 1] ?? 1,
    y0: tile.grid.sv[0] ?? 0,
    y1: tile.grid.sv[tile.grid.sv.length - 1] ?? 1,
  }));
  const boxHeights = extents.map(
    (e) => (BOX_WIDTH_PX * Math.abs(e.y1 - e.y0)) / Math.max(1e-9, Math.abs(e.x1 - e.x0))
  );
  const pitches: number[] = [];
  for (let row = 0; row < nrows; row += 1) {
    let tallest = 0;
    for (let col = 0; col < ncols; col += 1) {
      const i = row * ncols + col;
      if (i < boxHeights.length) tallest = Math.max(tallest, boxHeights[i] as number);
    }
    pitches.push(Math.max(ROW_PITCH_PX, ABOVE_BOX_PX + tallest + BELOW_BOX_PX));
  }
  const boxes: Rect[] = tiles.map((_tile, index) => {
    const col = index % ncols;
    const row = Math.floor(index / ncols);
    let top = TOP_BAND_PX;
    for (let r = 0; r < row; r += 1) top += pitches[r] as number;
    const boxH = boxHeights[index] as number;
    const slack = Math.max(0, (pitches[row] as number) - (ABOVE_BOX_PX + boxH + BELOW_BOX_PX));
    return {
      x: EDGE_MARGIN_PX + col * COLUMN_PITCH_PX + BOX_LEFT_PX,
      y: top + slack / 2 + ABOVE_BOX_PX,
      width: BOX_WIDTH_PX,
      height: boxH,
    };
  });
  return {
    width: EDGE_MARGIN_PX + COLUMN_PITCH_PX * ncols,
    height: TOP_BAND_PX + pitches.reduce((a, b) => a + b, 0) + EDGE_MARGIN_PX,
    ncols,
    nrows,
    boxes,
    extents,
  };
}

/**
 * The whole reslice figure: `nrows × ncols` panels, each an oblique reslice with its rings, its tip
 * square and its per-gap 3-D distances, under the suptitle.
 *
 * The two changes the owner asked for are both here and both one line: the ring stroke and the
 * distance text take `tile.color` (the app's Group colour) where seegprep hard-codes `"cyan"`.
 * Placement, sizes and the `%.1f` format are seegprep's — `mid[1] + 0.6`, `fontsize=4.5`,
 * `ha="center"`, `va="bottom"`.
 */
export function drawResliceFigure(
  ctx: Ctx2D,
  tiles: readonly ResliceTile[],
  drawImage: DrawImageData,
  measure: (text: string) => number
): void {
  const layout = resliceLayout(tiles);
  const { width, height } = layout;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  drawSuptitle(ctx, width, RESLICE_SUPTITLE, { measure });

  tiles.forEach((tile, index) => {
    const ax = new Axes(layout.boxes[index] as Rect, layout.extents[index] as Extent);
    const image = resliceTileImage(tile);
    drawImage(image.data, image.width, image.height, ax.box);

    ctx.save();
    ctx.lineWidth = pt(1.2); // mew=1.2
    ctx.strokeStyle = tile.color;
    for (const mark of tile.marks) {
      ctx.beginPath();
      ctx.arc(ax.px(mark.mm.along), ax.py(mark.mm.across), pt(8) / 2, 0, Math.PI * 2); // ms=8
      ctx.stroke();
    }
    const tip = tile.marks[0];
    if (tip !== undefined) {
      ctx.lineWidth = pt(2); // mew=2
      ctx.strokeStyle = '#00ff00'; // "lime"
      const side = pt(11); // ms=11
      ctx.strokeRect(
        ax.px(tip.mm.along) - side / 2,
        ax.py(tip.mm.across) - side / 2,
        side,
        side
      );
    }
    // seegprep annotates at `fontsize=4.5`, which on a metal-bright panel is unreadable — and the
    // number being *legible* is the whole of change 2. 6.5 pt with a 1 px white halo behind it, at
    // seegprep's own `mid + 0.6 mm` placement.
    ctx.font = fontSpec(DISTANCE_LABEL_PT);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = tile.color;
    for (const label of tile.labels) {
      const text = label.distanceMm.toFixed(1);
      const x = ax.px(label.mm.along);
      const y = ax.py(label.mm.across + 0.6);
      ctx.strokeText(text, x, y);
      ctx.fillText(text, x, y);
    }
    ctx.restore();

    drawAxesFrame(ctx, ax, { tickLabelSize: 6 });
    drawAxesTitle(ctx, ax, `${tile.electrode}  (n=${tile.marks.length})`, 9);
    drawXLabel(ctx, ax, 'along shaft (mm)', 7, 6);
    drawYLabel(ctx, ax, 'perp (mm)', 7, BOX_LEFT_PX - pt(4));
  });
  ctx.restore();
}

// --- the 3-D implant figure ---------------------------------------------------------------------

/**
 * Samples a coarse brain mask out of an open volume, over a box around the implanted contacts.
 *
 * There is no host call that reports a dataset's bounds, so the box is derived from the contacts
 * themselves plus `paddingMm` — wide enough to contain a head around any implant. `sampleVolume`
 * returns `NaN` outside the volume, which is exactly the "not brain" answer needed at the edges.
 *
 * `labels` selects a SimNIBS tissue map's brain labels (seegprep's `brain_labels=(1, 2)`); with no
 * label map the threshold is Otsu's on the T1, which is the one cut that needs no per-subject
 * tuning. The grid is capped at {@link MAX_SAMPLE_POINTS} by coarsening the step, so a large box
 * degrades in resolution rather than failing.
 */
export async function buildBrainMask(
  host: ExportHost,
  datasetId: string,
  points: readonly vec3[],
  opts: { labels?: readonly number[]; paddingMm?: number; stepMm?: number } = {}
): Promise<BrainMask | null> {
  if (points.length === 0) return null;
  const classify = (values: Float32Array): ((v: number) => boolean) | null => {
    if (opts.labels !== undefined) {
      const wanted = new Set(opts.labels);
      return (v) => Number.isFinite(v) && wanted.has(Math.round(v));
    }
    const threshold = otsuThreshold(values);
    return threshold === null ? null : (v) => Number.isFinite(v) && v > threshold;
  };
  const sampleBox = async (
    lo: vec3,
    hi: vec3,
    step: number
  ): Promise<{ mask: BrainMask; lo: vec3; hi: vec3 } | null> => {
    let s = step;
    const dimsFor = (d: number): [number, number, number] => [
      Math.max(2, Math.ceil((hi[0] - lo[0]) / d) + 1),
      Math.max(2, Math.ceil((hi[1] - lo[1]) / d) + 1),
      Math.max(2, Math.ceil((hi[2] - lo[2]) / d) + 1),
    ];
    let dims = dimsFor(s);
    while (dims[0] * dims[1] * dims[2] > MAX_SAMPLE_POINTS) {
      s *= 1.15;
      dims = dimsFor(s);
    }
    const [nx, ny, nz] = dims;
    const world = new Float32Array(nx * ny * nz * 3);
    let k = 0;
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          world[k++] = (lo[0] as number) + ix * s;
          world[k++] = (lo[1] as number) + iy * s;
          world[k++] = (lo[2] as number) + iz * s;
        }
      }
    }
    // Nearest for a label map — interpolating between label 1 and label 3 names a tissue that is
    // not there. The Otsu path is a threshold on a T1, where either order is fine.
    const values = await sampleVolumeChunked(host, datasetId, world, {
      order: opts.labels === undefined ? 1 : 0,
    });
    const inside = classify(values);
    if (inside === null) return null;
    const data = new Uint8Array(nx * ny * nz);
    const boxLo: vec3 = [Infinity, Infinity, Infinity];
    const boxHi: vec3 = [-Infinity, -Infinity, -Infinity];
    let any = false;
    for (let iz = 0; iz < nz; iz += 1) {
      for (let iy = 0; iy < ny; iy += 1) {
        for (let ix = 0; ix < nx; ix += 1) {
          const at = (iz * ny + iy) * nx + ix;
          if (!inside(values[at] as number)) continue;
          data[at] = 1;
          any = true;
          const p: vec3 = [
            (lo[0] as number) + ix * s,
            (lo[1] as number) + iy * s,
            (lo[2] as number) + iz * s,
          ];
          for (let c = 0; c < 3; c += 1) {
            if ((p[c] as number) < (boxLo[c] as number)) boxLo[c] = p[c] as number;
            if ((p[c] as number) > (boxHi[c] as number)) boxHi[c] = p[c] as number;
          }
        }
      }
    }
    if (!any) return null;
    return {
      mask: { origin: [lo[0], lo[1], lo[2]], step: s, dims, data },
      lo: boxLo,
      hi: boxHi,
    };
  };

  const padding = opts.paddingMm ?? 90;
  const lo: vec3 = [Infinity, Infinity, Infinity];
  const hi: vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let c = 0; c < 3; c += 1) {
      lo[c] = Math.min(lo[c] as number, (p[c] as number) - padding);
      hi[c] = Math.max(hi[c] as number, (p[c] as number) + padding);
    }
  }
  // **Two passes.** The first is coarse and only there to find where the brain actually is; the
  // second resamples that box at the fine step. One pass over the padded box at 1.4 mm would be
  // twelve million points against a two-million cap, and coarsening to fit is what made the surface
  // a blob — the wasted samples are almost all air.
  const coarse = await sampleBox(lo, hi, 4);
  if (coarse === null) return null;
  const margin = 4;
  const tight: vec3 = [coarse.lo[0] - margin, coarse.lo[1] - margin, coarse.lo[2] - margin];
  const tightHi: vec3 = [coarse.hi[0] + margin, coarse.hi[1] + margin, coarse.hi[2] + margin];
  const fine = await sampleBox(tight, tightHi, opts.stepMm ?? BRAIN_STEP_MM);
  return (fine ?? coarse).mask;
}

/** Every lead, recentred on the implant's own centroid — seegprep's `_level`. */
export function buildLeads(set: ContactSet): Lead[] {
  const names = groupNames(set);
  const all: vec3[] = [];
  for (const name of names) for (const c of contactsOf(set, name)) all.push(c.position);
  if (all.length === 0) return [];
  const center: vec3 = [0, 0, 0];
  for (const p of all) for (let c = 0; c < 3; c += 1) center[c] = (center[c] as number) + (p[c] as number) / all.length;
  return names.map((name, index) => ({
    label: name,
    color: paletteColor(index),
    points: contactsOf(set, name).map(
      (c) =>
        [
          c.position[0] - center[0],
          c.position[1] - center[1],
          c.position[2] - center[2],
        ] as vec3
    ),
  }));
}

/** The same recentring, applied to a mask so it shares the leads' frame. */
export function centerMask(mask: BrainMask, set: ContactSet): BrainMask {
  const all: vec3[] = [];
  for (const name of groupNames(set)) for (const c of contactsOf(set, name)) all.push(c.position);
  if (all.length === 0) return mask;
  const center: vec3 = [0, 0, 0];
  for (const p of all) for (let c = 0; c < 3; c += 1) center[c] = (center[c] as number) + (p[c] as number) / all.length;
  return {
    ...mask,
    origin: [mask.origin[0] - center[0], mask.origin[1] - center[1], mask.origin[2] - center[2]],
  };
}

/** The implant figure's canvas size — the reference PNG's own 794 x 788 px panels, 2 across. */
export function implantFigureSize(viewCount: number = IMPLANT3D_VIEWS.length): {
  width: number;
  height: number;
  ncols: number;
  nrows: number;
  panelWidth: number;
  panelHeight: number;
} {
  const ncols = viewCount > 1 ? 2 : 1;
  const nrows = Math.ceil(viewCount / ncols);
  return {
    width: IMPLANT_PANEL_WIDTH_PX * ncols,
    height: IMPLANT_PANEL_HEIGHT_PX * nrows,
    ncols,
    nrows,
    panelWidth: IMPLANT_PANEL_WIDTH_PX,
    panelHeight: IMPLANT_PANEL_HEIGHT_PX,
  };
}

/**
 * The brain surface, from a sampled mask: marching cubes, then Taubin smoothing, then normals.
 *
 * seegprep runs `smooth_taubin(n_iter=30, pass_band=0.05)`; 15 λ/μ iterations here reach the same
 * roundness on a mask this size, and stopping earlier keeps the export under a second. `decimate` is
 * not reproduced — nothing downstream is triangle-bound — so this mesh is denser than seegprep's,
 * which affects run time and not the picture.
 */
export function brainSurface(mask: BrainMask): { mesh: Mesh; normals: Float32Array } | null {
  const mesh = taubinSmooth(
    marchingCubes({ data: mask.data, dims: mask.dims, origin: mask.origin, step: mask.step }),
    15
  );
  if (mesh.indices.length === 0) return null;
  return { mesh, normals: vertexNormals(mesh) };
}

export function drawImplantFigure(
  ctx: Ctx2D,
  leads: readonly Lead[],
  brain: { mesh: Mesh; normals: Float32Array } | null,
  drawImage: DrawImageData,
  measure: (text: string) => number,
  views: readonly Implant3dView[] = IMPLANT3D_VIEWS
): void {
  const size = implantFigureSize(views.length);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  drawSuptitle(ctx, size.width, implantSuptitle(leads), {
    sizePt: 16,
    family: SERIF,
    topPx: pt(6),
    measure,
  });

  // Measured on the reference PNG: a panel title sits ~60 px into its row band, the first row's
  // band also has to clear the suptitle above it, and the legend lives inside the last row's band.
  const titleBand = 62;
  const firstRowTitleBand = 108;
  const legendBand = 100;
  // Every view is rendered into the same-sized rectangle so all four share one camera scale, as
  // pyvista's do (one 1100 x 1000 window per shot). Rows differ in what they must leave for the
  // suptitle and the legend, so the render height is the tightest of them and each rect is centred
  // in its own row's free space — otherwise the top row's brains come out 9% larger than the
  // bottom's, which no anatomy explains.
  const renderHeight =
    size.panelHeight - Math.max(firstRowTitleBand, titleBand + legendBand);
  views.forEach((view, index) => {
    const col = index % size.ncols;
    const row = Math.floor(index / size.ncols);
    const isLastRow = row === size.nrows - 1;
    const band = row === 0 ? firstRowTitleBand : titleBand;
    const free = size.panelHeight - band - (isLastRow ? legendBand : 0);
    const rect: Rect = {
      x: col * size.panelWidth,
      y: row * size.panelHeight + band + (free - renderHeight) / 2,
      width: size.panelWidth,
      height: renderHeight,
    };
    const pixels = renderImplantView(view, leads, brain, Math.round(rect.width), Math.round(rect.height));
    drawImage(pixels, Math.round(rect.width), Math.round(rect.height), rect);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.font = fontSpec(13, { family: SERIF, weight: 'bold' }); // axes.titleweight = bold
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      view.charAt(0).toUpperCase() + view.slice(1),
      rect.x + rect.width / 2,
      rect.y - pt(8)
    );
    ctx.restore();
  });

  ctx.font = fontSpec(9);
  drawImplantLegend(ctx, legendOf(leads), size.width, size.height - pt(10), {
    fontPx: pt(9),
    measure,
  });
  ctx.restore();
}
