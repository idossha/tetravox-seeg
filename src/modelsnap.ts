/**
 * **What the electrode is**, and what follows from knowing it.
 *
 * `shaft.ts` knows a depth electrode is a rigid rod with contacts along it and contact 1 at the
 * deep end; it does not know *which* rod. Re-fit therefore re-spaces at the shaft's own **median
 * observed gap**, which is the best a module can do with no catalogue — and is wrong for the whole
 * Ad-Tech Behnke-Fried family, whose first gap is not its second. A BF10R-SP21X measured 3.0 mm
 * then 5.5 mm re-spaced at its median comes out uniformly 5.5 mm, contact 2 moved 2.5 mm off the
 * metal it is inside, and every number the panel prints about it is then self-consistent and wrong.
 *
 * So this file is the other half: given a **model** — a gap template with a known number of
 * contacts — fit the rod, slide the template along it until it sits on the brightest metal, and
 * put each contact where the template and the image agree. Three things make that safe:
 *
 *  * **The fit rejects one outlier.** A single contact dragged off the shaft (or a localiser's
 *    stray) drags a least-squares axis with it, and an axis that is wrong is a template that is
 *    wrong everywhere. One rejection pass, never two: two passes on ten contacts is a fit of
 *    whatever survived, which is not a fit of the electrode.
 *  * **The template is slid, not scaled.** The gaps come from the manufacturer; only *where the
 *    tip is* is unknown, so the search has exactly one free parameter and cannot absorb a bad model
 *    by stretching.
 *  * **A per-contact peak that lands off the axis is refused.** `peakCentroid` weighs everything
 *    bright in its box, and next to a shaft that is often the *neighbouring* shaft. More than
 *    {@link OFF_AXIS_LIMIT_MM} off the fitted line is not this electrode's metal, and the contact
 *    keeps the on-axis template position rather than jumping to someone else's.
 *
 * **Nothing here renumbers.** `shaft.ts`'s rule is unchanged and applies to this too: only Re-fit
 * and Renumber tip-first ever change a contact's number or name, so a snap-to-model moves contacts
 * and leaves the table's `csc` mapping exactly as the clinic wired it.
 *
 * **Every distance in this file is 3-D**, in world millimetres, and so is every distance derived
 * from it that the panel prints.
 */

import { contacts } from '@tetravox/module-sdk';
import type { ContactSet, vec3 } from '@tetravox/module-sdk';
import { CATALOGUE } from './catalogue.gen';
import type { CatalogueEntry } from './catalogue.gen';

export type { CatalogueEntry };

const { contactsOf, distanceMm, fitLine } = contacts;

// ---- what a resolved model is -------------------------------------------------------------------

/**
 * Where a group's geometry came from. `'none'` is not represented — that is a `null` model.
 *
 * `'sidecar-measured'` is the honest third answer, and it exists because seegprep's sidecar always
 * states a `spacing_gaps_mm`: when its own catalogue matched nothing it writes `model: "n/a"` and
 * fills the vector with **this shaft's measured median pitch, repeated**, so that a QC consumer
 * always has a nominal to compare against. That is a useful number and it is emphatically not a
 * manufacturer's geometry — a Behnke-Fried lead's measured median is 5.5 mm and its first gap is
 * 3.0 mm — so it is labelled differently, ranked below a real catalogue match, and shown to the user
 * as what it is.
 */
export type ModelSource = 'sidecar' | 'sidecar-measured' | 'catalogue';

export interface ElectrodeModel {
  /** The model key, as the source spelled it. */
  model: string;
  nContacts: number;
  /** `nContacts − 1` centre-to-centre gaps, **tip-first**: `gapsMm[i]` is contact i+1 → i+2. */
  gapsMm: number[];
  contactLengthMm?: number;
  source: ModelSource;
}

/**
 * One electrode's row of a seegprep `_electrodes-geometry.json` sidecar.
 *
 * `model` is `null` for seegprep's own `"n/a"` — the string it writes when *its* catalogue matched
 * nothing. Read literally, `"n/a"` would be reported to the user as an electrode model called n/a
 * and would stop the resolver looking anywhere else; `null` is what it means.
 *
 * When `model` is `null` and `gapsMm` is not, the gaps are the shaft's **measured** median pitch
 * repeated (see {@link ModelSource}), not a manufacturer's vector.
 */
export interface GeometrySidecarEntry {
  model: string | null;
  contactLengthMm: number | null;
  /** The per-gap spacing the sidecar states, or `null` when it states none. */
  gapsMm: number[] | null;
  /** `n_contacts` as the sidecar states it, when it does. */
  nContacts: number | null;
}

