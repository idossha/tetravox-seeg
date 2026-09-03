/**
 * Catalogue-aware snapping: the model resolution, the template slide, and the extension.
 *
 * The lead these suites are built around is a real one — an Ad-Tech Behnke-Fried, `3.0` mm between
 * contacts 1 and 2 and `5.5` mm from there out — because it is the electrode the *old* behaviour
 * gets wrong: re-spacing at the observed median gap puts contact 2 two and a half millimetres off
 * the metal it is inside, and every number the panel then prints about that shaft is
 * self-consistent and wrong. So the assertion that matters is the first one: from a start shifted
 * 2 mm along the axis, the template locks back onto the true offset and the residuals are under
 * 0.1 mm.
 *
 * The oracles are synthetic and **not** a re-implementation of the engine: `sampleVolume` here is a
 * Gaussian bump at each true contact position and `peakCentroid` answers with the nearest true
 * position inside its radius. That is the shape of what a CT gives back, and it is enough to hold
 * the search to its contract without asserting against a second copy of `derived/voxel-box.ts`.
 */

import { describe, expect, it } from 'vitest';
import { HAS_CONTACTS } from './setup';
import type { ContactSet, vec3 } from '@tetravox/module-sdk';
import { contacts } from '@tetravox/module-sdk';
import { CATALOGUE } from '../src/catalogue.gen';
import type { CatalogueEntry, PeakFn, SampleFn } from '../src/modelsnap';
import {
  extendAlongAxis,
  gapResiduals,
  lookupCatalogue,
  modelsFromTable,
  parseGeometrySidecar,
  parseSiteCsv,
  planModelSnap,
  resolveElectrodeModel,
  robustFit,
} from '../src/modelsnap';

/** The Behnke-Fried gaps: 3.0 mm between 1 and 2, then 5.5 mm eight times. Ten contacts. */
const BF_GAPS = [3, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5];

/** A uniform RD-style lead: ten contacts, 5 mm throughout. */
const RD_GAPS = [5, 5, 5, 5, 5, 5, 5, 5, 5];

/** A straight shaft along a deliberately oblique unit direction, so no axis is special. */
const AXIS: vec3 = [0.6, 0.48, 0.64];
const ORIGIN: vec3 = [10, -20, 30];

function along(t: number): vec3 {
  return [ORIGIN[0] + AXIS[0] * t, ORIGIN[1] + AXIS[1] * t, ORIGIN[2] + AXIS[2] * t];
}

/** Cumulative offsets of a gap list — the `t` of each contact from the tip. */
function offsets(gaps: readonly number[]): number[] {
  const out = [0];
  for (const gap of gaps) out.push((out[out.length - 1] as number) + gap);
  return out;
}

