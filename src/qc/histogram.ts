/**
 * The spacing histogram — `sub-{id}_desc-spacing_qc.svg` — built by hand, no charting library: the
 * bundle is one file with no imports (`rollup.config.mjs`), so a library is not an option here any
 * more than anywhere else in this module.
 *
 * Bins are the consecutive-contact 3-D distances from `qc/tsv.ts`'s `spacingRows`, one bar set for
 * the whole subject. A **dashed nominal line** is drawn once per distinct model pitch present:
 *
 *  1. a group's `model` extra column, if the table carries one — its typical pitch comes from
 *     `derivatives/seegprep/sub-{id}/ieeg/sub-{id}_electrodes-geometry.json`'s `spacing_gaps_mm`
 *     when that sidecar is readable and names the model;
 *  2. otherwise the **median** of that model's own observed gaps stands in for its nominal pitch;
 *  3. a table with no `model` column at all gets one line: the median of every gap in the subject.
 *
 * Colours are explicit fills, not CSS custom properties — the figure has to look the same whether
 * Tetravox opens it in a themed viewer or a browser with no theme at all.
 */

import type { ContactSet } from '@tetravox/module-sdk';
import { spacingRows } from './tsv';

const WIDTH = 640;
const HEIGHT = 360;
const MARGIN = { top: 24, right: 24, bottom: 48, left: 56 };
const BIN_COUNT = 24;

const COLOR = {
  background: '#ffffff',
  axis: '#333333',
  text: '#222222',
  bar: '#4c78a8',
  barStroke: '#2f4f6f',
  nominal: '#d6604d',
  grid: '#e2e2e2',
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number);
}

/**
 * The geometry sidecar's `spacing_gaps_mm`, keyed by model name, if it parses. Read as plain JSON —
 * this module never assumes a particular shape beyond "an object with numeric or numeric-array
 * values under `spacing_gaps_mm`, keyed by model".
 */
export function nominalPitchesFromSidecar(json: string): Record<string, number> {
  try {
    const parsed = JSON.parse(json) as { spacing_gaps_mm?: Record<string, number | number[]> };
    const gaps = parsed.spacing_gaps_mm ?? {};
    const out: Record<string, number> = {};
    for (const [model, value] of Object.entries(gaps)) {
      out[model] = Array.isArray(value) ? median(value) : value;
    }
    return out;
  } catch {
    return {};
  }
}

/** One dashed nominal line per distinct model, or one line for the whole subject if no models. */
export function nominalPitches(
  set: ContactSet,
  sidecarPitches: Record<string, number> = {}
): Array<{ label: string; pitchMm: number }> {
  const rows = spacingRows(set);
  const modelOfGroup = new Map<string, string>();
  for (const group of set.groups) {
    const first = set.contacts.find((c) => c.group === group.name);
    const model = first?.extra['model'];
    if (typeof model === 'string' && model !== '') modelOfGroup.set(group.name, model);
  }
  const models = new Set(modelOfGroup.values());
  if (models.size === 0) {
    return rows.length === 0 ? [] : [{ label: 'median', pitchMm: median(rows.map((r) => r.distanceMm)) }];
  }
  const out: Array<{ label: string; pitchMm: number }> = [];
  for (const model of models) {
    if (typeof sidecarPitches[model] === 'number') {
      out.push({ label: model, pitchMm: sidecarPitches[model] });
      continue;
    }
    const gaps = rows
      .filter((r) => modelOfGroup.get(r.electrode) === model)
      .map((r) => r.distanceMm);
    if (gaps.length > 0) out.push({ label: model, pitchMm: median(gaps) });
  }
  return out;
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);
}

/** The spacing histogram as a standalone SVG document. */
export function spacingHistogramSvg(
  set: ContactSet,
  opts: { sidecarPitches?: Record<string, number>; subjectId?: string } = {}
): string {
  const rows = spacingRows(set);
  const distances = rows.map((r) => r.distanceMm);
  const lines = nominalPitches(set, opts.sidecarPitches ?? {});

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const lo = distances.length === 0 ? 0 : Math.min(...distances, ...lines.map((l) => l.pitchMm));
  const hi = distances.length === 0 ? 1 : Math.max(...distances, ...lines.map((l) => l.pitchMm));
  const pad = (hi - lo) * 0.1 || 1;
  const xMin = Math.max(0, lo - pad);
  const xMax = hi + pad;

  const binWidth = (xMax - xMin) / BIN_COUNT;
  const counts = new Array<number>(BIN_COUNT).fill(0);
  for (const d of distances) {
    const idx = Math.min(BIN_COUNT - 1, Math.max(0, Math.floor((d - xMin) / binWidth)));
    counts[idx] = (counts[idx] ?? 0) + 1;
  }
  const maxCount = Math.max(1, ...counts);

  const xOf = (mm: number): number => MARGIN.left + ((mm - xMin) / (xMax - xMin)) * plotW;
  const yOf = (count: number): number => MARGIN.top + plotH - (count / maxCount) * plotH;

  const bars = counts
    .map((count, i) => {
      const x0 = xOf(xMin + i * binWidth);
      const x1 = xOf(xMin + (i + 1) * binWidth);
      const y = yOf(count);
      const h = MARGIN.top + plotH - y;
      if (count === 0) return '';
      return `<rect x="${x0.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(0, x1 - x0 - 1).toFixed(2)}" height="${h.toFixed(2)}" fill="${COLOR.bar}" stroke="${COLOR.barStroke}" stroke-width="0.5" />`;
    })
    .join('\n');

  const nominalLines = lines
    .map((l, i) => {
      const x = xOf(l.pitchMm);
      const y = MARGIN.top + i * 14;
      return (
        `<line x1="${x.toFixed(2)}" y1="${MARGIN.top}" x2="${x.toFixed(2)}" y2="${(MARGIN.top + plotH).toFixed(2)}" ` +
        `stroke="${COLOR.nominal}" stroke-width="1.5" stroke-dasharray="6,4" />` +
        `<text x="${(x + 3).toFixed(2)}" y="${(y + 10).toFixed(2)}" font-size="10" fill="${COLOR.nominal}">${escapeXml(l.label)} ${l.pitchMm.toFixed(2)}mm</text>`
      );
    })
    .join('\n');

  const title = opts.subjectId ? `Contact spacing — sub-${opts.subjectId}` : 'Contact spacing';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" fill="${COLOR.background}" />
  <text x="${MARGIN.left}" y="16" font-size="14" fill="${COLOR.text}">${escapeXml(title)}</text>
  <line x1="${MARGIN.left}" y1="${MARGIN.top + plotH}" x2="${MARGIN.left + plotW}" y2="${MARGIN.top + plotH}" stroke="${COLOR.axis}" />
  <line x1="${MARGIN.left}" y1="${MARGIN.top}" x2="${MARGIN.left}" y2="${MARGIN.top + plotH}" stroke="${COLOR.axis}" />
  <text x="${MARGIN.left + plotW / 2}" y="${HEIGHT - 8}" font-size="11" fill="${COLOR.text}" text-anchor="middle">distance (mm)</text>
  <text x="14" y="${MARGIN.top + plotH / 2}" font-size="11" fill="${COLOR.text}" text-anchor="middle" transform="rotate(-90 14 ${MARGIN.top + plotH / 2})">count</text>
  ${bars}
  ${nominalLines}
</svg>
`;
}
