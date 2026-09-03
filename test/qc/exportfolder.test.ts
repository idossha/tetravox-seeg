/**
 * The QC export sheet's Save-as fallback (T1 fix, 2026-09-03): when the loaded table's anchor is
 * not inside a resolvable BIDS derivatives tree (`host.files.siblings` finds nothing), `runQcExport`
 * asks `chooseQcFolder` once up front rather than silently reporting `'no-derivatives'` for every
 * figure. `createModel`'s `openPath('electrodes', …)` is the entry point that sets that state, so
 * these tests drive it through the real model rather than reimplementing its internals.
 */

import { describe, expect, it, vi } from 'vitest';
import { HAS_CONTACTS } from '../setup';
import { createModel } from '../../src/editor';
import type { ModuleHost } from '@tetravox/module-sdk';

const TSV = 'name\tx\ty\tz\nA1\t0\t0\t0\nA2\t3\t0\t0\n';

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
      datasets: vi.fn(() => []),
      layers: vi.fn(() => []),
      addLayer: vi.fn((layer: unknown) => layer),
      updateLayer: vi.fn(),
      removeLayer: vi.fn(),
      setBlock: vi.fn(),
      setCursor: vi.fn(),
      on: vi.fn(() => () => undefined),
      peakCentroid: vi.fn(() => null),
      sampleVolume: vi.fn(async () => new Float32Array()),
    },
    tool: {
      pointTool: vi.fn(() => null),
      select: vi.fn(),
      setPointTool: vi.fn(),
    },
    files: {
      readText: vi.fn(async () => TSV),
      siblings: vi.fn(async () => ({})),
      openDialog: vi.fn(async () => null),
      saveDialog: vi.fn(async () => null),
      writeText: vi.fn(async () => ({ ok: true, backupPath: null })),
      writeBinary: vi.fn(async () => ({ ok: true, backupPath: null })),
    },
    capture: {
      setView: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => new Uint8Array()),
    },
    ui: {
      toast: vi.fn(),
      setDirty: vi.fn(),
      status: vi.fn(),
      confirm: vi.fn(async () => 2),
    },
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

describe.skipIf(!HAS_CONTACTS)('runQcExport (via exportQc) without a derivatives tree', () => {
  it('asks chooseQcFolder once and writes every requested figure under the chosen folder with stem-based names', async () => {
    const saveDialog = vi
      .fn()
      .mockResolvedValue({ path: '/plain/out/sub-01_desc-spacing_qc.svg', siblings: {} });
    const host = mockHost({ files: { saveDialog } });
    const model = createModel(host);

    const opened = await model.openPath('electrodes', '/plain/data/sub-01_electrodes.tsv');
    expect(opened).toBe(true);

    const results = await model.exportQc({ spacing: true, reslice: false, implant3d: false });

    expect(saveDialog).toHaveBeenCalledTimes(1);
    expect(results['spacing']).toBe('ok');

    const writeText = host.files.writeText as ReturnType<typeof vi.fn>;
    const writtenPaths = writeText.mock.calls.map((call) => call[0] as string);
    expect(writtenPaths).toContain('/plain/out/sub-01_electrodes_desc-spacing_qc.svg');
    expect(writtenPaths).toContain('/plain/out/sub-01_electrodes_desc-spacing_qc.tsv');
    // No dataset_description.json outside a derivatives tree.
    expect(writtenPaths.some((p) => p.endsWith('dataset_description.json'))).toBe(false);
  });

  it('writes nothing and reports no results when the chooser is cancelled', async () => {
    const saveDialog = vi.fn().mockResolvedValue(null);
    const host = mockHost({ files: { saveDialog } });
    const model = createModel(host);

    await model.openPath('electrodes', '/plain/data/sub-01_electrodes.tsv');
    const results = await model.exportQc({ spacing: true, reslice: false, implant3d: false });

    expect(saveDialog).toHaveBeenCalledTimes(1);
    expect(results).toEqual({});
    const writeText = host.files.writeText as ReturnType<typeof vi.fn>;
    expect(writeText).not.toHaveBeenCalled();
    const toast = host.ui.toast as ReturnType<typeof vi.fn>;
    expect(toast).toHaveBeenCalledWith('warn', 'QC export cancelled — no output folder.');
  });
});
