/**
 * The BIDS derivative layout a `seegprep` subject has, and what it means for this module.
 *
 * `seegprep` writes a fixed shape (`seegprep/io/layout.py`, and Slicer's `_resolveInputs`):
 *
 * ```text
 * <bids>/derivatives/seegprep/sub-<id>/ct/sub-<id>_acq-bone_space-T1w_ct.nii.gz
 * <bids>/derivatives/seegprep/sub-<id>/ieeg/sub-<id>_space-T1w_electrodes.tsv
 * <bids>/derivatives/seegprep/sub-<id>/ieeg/sub-<id>_space-T1w_coordsystem.json
 * <bids>/derivatives/SimNIBS/sub-<id>/m2m_<id>/T1.nii.gz
 * ```
 *
 * so opening either of the first two is enough to find the other, and the manifest declares the
 * patterns that say so (`src/manifest.ts`). This file is the module's half
 * of that: the template strings the manifest and the module have to agree on, and what a resolved
 * candidate *means*.
 *
 * **The templates are duplicated on purpose, and a test pins the duplication.** A manifest is
 * data-only TypeScript that main imports before a window exists (§13.1), so it cannot import a
 * renderer file; and this file cannot be the manifest, because a manifest is data. So the strings
 * appear twice and `test/bids.test.ts` asserts they are the same strings — which is the only
 * arrangement in which a typo fails a test rather than silently disabling a sibling.
 *
 * **`{stem}` is not duplicated, though.** The templates are strings a test can compare; the token's
 * *meaning* is a function, and two copies of it disagreed about a dotted table name — main admitted
 * one editlog name and this module wrote another. It comes from the module contract, which is
 * data-only and main-safe and therefore the one file both sides of that write may import.
 */

import { stemOf } from '@tetravox/module-sdk';

/** Templates the CT anchors. Keys of the `Record` `host.files.siblings` and `onSibling` hand over. */
export const FROM_CT_TSV = '../ieeg/{sub}_space-{space}_electrodes.tsv';
export const FROM_CT_COORDSYSTEM = '../ieeg/{sub}_space-{space}_coordsystem.json';
export const FROM_CT_EDITLOG = '../ieeg/{sub}_space-{space}_electrodes_editlog.json';
export const FROM_CT_T1 = '../../../SimNIBS/{sub}/m2m_{id}/T1.nii.gz';
/**
 * seegprep's per-electrode geometry sidecar (seegprep PR #2).
 *
 * `{"LHIP": {"model": "BF10R-SP21X", "contact_length_mm": 1.57, "spacing_gaps_mm": [3.0, 5.5, …]}}`
 * — the geometry of *this subject's* implant, which is why it outranks the bundled catalogue. No
 * `space` entity: the distance between two contacts on a rod is not a fact about a coordinate space.
 */
export const FROM_CT_GEOMETRY = '../ieeg/{sub}_electrodes-geometry.json';

/** Templates the electrodes table anchors. */
export const FROM_TSV_CT = '../ct/{sub}_acq-bone_space-{space}_ct.nii.gz';
export const FROM_TSV_COORDSYSTEM = '{sub}_space-{space}_coordsystem.json';
export const FROM_TSV_EDITLOG = '{stem}_editlog.json';
export const FROM_TSV_GEOMETRY = '{sub}_electrodes-geometry.json';
/**
 * The same SimNIBS T1, anchored on the table (0.2.2, re-released).
 *
 * The string is {@link FROM_CT_T1}'s — `ieeg/` and `ct/` are siblings under `sub-<id>/`, so the
 * three-level ascent is the same from either — but it has to be declared on *both* anchor groups or
 * a session that opened the table finds no T1 at all.
 */
export const FROM_TSV_T1 = FROM_CT_T1;

/**
 * The default **save target** for the corrected table, under the dataset's own `derivatives/`
 * rather than beside `seegprep`'s output (2026-09-03, T1). `{derivatives}` is resolved by main by
 * walking up from the anchor; when no BIDS root is found the candidate simply does not resolve, and
 * the editor falls back to the table's own source path (`seegprepWarning` below is what a save to
 * *that* fallback is checked against). `seegprep`'s overwrite guard now globs both
 * `*_electrodes_editlog.json` and `*_electrodes_corrected_editlog.json`, so both stems are
 * legitimate and `seegprepWarning` accepts either.
 */
