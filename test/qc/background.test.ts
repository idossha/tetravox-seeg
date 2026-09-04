/**
 * **The regression suite for the P077 export that came out on white paper** (owner report against
 * the released 0.2.2, fixed in its re-release).
 *
 * Two defects, both visible in the same pair of PDFs. Every reslice panel was CT metal on white —
 * no anatomy at all — and the 3-D figure was twelve leads floating in nothing. The cause was that
 * `t1Path` was only ever set by a `load` operation's explicit `t1:`: the T1 sibling was declared on
 * the CT anchor and not on the table anchor, so a session that opened the *table* never learned
 * where the T1 was, and the figures degraded to blank in silence. The third defect is in the same
 * report — the reslice was named from the table's stem while the implant figure beside it was named
 * from the `sub-` entity, so the pair disagreed.
 *
 * So the claims here are: a background is always chosen and the export names which volume it was; a
 * missing brain is stated rather than omitted; and both figures take their name from the subject
 * whenever the anchor has one.
 */

import { describe, expect, it, vi } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import { createModel } from '../../src/editor';
import { chooseBackground, largestComponent } from '../../src/qc/export';
import { WRITER_IMPLANT3D_BIDS, WRITER_IMPLANT3D_STEM } from '../../src/qc/paths';
import { stubOffscreenCanvas } from './canvasstub';
import type { ModuleHost } from '@tetravox/module-sdk';

const TSV = 'name\tx\ty\tz\nA1\t0\t0\t0\nA2\t3\t0\t0\nA3\t6\t0\t0\n';
const DERIV = '/data/bids/derivatives';
const TABLE = `${DERIV}/seegprep/sub-P077/ieeg/sub-P077_space-T1w_electrodes.tsv`;
const CT = `${DERIV}/seegprep/sub-P077/ct/sub-P077_acq-bone_space-T1w_ct.nii.gz`;
const T1 = `${DERIV}/SimNIBS/sub-P077/m2m_P077/T1.nii.gz`;

const CT_DATASET = { id: 'ct', kind: 'volume', name: 'sub-P077_acq-bone_space-T1w_ct.nii.gz', path: CT };
const T1_DATASET = { id: 't1', kind: 'volume', name: 'T1.nii.gz', path: T1 };

describe('chooseBackground', () => {
  it('takes the bound T1 when it is open', () => {
    const choice = chooseBackground([CT_DATASET, T1_DATASET], {
      ctDatasetId: 'ct',
      boundT1Path: T1,
      discoveredT1Path: T1,
    });
    expect(choice).toEqual({
      datasetId: 't1',
      window: 'percentile',
      detail: 'background: T1.nii.gz (T1)',
    });
  });

  it('takes an open T1 that was never bound — the owner’s second scenario', () => {
    const choice = chooseBackground([CT_DATASET, T1_DATASET], {
      ctDatasetId: 'ct',
      boundT1Path: null,
      discoveredT1Path: null,
    });
    expect(choice.datasetId).toBe('t1');
    expect(choice.window).toBe('percentile');
    expect(choice.detail).toContain('T1.nii.gz');
  });

  it('takes any open non-CT volume before giving up on a grey background', () => {
    const other = { id: 'other', kind: 'volume', name: 'flair.nii.gz', path: '/x/flair.nii.gz' };
    const choice = chooseBackground([CT_DATASET, other], {
      ctDatasetId: 'ct',
      boundT1Path: null,
      discoveredT1Path: null,
    });
    expect(choice.datasetId).toBe('other');
  });

  it('falls back to the CT in its soft-tissue window, and says where the unopened T1 is', () => {
    const choice = chooseBackground([CT_DATASET], {
      ctDatasetId: 'ct',
      boundT1Path: null,
      discoveredT1Path: T1,
    });
    expect(choice.datasetId).toBe('ct');
    expect(choice.window).toBe('ct-soft');
    expect(choice.detail).toContain('-100..300 HU');
    expect(choice.detail).toContain(`T1 found at ${T1} but not open`);
  });

  it('has nothing to offer when no volume is open at all', () => {
    const choice = chooseBackground([], {
      ctDatasetId: null,
      boundT1Path: null,
      discoveredT1Path: null,
    });
    expect(choice.datasetId).toBeNull();
    expect(choice.detail).toContain('no volume is open');
  });
});

describe('largestComponent', () => {
  it('keeps the bigger blob and drops the smaller one, 6-connected', () => {
    // 5 x 1 x 1: a run of three, a gap, then a single voxel.
    const data = Uint8Array.from([1, 1, 1, 0, 1]);
    const kept = largestComponent(data, [5, 1, 1]);
    expect(Array.from(kept as Uint8Array)).toEqual([1, 1, 1, 0, 0]);
  });

  it('answers null for an empty mask', () => {
    expect(largestComponent(new Uint8Array(8), [2, 2, 2])).toBeNull();
  });
});

