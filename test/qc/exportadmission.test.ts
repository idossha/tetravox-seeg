/**
 * **The regression test for the export that reported `error` three times** (owner report against
 * the released 0.2.0, fixed in 0.2.1).
 *
 * The defect was not in the figures. 0.2.0 wrote to the `{derivatives}` paths
 * `host.files.siblings` had *resolved* when the table was opened — paths that were found, never
 * admitted. The host admits a path for writing only when the module's own Save sheet returns it, so
 * every write came back `{ ok: false, error: 'not on the extension write list' }`, and the sheet
 * turned each of those into the bare string `'error'`.
 *
 * So there are two claims here, and they are the two halves of the fix:
 *
 *  1. **The export goes through a Save sheet**, once, pre-filled with the derivatives default — it
 *     never writes to a path it only found (`writes only what a sheet admitted`).
 *  2. **A failure arrives as the reason**, including the host's own refusal text, never as a status
 *     word (`reports the host's own refusal`).
 *
 * `createModel`'s own entry points drive it, rather than reimplementing its internals.
 */

import { describe, expect, it, vi } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import { createModel } from '../../src/editor';
import { FROM_ANCHOR_QC_RESLICE_PDF, WRITER_IMPLANT3D_BIDS } from '../../src/qc/paths';
import type { ModuleHost } from '@tetravox/module-sdk';
import { stubOffscreenCanvas } from './canvasstub';

const TSV = 'name\tx\ty\tz\nA1\t0\t0\t0\nA2\t3\t0\t0\nA3\t6\t0\t0\n';
const DERIV = '/data/bids/derivatives';
const TABLE = `${DERIV}/seegprep/sub-P076/ieeg/sub-P076_space-T1w_electrodes.tsv`;
const CT = `${DERIV}/seegprep/sub-P076/ct/sub-P076_acq-bone_space-T1w_ct.nii.gz`;
const FIGURES = `${DERIV}/tetravox/sub-P076/ieeg/figures`;

function mockHost(overrides: Partial<Record<string, unknown>> = {}): ModuleHost {
  const base = {
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
      datasets: vi.fn(() => [{ id: 'ct', kind: 'volume', name: 'ct', path: CT }]),
      layers: vi.fn(() => []),
      addLayer: vi.fn((layer: unknown) => layer),
      updateLayer: vi.fn(),
      removeLayer: vi.fn(),
      setBlock: vi.fn(),
      setCursor: vi.fn(),
      on: vi.fn(() => () => undefined),
      peakCentroid: vi.fn(() => null),
      sampleVolume: vi.fn(async (_id: string, points: Float32Array) =>
        new Float32Array(points.length / 3)
      ),
    },
    tool: { pointTool: vi.fn(() => null), select: vi.fn(), setPointTool: vi.fn() },
    files: {
      readText: vi.fn(async () => TSV),
      // What the released build found on load, and then wrongly treated as writable.
      siblings: vi.fn(async () => ({
        [FROM_ANCHOR_QC_RESLICE_PDF]: `${FIGURES}/sub-P076_desc-reslice_qc.pdf`,
      })),
      openDialog: vi.fn(async () => null),
      saveDialog: vi.fn(async () => null),
      writeText: vi.fn(async () => ({ ok: true, backupPath: null })),
      writeBinary: vi.fn(async () => ({ ok: true, backupPath: null })),
    },
    capture: {
      setView: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => new Uint8Array()),
    },
    ui: { toast: vi.fn(), setDirty: vi.fn(), status: vi.fn(), confirm: vi.fn(async () => 2) },
  };
  return {
    ...base,
    ...overrides,
    scene: { ...base.scene, ...(overrides['scene'] as object) },
    tool: { ...base.tool, ...(overrides['tool'] as object) },
    files: { ...base.files, ...(overrides['files'] as object) },
    ui: { ...base.ui, ...(overrides['ui'] as object) },
  } as unknown as ModuleHost;
}

/** The admitted target a Save sheet returns for the BIDS default: the two figures, side by side. */
function admits(directory: string) {
  return {
    path: `${directory}/sub-P076_desc-reslice_qc.pdf`,
    siblings: { [WRITER_IMPLANT3D_BIDS]: `${directory}/sub-P076_desc-implant3d_qc.pdf` },
  };
}

