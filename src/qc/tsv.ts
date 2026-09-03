/**
 * The spacing TSV — `sub-{id}_desc-spacing_qc.tsv` — one row per consecutive contact pair on an
 * electrode, in 3-D world millimetres.
 *
 * Columns: `electrode`, `contact_a`, `contact_b`, `distance_mm`. Consecutive is by **ordinal**, the
 * same order the panel's distance column and the histogram both use, not the order the file
 * happened to list rows in — `contactsOf` (the shared kit) already sorts that way.
 */

import { contacts } from '@tetravox/module-sdk';
import type { ContactSet } from '@tetravox/module-sdk';

const { contactsOf, distanceMm, groupNames } = contacts;

export interface SpacingRow {
  electrode: string;
  contactA: string;
  contactB: string;
  distanceMm: number;
}

/** Consecutive-contact 3-D distances for every electrode with two or more contacts. */
export function spacingRows(set: ContactSet): SpacingRow[] {
  const rows: SpacingRow[] = [];
  for (const name of groupNames(set)) {
    const ordered = contactsOf(set, name);
    for (let i = 1; i < ordered.length; i++) {
      const a = ordered[i - 1]!;
      const b = ordered[i]!;
      rows.push({
        electrode: name,
        contactA: a.name,
        contactB: b.name,
        distanceMm: distanceMm(a.position, b.position),
      });
    }
  }
  return rows;
}

/** The rows as a tab-separated table, header first, distances to 3 decimal places. */
export function spacingTsv(set: ContactSet): string {
  const header = ['electrode', 'contact_a', 'contact_b', 'distance_mm'].join('\t');
  const lines = spacingRows(set).map((r) =>
    [r.electrode, r.contactA, r.contactB, r.distanceMm.toFixed(3)].join('\t')
  );
  return [header, ...lines].join('\n') + '\n';
}
