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
  DPI,
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
import { planeBasisFor, resliceGrid, resliceMarks, type ResliceGrid } from './reslice';

const { contactsOf, groupNames } = contacts;

/** `sampleVolume`'s own cap. A caller that needs more chunks the request. */
export const MAX_SAMPLE_POINTS = 2_000_000;

/** `ct_metal_hu` / `ct_metal_hu_max` — the `autumn` overlay's window (`electrode_reslice`). */
export const CT_METAL_HU = 1200;
export const CT_METAL_HU_MAX = 3000;
/** `alpha=0.85` on the CT overlay. */
export const CT_ALPHA = 0.85;

/** `ncols=3`, and the per-panel `figsize` in inches. */
export const RESLICE_NCOLS = 3;
export const PANEL_WIDTH_IN = 6.2;
export const PANEL_HEIGHT_IN = 3.0;
/** `implant_3d`'s `figsize=(6.5 * ncols, 6.0 * nrows)`. */
export const IMPLANT_PANEL_WIDTH_IN = 6.5;
export const IMPLANT_PANEL_HEIGHT_IN = 6.0;

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

/** The strip `tight_layout` leaves above the first row for the wrapped suptitle. */
const SUPTITLE_BAND_PX = Math.round(pt(12) * 1.2 * 2 + pt(10));

/** The reslice figure's canvas size in device pixels — `figsize × dpi`, seegprep's small multiples. */
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
    width: Math.round(PANEL_WIDTH_IN * ncols * DPI),
    height: Math.round(PANEL_HEIGHT_IN * nrows * DPI + SUPTITLE_BAND_PX),
    ncols,
    nrows,
  };
}

/**
 * How much of the padded slot the axes box may take.
 *
 * matplotlib's `tight_layout` leaves ~7% of the figure as margin all round before `savefig`'s tight
 * bbox crops it; measured on seegprep's `sub-P076_desc-reslice_qc.png`, its axes boxes are 15%
 * smaller than a slot filling the cell. Applied here so the cropped figure comes out the same pixel
 * size as seegprep's rather than 16% larger.
 */
const PANEL_SHRINK = 0.85;

/** Panel padding, in device pixels: room for the title, the tick labels and the axis labels. */
const PANEL_PAD = {
  left: pt(7 * 1.2) + pt(6) * 2.4 + pt(7) + pt(5),
  right: pt(8),
  top: pt(9 * 1.2) + pt(8),
  bottom: pt(7) + pt(6) * 1.2 + pt(5) + pt(7 * 1.2) + pt(6),
};

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
  const { width, height, ncols, nrows } = resliceFigureSize(tiles.length);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  drawSuptitle(ctx, width, RESLICE_SUPTITLE, { measure });

  const cellW = width / ncols;
  const cellH = (height - SUPTITLE_BAND_PX) / nrows;
  tiles.forEach((tile, index) => {
    const col = index % ncols;
    const row = Math.floor(index / ncols);
    const boxW = (cellW - PANEL_PAD.left - PANEL_PAD.right) * PANEL_SHRINK;
    const boxH = (cellH - PANEL_PAD.top - PANEL_PAD.bottom) * PANEL_SHRINK;
    const slot: Rect = {
      x: col * cellW + PANEL_PAD.left + (cellW - PANEL_PAD.left - PANEL_PAD.right - boxW) / 2,
      y: SUPTITLE_BAND_PX + row * cellH + PANEL_PAD.top,
      width: boxW,
      height: boxH,
    };
    const su = tile.grid.su;
    const sv = tile.grid.sv;
    const ax = new Axes(slot, {
      x0: su[0] ?? 0,
      x1: su[su.length - 1] ?? 1,
      y0: sv[0] ?? 0,
      y1: sv[sv.length - 1] ?? 1,
    });
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
    ctx.fillStyle = tile.color;
    ctx.font = fontSpec(4.5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const label of tile.labels) {
      ctx.fillText(
        label.distanceMm.toFixed(1),
        ax.px(label.mm.along),
        ax.py(label.mm.across + 0.6)
      );
    }
    ctx.restore();

    drawAxesFrame(ctx, ax, { tickLabelSize: 6 });
    drawAxesTitle(ctx, ax, `${tile.electrode}  (n=${tile.marks.length})`, 9);
    drawXLabel(ctx, ax, 'along shaft (mm)', 7, 6);
    drawYLabel(ctx, ax, 'perp (mm)', 7, pt(6) * 2.4 + pt(7) + pt(5));
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
  const padding = opts.paddingMm ?? 90;
  const lo: vec3 = [Infinity, Infinity, Infinity];
  const hi: vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let c = 0; c < 3; c += 1) {
      lo[c] = Math.min(lo[c] as number, (p[c] as number) - padding);
      hi[c] = Math.max(hi[c] as number, (p[c] as number) + padding);
    }
  }
  let step = opts.stepMm ?? BRAIN_STEP_MM;
  const dimsFor = (s: number): [number, number, number] => [
    Math.max(2, Math.ceil((hi[0] - lo[0]) / s) + 1),
    Math.max(2, Math.ceil((hi[1] - lo[1]) / s) + 1),
    Math.max(2, Math.ceil((hi[2] - lo[2]) / s) + 1),
  ];
  let dims = dimsFor(step);
  while (dims[0] * dims[1] * dims[2] > MAX_SAMPLE_POINTS) {
    step *= 1.25;
    dims = dimsFor(step);
  }
  const [nx, ny, nz] = dims;
  const world = new Float32Array(nx * ny * nz * 3);
  let k = 0;
  for (let iz = 0; iz < nz; iz += 1) {
    for (let iy = 0; iy < ny; iy += 1) {
      for (let ix = 0; ix < nx; ix += 1) {
        world[k++] = (lo[0] as number) + ix * step;
        world[k++] = (lo[1] as number) + iy * step;
        world[k++] = (lo[2] as number) + iz * step;
      }
    }
  }
  // Nearest for a label map — interpolating between label 1 and label 3 names a tissue that is not
  // there. The Otsu path is a threshold on a windowed T1, where either order is fine.
  const values = await sampleVolumeChunked(host, datasetId, world, {
    order: opts.labels === undefined ? 1 : 0,
  });
  const data = new Uint8Array(nx * ny * nz);
  if (opts.labels !== undefined) {
    const wanted = new Set(opts.labels);
    for (let i = 0; i < data.length; i += 1) {
      const v = values[i] as number;
      data[i] = Number.isFinite(v) && wanted.has(Math.round(v)) ? 1 : 0;
    }
  } else {
    const threshold = otsuThreshold(values);
    if (threshold === null) return null;
    for (let i = 0; i < data.length; i += 1) {
      const v = values[i] as number;
      data[i] = Number.isFinite(v) && v > threshold ? 1 : 0;
    }
  }
  let any = false;
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] === 1) {
      any = true;
      break;
    }
  }
  return any ? { origin: [lo[0], lo[1], lo[2]], step, dims, data } : null;
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