export const FROM_TSV_DERIVATIVES_CORRECTED =
  '{derivatives}/tetravox/{sub}/ieeg/{sub}_space-{space}_electrodes_corrected.tsv';
export const FROM_TSV_DERIVATIVES_CORRECTED_EDITLOG =
  '{derivatives}/tetravox/{sub}/ieeg/{sub}_space-{space}_electrodes_corrected_editlog.json';

/** What a bundle probe found beside the anchor. Every field is a path or `null`. */
export interface SubjectBundle {
  tsv: string | null;
  ct: string | null;
  t1: string | null;
  coordsystem: string | null;
  editlog: string | null;
  /** seegprep's per-electrode geometry sidecar, when the subject has one. */
  geometry: string | null;
}

const EMPTY: SubjectBundle = {
  tsv: null,
  ct: null,
  t1: null,
  coordsystem: null,
  editlog: null,
  geometry: null,
};

/**
 * Read a `host.files.siblings` result — keyed by the manifest's own templates — as a bundle.
 *
 * A template that is not in the record, or whose value is `null`, is "not there"; the two are the
 * same answer to this module and different only to the host, which distinguishes "no rule for this
 * anchor" from "declared, probed, missing".
 */
export function bundleOf(found: Record<string, string | null>): SubjectBundle {
  const at = (...templates: string[]): string | null => {
    for (const template of templates) {
      const path = found[template];
      if (typeof path === 'string' && path !== '') return path;
    }
    return null;
  };
  return {
    tsv: at(FROM_CT_TSV),
    ct: at(FROM_TSV_CT),
    t1: at(FROM_CT_T1, FROM_TSV_T1),
    coordsystem: at(FROM_CT_COORDSYSTEM, FROM_TSV_COORDSYSTEM),
    editlog: at(FROM_CT_EDITLOG, FROM_TSV_EDITLOG),
    geometry: at(FROM_CT_GEOMETRY, FROM_TSV_GEOMETRY),
  };
}

/** Is there anything in this bundle at all? */
export function bundleIsEmpty(bundle: SubjectBundle): boolean {
  return (Object.keys(EMPTY) as (keyof SubjectBundle)[]).every((key) => bundle[key] === null);
}

/** The basename of a path, on either platform's separator. */
export function baseNameOf(path: string): string {
  return path.split(/[/\\]/).pop() ?? '';
}

/** `{stem}` — the module contract's, re-exported so the editlog name below is main's `{stem}`. */
export { stemOf };

/**
 * `<stem>_editlog.json` beside `tsvPath`.
 *
 * The name is the contract: `seegprep`'s CLI globs `*_electrodes_editlog.json` and refuses to
 * overwrite a hand-edited subject unless `--force`, so an editlog whose stem does not end in
 * `_electrodes` is a file nothing will ever look at.
 */
export function editlogNameFor(tsvName: string): string {
  return `${stemOf(tsvName)}_editlog.json`;
}

/**
 * Whether saving under this name will produce an editlog `seegprep` finds.
 *
 * Two things have to be true, and the warning names whichever is not: the stem ends in
 * `_electrodes`, and the file sits in an `ieeg/` directory. Both come straight from
 * `seegprep/cli.py::_editlog_files`, which looks in `<deriv>/sub-<id>/ieeg` for that glob.
 */
export function seegprepWarning(path: string): string | null {
  const name = baseNameOf(path);
  const stem = stemOf(name);
  const directory = /(?:^|[/\\])ieeg[/\\][^/\\]+$/.test(path);
  if (!stem.endsWith('_electrodes') && !stem.endsWith('_electrodes_corrected')) {
    return (
      `“${name}” does not end in _electrodes.tsv or _electrodes_corrected.tsv, so seegprep’s ` +
      `--force guard will not see its editlog (it globs *_electrodes_editlog.json and ` +
      `*_electrodes_corrected_editlog.json).`
    );
  }
  if (!directory) {
    return (
      `“${name}” is not in an ieeg/ directory, so seegprep will not find its editlog ` +
      `(it looks in <derivatives>/sub-<id>/ieeg).`
    );
  }
  return null;
}

/** `sub-P076` out of a path, for the panel's source line. `null` when there is none. */
export function subjectOf(path: string): string | null {
  const match = /(?:^|[/\\])(sub-[A-Za-z0-9]+)(?=[/\\_])/.exec(path);
  return match === null ? null : (match[1] as string);
}