/** Everything the module has been able to learn about which electrodes these are. */
export interface ModelSources {
  /** seegprep's `_electrodes-geometry.json`, by electrode name. The most specific source there is. */
  sidecar?: ReadonlyMap<string, GeometrySidecarEntry> | null;
  /** The electrodes table's own `model` column, by electrode name. */
  tableModels?: ReadonlyMap<string, string> | null;
  /** The site CSV's `part_number` column, by electrode name. */
  partNumbers?: ReadonlyMap<string, string> | null;
  /** An `n_contacts` a table or a CSV stated, for a sidecar that gives gaps and no count. */
  declaredCounts?: ReadonlyMap<string, number> | null;
  /** Overridable so a test can drive this with two models rather than forty-four. */
  catalogue?: readonly CatalogueEntry[];
}

/**
 * The catalogue entry for a part number, matched **case-insensitively as a prefix**.
 *
 * seegprep's catalogue documents its `model` field as "canonical model / part-number-prefix key
 * used for matching (case-insensitive, prefix match)", and this is that rule: a site's
 * `BF10R-SP21X-0C3` finds `BF10R-SP21X` without anyone having to know which trailing segments are
 * options and which are geometry. The **longest** matching key wins, so a catalogue that later
 * distinguishes `BF10R-SP21X-0C3` from its family gets the specific answer without this changing.
 */
export function lookupCatalogue(
  partNumber: string,
  catalogue: readonly CatalogueEntry[] = CATALOGUE
): CatalogueEntry | null {
  const key = partNumber.trim().toUpperCase();
  if (key === '') return null;
  let best: CatalogueEntry | null = null;
  for (const entry of catalogue) {
    if (!key.startsWith(entry.model.toUpperCase())) continue;
    if (best === null || entry.model.length > best.model.length) best = entry;
  }
  return best;
}

/**
 * This electrode's geometry, from the most specific source that has it.
 *
 * In order: the subject's own seegprep sidecar (which states the gaps for *this* implant), then the
 * bundled catalogue keyed by whatever model string the table or the site CSV carries, then nothing
 * — and nothing is a supported answer, not a failure. With no model resolved the module behaves
 * exactly as it did before this file existed: Re-fit re-spaces at the median observed gap and the
 * panel's model section says so.
 */
export function resolveElectrodeModel(
  group: string,
  sources: ModelSources = {}
): ElectrodeModel | null {
  const catalogue = sources.catalogue ?? CATALOGUE;
  const sidecar = sources.sidecar?.get(group) ?? null;
  const declared = sources.declaredCounts?.get(group) ?? null;

  const sidecarGaps =
    sidecar !== null && sidecar.gapsMm !== null && sidecar.gapsMm.length > 0
      ? sidecar.gapsMm
      : null;

  // A sidecar that both names a model and states its gaps is the most specific source there is: it
  // was written for *this* implant, by the program that also wrote the table.
  if (sidecar !== null && sidecar.model !== null && sidecarGaps !== null) {
    return {
      model: sidecar.model,
      nContacts: sidecarGaps.length + 1,
      gapsMm: [...sidecarGaps],
      ...(sidecar.contactLengthMm === null ? {} : { contactLengthMm: sidecar.contactLengthMm }),
      source: 'sidecar',
    };
  }

  // A sidecar that names the model without stating gaps is still the best *key* there is: it was
  // written for this subject, where the table's column may be blank and the site CSV may be absent.
  const keys = [sidecar?.model ?? null, sources.tableModels?.get(group) ?? null, sources.partNumbers?.get(group) ?? null];
  for (const key of keys) {
    if (key === null || key.trim() === '') continue;
    const entry = lookupCatalogue(key, catalogue);
    if (entry === null) continue;
    return {
      model: entry.model,
      nContacts: declared !== null && declared > 0 ? Math.max(entry.nContacts, declared) : entry.nContacts,
      gapsMm: expandGaps([...entry.gapsMm], (declared ?? 0) > entry.nContacts ? (declared as number) : entry.nContacts),
      ...(entry.contactLengthMm === undefined ? {} : { contactLengthMm: entry.contactLengthMm }),
      source: 'catalogue',
    };
  }

  /*
   * Last: the sidecar's measured stand-in, ranked **below** the catalogue on purpose.
   *
   * seegprep writes `model: "n/a"` with the shaft's measured median pitch repeated whenever its own
   * catalogue matched nothing — but *this* module may still know the model, because the table's
   * `model` column and a site part number are keys seegprep never saw. A manufacturer's vector beats
   * a measured median every time, and for the family that motivates this whole file it is the
   * difference between a 3.0 mm first gap and a 5.5 mm one.
   *
   * Taken on its own it is still worth having: it is a per-electrode number to snap and to measure
   * against rather than none at all, it is what the panel's per-gap table is filled from, and it is
   * labelled `sidecar-measured` everywhere it is shown so nobody reads it as a datasheet.
   */
  if (sidecarGaps !== null) {
    return {
      model: 'measured',
      nContacts: sidecar?.nContacts ?? sidecarGaps.length + 1,
      gapsMm: expandGaps([...sidecarGaps], sidecar?.nContacts ?? sidecarGaps.length + 1),
      ...(sidecar?.contactLengthMm == null ? {} : { contactLengthMm: sidecar.contactLengthMm }),
      source: 'sidecar-measured',
    };
  }
  return null;
}

