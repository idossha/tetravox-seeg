/**
 * The panel's rendered markup, offscreen.
 *
 * `renderToStaticMarkup` is the whole harness: no jsdom, no window, no screen — which is the rule
 * this repository's GUI checks have to keep, and it is enough for the two facts this file is
 * about. Effects never run in a static render, so what is asserted here is the **docked** layout;
 * the wide one differs only in the two column wrappers, and the contact row is the same element in
 * both.
 *
 * What it pins (2026-09-03): a site whose contacts are named `L-CING-MID01` saw `L-CING-…` in
 * every row, because the name cell was a fixed `w-16` with `truncate` on it. The name is the row's
 * identity and the one cell that may never be shortened.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { createElement } from '@tetravox/module-sdk';
import type { SeegModel, SeegRow, SeegView } from '../src/editor';
import { SeegPanel } from '../src/Panel';

/** A fourteen-contact lead with the long names that provoked the truncation. */
const ROWS: SeegRow[] = Array.from({ length: 14 }, (_, index) => ({
  id: `c${index + 1}`,
  name: `L-CING-MID${String(index + 1).padStart(2, '0')}`,
  status: index === 3 ? 'edited' : 'unchanged',
  spacingMm: index === 0 ? null : 5,
  selected: index === 0,
  tip: index === 0,
}));

const VIEW: SeegView = {
  ready: true,
  subject: 'sub-P073',
  ctName: 'sub-P073_acq-bone_space-T1w_ct.nii.gz',
  tsvName: 'sub-P073_space-T1w_electrodes.tsv',
  banner: null,
  warning: null,
  provenance: 'file',
  electrodes: [{ name: 'L-CING', count: ROWS.length, color: '#4f8ef7' }],
  electrode: 'L-CING',
  snapRadiusMm: 2,
  ghost: false,
  wire: true,
  dotRadiusPx: 5,
  sizeBounds: { min: 2, max: 12, step: 1 },
  placing: false,
  stats: { electrode: 'L-CING', n: ROWS.length, rmsMm: 0.1, spacingCv: 0.21, pitchMm: 5 },
  model: null,
  modelledElectrodes: 0,
  modelSource: 'none',
  snapNote: 'Snapped 14 contacts on L-CING along axis · model BF10R-SP21X',
  tipName: 'L-CING-MID01',
  diagram: null,
  rows: ROWS,
  selectedId: 'c1',
  dirty: false,
  changed: 0,
  canUndo: false,
  canRedo: false,
  busy: false,
  message: null,
};

/** Only the members the panel reads while rendering; the rest throw if a render ever calls them. */
const MODEL = new Proxy(
  {
    state: () => VIEW,
    subscribe: () => () => undefined,
  } as Partial<SeegModel>,
  {
    get(target, key) {
      const value = target[key as keyof SeegModel];
      return value ?? ((): never => {
        throw new Error(`the panel called ${String(key)} during a render`);
      });
    },
  }
) as SeegModel;

function markup(): string {
  return renderToStaticMarkup(createElement(SeegPanel, { model: MODEL }));
}

describe('the contact list', () => {
  it('carries the full name of every contact of a fourteen-contact electrode', () => {
    const html = markup();
    for (const row of ROWS) {
      expect(html).toContain(`data-testid="seeg-row-${row.name}"`);
      // The tip marker (`▸`) shares the cell, so the assertion is on the name's tail.
      expect(html).toContain(`${row.name}</button>`);
    }
  });

  it('renders one row per contact, with none dropped by a height cap', () => {
    expect(markup().match(/data-testid="seeg-row-/g) ?? []).toHaveLength(ROWS.length);
  });

  it('never truncates the name cell', () => {
    // `truncate` is Tailwind's `text-overflow: ellipsis`, and the module ships as a bundle whose
    // classes are the only thing an assertion can read — there is no layout to measure here.
    const html = markup();
    for (const row of ROWS) {
      const cell = new RegExp(`<button[^>]*data-testid="seeg-select-${row.name}"[^>]*>`).exec(html);
      expect(cell, `no name cell for ${row.name}`).not.toBeNull();
      expect(cell?.[0]).not.toContain('truncate');
      expect(cell?.[0]).not.toContain('text-ellipsis');
      expect(cell?.[0]).toContain('whitespace-nowrap');
    }
  });
});
