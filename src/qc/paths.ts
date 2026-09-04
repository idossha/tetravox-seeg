/**
 * The QC export's output names.
 *
 * These mirror the `{derivatives}` templates declared in `src/manifest.ts` — the `siblings` groups
 * that *find* an existing figure, and the `qc-figures` writer whose Save sheet *admits* the two the
 * export writes. As with `src/bids.ts`, the strings are duplicated on purpose — the manifest is
 * data-only and cannot import this file — and `test/qc/paths.test.ts` pins the two against each
 * other, so a typo fails a test rather than quietly writing a figure nobody can find.
 *
 * **Both figures are PDFs** (0.2.1): the reslice report is one page per electrode and the 3-D report
 * is a tiled page with its legend, and a document with pages is not the same artefact as one tall
 * PNG. The spacing histogram is gone entirely — the per-gap table in the panel is the thing people
 * read, and the SVG was a second, staler copy of it.
 */

/** The default output folder, relative to the resolved `{derivatives}` root. */
export function qcFolder(id: string): string {
  return `tetravox/sub-${id}/ieeg/figures`;
}

export function qcResliceName(id: string): string {
  return `sub-${id}_desc-reslice_qc.pdf`;
}

export function qcImplant3dName(id: string): string {
  return `sub-${id}_desc-implant3d_qc.pdf`;
}

/**
 * The PNG twin of each figure (0.2.2).
 *
 * seegprep writes its QC figures as PNGs (`reports/localize.py`, `..._desc-reslice_qc.png`), and a
 * figure that is meant to be visually 1:1 with one has to be openable the same way. The PDF stays —
 * it is the printable artefact — and the PNG carries the same pixels under seegprep's own name, so
 * the two derivatives can be put side by side without converting anything.
 */
export function qcReslicePngName(id: string): string {
  return `sub-${id}_desc-reslice_qc.png`;
}

export function qcImplant3dPngName(id: string): string {
  return `sub-${id}_desc-implant3d_qc.png`;
}

/** `{derivatives}/tetravox/dataset_description.json` — written once if absent. */
export const DATASET_DESCRIPTION_TEMPLATE = '{derivatives}/tetravox/dataset_description.json';

/**
 * The sibling templates declared on the manifest's two `siblings` groups (`src/manifest.ts`), so
 * `editor.ts` can read the QC export's default output paths straight out of the same
 * `host.files.siblings` result it already asks for on load — no second host round trip, and no
 * `{derivatives}` resolution of its own (only main does that, per the host's `module-io.ts`).
 *
 * Finding a path is **not** permission to write it: `host.files.siblings` probes names, and only a
 * Save sheet admits one. These are the sheet's *default*, which is why `editor.ts` hands the reslice
 * path to `saveDialog` as its `defaultPath` rather than writing to it directly (0.2.1 — writing to
 * it directly is what reported `reslice: error` on a released build).
 */
export const FROM_ANCHOR_QC_RESLICE_PDF =
  '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-reslice_qc.pdf';
export const FROM_ANCHOR_QC_IMPLANT3D_PDF =
  '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-implant3d_qc.pdf';
export const FROM_ANCHOR_QC_DATASET_DESCRIPTION = DATASET_DESCRIPTION_TEMPLATE;

/**
 * The `qc-figures` writer's sibling templates (`src/manifest.ts`), in preference order for the
 * implant figure.
 *
 * The Save sheet's chosen file is the **reslice** PDF; the implant figure is a plain sibling beside
 * it, so redirecting the export to any folder at all still admits both. `WRITER_IMPLANT3D_BIDS`
 * needs the anchor to carry a `sub-` entity and is dropped by main when it does not, which is what
 * `WRITER_IMPLANT3D_STEM` is for — a table called `contacts.tsv` still gets its second figure.
 */
export const WRITER_IMPLANT3D_BIDS = 'sub-{id}_desc-implant3d_qc.pdf';
export const WRITER_IMPLANT3D_STEM = '{stem}-implant3d.pdf';
/** The PNG twins, in the same preference order (0.2.2). */
export const WRITER_RESLICE_PNG_BIDS = 'sub-{id}_desc-reslice_qc.png';
export const WRITER_RESLICE_PNG_STEM = '{stem}.png';
export const WRITER_IMPLANT3D_PNG_BIDS = 'sub-{id}_desc-implant3d_qc.png';
export const WRITER_IMPLANT3D_PNG_STEM = '{stem}-implant3d.png';
export const WRITER_BACKUP = '{name}.{stamp}.bak';