function distance(a: vec3, b: vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * A bright profile at `truth`: each sample is the largest Gaussian bump any true contact makes at
 * it, so the value falls off with distance from the metal exactly as a CT's does near a shaft.
 */
function brightAt(truth: readonly vec3[]): SampleFn {
  const sigma = 1.2;
  return (points) =>
    Promise.resolve(
      points.map((p) => {
        let best = 0;
        for (const t of truth) {
          const d = distance(p, t);
          best = Math.max(best, Math.exp(-(d * d) / (2 * sigma * sigma)));
        }
        return best;
      })
    );
}

/** `peakCentroid`: the nearest true contact inside the radius, or nothing. */
function peakAt(truth: readonly vec3[]): PeakFn {
  return (world, radiusMm) => {
    let best: vec3 | null = null;
    let bestD = Infinity;
    for (const t of truth) {
      const d = distance(world, t);
      if (d <= radiusMm && d < bestD) {
        best = t;
        bestD = d;
      }
    }
    return best === null ? null : ([...best] as vec3);
  };
}

describe('the bundled catalogue', () => {
  it('is generated, non-empty, and states n − 1 gaps for every model', () => {
    expect(CATALOGUE.length).toBeGreaterThan(0);
    for (const entry of CATALOGUE) {
      expect(entry.gapsMm.length, entry.model).toBe(entry.nContacts - 1);
      expect(entry.gapsMm.every((g) => Number.isFinite(g) && g > 0), entry.model).toBe(true);
    }
  });

  it('expands seegprep’s scalar pitch and keeps its per-gap lists — the round trip', () => {
    // `RD10R-SP05X` is a scalar 5.0 in seegprep's catalogue: ten contacts, nine equal gaps here.
    const uniform = CATALOGUE.find((e) => e.model === 'RD10R-SP05X');
    expect(uniform?.gapsMm).toEqual([5, 5, 5, 5, 5, 5, 5, 5, 5]);
    // `D08-15CM` is the one entry whose spacing is a *list*, and it must survive verbatim.
    const listed = CATALOGUE.find((e) => e.model === 'D08-15CM');
    expect(listed?.nContacts).toBe(15);
    expect(listed?.gapsMm).toEqual([3.5, 3.5, 3.5, 3.5, 13, 3.5, 3.5, 3.5, 3.5, 13, 3.5, 3.5, 3.5, 3.5]);
  });

  it('matches a part number by case-insensitive prefix, longest key first', () => {
    // The whole reason the match is a prefix: a site's part number carries option suffixes.
    expect(lookupCatalogue('BF10R-SP21X-0C3')?.model).toBe('BF10R-SP21X');
    expect(lookupCatalogue('bf10r-sp21x')?.model).toBe('BF10R-SP21X');
    expect(lookupCatalogue('  RD10R-SP05X-XYZ  ')?.model).toBe('RD10R-SP05X');
    expect(lookupCatalogue('NOT-A-MODEL')).toBeNull();
    expect(lookupCatalogue('')).toBeNull();

    const two: CatalogueEntry[] = [
      { model: 'AB', nContacts: 2, gapsMm: [5] },
      { model: 'AB-LONG', nContacts: 3, gapsMm: [5, 5] },
    ];
    expect(lookupCatalogue('AB-LONG-1', two)?.model).toBe('AB-LONG');
  });
});

describe('resolveElectrodeModel', () => {
  it('prefers the subject’s own geometry sidecar over the catalogue', () => {
    const sidecar = parseGeometrySidecar(
      JSON.stringify({
        LHIP: { model: 'BF10R-SP21X', contact_length_mm: 1.57, spacing_gaps_mm: BF_GAPS },
      })
    );
    const model = resolveElectrodeModel('LHIP', {
      sidecar,
      // The catalogue says this family is uniformly 5 mm; the sidecar says otherwise, and the
      // sidecar was written for *this* implant.
      tableModels: new Map([['LHIP', 'BF10R-SP21X']]),
    });
    expect(model).not.toBeNull();
    expect(model?.source).toBe('sidecar');
    expect(model?.gapsMm).toEqual(BF_GAPS);
    expect(model?.nContacts).toBe(10);
    expect(model?.contactLengthMm).toBe(1.57);
  });

  it('falls back to the catalogue, keyed by the table’s model column', () => {
    const model = resolveElectrodeModel('LAMY', {
      tableModels: new Map([['LAMY', 'RD10R-SP05X']]),
    });
    expect(model?.source).toBe('catalogue');
    expect(model?.gapsMm).toEqual(RD_GAPS);
  });

  it('falls back to the catalogue keyed by the site CSV’s part-number prefix', () => {
    const model = resolveElectrodeModel('LAMY', {
      partNumbers: new Map([['LAMY', 'BF10R-SP21X-0C3']]),
    });
    expect(model?.model).toBe('BF10R-SP21X');
    expect(model?.source).toBe('catalogue');
  });

  it('uses a sidecar that names a model without stating its gaps as a catalogue key', () => {
    const sidecar = parseGeometrySidecar(JSON.stringify({ LAMY: { model: 'RD10R-SP05X' } }));
    const model = resolveElectrodeModel('LAMY', { sidecar });
    expect(model?.source).toBe('catalogue');
    expect(model?.nContacts).toBe(10);
  });

  it('resolves nothing at all rather than guessing — the supported no-catalogue state', () => {
    expect(resolveElectrodeModel('LAMY', {})).toBeNull();
    expect(resolveElectrodeModel('LAMY', { catalogue: [] })).toBeNull();
    expect(resolveElectrodeModel('LAMY', { tableModels: new Map([['LAMY', 'MYSTERY-9']]) })).toBeNull();
  });
});


/**
 * The envelope `seegprep` actually writes, copied from `seegprep/core/characterize.py`
 * (`geometry_summary` + `electrode_geometry`): top-level detection tallies plus an `electrodes`
 * **array**, each row naming itself with `electrode_id`.
 *
 * Two rows, because the two cases are different files as far as this module is concerned: L-HIP
 * matched seegprep's catalogue (a real `model`, the catalogue's per-gap vector), and L-AMY did not
 * — so seegprep wrote `model: "n/a"` and filled `spacing_gaps_mm` with the shaft's own
 * `median_spacing_mm`, repeated, which is a nominal to compare against and is *not* a datasheet.
 */
const SEEGPREP_SIDECAR = JSON.stringify({
  n_candidate_contacts: 214,
  n_assigned: 18,
  n_unassigned: 4,
  n_electrodes: 2,
  spacing_estimate_mm: 5.0,
  params: { spacing_tol_mm: 1.5 },
  electrodes: [
    {
      electrode_id: 'L-HIP',
      n_contacts: 10,
      n_raw: 12,
      n_trimmed_bolt: 2,
      contact_cids: [],
      coords_ras: [
        [10, -20, 30],
        [11.8, -18.56, 31.92],
      ],
      trimmed_ras: [],
      axis: [0.6, 0.48, 0.64],
      median_spacing_mm: 5.5,
      spacing_cv: 0.11,
      line_rms_mm: 0.21,
      line_max_dev_mm: 0.4,
      tip_ras: [10, -20, 30],
      entry_ras: [37.2, -0.24, 59.04],
      model: 'BF10R-SP21X',
      contact_length_mm: 1.57,
      spacing_gaps_mm: [3, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5, 5.5],
    },
    {
      electrode_id: 'L-AMY',
      n_contacts: 8,
      n_raw: 8,
      n_trimmed_bolt: 0,
      contact_cids: [],
      coords_ras: [[0, 0, 0]],
      trimmed_ras: [],
      axis: [1, 0, 0],
      median_spacing_mm: 4.982,
      spacing_cv: 0.04,
      line_rms_mm: 0.18,
      line_max_dev_mm: 0.3,
      tip_ras: [0, 0, 0],
      entry_ras: [34.87, 0, 0],
      // seegprep's own catalogue matched nothing: "n/a", and the gaps are the measured median
      // repeated to n_contacts − 1.
      model: 'n/a',
      contact_length_mm: null,
      spacing_gaps_mm: [4.982, 4.982, 4.982, 4.982, 4.982, 4.982, 4.982],
    },
  ],
});

describe('the sidecar seegprep really writes', () => {
  it('names each row by electrode_id, inside the electrodes array', () => {
    const rows = parseGeometrySidecar(SEEGPREP_SIDECAR);
    expect([...rows.keys()]).toEqual(['L-HIP', 'L-AMY']);
    expect(rows.get('L-HIP')?.model).toBe('BF10R-SP21X');
    expect(rows.get('L-HIP')?.contactLengthMm).toBe(1.57);
    expect(rows.get('L-HIP')?.nContacts).toBe(10);
    // The top-level tallies and `params` are not electrodes, and reading the array means they never
    // had a chance to become one.
    expect(rows.has('params')).toBe(false);
    expect(rows.has('n_electrodes')).toBe(false);
  });

  it('reads seegprep’s "n/a" as no model at all, not as a model called n/a', () => {
    const rows = parseGeometrySidecar(SEEGPREP_SIDECAR);
    // Taken literally this would be shown to a clinician as an electrode model named "n/a", and
    // would stop the resolver from ever consulting the table's own `model` column.
    expect(rows.get('L-AMY')?.model).toBeNull();
    expect(rows.get('L-AMY')?.gapsMm).toHaveLength(7);
    expect(rows.get('L-AMY')?.contactLengthMm).toBeNull();
  });

  it('takes the sidecar’s per-gap vector for the electrode seegprep did match', () => {
    const model = resolveElectrodeModel('L-HIP', {
      sidecar: parseGeometrySidecar(SEEGPREP_SIDECAR),
    });
    expect(model?.source).toBe('sidecar');
    expect(model?.model).toBe('BF10R-SP21X');
    expect(model?.gapsMm).toEqual(BF_GAPS);
    expect(model?.nContacts).toBe(10);
  });

  it('lets a table’s model column beat the n/a row’s measured pitch', () => {
    // The point of reading "n/a" as absence: seegprep never saw the table's `model` column, so a
    // real manufacturer's vector is still available and is strictly better than a repeated median.
    const model = resolveElectrodeModel('L-AMY', {
      sidecar: parseGeometrySidecar(SEEGPREP_SIDECAR),
      tableModels: new Map([['L-AMY', 'RD10R-SP05X']]),
    });
    expect(model?.source).toBe('catalogue');
    expect(model?.model).toBe('RD10R-SP05X');
  });

  it('falls back to the measured pitch, labelled as measured, when nothing else knows', () => {
    const model = resolveElectrodeModel('L-AMY', {
      sidecar: parseGeometrySidecar(SEEGPREP_SIDECAR),
    });
    expect(model?.source).toBe('sidecar-measured');
    // Named `measured`, never a part number: the panel prints this and nobody may read it as a
    // datasheet.
    expect(model?.model).toBe('measured');
    expect(model?.nContacts).toBe(8);
    expect(model?.gapsMm).toEqual([4.982, 4.982, 4.982, 4.982, 4.982, 4.982, 4.982]);
    expect(model?.contactLengthMm).toBeUndefined();
  });
});

describe('parseGeometrySidecar', () => {
  it('reads the three envelopes seegprep might write, and only the numbers it can trust', () => {
    const flat = parseGeometrySidecar(JSON.stringify({ A: { spacing_gaps_mm: [3, 5.5] } }));
    expect(flat.get('A')?.gapsMm).toEqual([3, 5.5]);

    const nested = parseGeometrySidecar(
      JSON.stringify({ schema: 'x', electrodes: { A: { spacing_gaps_mm: [5] } } })
    );
    expect(nested.get('A')?.gapsMm).toEqual([5]);

    const listed = parseGeometrySidecar(
      JSON.stringify({ electrodes: [{ name: 'A', model: 'RD10R-SP05X' }] })
    );
    expect(listed.get('A')?.model).toBe('RD10R-SP05X');
  });

  it('discards a spacing list it cannot trust rather than repairing it', () => {
    // A half-read geometry is a template slid onto the wrong metal, so a bad gap voids the list and
    // the electrode falls through to the catalogue.
    const bad = parseGeometrySidecar(JSON.stringify({ A: { model: 'X', spacing_gaps_mm: [5, 0] } }));
    expect(bad.get('A')?.gapsMm).toBeNull();
    expect(bad.get('A')?.model).toBe('X');
    expect(parseGeometrySidecar('not json').size).toBe(0);
    expect(parseGeometrySidecar('[]').size).toBe(0);
  });
});

describe('parseSiteCsv', () => {
  it('reads the site’s own columns, and skips a row with no name', () => {
    const rows = parseSiteCsv(
      'name,target,part_number,n_contacts,csc_first,color,notes\n' +
        'LHIP,hippocampus,BF10R-SP21X-0C3,10,1,#ff0000,\n' +
        ',nothing,RD10R-SP05X,10,11,#00ff00,\n' +
        'LAMY,amygdala,,,21,#0000ff,no part number recorded\n'
    );
    expect(rows.size).toBe(2);
    expect(rows.get('LHIP')?.partNumber).toBe('BF10R-SP21X-0C3');
    expect(rows.get('LHIP')?.nContacts).toBe(10);
    expect(rows.get('LAMY')?.partNumber).toBeNull();
    expect(rows.get('LAMY')?.target).toBe('amygdala');
  });
});

describe.skipIf(!HAS_CONTACTS)('modelsFromTable', () => {
  const row = (group: string, ordinal: number, extra: Record<string, string>) => ({
    id: `${group}${ordinal}`,
    name: `${group}${ordinal}`,
    group,
    ordinal,
    position: along(ordinal) as vec3,
    original: null,
    originalName: null,
    loadedStatus: null,
    extra,
  });

  it('reads the model and n_contacts columns a BIDS table already carries', () => {
    const set: ContactSet = {
      groups: [{ name: 'LHIP', color: [1, 0, 0, 1], tip: 'auto' }],
      contacts: [
        row('LHIP', 1, { model: 'BF10R-SP21X', n_contacts: '10' }),
        row('LHIP', 2, { model: 'BF10R-SP21X', n_contacts: '10' }),
      ],
    };
    const { models, counts } = modelsFromTable(set);
    expect(models.get('LHIP')).toBe('BF10R-SP21X');
    expect(counts.get('LHIP')).toBe(10);
  });

  it('refuses an electrode whose rows disagree about which model it is', () => {
    const set: ContactSet = {
      groups: [{ name: 'LHIP', color: [1, 0, 0, 1], tip: 'auto' }],
      contacts: [
        row('LHIP', 1, { model: 'BF10R-SP21X' }),
        row('LHIP', 2, { model: 'RD10R-SP05X' }),
      ],
    };
    expect(modelsFromTable(set).models.has('LHIP')).toBe(false);
  });
});

describe.skipIf(!HAS_CONTACTS)('robustFit', () => {
  it('rejects one contact dragged off the shaft, and still gives it a position along the axis', () => {
    const points = offsets(RD_GAPS).map((t) => along(t));
    // Contact 5 pushed 4 mm sideways — the case a plain least-squares fit lets tilt the whole rod.
    const perp: vec3 = [-AXIS[1], AXIS[0], 0];
    const norm = Math.hypot(perp[0], perp[1], perp[2]);
    const bad = points[4] as vec3;
    points[4] = [
      bad[0] + (perp[0] / norm) * 4,
      bad[1] + (perp[1] / norm) * 4,
      bad[2] + (perp[2] / norm) * 4,
    ];

    const fit = robustFit(points);
    expect(fit).not.toBeNull();
    expect(fit?.rejected).toEqual([4]);
    // The axis is the shaft's, not the outlier's: the RMS of what was kept is essentially zero.
    expect(fit?.rmsMm ?? 1).toBeLessThan(1e-6);
    // And the rejected contact still has a `t` — it is the one this most wants to move.
    expect(fit?.t.length).toBe(points.length);
  });

  it('does not reject anything from a straight shaft, and needs two contacts', () => {
    const fit = robustFit(offsets(RD_GAPS).map((t) => along(t)));
    expect(fit?.rejected).toEqual([]);
    expect(robustFit([along(0)])).toBeNull();
  });
});

describe.skipIf(!HAS_CONTACTS)('planModelSnap', () => {
  it('locks a Behnke-Fried template back onto the true offset from a 2 mm shifted start', async () => {
    const truth = offsets(BF_GAPS).map((t) => along(t));
    // What the localiser handed over: the whole shaft 2 mm along the axis, evenly spaced at 5.5 mm
    // — which is what re-fitting a BF lead at its median gap produces, and is wrong at contact 2.
    const start = truth.map((_p, i) => along(2 + i * 5.5));

    const plan = await planModelSnap({
      positionsTipFirst: start,
      gapsMm: BF_GAPS,
      sample: brightAt(truth),
      peak: peakAt(truth),
      snapRadiusMm: 1.5,
    });

    expect(plan).not.toBeNull();
    const residuals = plan?.residuals ?? [];
    expect(residuals).toHaveLength(BF_GAPS.length);
    for (const gap of residuals) {
      expect(Math.abs(gap.residualMm), `gap ${gap.index}`).toBeLessThan(0.1);
      expect(gap.flagged).toBe(false);
    }
    // The template landed on the metal, so every contact is within a fraction of a millimetre of
    // where the lead really is — including contact 2, which the 5.5 mm re-spacing had 2.5 mm off.
    plan?.positions.forEach((p, i) => {
      expect(distance(p, truth[i] as vec3), `contact ${i + 1}`).toBeLessThan(0.1);
    });
    expect(plan?.peaked).toBe(truth.length);
    expect(plan?.offAxisRejected).toBe(0);
  });

  it('keeps the on-axis template position when the peak is another shaft’s metal', async () => {
    const truth = offsets(RD_GAPS).map((t) => along(t));
    // A neighbouring electrode 3 mm to the side, brighter to `peakCentroid` for one contact only.
    const perp: vec3 = [-AXIS[1], AXIS[0], 0];
    const norm = Math.hypot(perp[0], perp[1], perp[2]);
    const intruder: vec3 = [
      (truth[3] as vec3)[0] + (perp[0] / norm) * 2.5,
      (truth[3] as vec3)[1] + (perp[1] / norm) * 2.5,
      (truth[3] as vec3)[2] + (perp[2] / norm) * 2.5,
    ];
    const peak: PeakFn = (world, radiusMm) => {
      if (distance(world, intruder) <= radiusMm) return [...intruder] as vec3;
      return peakAt(truth)(world, radiusMm);
    };

    const plan = await planModelSnap({
      positionsTipFirst: truth,
      gapsMm: RD_GAPS,
      sample: brightAt(truth),
      peak,
      // Wide enough that the intruder is inside the box, which is the situation the refusal exists
      // for: a big radius is what a user reaches for on a noisy CT.
      snapRadiusMm: 3,
    });

    expect(plan?.offAxisRejected).toBe(1);
    // Refused, so contact 4 sits on the template — not 2.5 mm sideways on the neighbour.
    expect(distance(plan?.positions[3] as vec3, intruder)).toBeGreaterThan(2);
    expect(distance(plan?.positions[3] as vec3, truth[3] as vec3)).toBeLessThan(0.1);
  });

  it('answers null when the oracle has nothing to say, so nothing moves', async () => {
    const start = offsets(RD_GAPS).map((t) => along(t));
    const plan = await planModelSnap({
      positionsTipFirst: start,
      gapsMm: RD_GAPS,
      // Every point outside the volume: `NaN`, which is what `sampleVolume` answers there.
      sample: (points) => Promise.resolve(points.map(() => Number.NaN)),
      peak: () => null,
      snapRadiusMm: 1.5,
    });
    expect(plan).toBeNull();
  });

  it('needs two contacts before there is an axis to slide along', async () => {
    const plan = await planModelSnap({
      positionsTipFirst: [along(0)],
      gapsMm: RD_GAPS,
      sample: brightAt([along(0)]),
      peak: peakAt([along(0)]),
      snapRadiusMm: 1.5,
    });
    expect(plan).toBeNull();
  });
});

describe.skipIf(!HAS_CONTACTS)('gapResiduals', () => {
  it('is 3-D, signed, and flags past 0.75 mm', () => {
    const gaps = gapResiduals([along(0), along(5), along(11)], [5, 5]);
    expect(gaps[0]?.residualMm).toBeCloseTo(0, 6);
    expect(gaps[0]?.flagged).toBe(false);
    expect(gaps[1]?.residualMm).toBeCloseTo(1, 6);
    expect(gaps[1]?.flagged).toBe(true);
  });

  it('stops where the model stops, rather than inventing a gap', () => {
    expect(gapResiduals([along(0), along(5), along(10)], [5])).toHaveLength(1);
  });
});

describe.skipIf(!HAS_CONTACTS)('extendAlongAxis', () => {
  it('adds exactly the missing contacts, beyond the entry end, at the model’s spacing', () => {
    const truth = offsets(BF_GAPS).map((t) => along(t));
    // Only the six deep contacts were localised; four are missing at the entry end.
    const present = truth.slice(0, 6);
    const added = extendAlongAxis({
      positionsTipFirst: present,
      gapsMm: BF_GAPS,
      nContacts: 10,
      peak: peakAt(truth),
      snapRadiusMm: 1.5,
    });

    expect(added).toHaveLength(4);
    added?.forEach((p, k) => {
      // Slot 7, 8, 9, 10 — beyond the last present contact, away from the tip.
      expect(distance(p, truth[6 + k] as vec3), `added ${k}`).toBeLessThan(0.1);
      expect(distance(p, truth[0] as vec3)).toBeGreaterThan(distance(present[5] as vec3, truth[0] as vec3));
    });
  });

  it('stays on the model’s grid where the CT has nothing — a contact in the skull', () => {
    const present = offsets(BF_GAPS).slice(0, 6).map((t) => along(t));
    const added = extendAlongAxis({
      positionsTipFirst: present,
      gapsMm: BF_GAPS,
      nContacts: 8,
      peak: () => null,
      snapRadiusMm: 1.5,
    });
    expect(added).toHaveLength(2);
    // 5.5 mm out from the last present contact, exactly as the model says.
    expect(distance(added?.[0] as vec3, present[5] as vec3)).toBeCloseTo(5.5, 6);
    expect(distance(added?.[1] as vec3, added?.[0] as vec3)).toBeCloseTo(5.5, 6);
  });

  it('adds nothing to a complete electrode, and nothing it has no axis for', () => {
    const present = offsets(RD_GAPS).map((t) => along(t));
    expect(
      extendAlongAxis({ positionsTipFirst: present, gapsMm: RD_GAPS, nContacts: 10, peak: () => null, snapRadiusMm: 1.5 })
    ).toBeNull();
    expect(
      extendAlongAxis({ positionsTipFirst: [along(0)], gapsMm: RD_GAPS, nContacts: 10, peak: () => null, snapRadiusMm: 1.5 })
    ).toBeNull();
  });
});

describe.skipIf(!HAS_CONTACTS)('a uniform lead with no model', () => {
  it('is left to the kit’s even re-spacing, unchanged', () => {
    // The no-catalogue state is not a degraded one: with nothing resolved, `respaceEven` — which is
    // what Re-fit uses and what this feature deliberately does not touch — still puts a uniform
    // lead exactly on its own median grid.
    const { respaceEven } = contacts;
    const noisy = offsets(RD_GAPS).map((t, i) => along(t + (i % 2 === 0 ? 0.05 : -0.05)));
    expect(resolveElectrodeModel('LAMY', {})).toBeNull();
    const spaced = respaceEven(noisy) as vec3[];
    // Every gap is the same, and it is the shaft's own **median** observed gap — not the model's
    // 5 mm, because there is no model. That is the fallback, stated: with no catalogue the module
    // does exactly what it did before this feature existed.
    const gaps = spaced.slice(1).map((p, i) => distance(spaced[i] as vec3, p));
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0] as number, 9);
    expect(gaps[0]).toBeCloseTo(4.9, 6);
  });
});