/**
 * `gaps` lengthened to `nContacts − 1` by repeating its last value.
 *
 * Only ever used when a table declares **more** contacts than the catalogue entry has — a site that
 * ordered a longer variant of a family the catalogue knows. Repeating the last gap is the only
 * honest extrapolation: every family in the catalogue whose spacing is non-uniform is non-uniform at
 * the *tip*, and uniform from there out.
 */
function expandGaps(gaps: number[], nContacts: number): number[] {
  const want = Math.max(0, nContacts - 1);
  const last = gaps[gaps.length - 1] ?? 0;
  while (gaps.length < want) gaps.push(last);
  return gaps.slice(0, want);
}

// ---- reading the sources ------------------------------------------------------------------------

function numberOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

function gapsOrNull(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const gaps = value.map(numberOrNull);
  return gaps.every((g): g is number => g !== null && g > 0) ? gaps : null;
}

/**
 * seegprep's `"n/a"` — the string it writes for `model` when its own catalogue matched nothing —
 * read as the absence it is.
 *
 * Taken literally it would be shown to a clinician as an electrode model called *n/a*, and it would
 * stop the resolver looking anywhere else: `"n/a"` is a non-empty string, so a naive reader treats
 * it as an answer. It is not an answer, and the table's `model` column may hold a real one.
 */
function modelOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  if (model === '') return null;
  const lower = model.toLowerCase();
  return lower === 'n/a' || lower === 'na' || lower === 'none' || lower === 'unknown'
    ? null
    : model;
}

function sidecarRow(raw: unknown): GeometrySidecarEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const entry: GeometrySidecarEntry = {
    model: modelOrNull(row['model']),
    contactLengthMm: numberOrNull(row['contact_length_mm']),
    gapsMm: gapsOrNull(row['spacing_gaps_mm']),
    nContacts: numberOrNull(row['n_contacts']),
  };
  return entry.model === null && entry.gapsMm === null && entry.contactLengthMm === null
    ? null
    : entry;
}

/**
 * `sub-<id>_electrodes-geometry.json` (seegprep PR #2) as a map from electrode name to geometry.
 *
 * **The shape seegprep actually writes** (`seegprep/core/characterize.py`, `geometry_summary` and
 * `electrode_geometry`) is a top-level object of detection tallies plus an `electrodes` **array**,
 * each row of which names itself with **`electrode_id`** and carries `n_contacts`, `coords_ras`,
 * `median_spacing_mm`, and the three keys this module wants: `model`, `contact_length_mm` and
 * `spacing_gaps_mm`. That is the shape to read first; two others — a bare object keyed by electrode
 * name, and the same object under `electrodes` — are read as well, because the sidecar is another
 * program's file and this module is a reader of it, not its schema.
 *
 * What is *not* forgiving: a `spacing_gaps_mm` that is not a list of positive finite numbers is
 * discarded rather than repaired, and the electrode falls through to the catalogue. A geometry
 * half-read is a template slid onto the wrong metal. And `model: "n/a"` is read as no model at all
 * (see {@link modelOrNull}), which is what it means.
 *
 * Returns an empty map for anything unreadable, so a corrupt sidecar is "no sidecar".
 */