describe.skipIf(!HAS_CONTACTS)('the QC export writes only what a Save sheet admitted', () => {
  it('asks the qc-figures sheet, pre-filled with the derivatives path it merely found', async () => {
    const saveDialog = vi.fn().mockResolvedValue(admits(FIGURES));
    const host = mockHost({ files: { saveDialog } });
    const model = createModel(host);
    expect(await model.openPath('electrodes', TABLE)).toBe(true);

    await model.exportQc({ reslice: true, implant3d: true });

    // The whole defect, in one assertion: the found path is the sheet's **default**, not its
    // target. 0.2.0 passed it to `writeBinary` and the host refused every write.
    expect(saveDialog).toHaveBeenCalledTimes(1);
    expect(saveDialog).toHaveBeenCalledWith(
      'qc-figures',
      `${FIGURES}/sub-P076_desc-reslice_qc.pdf`
    );
  });

  it('asks once per table and reuses what that sheet admitted', async () => {
    const saveDialog = vi.fn().mockResolvedValue(admits(FIGURES));
    const host = mockHost({ files: { saveDialog } });
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);

    await model.exportQc({ reslice: true, implant3d: false });
    await model.exportQc({ reslice: true, implant3d: false });
    expect(saveDialog).toHaveBeenCalledTimes(1);

    // `chooseOutput` is the panel's "Export to…", and it is the only thing that asks again.
    await model.exportQc({ reslice: true, implant3d: false, chooseOutput: true });
    expect(saveDialog).toHaveBeenCalledTimes(2);
  });

  it('falls back to a name beside the table when no derivatives tree resolved', async () => {
    const saveDialog = vi.fn().mockResolvedValue(admits('/plain/out'));
    const host = mockHost({ files: { saveDialog, siblings: vi.fn(async () => ({})) } });
    const model = createModel(host);
    await model.openPath('electrodes', '/plain/data/sub-01_electrodes.tsv');

    await model.exportQc({ reslice: true, implant3d: false });
    expect(saveDialog).toHaveBeenCalledWith(
      'qc-figures',
      '/plain/data/sub-01_desc-reslice_qc.pdf'
    );
  });

  it('writes nothing and reports no results when the sheet is cancelled', async () => {
    const saveDialog = vi.fn().mockResolvedValue(null);
    const host = mockHost({ files: { saveDialog } });
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);

    const results = await model.exportQc({ reslice: true, implant3d: true });

    expect(saveDialog).toHaveBeenCalledTimes(1);
    expect(results).toEqual({});
    expect(host.files.writeBinary as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
    expect(host.ui.toast).toHaveBeenCalledWith('warn', 'QC export cancelled — no output chosen.');
  });
});

describe.skipIf(!HAS_CONTACTS)('a failed QC figure says why', () => {
  it('reports a missing precondition as a sentence, never as the word "error"', async () => {
    const saveDialog = vi.fn().mockResolvedValue(admits(FIGURES));
    const host = mockHost({ files: { saveDialog } });
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);

    // vitest has no `OffscreenCanvas`, which is a real precondition and now reads as one.
    const results = await model.exportQc({ reslice: true, implant3d: true });
    for (const name of ['reslice', 'implant3d']) {
      expect(results[name]?.ok).toBe(false);
      expect(results[name]?.detail).toBe(
        'this host has no OffscreenCanvas, so a figure cannot be composed'
      );
    }
  });

  it("reports the host's own refusal text when a write is refused", async () => {
    // The failure the owner actually saw, reproduced at this layer: the host says no, and the
    // reason it gave is what the caller gets back.
    const saveDialog = vi.fn().mockResolvedValue(admits(FIGURES));
    const writeBinary = vi
      .fn()
      .mockResolvedValue({ ok: false, error: 'not on the extension write list' });
    const host = mockHost({ files: { saveDialog, writeBinary } });
    const model = createModel(host);
    await model.openPath('electrodes', TABLE);

    const stub = stubOffscreenCanvas();
    try {
      const results = await model.exportQc({ reslice: true, implant3d: false });
      expect(writeBinary).toHaveBeenCalledTimes(1);
      expect(writeBinary.mock.calls[0]?.[0]).toBe(`${FIGURES}/sub-P076_desc-reslice_qc.pdf`);
      expect(results['reslice']).toEqual({ ok: false, detail: 'not on the extension write list' });
    } finally {
      stub.restore();
    }
  });
});