/** The scene's datasets are the variable; everything else is the admission suite's host. */
function mockHost(datasets: readonly object[], opts: { siblings?: Record<string, string | null> } = {}): ModuleHost {
  return {
    id: 'seeg',
    history: vi.fn(() => ({
      push: vi.fn(),
      undo: vi.fn(() => null),
      redo: vi.fn(() => null),
      clear: vi.fn(),
      canUndo: vi.fn(() => false),
      canRedo: vi.fn(() => false),
    })),
    subscribe: vi.fn(),
    scene: {
      block: vi.fn(() => null),
      datasets: vi.fn(() => datasets),
      layers: vi.fn(() => []),
      addLayer: vi.fn((layer: unknown) => layer),
      updateLayer: vi.fn(),
      removeLayer: vi.fn(),
      setBlock: vi.fn(),
      setCursor: vi.fn(),
      on: vi.fn(() => () => undefined),
      peakCentroid: vi.fn(() => null),
      sampleVolume: vi.fn(
        async (_id: string, points: Float32Array) => new Float32Array(points.length / 3)
      ),
    },
    tool: { pointTool: vi.fn(() => null), select: vi.fn(), setPointTool: vi.fn() },
    files: {
      readText: vi.fn(async () => TSV),
      siblings: vi.fn(async () => opts.siblings ?? {}),
      openDialog: vi.fn(async () => null),
      saveDialog: vi.fn(async (_id: string, defaultPath: string | null) => ({
        path: defaultPath ?? '/out/figure.pdf',
        siblings: {
          [WRITER_IMPLANT3D_BIDS]: '/out/sub-P077_desc-implant3d_qc.pdf',
          [WRITER_IMPLANT3D_STEM]: '/out/figure-implant3d.pdf',
        },
      })),
      writeText: vi.fn(async () => ({ ok: true, backupPath: null })),
      writeBinary: vi.fn(async () => ({ ok: true, backupPath: null })),
    },
    capture: { setView: vi.fn(async () => undefined), screenshot: vi.fn(async () => new Uint8Array()) },
    ui: { toast: vi.fn(), setDirty: vi.fn(), status: vi.fn(), confirm: vi.fn(async () => 2) },
  } as unknown as ModuleHost;
}

describe.skipIf(!HAS_CONTACTS)('the QC export always has a background, and says which', () => {
  it('with only the CT open, windows the CT and reports the unopened T1 (the P077 session)', async () => {
    const host = mockHost([CT_DATASET], { siblings: { '../../../SimNIBS/{sub}/m2m_{id}/T1.nii.gz': T1 } });
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);
    const stub = stubOffscreenCanvas();
    try {
      const results = await model.exportQc({ reslice: true, implant3d: true });
      expect(results['reslice']?.ok).toBe(true);
      expect(results['reslice']?.detail).toContain('-100..300 HU');
      expect(results['reslice']?.detail).toContain('but not open');
      // The brain: a zero-valued CT is inside the soft-tissue window everywhere, so the largest
      // component is the whole sampled box — not a brain, and said so rather than left blank.
      expect(results['implant3d']?.ok).toBe(true);
      expect(results['implant3d']?.detail).toContain('silhouette omitted');
    } finally {
      stub.restore();
    }
  });

  it('with a T1 open but never bound, both figures use it and the result names it', async () => {
    const host = mockHost([CT_DATASET, T1_DATASET]);
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);
    const stub = stubOffscreenCanvas();
    try {
      const results = await model.exportQc({ reslice: true, implant3d: true });
      expect(results['reslice']?.detail).toContain('T1.nii.gz');
      expect(results['reslice']?.detail).not.toContain('HU');
      expect(results['implant3d']?.detail).toContain('T1.nii.gz');
    } finally {
      stub.restore();
    }
  });
});

describe.skipIf(!HAS_CONTACTS)('the two figures are named for the same subject', () => {
  it('takes `sub-` from a BIDS anchor, not the table’s stem', async () => {
    const host = mockHost([CT_DATASET]);
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);
    await model.exportQc({ reslice: true, implant3d: false });
    expect(host.files.saveDialog).toHaveBeenCalledWith(
      'qc-figures',
      `${DERIV}/seegprep/sub-P077/ieeg/sub-P077_desc-reslice_qc.pdf`
    );
  });

  it('falls back to the stem only when no path component carries a subject', async () => {
    const host = mockHost([CT_DATASET]);
    const model = createModel(host);
    await model.openPath('electrodes', '/plain/foo.tsv');
    await model.exportQc({ reslice: true, implant3d: false });
    expect(host.files.saveDialog).toHaveBeenCalledWith(
      'qc-figures',
      '/plain/foo_desc-reslice_qc.pdf'
    );
  });
});
