import { describe, expect, it } from 'vitest';
import {
  DATASET_DESCRIPTION_TEMPLATE,
  FROM_ANCHOR_QC_IMPLANT3D_PDF,
  FROM_ANCHOR_QC_RESLICE_PDF,
  WRITER_IMPLANT3D_BIDS,
  WRITER_IMPLANT3D_STEM,
  datasetDescriptionPath,
  implant3dBesideReslice,
  qcFolder,
  qcImplant3dName,
  qcOutputPaths,
  qcResliceName,
} from '../../src/qc/paths';
import { seegManifest } from '../../src/manifest';

describe('qc output paths', () => {
  it('names the two figures the export writes, and the sidecar beside them', () => {
    const paths = qcOutputPaths('/data/bids/derivatives', 'P076');
    expect(paths.folder).toBe('/data/bids/derivatives/tetravox/sub-P076/ieeg/figures');
    expect(paths.reslicePdf).toBe(paths.folder + '/sub-P076_desc-reslice_qc.pdf');
    expect(paths.implant3dPdf).toBe(paths.folder + '/sub-P076_desc-implant3d_qc.pdf');
    expect(paths.datasetDescription).toBe(
      '/data/bids/derivatives/tetravox/dataset_description.json'
    );
  });

  it('agrees with its own name helpers', () => {
    expect(qcFolder('P076')).toBe('tetravox/sub-P076/ieeg/figures');
    expect(qcResliceName('P076')).toBe('sub-P076_desc-reslice_qc.pdf');
    expect(qcImplant3dName('P076')).toBe('sub-P076_desc-implant3d_qc.pdf');
    expect(datasetDescriptionPath('/x/derivatives')).toBe(
      '/x/derivatives/tetravox/dataset_description.json'
    );
  });

  // The manifest is data-only and cannot import this file, so the strings live twice. This is the
  // test that makes the duplication safe — the same job `test/bids.test.ts` does for the load side.
  it('is the manifest’s own sibling and writer templates', () => {
    const candidates = new Set((seegManifest.siblings ?? []).flatMap((rule) => rule.candidates));
    expect(candidates).toContain(FROM_ANCHOR_QC_RESLICE_PDF);
    expect(candidates).toContain(FROM_ANCHOR_QC_IMPLANT3D_PDF);
    expect(candidates).toContain(DATASET_DESCRIPTION_TEMPLATE);
    // No spacing figure is declared anywhere any more (0.2.1).
    expect([...candidates].filter((c) => c.includes('spacing'))).toEqual([]);

    const writer = (seegManifest.writers ?? []).find((w) => w.id === 'qc-figures');
    expect(writer).toBeDefined();
    expect(writer?.siblings).toContain(WRITER_IMPLANT3D_BIDS);
    expect(writer?.siblings).toContain(WRITER_IMPLANT3D_STEM);
    expect(writer?.siblings).toContain(DATASET_DESCRIPTION_TEMPLATE);
  });

  // `implant3dBesideReslice` re-derives, for a `--job` run with no Save sheet, exactly what main
  // substituted the two writer templates into. A drift here is a write main refuses.
  it('derives the implant figure’s name the way the writer templates do', () => {
    expect(implant3dBesideReslice('sub-P076_desc-reslice_qc.pdf')).toBe(
      WRITER_IMPLANT3D_BIDS.replace('{id}', 'P076')
    );
    expect(implant3dBesideReslice('sub-P076_desc-reslice_qc.pdf')).toBe(
      'sub-P076_desc-implant3d_qc.pdf'
    );
    // No `sub-` entity: the stem fallback, so a table nobody named in BIDS still gets both figures.
    expect(implant3dBesideReslice('contacts_reslice.pdf')).toBe(
      WRITER_IMPLANT3D_STEM.replace('{stem}', 'contacts_reslice')
    );
  });
});
