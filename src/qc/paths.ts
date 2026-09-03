/**
 * The QC export sheet's default output names.
 *
 * These mirror the `{derivatives}` templates declared in `src/manifest.ts`'s `writers` for
 * `qc-spacing-svg`, `qc-reslice-png` and `qc-implant3d-png`. As with `src/bids.ts`, the strings are
 * duplicated on purpose — the manifest is data-only and cannot import this file — and
 * `test/qc/paths.test.ts` pins the two against each other.
 */

/** The default output folder, relative to the resolved `{derivatives}` root. */
export function qcFolder(id: string): string {
  return `tetravox/sub-${id}/ieeg/figures`;
}

export function qcSpacingSvgName(id: string): string {
  return `sub-${id}_desc-spacing_qc.svg`;
}

export function qcSpacingTsvName(id: string): string {
  return `sub-${id}_desc-spacing_qc.tsv`;
}

export function qcResliceName(id: string): string {
  return `sub-${id}_desc-reslice_qc.png`;
}

export function qcImplant3dName(id: string): string {
  return `sub-${id}_desc-implant3d_qc.png`;
}

/** `{derivatives}/tetravox/dataset_description.json` — written once if absent. */
export const DATASET_DESCRIPTION_TEMPLATE = '{derivatives}/tetravox/dataset_description.json';

/**
 * The sibling templates declared on the manifest's two `siblings` groups (`src/manifest.ts`), so
 * `editor.ts` can read the QC sheet's default output folder straight out of the same
 * `host.files.siblings` result it already asks for on load — no second host round trip, and no
 * `{derivatives}` resolution of its own (only main does that, per `module-io.ts`).
 */
export const FROM_ANCHOR_QC_SPACING_SVG =
  '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-spacing_qc.svg';
export const FROM_ANCHOR_QC_SPACING_TSV =
  '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-spacing_qc.tsv';
export const FROM_ANCHOR_QC_RESLICE_PNG =
  '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-reslice_qc.png';
export const FROM_ANCHOR_QC_IMPLANT3D_PNG =
  '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-implant3d_qc.png';
export const FROM_ANCHOR_QC_DATASET_DESCRIPTION = DATASET_DESCRIPTION_TEMPLATE;

export function datasetDescriptionPath(derivativesRoot: string): string {
  return `${derivativesRoot}/tetravox/dataset_description.json`;
}

export function qcOutputPaths(
  derivativesRoot: string,
  id: string
): {
  folder: string;
  spacingSvg: string;
  spacingTsv: string;
  reslicePng: string;
  implant3dPng: string;
  datasetDescription: string;
} {
  const folder = `${derivativesRoot}/${qcFolder(id)}`;
  return {
    folder,
    spacingSvg: `${folder}/${qcSpacingSvgName(id)}`,
    spacingTsv: `${folder}/${qcSpacingTsvName(id)}`,
    reslicePng: `${folder}/${qcResliceName(id)}`,
    implant3dPng: `${folder}/${qcImplant3dName(id)}`,
    datasetDescription: datasetDescriptionPath(derivativesRoot),
  };
}
