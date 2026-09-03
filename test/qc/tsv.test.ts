/** The spacing TSV: one row per consecutive contact pair, 3-D world distances (§T1). */

import { describe, expect, it } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import { contacts } from '@tetravox/module-sdk';
import type { Contact, ContactSet, vec3 } from '@tetravox/module-sdk';
import { spacingRows, spacingTsv } from '../../src/qc/tsv';

const { paletteColor } = contacts;

function shaft(group: string, start: vec3, dir: vec3, pitch: number, n: number): Contact[] {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const u: vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  return Array.from({ length: n }, (_v, i) => ({
    id: `${group}-${i + 1}`,
    name: `${group}${String(i + 1).padStart(2, '0')}`,
    group,
    ordinal: i + 1,
    position: [start[0] + u[0] * pitch * i, start[1] + u[1] * pitch * i, start[2] + u[2] * pitch * i] as vec3,
    original: null,
    originalName: null,
    loadedStatus: null,
    extra: {},
  }));
}

function setOf(...cs: Contact[]): ContactSet {
  const names = [...new Set(cs.map((c) => c.group))];
  return { contacts: cs, groups: names.map((name, i) => ({ name, color: paletteColor(i), tip: 'auto' as const })) };
}

describe.skipIf(!HAS_CONTACTS)('spacingRows', () => {
  it('is one row per consecutive pair, in 3-D millimetres', () => {
    const set = setOf(...shaft('LHIP', [0, 0, 0], [1, 0, 0], 3.5, 4));
    const rows = spacingRows(set);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({ electrode: 'LHIP', contactA: 'LHIP01', contactB: 'LHIP02', distanceMm: 3.5 });
    for (const r of rows) expect(r.distanceMm).toBeCloseTo(3.5, 6);
  });

  it('skips electrodes with fewer than two contacts', () => {
    const set = setOf(...shaft('A', [0, 0, 0], [1, 0, 0], 3.5, 1));
    expect(spacingRows(set)).toHaveLength(0);
  });

  it('a 3-4-5 triangle gap comes out to 5.000', () => {
    const cs: Contact[] = [
      { id: '1', name: 'X01', group: 'X', ordinal: 1, position: [0, 0, 0], original: null, originalName: null, loadedStatus: null, extra: {} },
      { id: '2', name: 'X02', group: 'X', ordinal: 2, position: [3, 4, 0], original: null, originalName: null, loadedStatus: null, extra: {} },
    ];
    const rows = spacingRows(setOf(...cs));
    expect(rows[0]?.distanceMm).toBeCloseTo(5, 6);
  });
});

describe.skipIf(!HAS_CONTACTS)('spacingTsv', () => {
  it('writes a header and one tab-separated row per pair', () => {
    const set = setOf(...shaft('LHIP', [0, 0, 0], [1, 0, 0], 4, 3));
    const text = spacingTsv(set);
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('electrode\tcontact_a\tcontact_b\tdistance_mm');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('LHIP\tLHIP01\tLHIP02\t4.000');
  });
});