export function parseGeometrySidecar(text: string): Map<string, GeometrySidecarEntry> {
  const out = new Map<string, GeometrySidecarEntry>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null) return out;
  const root = parsed as Record<string, unknown>;
  const body = root['electrodes'] ?? root;

  if (Array.isArray(body)) {
    for (const raw of body) {
      if (typeof raw !== 'object' || raw === null) continue;
      const row = raw as Record<string, unknown>;
      // `electrode_id` first: it is the key seegprep writes. The rest are fallbacks for a sidecar
      // written by something else, and cost nothing.
      const name = row['electrode_id'] ?? row['name'] ?? row['electrode'] ?? row['group'];
      const entry = sidecarRow(row);
      if (typeof name === 'string' && name !== '' && entry !== null) out.set(name, entry);
    }
    return out;
  }
  if (typeof body !== 'object' || body === null) return out;
  for (const [name, raw] of Object.entries(body as Record<string, unknown>)) {
    // The envelope's own metadata keys are objects too; a row with nothing readable in it is
    // skipped by `sidecarRow`, which is what keeps `{"schema": {...}}` out of the map.
    const entry = sidecarRow(raw);
    if (entry !== null) out.set(name, entry);
  }
  return out;
}

/** One row of the site's `sub-<id>/etc/sub-<id>_electrodes.csv`. */
export interface SiteElectrode {
  name: string;
  partNumber: string | null;
  nContacts: number | null;
  target: string | null;
}

/**
 * The site CSV — `name,target,part_number,n_contacts,csc_first,color,notes`.
 *
 * Read with the same forgiveness the contacts kit's TSV reader has, and for the same reason: the
 * columns are matched case-insensitively by name and a ragged row is truncated rather than refused,
 * because this file is typed by a person. A row with no `name` is skipped; everything else is
 * optional, since the one field this module needs is `part_number` and a site that does not record
 * it still gets a list of electrode names.
 */
export function parseSiteCsv(text: string): Map<string, SiteElectrode> {
  const out = new Map<string, SiteElectrode>();
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');
  const header = lines.shift();
  if (header === undefined) return out;
  const delimiter = header.includes('\t') ? '\t' : header.includes(';') ? ';' : ',';
  const columns = header.split(delimiter).map((c) => c.trim().toLowerCase());
  const at = (...names: string[]): number => {
    for (const name of names) {
      const index = columns.indexOf(name);
      if (index >= 0) return index;
    }
    return -1;
  };
  const iName = at('name', 'electrode', 'label');
  if (iName < 0) return out;
  const iPart = at('part_number', 'part number', 'model', 'part');
  const iCount = at('n_contacts', 'ncontacts', 'contacts');
  const iTarget = at('target');
  const cell = (fields: string[], index: number): string | null => {
    if (index < 0) return null;
    const value = fields[index]?.trim() ?? '';
    return value === '' ? null : value;
  };
  for (const line of lines) {
    const fields = line.split(delimiter);
    const name = cell(fields, iName);
    if (name === null) continue;
    out.set(name, {
      name,
      partNumber: cell(fields, iPart),
      nContacts: numberOrNull(cell(fields, iCount)),
      target: cell(fields, iTarget),
    });
  }
  return out;
}

/**
 * The `model` and `n_contacts` columns the electrodes table already carries, by electrode.
 *
 * A BIDS `electrodes.tsv` states them **per contact row**, so a group's value is whichever its rows
 * agree on; rows that disagree are treated as no answer at all, because an electrode that is two
 * models is a table error and guessing one of them would put a template on the wrong metal.
 */
export function modelsFromTable(set: ContactSet): {
  models: Map<string, string>;
  counts: Map<string, number>;
} {
  const models = new Map<string, string>();
  const counts = new Map<string, number>();
  const conflicted = new Set<string>();
  for (const contact of set.contacts) {
    for (const [key, value] of Object.entries(contact.extra)) {
      const column = key.trim().toLowerCase();
      if (column === 'model' || column === 'part_number') {
        const model = value.trim();
        if (model === '' || model === 'n/a') continue;
        const seen = models.get(contact.group);
        if (seen !== undefined && seen !== model) conflicted.add(contact.group);
        else models.set(contact.group, model);
      } else if (column === 'n_contacts') {
        const n = numberOrNull(value);
        if (n !== null && n > 0) counts.set(contact.group, Math.trunc(n));
      }
    }
  }
  for (const group of conflicted) models.delete(group);
  return { models, counts };
}

// ---- geometry ------------------------------------------------------------------------------------

/** A contact whose peak lands further than this off the fitted axis keeps the template position. */
export const OFF_AXIS_LIMIT_MM = 1.0;

/** A gap this far from the model's is flagged in the panel. */
export const GAP_FLAG_MM = 0.75;

/** The rejection threshold is this many times the first fit's RMS, but never below the floor. */
const OUTLIER_SIGMA = 2.5;
const OUTLIER_FLOOR_MM = 0.5;