/** The implant figure's canvas size — `figsize=(6.5 * 2, 6.0 * 2)` at {@link DPI}, plus the legend. */
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
  const panelWidth = Math.round(IMPLANT_PANEL_WIDTH_IN * DPI);
  const panelHeight = Math.round(IMPLANT_PANEL_HEIGHT_IN * DPI);
  return {
    width: panelWidth * ncols,
    height: panelHeight * nrows,
    ncols,
    nrows,
    panelWidth,
    panelHeight,
  };
}

/**
 * The whole implant figure: the four rendered views tiled 2×2 with capitalised serif titles, the
 * bottom-centre legend and the serif suptitle — `implant_3d`'s matplotlib half, drawn directly.
 */
export function drawImplantFigure(
  ctx: Ctx2D,
  leads: readonly Lead[],
  mask: BrainMask | null,
  drawImage: DrawImageData,
  measure: (text: string) => number,
  views: readonly Implant3dView[] = IMPLANT3D_VIEWS
): void {
  const size = implantFigureSize(views.length);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size.width, size.height);
  // `y=0.99` on a 16 pt serif suptitle; `tight_layout(rect=(0, 0.03, 1, 0.98))` reserves the band.
  drawSuptitle(ctx, size.width, implantSuptitle(leads), {
    sizePt: 16,
    family: SERIF,
    topPx: size.height * 0.01,
    measure,
  });

  const bandTop = size.height * 0.045;
  const bandBottom = size.height * 0.955;
  const cellH = (bandBottom - bandTop) / size.nrows;
  const cellW = size.width / size.ncols;
  // Rendered at the panel's own pixel size: a third of it made a 1.3 mm contact about one pixel
  // across, so the leads read as dashes rather than as the strings of beads the reference shows.
  const renderW = Math.round(cellW * 0.94);
  const renderH = Math.round(cellH - pt(20));
  views.forEach((view, index) => {
    const col = index % size.ncols;
    const row = Math.floor(index / size.ncols);
    // Inset so neighbouring views do not touch — matplotlib's `tight_layout` leaves the same gutter.
    const inset = cellW * 0.03;
    const rect: Rect = {
      x: col * cellW + inset,
      y: bandTop + row * cellH + pt(20),
      width: cellW - 2 * inset,
      height: cellH - pt(20) - inset,
    };
    const pixels = renderImplantView(view, leads, mask, renderW, renderH);
    drawImage(pixels, renderW, renderH, rect);
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.font = fontSpec(13, { family: SERIF, weight: 'bold' }); // axes.titleweight = bold
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(
      view.charAt(0).toUpperCase() + view.slice(1),
      rect.x + rect.width / 2,
      rect.y - pt(6)
    );
    ctx.restore();
  });

  ctx.font = fontSpec(9);
  drawImplantLegend(ctx, legendOf(leads), size.width, size.height - pt(6), {
    fontPx: pt(9),
    measure,
  });
  ctx.restore();
}
