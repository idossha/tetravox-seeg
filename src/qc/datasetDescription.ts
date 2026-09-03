/**
 * `{derivatives}/tetravox/dataset_description.json` — the BIDS-derivative marker for this module's
 * QC output folder, written once if it is not already there (BIDS spec: every derivatives folder
 * that is its own dataset needs one).
 */

export interface DatasetDescription {
  Name: string;
  BIDSVersion: string;
  DatasetType: 'derivative';
  GeneratedBy: Array<{ Name: string; Version: string }>;
}

export function datasetDescriptionOf(manifestVersion: string): DatasetDescription {
  return {
    Name: 'tetravox',
    BIDSVersion: '1.9.0',
    DatasetType: 'derivative',
    GeneratedBy: [{ Name: 'tetravox.seeg', Version: manifestVersion }],
  };
}

export function datasetDescriptionJson(manifestVersion: string): string {
  return JSON.stringify(datasetDescriptionOf(manifestVersion), null, 2) + '\n';
}