export interface AxisFit {
  centroid: vec3;
  /** Unit direction, the kit's sign convention. */
  axis: vec3;
  /** Every input point's signed distance along `axis` from `centroid`, in input order. */
  t: number[];
  /** RMS perpendicular distance of the points the fit **kept**, in millimetres. */
  rmsMm: number;
  /** Indices of the points one rejection pass dropped. */
  rejected: number[];
}

function dot(a: vec3, b: vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** The point on `fit`'s line at signed distance `t` from its centroid. */
export function pointAt(fit: AxisFit, t: number): vec3 {
  return [
    fit.centroid[0] + fit.axis[0] * t,
    fit.centroid[1] + fit.axis[1] * t,
    fit.centroid[2] + fit.axis[2] * t,
  ];
}

/** How far `p` is from `fit`'s line, in millimetres. */
export function offAxisMm(fit: AxisFit, p: vec3): number {
  const along = dot([p[0] - fit.centroid[0], p[1] - fit.centroid[1], p[2] - fit.centroid[2]], fit.axis);
  return distanceMm(p, pointAt(fit, along));
}

function fitAt(points: readonly vec3[], keep: readonly vec3[], rejected: number[]): AxisFit | null {
  const fit = fitLine(keep);
  if (fit === null) return null;
  const t = points.map((p) =>
    dot([p[0] - fit.centroid[0], p[1] - fit.centroid[1], p[2] - fit.centroid[2]], fit.axis)
  );
  return { centroid: fit.centroid, axis: fit.axis, t, rmsMm: fit.rmsMm, rejected };
}

/**
 * A least-squares line through the contacts with **one** outlier-rejection pass.
 *
 * The first fit gives an RMS; anything more than {@link OUTLIER_SIGMA} × RMS off the line — and at
 * least {@link OUTLIER_FLOOR_MM} off it, so a shaft that is already straight does not reject its own
 * noise — is dropped and the line is fitted again through the rest. `t` is then computed for
 * **every** point against that second line, rejected ones included: an outlier still has a position
 * along the shaft, and it is the contact this most needs to move.
 *
 * One pass and no more. Iterating to convergence on ten points is a fit of whichever four agreed,
 * and a rod through four contacts of a ten-contact electrode is a worse axis than a rod through all
 * ten with one bad one in it.
 *
 * `null` for fewer than two contacts, or a degenerate set the kit cannot fit.
 */
export function robustFit(positions: readonly vec3[]): AxisFit | null {
  if (positions.length < 2) return null;
  const first = fitAt(positions, positions, []);
  if (first === null) return null;
  if (positions.length < 4) return first;

  const threshold = Math.max(OUTLIER_SIGMA * first.rmsMm, OUTLIER_FLOOR_MM);
  const rejected: number[] = [];
  const keep: vec3[] = [];
  positions.forEach((p, index) => {
    if (offAxisMm(first, p) > threshold) rejected.push(index);
    else keep.push(p);
  });
  if (rejected.length === 0 || keep.length < 2) return first;
  return fitAt(positions, keep, rejected) ?? first;
}

/**
 * A unit vector perpendicular to `axis`, well-defined for every orientation including vertical.
 *
 * The reference is whichever world basis vector is *least* aligned with `axis`, so the cross
 * product is never near zero — the same construction the drag guide uses, and shared with it so a
 * shaft's perpendicular means one thing in this module.
 */
export function perpendicularTo(axis: vec3): vec3 {
  const ax = Math.abs(axis[0]);
  const ay = Math.abs(axis[1]);
  const az = Math.abs(axis[2]);
  const reference: vec3 = ax <= ay && ax <= az ? [1, 0, 0] : ay <= az ? [0, 1, 0] : [0, 0, 1];
  const perp: vec3 = [
    axis[1] * reference[2] - axis[2] * reference[1],
    axis[2] * reference[0] - axis[0] * reference[2],
    axis[0] * reference[1] - axis[1] * reference[0],
  ];
  const length = Math.hypot(perp[0], perp[1], perp[2]);
  return length > 0 ? [perp[0] / length, perp[1] / length, perp[2] / length] : [0, 0, 0];
}

/** `gapsMm` as cumulative distances from contact 1: `[0, g0, g0+g1, …]`. */
export function cumulativeMm(gapsMm: readonly number[], n: number): number[] {
  const out = [0];
  for (let i = 1; i < n; i += 1) out.push((out[i - 1] as number) + (gapsMm[i - 1] ?? 0));
  return out;
}

/** 3-D gap residuals against the model, tip-first. `measured − model`, flagged past ±0.75 mm. */
export interface GapResidual {
  /** The gap between contact `index` and contact `index + 1`, 1-based. */
  index: number;
  measuredMm: number;
  modelMm: number;
  residualMm: number;
  flagged: boolean;
}

export function gapResiduals(
  positionsTipFirst: readonly vec3[],
  gapsMm: readonly number[]
): GapResidual[] {
  const out: GapResidual[] = [];
  for (let i = 0; i + 1 < positionsTipFirst.length; i += 1) {
    const model = gapsMm[i];
    if (model === undefined) break;
    const measured = distanceMm(positionsTipFirst[i] as vec3, positionsTipFirst[i + 1] as vec3);
    const residual = measured - model;
    out.push({
      index: i + 1,
      measuredMm: measured,
      modelMm: model,
      residualMm: residual,
      flagged: Math.abs(residual) > GAP_FLAG_MM,
    });
  }
  return out;
}

// ---- sliding the template ------------------------------------------------------------------------

/**
 * The intensity oracle: values at arbitrary world points, `NaN` outside the volume.
 *
 * This is `host.scene.sampleVolume` bound to a dataset — injected rather than the host, so the
 * search is a pure function of a point cloud and a test drives it with a synthetic bright profile
 * and no engine at all.
 */
export type SampleFn = (points: readonly vec3[]) => Promise<readonly number[]>;

/** `host.scene.peakCentroid` bound to a dataset. `null` = nothing bright in the box. */
export type PeakFn = (world: vec3, radiusMm: number) => vec3 | null;

export interface SlideOptions {
  /** How far either side of the current tip the template is tried, in millimetres. */
  windowMm?: number;
  coarseStepMm?: number;
  fineStepMm?: number;
  /** The radius of the tube the intensity is averaged over. */
  tubeRadiusMm?: number;
  /** How many points around the tube per contact. `0` samples the axis alone — the fallback path. */
  spokes?: number;
}

const DEFAULTS = {
  windowMm: 6,
  coarseStepMm: 0.25,
  fineStepMm: 0.05,
  tubeRadiusMm: 1,
  spokes: 6,
} as const;

/**
 * The points one candidate offset asks about: each contact's template position, plus a ring of
 * `spokes` points at `tubeRadiusMm` around it.
 *
 * A depth electrode is about 0.8 mm across and a CT voxel is often 0.4–0.6 mm, so a *centre-line*
 * sample is one or two voxels wide and a shaft half a voxel off the fitted axis scores nothing.
 * Averaging over a 1 mm tube makes the score a property of the rod rather than of the sampling
 * grid, which is what lets a 0.25 mm slide have a maximum worth finding.
 */
function tubePoints(
  centre: vec3,
  u: vec3,
  v: vec3,
  tubeRadiusMm: number,
  spokes: number
): vec3[] {
  const points: vec3[] = [centre];
  for (let s = 0; s < spokes; s += 1) {
    const angle = (2 * Math.PI * s) / spokes;
    const cos = Math.cos(angle) * tubeRadiusMm;
    const sin = Math.sin(angle) * tubeRadiusMm;
    points.push([
      centre[0] + u[0] * cos + v[0] * sin,
      centre[1] + u[1] * cos + v[1] * sin,
      centre[2] + u[2] * cos + v[2] * sin,
    ]);
  }
  return points;
}

/** The mean of the finite values, or `null` when fewer than half of them are finite. */
function meanFinite(values: readonly number[]): number | null {
  let sum = 0;
  let n = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    n += 1;
  }
  return n * 2 < values.length ? null : n === 0 ? null : sum / n;
}

