/**
 * The QC export sheet's host-facing half: chunked `sampleVolume` calls, `OffscreenCanvas`
 * compositing for the reslice and implant figures, and the `files.writeBinary` / `writeText` calls
 * that land the five outputs `qc/paths.ts` names. `qc/reslice.ts` and `qc/histogram.ts` hold the
 * geometry a synthetic fixture can check; this file is the part that only a running host can
 * exercise, and it is written so every host call is behind a narrow, mockable surface
 * (`test/setup.ts`'s pattern — see `test/qc/export.test.ts`).
 *
 * **What could not be verified without a running host**: the actual pixel output of `sampleVolume`
 * and `capture.screenshot`, and whether `OffscreenCanvas` behaves identically to the app's renderer
 * process. The chunking math and the file-write sequencing are exercised against a mock host.
 */

import type { ContactSet } from '@tetravox/module-sdk';
import { contacts } from '@tetravox/module-sdk';
import { spacingHistogramSvg, nominalPitchesFromSidecar } from './histogram';
import { spacingTsv } from './tsv';
import { datasetDescriptionJson } from './datasetDescription';
import { qcOutputPaths } from './paths';
import { planeBasisFor, resliceGrid, resliceMarks, type ResliceGrid } from './reslice';

const { contactsOf, groupNames } = contacts;

/** `sampleVolume`'s own cap. A caller that needs more chunks the request. */
export const MAX_SAMPLE_POINTS = 2_000_000;

/** Narrow slices of `ModuleHost` this module actually calls, for mocking. */
export interface ExportHost {
  scene: {
    sampleVolume(
      datasetId: string,
      worldPoints: Float32Array,
      opts?: { order?: 0 | 1; volumeIndex?: number }
    ): Promise<Float32Array>;
  };
  capture: {
    screenshot(opts: {
      target: 'view' | 'grid';
      viewId?: string;
      width?: number;
      height?: number;
      background?: 'transparent' | 'theme';
    }): Promise<Uint8Array>;
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

export interface SpacingExportResult {
  svgPath: string;
  tsvPath: string;
  ok: boolean;
}

/** The spacing histogram (SVG) and its TSV, plus the dataset_description sidecar. */
export async function exportSpacing(
  host: ExportHost,
  set: ContactSet,
  opts: {
    derivativesRoot: string;
    subjectId: string;
    manifestVersion: string;
    geometrySidecarPath?: string;
  }
): Promise<SpacingExportResult> {
  const paths = qcOutputPaths(opts.derivativesRoot, opts.subjectId);
  await ensureDatasetDescription(host, paths.datasetDescription, opts.manifestVersion);

  let sidecarPitches: Record<string, number> = {};
  if (opts.geometrySidecarPath !== undefined) {
    const text = await host.files.readText(opts.geometrySidecarPath);
    if (text !== null) sidecarPitches = nominalPitchesFromSidecar(text);
  }

  const svg = spacingHistogramSvg(set, { sidecarPitches, subjectId: opts.subjectId });
  const svgWritten = await host.files.writeText(paths.spacingSvg, svg, { backup: true });
  const tsvWritten = await host.files.writeText(paths.spacingTsv, spacingTsv(set), { backup: true });
  return { svgPath: paths.spacingSvg, tsvPath: paths.spacingTsv, ok: svgWritten.ok && tsvWritten.ok };
}

/**
 * One electrode's reslice tile: the sampled T1/CT slabs plus where the contact rings and distance
 * labels land, ready for `compositeResliceCanvas` to draw.
 */
export interface ResliceTile {
  electrode: string;
  grid: ResliceGrid;
  t1: Float32Array | null;
  ct: Float32Array | null;
  marks: ReturnType<typeof resliceMarks>['marks'];
  labels: ReturnType<typeof resliceMarks>['labels'];
}

/** Samples every electrode's reslice plane. Returns `null` tiles for an electrode with < 2 points. */
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
    const grid = resliceGrid(basis);
    const { marks, labels } = resliceMarks(ordered, basis, grid);
    const t1 =
      opts.t1DatasetId === null ? null : await sampleVolumeChunked(host, opts.t1DatasetId, grid.points);
    const ct =
      opts.ctDatasetId === null ? null : await sampleVolumeChunked(host, opts.ctDatasetId, grid.points);
    tiles.push({ electrode: name, grid, t1, ct, marks, labels });
  }
  return tiles;
}

/**
 * Draws the composited reslice grid (T1 grey, CT ≥1200 HU warm ramp, cyan rings, a green square at
 * contact 1, distance labels) into `canvas`, tiling every electrode into 3 columns.
 *
 * Takes an already-constructed `OffscreenCanvas` (or a compatible 2D-context source) so the caller
 * decides how to obtain one — the app's renderer process has a real `OffscreenCanvas`; nothing here
 * assumes a DOM.
 */
export function compositeReslice(
  ctx: OffscreenCanvasRenderingContext2D,
  tiles: ResliceTile[],
  tileWidthPx: number,
  tileHeightPx: number
): void {
  const columns = 3;
  const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
    return sorted[idx] as number;
  };

  tiles.forEach((tile, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const ox = col * tileWidthPx;
    const oy = row * tileHeightPx;

    const { nAlong, nAcross } = tile.grid;
    const t1Values = tile.t1 !== null ? Array.from(tile.t1).filter((v) => Number.isFinite(v)) : [];
    const lo = percentile(t1Values, 2);
    const hi = percentile(t1Values, 99);
    const image = ctx.createImageData(nAcross, nAlong);
    for (let i = 0; i < nAlong; i++) {
      for (let j = 0; j < nAcross; j++) {
        const src = i * nAcross + j;
        const px = (i * nAcross + j) * 4;
        let r = 0;
        let g = 0;
        let b = 0;
        const t1v = tile.t1?.[src];
        if (t1v !== undefined && Number.isFinite(t1v)) {
          const norm = hi > lo ? Math.min(1, Math.max(0, (t1v - lo) / (hi - lo))) : 0;
          r = g = b = Math.round(norm * 255);
        }
        const ctv = tile.ct?.[src];
        if (ctv !== undefined && Number.isFinite(ctv) && ctv >= 1200) {
          // Warm ramp: orange scaling with HU above the 1200 floor, capped at 3000.
          const norm = Math.min(1, (ctv - 1200) / 1800);
          r = Math.round(255 * norm + r * (1 - norm));
          g = Math.round(140 * norm + g * (1 - norm));
          b = Math.round(b * (1 - norm));
        }
        image.data[px] = r;
        image.data[px + 1] = g;
        image.data[px + 2] = b;
        image.data[px + 3] = 255;
      }
    }
    ctx.putImageData(image, ox, oy);

    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 1.5;
    for (const mark of tile.marks) {
      ctx.beginPath();
      ctx.arc(ox + mark.pixel.x, oy + mark.pixel.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();
      if (mark.ordinal === 1) {
        ctx.strokeStyle = '#22c55e';
        ctx.strokeRect(ox + mark.pixel.x - 4, oy + mark.pixel.y - 4, 8, 8);
        ctx.strokeStyle = '#00e5ff';
      }
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px sans-serif';
    for (const label of tile.labels) {
      ctx.fillText(label.distanceMm.toFixed(2), ox + label.pixel.x, oy + label.pixel.y);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tile.electrode, ox + 4, oy + 12);
    ctx.restore();
  });
}
