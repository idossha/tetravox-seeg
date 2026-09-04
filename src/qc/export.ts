/**
 * The QC export's host-facing half: chunked `sampleVolume` calls and the canvas painting the two
 * figures are composed from. `qc/reslice.ts` and `qc/implant3d.ts` hold the geometry and the capture
 * sequence a synthetic fixture can check; `qc/pdf.ts` turns the encoded pictures into a document;
 * this file is the part in between, written so every host call is behind a narrow, mockable surface
 * (`test/setup.ts`'s pattern — see `test/qc/export.test.ts`).
 *
 * **The painting is split in two on purpose.** `paintResliceImage` writes the sampled slab with
 * `putImageData`, which cannot scale, so it is always 1 px per grid sample; `drawResliceOverlay`
 * draws the rings and the distance labels at whatever integer `scale` the caller enlarged that
 * image to. Both take a plain 2D context, so both run under a test with no `OffscreenCanvas`.
 *
 * **What could not be verified without a running host**: the actual pixel output of `sampleVolume`
 * and `capture.screenshot`, and whether `OffscreenCanvas` and its JPEG encoder behave identically to
 * the app's renderer process. The chunking math and the file-write sequencing are exercised against
 * a mock host; `test/qc/pdf.test.ts` reads the produced document back.
 */

import type { ContactSet } from '@tetravox/module-sdk';
import { contacts } from '@tetravox/module-sdk';
import { datasetDescriptionJson } from './datasetDescription';
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

/** The pixel size of one electrode's reslice image: 1 px per grid sample, before any enlargement. */
export function resliceImageSize(tile: ResliceTile): { width: number; height: number } {
  return { width: tile.grid.nAcross, height: tile.grid.nAlong };
}

/** The 2nd/99th percentile of the finite values, for the T1 window. Empty input windows to 0. */
function percentile(values: readonly number[], p: number): number {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[idx] as number;
}

/**
 * Paints one electrode's sampled slab into `ctx` at 1 px per grid sample: T1 as grey windowed to
 * its own 2nd–99th percentile, CT at or above 1200 HU as a warm ramp over it.
 *
 * `putImageData` ignores the transform and cannot scale, so the context must be exactly
 * {@link resliceImageSize} — a caller that wants the figure bigger enlarges this image with
 * `drawImage` and then calls {@link drawResliceOverlay} at the matching scale.
 */
export function paintResliceImage(
  ctx: OffscreenCanvasRenderingContext2D,
  tile: ResliceTile
): void {
  const { nAlong, nAcross } = tile.grid;
  const t1Values = tile.t1 === null ? [] : Array.from(tile.t1);
  const lo = percentile(t1Values, 2);
  const hi = percentile(t1Values, 99);
  const image = ctx.createImageData(nAcross, nAlong);
  for (let i = 0; i < nAlong; i++) {
    for (let j = 0; j < nAcross; j++) {
      const src = i * nAcross + j;
      const px = src * 4;
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
  ctx.putImageData(image, 0, 0);
}

/**
 * Draws the contact rings, the green square at contact 1 and the per-gap distance labels over an
 * image already enlarged by `scale`.
 *
 * The ring radius and the label size grow with `scale` so the annotation is the same fraction of
 * the picture at any enlargement — the whole reason the scale is a parameter rather than a constant.
 */
export function drawResliceOverlay(
  ctx: OffscreenCanvasRenderingContext2D,
  tile: ResliceTile,
  scale = 1
): void {
  ctx.save();
  ctx.lineWidth = Math.max(1, 1.5 * scale);
  for (const mark of tile.marks) {
    ctx.strokeStyle = '#00e5ff';
    ctx.beginPath();
    ctx.arc(mark.pixel.x * scale, mark.pixel.y * scale, 3.5 * scale, 0, Math.PI * 2);
    ctx.stroke();
    if (mark.ordinal === 1) {
      ctx.strokeStyle = '#22c55e';
      ctx.strokeRect(
        mark.pixel.x * scale - 4 * scale,
        mark.pixel.y * scale - 4 * scale,
        8 * scale,
        8 * scale
      );
    }
  }
  ctx.fillStyle = '#ffffff';
  ctx.font = `${Math.round(10 * scale)}px sans-serif`;
  for (const label of tile.labels) {
    ctx.fillText(label.distanceMm.toFixed(2), label.pixel.x * scale, label.pixel.y * scale);
  }
  ctx.restore();
}

/**
 * The caption lines printed on one electrode's page: the electrode, then its 3-D gap distances.
 *
 * The distances are the **3-D** ones (`contacts.distanceMm` between consecutive contacts), not the
 * in-plane separation the picture shows — a contact a little off the reslice plane is nearer in the
 * picture than it is in the head, and the number a reader quotes has to be the real one.
 */
export function resliceCaption(tile: ResliceTile): string[] {
  const gaps = tile.labels.map((label) => label.distanceMm);
  // ASCII only, deliberately: `qc/pdf.ts` embeds no font, so a character the base-14 WinAnsi
  // encoding cannot name is dropped — an em dash here left the caption reading "A  6 contacts".
  if (gaps.length === 0) return [`${tile.electrode}: one contact, no gap to report`];
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  return [
    `${tile.electrode}: ${tile.marks.length} contacts, ${gaps.length} gaps, mean ${mean.toFixed(2)} mm (3-D)`,
    `gaps (mm): ${gaps.map((g) => g.toFixed(2)).join('  ')}`,
  ];
}