function gridOf(centre: number, halfWidth: number, step: number): number[] {
  const out: number[] = [];
  const count = Math.max(1, Math.round(halfWidth / step));
  for (let k = -count; k <= count; k += 1) out.push(centre + k * step);
  return out;
}

export interface SlideResult {
  /** The `t` along the fitted axis at which contact 1 sits. */
  tStart: number;
  /** The mean tube intensity the winning offset scored. */
  score: number;
}

/**
 * Slide the gap template along the axis and keep the offset that lies on the brightest metal.
 *
 * **One free parameter.** The gaps are the manufacturer's and are not adjusted, so the search
 * cannot make a wrong model fit by stretching it — a template that scores badly everywhere is a
 * model that is wrong, and the panel's residuals are what say so.
 *
 * Two passes: 0.25 mm across the whole window, then 0.05 mm across one coarse step either side of
 * the winner. Both are **one** `sample` call each, because the oracle is a bounded batch read and
 * forty-nine calls of seventy points is forty-eight more round trips than one call of 3,430.
 *
 * `null` when the oracle answered for nothing — every candidate outside the volume, or a volume
 * with no scalar to give. The caller then leaves the contacts where they are, which is the same
 * promise `snapContacts` makes about a contact with no metal near it.
 */
export async function slideTemplate(
  fit: AxisFit,
  tTip: number,
  direction: 1 | -1,
  cumulative: readonly number[],
  sample: SampleFn,
  options: SlideOptions = {}
): Promise<SlideResult | null> {
  const windowMm = options.windowMm ?? DEFAULTS.windowMm;
  const coarseStepMm = options.coarseStepMm ?? DEFAULTS.coarseStepMm;
  const fineStepMm = options.fineStepMm ?? DEFAULTS.fineStepMm;
  const tubeRadiusMm = options.tubeRadiusMm ?? DEFAULTS.tubeRadiusMm;
  const spokes = options.spokes ?? DEFAULTS.spokes;

  const u = perpendicularTo(fit.axis);
  const v: vec3 = [
    fit.axis[1] * u[2] - fit.axis[2] * u[1],
    fit.axis[2] * u[0] - fit.axis[0] * u[2],
    fit.axis[0] * u[1] - fit.axis[1] * u[0],
  ];

  const scoreGrid = async (grid: readonly number[]): Promise<SlideResult | null> => {
    const points: vec3[] = [];
    for (const tStart of grid) {
      for (const offset of cumulative) {
        points.push(...tubePoints(pointAt(fit, tStart + direction * offset), u, v, tubeRadiusMm, spokes));
      }
    }
    if (points.length === 0) return null;
    const values = await sample(points);
    const per = (spokes + 1) * cumulative.length;
    let best: SlideResult | null = null;
    for (const [index, tStart] of grid.entries()) {
      const slice = values.slice(index * per, (index + 1) * per);
      const score = meanFinite(slice as number[]);
      if (score === null) continue;
      if (best === null || score > best.score) best = { tStart, score };
    }
    return best;
  };

  const coarse = await scoreGrid(gridOf(tTip, windowMm, coarseStepMm));
  if (coarse === null) return null;
  const fine = await scoreGrid(gridOf(coarse.tStart, coarseStepMm, fineStepMm));
  return fine === null || fine.score < coarse.score ? coarse : fine;
}