export function datasetDescriptionPath(derivativesRoot: string): string {
  return `${derivativesRoot}/tetravox/dataset_description.json`;
}

export function qcOutputPaths(
  derivativesRoot: string,
  id: string
): {
  folder: string;
  reslicePdf: string;
  implant3dPdf: string;
  reslicePng: string;
  implant3dPng: string;
  datasetDescription: string;
} {
  const folder = `${derivativesRoot}/${qcFolder(id)}`;
  return {
    folder,
    reslicePdf: `${folder}/${qcResliceName(id)}`,
    implant3dPdf: `${folder}/${qcImplant3dName(id)}`,
    reslicePng: `${folder}/${qcReslicePngName(id)}`,
    implant3dPng: `${folder}/${qcImplant3dPngName(id)}`,
    datasetDescription: datasetDescriptionPath(derivativesRoot),
  };
}

/**
 * The implant figure's name beside an already-named reslice figure — the same arithmetic main does
 * when it substitutes {@link WRITER_IMPLANT3D_BIDS} / {@link WRITER_IMPLANT3D_STEM} against the
 * Save sheet's anchor.
 *
 * Duplicated here because a `--job` run has no Save sheet to ask: the job's `out` names the reslice
 * PDF, main admitted every writer's siblings beside it, and this is how the module works out which
 * of those names it may use. `test/qc/paths.test.ts` holds it to the templates.
 */
/**
 * The figures' base name for an anchor outside a resolvable derivatives tree.
 *
 * `sub-<id>` whenever the anchor path carries the entity — in a directory or in the filename —
 * because that is what names the *subject*, and the two figures then agree with each other and with
 * the BIDS names. The stem is the fallback for a table that has no subject entity at all
 * (`contacts.tsv`), where a `sub-` placeholder no path supplied would be a lie.
 *
 * Before 0.2.2's re-release this was the stem unconditionally, which is how P077's reslice came out
 * as `sub-P077_space-T1w_electrodes_desc-reslice_qc.pdf` beside a correctly named implant figure.
 */
export function qcBaseName(anchorPath: string): { sub: string | null; stem: string } {
  const name = anchorPath.split(/[/\\]/).pop() ?? anchorPath;
  const stem = name.replace(/\.[^./]*$/, '');
  const match = /(?:^|[/\\_])sub-([A-Za-z0-9]+)(?=[/\\_.]|$)/.exec(anchorPath);
  return { sub: match === null ? null : (match[1] as string), stem };
}

/** The reslice figure's name for that anchor — `sub-<id>_desc-reslice_qc.pdf` where there is one. */
export function qcResliceNameFor(anchorPath: string): string {
  const { sub, stem } = qcBaseName(anchorPath);
  return sub === null ? `${stem}_desc-reslice_qc.pdf` : qcResliceName(sub);
}

export function implant3dBesideReslice(anchorName: string): string {
  const stem = anchorName.replace(/\.[^./]*$/, '');
  const sub = /(?:^|_)sub-([A-Za-z0-9]+)(?:_|$)/.exec(stem);
  return sub === null ? `${stem}-implant3d.pdf` : `sub-${sub[1]}_desc-implant3d_qc.pdf`;
}

/** The same arithmetic for the two PNG twins (0.2.2), against the same Save-sheet anchor. */
export function pngBesideReslice(anchorName: string): { reslice: string; implant3d: string } {
  const stem = anchorName.replace(/\.[^./]*$/, '');
  const sub = /(?:^|_)sub-([A-Za-z0-9]+)(?:_|$)/.exec(stem);
  return sub === null
    ? { reslice: `${stem}.png`, implant3d: `${stem}-implant3d.png` }
    : {
        reslice: `sub-${sub[1]}_desc-reslice_qc.png`,
        implant3d: `sub-${sub[1]}_desc-implant3d_qc.png`,
      };
}
