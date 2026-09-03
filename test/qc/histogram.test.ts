/** The spacing histogram SVG: one bar set and the expected nominal lines (§T1). */

import { describe, expect, it } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import { contacts } from '@tetravox/module-sdk';
import type { Contact, ContactSet, vec3 } from '@tetravox/module-sdk';
import { nominalPitches, nominalPitchesFromSidecar, spacingHistogramSvg } from '../../src/qc/histogram';

const { paletteColor } = contacts;

function shaft(group: string, pitch: number, n: number, model?: string): Contact[] {
  return Array.from({ length: n }, (_v, i) => ({
    id: `${group}-${i + 1}`,
    name: `${group}${i + 1}`,
    group,
    ordinal: i + 1,
    position: [pitch * i, 0, 0] as vec3,
    original: null,
    originalName: null,
    loadedStatus: null,
    extra: (model !== undefined ? { model } : {}) as Record<string, string>,
  }));
}

function setOf(...cs: Contact[]): ContactSet {
  const names = [...new Set(cs.map((c) => c.group))];
  return { contacts: cs, groups: names.map((name, i) => ({ name, color: paletteColor(i), tip: 'auto' as const })) };
}

describe.skipIf(!HAS_CONTACTS)('nominalPitches', () => {
  it('falls back to one median line when no group carries a model', () => {
    const set = setOf(...shaft('A', 3.5, 5));
    const lines = nominalPitches(set);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.pitchMm).toBeCloseTo(3.5, 6);
  });

  it('draws one line per distinct model present', () => {
    const set = setOf(...shaft('A', 3.5, 5, 'DIXI-8'), ...shaft('B', 5.0, 5, 'AdTech-6'));
    const lines = nominalPitches(set).sort((a, b) => a.pitchMm - b.pitchMm);
    expect(new Set(lines.map((l) => l.label))).toEqual(new Set(['DIXI-8', 'AdTech-6']));
    expect(lines[0]?.pitchMm).toBeCloseTo(3.5, 6);
    expect(lines[1]?.pitchMm).toBeCloseTo(5.0, 6);
  });

  it('prefers the sidecar pitch over the observed median for a named model', () => {
    const set = setOf(...shaft('A', 3.5, 5, 'DIXI-8'));
    const lines = nominalPitches(set, { 'DIXI-8': 3.55 });
    expect(lines[0]?.pitchMm).toBe(3.55);
  });
});

describe('nominalPitchesFromSidecar', () => {
  it('reads a scalar or array spacing_gaps_mm as a median', () => {
    const json = JSON.stringify({ spacing_gaps_mm: { 'DIXI-8': [3.4, 3.5, 3.6], 'AdTech-6': 5.0 } });
    const pitches = nominalPitchesFromSidecar(json);
    expect(pitches['DIXI-8']).toBeCloseTo(3.5, 6);
    expect(pitches['AdTech-6']).toBe(5.0);
  });

  it('is {} for unparsable JSON', () => {
    expect(nominalPitchesFromSidecar('not json')).toEqual({});
  });
});

describe.skipIf(!HAS_CONTACTS)('spacingHistogramSvg', () => {
  it('produces one bar set (rects) and the expected nominal (dashed) lines', () => {
    const set = setOf(...shaft('A', 3.5, 6, 'DIXI-8'));
    const svg = spacingHistogramSvg(set, { subjectId: 'P076' });
    expect(svg).toContain('<svg');
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(1);
    expect(svg).toContain('stroke-dasharray');
    expect(svg).toContain('DIXI-8');
    expect(svg).toContain('sub-P076');
  });
});