// ---- the two edits --------------------------------------------------------------------------------

export interface ModelSnapPlan {
  /** One position per contact, in the tip-first order handed in. */
  positions: vec3[];
  /** `t` of contact 1 along the fitted axis after the slide. */
  tStart: number;
  /** How many contacts landed on a `peakCentroid` answer rather than the bare template position. */
  peaked: number;
  /** How many peak answers were refused for landing more than 1 mm off the axis. */
  offAxisRejected: number;
  /** How many contacts the fit's one rejection pass dropped before fitting the axis. */
  outliers: number;
  residuals: GapResidual[];
}

/**
 * Move each template position onto the local peak, unless the peak is not on this shaft.
 *
 * The refusal is the point (see the file header): `peakCentroid` weighs everything bright in its
 * box, and the brightest thing near a contact is often the *neighbouring* electrode. A peak more
 * than {@link OFF_AXIS_LIMIT_MM} off the fitted line is therefore not this rod's metal, and the
 * contact stays on the template — which is a position derived from the manufacturer's geometry and
 * the shaft's own axis, and is never nothing.
 */
function peakOrTemplate(
  template: readonly vec3[],
  fit: AxisFit,
  peak: PeakFn,
  snapRadiusMm: number
): { positions: vec3[]; peaked: number; offAxisRejected: number } {
  let peaked = 0;
  let offAxisRejected = 0;
  const positions = template.map((point) => {
    const found = peak(point, snapRadiusMm);
    if (found === null) return point;
    if (offAxisMm(fit, found) > OFF_AXIS_LIMIT_MM) {
      offAxisRejected += 1;
      return point;
    }
    peaked += 1;
    return [...found] as vec3;
  });
  return { positions, peaked, offAxisRejected };
}

export interface ModelSnapInput {
  /** The electrode's current contact positions, **tip-first** — contact 1 at index 0. */
  positionsTipFirst: readonly vec3[];
  /** The model's gaps, tip-first. Only the first `n − 1` are used for `n` present contacts. */
  gapsMm: readonly number[];
  sample: SampleFn;
  peak: PeakFn;
  snapRadiusMm: number;
  options?: SlideOptions;
}

