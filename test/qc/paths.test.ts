import { describe, expect, it } from 'vitest';
import { qcOutputPaths, qcFolder, qcSpacingSvgName, qcSpacingTsvName, qcResliceName, qcImplant3dName, datasetDescriptionPath } from '../../src/qc/paths';

describe('qc output paths', () => {
  it('names the five outputs the export sheet writes', () => {
    const paths = qcOutputPaths('/data/bids/derivatives', 'P076');
    expect(paths.folder).toBe('/data/bids/derivatives/tetravox/sub-P076/ieeg/figures');
    expect(paths.spacingSvg).toBe(paths.folder + '/sub-P076_desc-spacing_qc.svg');
    expect(paths.spacingTsv).toBe(paths.folder + '/sub-P076_desc-spacing_qc.tsv');
    expect(paths.reslicePng).toBe(paths.folder + '/sub-P076_desc-reslice_qc.png');
    expect(paths.implant3dPng).toBe(paths.folder + '/sub-P076_desc-implant3d_qc.png');
    expect(paths.datasetDescription).toBe('/data/bids/derivatives/tetravox/dataset_description.json');
  });

  it('agrees with its own name helpers', () => {
    expect(qcFolder('P076')).toBe('tetravox/sub-P076/ieeg/figures');
    expect(qcSpacingSvgName('P076')).toBe('sub-P076_desc-spacing_qc.svg');
    expect(qcSpacingTsvName('P076')).toBe('sub-P076_desc-spacing_qc.tsv');
    expect(qcResliceName('P076')).toBe('sub-P076_desc-reslice_qc.png');
    expect(qcImplant3dName('P076')).toBe('sub-P076_desc-implant3d_qc.png');
    expect(datasetDescriptionPath('/x/derivatives')).toBe('/x/derivatives/tetravox/dataset_description.json');
  });
});