/**
 * Snap one electrode onto its model: robust fit → slide the template → per-contact peak.
 *
 * The present contacts are taken to occupy the model's **first** `n` slots, which is what a
 * partially localised shaft is: a localiser finds the deep contacts, whose metal is surrounded by
 * brain, and loses the shallow ones in the skull's own brightness. A shaft missing a *middle*
 * contact is a shaft this will mis-template, and the per-gap residuals in the panel are what say so
 * — which is why they are printed rather than merely checked.
 *
 * `null` for fewer than two contacts (nothing to fit an axis through) or when the oracle answered
 * for nothing at all. Nothing is mutated; the caller applies the plan as one history entry.
 */
export async function planModelSnap(input: ModelSnapInput): Promise<ModelSnapPlan | null> {
  const positions = input.positionsTipFirst;
  if (positions.length < 2) return null;
  const fit = robustFit(positions);
  if (fit === null) return null;

  const cumulative = cumulativeMm(input.gapsMm, positions.length);
  // Which way along the fitted axis the numbering runs. The axis's sign is the kit's canonical one
  // and has nothing to do with anatomy, so it is read off the contacts rather than assumed.
  const direction: 1 | -1 =
    (fit.t[positions.length - 1] as number) >= (fit.t[0] as number) ? 1 : -1;

  const slid = await slideTemplate(
    fit,
    fit.t[0] as number,
    direction,
    cumulative,
    input.sample,
    input.options
  );
  if (slid === null) return null;

  const template = cumulative.map((offset) => pointAt(fit, slid.tStart + direction * offset));
  const { positions: snapped, peaked, offAxisRejected } = peakOrTemplate(
    template,
    fit,
    input.peak,
    input.snapRadiusMm
  );
  return {
    positions: snapped,
    tStart: slid.tStart,
    peaked,
    offAxisRejected,
    outliers: fit.rejected.length,
    residuals: gapResiduals(snapped, input.gapsMm),
  };
}

export interface ExtendInput {
  positionsTipFirst: readonly vec3[];
  gapsMm: readonly number[];
  /** The model's contact count. Nothing is added when the electrode already has that many. */
  nContacts: number;
  peak: PeakFn;
  snapRadiusMm: number;
}

/**
 * The positions of the contacts this electrode is missing, placed **beyond the entry end**.
 *
 * Which end that is comes from the tip-first order the caller hands over — contact 1 is the deep
 * end (`shaft.ts`'s rule and the user's own flip), so the missing contacts continue away from it,
 * out toward the skull, at the model's own remaining gaps. That is where they physically are: a
 * localiser loses the shallow contacts to the skull's brightness, not the deep ones.
 *
 * Each new position is then snapped like any other, with the same off-axis refusal — so a contact
 * placed into bone finds nothing, stays exactly on the model's grid, and is honestly `added`.
 *
 * `null` when there is no axis to extend along or nothing missing.
 */
export function extendAlongAxis(input: ExtendInput): vec3[] | null {
  const present = input.positionsTipFirst.length;
  const missing = input.nContacts - present;
  if (missing <= 0 || present < 2) return null;
  const fit = robustFit(input.positionsTipFirst);
  if (fit === null) return null;
  const direction: 1 | -1 = (fit.t[present - 1] as number) >= (fit.t[0] as number) ? 1 : -1;

  const out: vec3[] = [];
  let t = fit.t[present - 1] as number;
  for (let k = 0; k < missing; k += 1) {
    // `gapsMm[present - 1 + k]` is the gap leading *into* the contact being added — the model's own
    // spacing at that slot, which for a Behnke-Fried lead is not the same as the gap before it.
    const gap = input.gapsMm[present - 1 + k];
    if (gap === undefined) break;
    t += direction * gap;
    const point = pointAt(fit, t);
    const found = input.peak(point, input.snapRadiusMm);
    const accepted = found !== null && offAxisMm(fit, found) <= OFF_AXIS_LIMIT_MM;
    out.push(accepted ? ([...(found as vec3)] as vec3) : point);
    // The next slot continues from the model's grid, not from where the peak pulled this one: an
    // extension that chained its own snaps would accumulate their error down the shaft.
  }
  return out.length === 0 ? null : out;
}

/** The electrodes of a set that have fewer contacts than their model says, and by how many. */
export function missingCounts(
  set: ContactSet,
  models: ReadonlyMap<string, ElectrodeModel | null>
): { electrode: string; present: number; expected: number }[] {
  const out: { electrode: string; present: number; expected: number }[] = [];
  for (const group of set.groups) {
    const model = models.get(group.name) ?? null;
    if (model === null) continue;
    const present = contactsOf(set, group.name).length;
    if (present < model.nContacts) {
      out.push({ electrode: group.name, present, expected: model.nContacts });
    }
  }
  return out;
}
