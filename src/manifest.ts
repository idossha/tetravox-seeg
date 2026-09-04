/**
 * `tetravox.seeg` — the sEEG contact editor (Tetravox ARCHITECTURE.md §13).
 *
 * The first product module, and the first one to live outside the Tetravox repository: an
 * Inputs → Edit → Save loop over a BIDS-iEEG `electrodes.tsv` and the registered CT it was localised
 * on, reproducing the 3D Slicer `SEEGContactEditor` a lab already uses
 * (`seegprep/slicer/SEEGContactEditor/`) inside Tetravox's own panes.
 *
 * **Data only**, like every manifest: type annotations and object literals, no DOM type and no
 * import but the SDK's `ModuleManifest` type, because the app's main process validates a
 * `type: "module"` job action against the installed manifests before a window exists (§13.6).
 * `scripts/emit-manifest.mjs` turns this file into the `manifest.json` a release ships, and the
 * SDK's own validator is what says the JSON is a manifest.
 *
 * **Every scene-mutating command is also an operation**, which is §13.6's "there is no
 * automation-only code path" applied to a module: the `operations` below are what a job file drives,
 * and each one is the same function the panel's button calls. The commands that are *not* operations
 * are the ones with no meaning without a person, and there is a rule rather than a list: a command
 * that needs a **live pointer** (`add` arms place mode), a **file sheet** (`save-as`), the session's
 * own **undo stack** (`undo`, `redo`), or that only moves the **selection** (`next`, `prev`) has
 * nothing to do in a batch run; `snap-electrode` and `snap-all` are the `snap` operation's `scope`.
 * `test/manifest.test.ts` holds this manifest to that rule, so a scene-mutating command added without an
 * operation fails the build rather than becoming an automation-only gap.
 *
 * **Command ids are kebab-case, not camelCase.** The manifest validator requires every contributed id to
 * match `^[a-z][a-z0-9-]*$` — the shape the host namespaces as `<moduleId>/<id>` — so `snap-electrode`
 * rather than `snapElectrode`. The **operation** ids, which are the half §13.6's job envelope names,
 * are unaffected.
 *
 * **The sibling patterns are the `seegprep` derivative layout.** The templates are duplicated in
 * `src/bids.ts`, which is what a data-only manifest costs; `test/bids.test.ts`
 * asserts the two agree, so a typo fails a test rather than quietly disabling a sibling.
 */

import type { ModuleManifest } from '@tetravox/module-sdk';

export const seegManifest: ModuleManifest = {
  id: 'tetravox.seeg',
  title: 'sEEG contacts',
  version: '0.2.2',
  hostApi: 1,
  // An external module documents itself at a URL: the app's guide has no `## sEEG contacts`
  // heading to point at once the module ships from its own repository (the manifest validator
  // accepts either form, and the registry entry carries the same link).
  docs: 'https://github.com/idossha/tetravox-seeg#readme',
  activation: ['onToggle', 'onReader', 'onSibling', 'onSceneBlock'],
  commands: [
    { id: 'add', title: 'Add contacts (place mode)', key: 'a' },
    { id: 'snap', title: 'Snap selected contact onto the shaft axis', key: 's', when: 'selection' },
    { id: 'snap-electrode', title: 'Snap electrode onto its shaft axis', key: 's', shift: true },
    { id: 'snap-all', title: 'Snap all electrodes onto their shaft axes…' },
    { id: 'next', title: 'Next contact', key: 'n' },
    { id: 'prev', title: 'Previous contact', key: 'p' },
    { id: 'extend', title: 'Extend along axis to the model’s contact count…' },
    { id: 'renumber', title: 'Renumber tip-first' },
    { id: 'flip-tip', title: 'Flip tip end', key: 't' },
    { id: 'ghost', title: 'Contacts visible through slices', key: 'g' },
    // Appended 2026-08-30. `d` is the one key left in §13.5's pool that this manifest does not
    // already bind, and it is what §13.5 calls a plain harmless key: it changes what is drawn and
    // nothing on disk.
    { id: 'wire', title: 'Draw the shaft line between contacts', key: 'd' },
    { id: 'delete', title: 'Delete selected contact', key: 'Delete', when: 'selection' },
    { id: 'undo', title: 'Undo', key: 'z' },
    { id: 'redo', title: 'Redo', key: 'z', shift: true },
    { id: 'load', title: 'Open electrodes table…' },
    { id: 'save', title: 'Save electrodes table' },
    { id: 'save-as', title: 'Save electrodes table as…' },
    { id: 'revert', title: 'Revert to loaded positions' },
  ],
  readers: [
    {
      id: 'electrodes',
      title: 'Electrode tables',
      extensions: ['tsv', 'csv', 'fcsv'],
      // `.tsv` alone is far too broad — a BIDS dataset is full of them — so the basename has to say
      // what it is. Matched against the basename, never the whole path (`modules/readers.ts`).
      match: '(electrodes|contacts|markups)',
    },
  ],
  siblings: [
    {
      // The registered CT. `{id}` is nested inside `{sub}` because SimNIBS names its model directory
      // `m2m_<id>` without the `sub-` prefix.
      from: '^(?<sub>sub-(?<id>[A-Za-z0-9]+))_acq-bone_space-(?<space>[A-Za-z0-9]+)_ct\\.nii(\\.gz)?$',
      candidates: [
        '../ieeg/{sub}_space-{space}_electrodes.tsv',
        '../ieeg/{sub}_space-{space}_coordsystem.json',
        '../ieeg/{sub}_space-{space}_electrodes_editlog.json',
        '../../../SimNIBS/{sub}/m2m_{id}/T1.nii.gz',
        // seegprep's per-electrode geometry sidecar (seegprep PR #2): `model`,
        // `contact_length_mm` and `spacing_gaps_mm` for this subject's own implant. It carries no
        // `space` entity, because the geometry of a rod is not a coordinate space.
        '../ieeg/{sub}_electrodes-geometry.json',
        // The default save target for the corrected table (T1, 2026-09-03): under the dataset's own
        // derivatives rather than beside seegprep's output. `bids.ts`'s `FROM_TSV_DERIVATIVES_CORRECTED*`.
        '{derivatives}/tetravox/{sub}/ieeg/{sub}_space-{space}_electrodes_corrected.tsv',
        '{derivatives}/tetravox/{sub}/ieeg/{sub}_space-{space}_electrodes_corrected_editlog.json',
        // The QC export's default output folder (`src/qc/paths.ts`'s `FROM_ANCHOR_QC_*`). Finding
        // these is what pre-fills the export's Save sheet; it is not permission to write them.
        '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-reslice_qc.pdf',
        '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-implant3d_qc.pdf',
        '{derivatives}/tetravox/dataset_description.json',
      ],
    },
    {
      from: '^(?<sub>sub-(?<id>[A-Za-z0-9]+))_space-(?<space>[A-Za-z0-9]+)_electrodes\\.tsv$',
      candidates: [
        '../ct/{sub}_acq-bone_space-{space}_ct.nii.gz',
        '{sub}_space-{space}_coordsystem.json',
        '{stem}_editlog.json',
        '{sub}_electrodes-geometry.json',
        // The subject's T1, from the table as well as from the CT (0.2.2, re-released). The ascent
        // is the same three levels — `ieeg/` and `ct/` sit at the same depth under `sub-<id>/` —
        // and without it a session that opened the *table* never learned where the T1 was, which is
        // how the P077 QC export came out on a white background.
        '../../../SimNIBS/{sub}/m2m_{id}/T1.nii.gz',
        '{derivatives}/tetravox/{sub}/ieeg/{sub}_space-{space}_electrodes_corrected.tsv',
        '{derivatives}/tetravox/{sub}/ieeg/{sub}_space-{space}_electrodes_corrected_editlog.json',
        '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-reslice_qc.pdf',
        '{derivatives}/tetravox/{sub}/ieeg/figures/{sub}_desc-implant3d_qc.pdf',
        '{derivatives}/tetravox/dataset_description.json',
      ],
    },
  ],
  writers: [
    {
      id: 'electrodes',
      title: 'Save electrodes table',
      filters: [{ name: 'BIDS electrodes table', extensions: ['tsv'] }],
      // The two files a save writes beside the table it was given: the backup of what was there, and
      // the provenance sidecar `seegprep`'s --force guard looks for.
      siblings: ['{name}.{stamp}.bak', '{stem}_editlog.json'],
      backup: 'timestamped',
    },
    /**
     * **The QC export's one writer** (0.2.1, replacing three).
     *
     * Three writers was the bug the owner hit: the export wrote to the `{derivatives}` paths
     * `host.files.siblings` had *found* on load, and finding a name is not permission to write it —
     * only a Save sheet admits a path (host `module-io.ts`). Every figure came back `error`.
     *
     * So there is one sheet and it names the **reslice** PDF; the 3-D figure and the dataset
     * sidecar are its siblings, admitted with it. The implant template is a **plain** sibling
     * rather than a `{derivatives}` one on purpose: a plain sibling lands beside whatever file the
     * user chose, so redirecting the export to a scratch folder still writes both figures, where a
     * `{derivatives}` template outside a BIDS tree resolves to nothing. `{stem}-implant3d.pdf` is
     * the fallback for an anchor carrying no `sub-` entity — main drops a template whose tokens the
     * anchor does not supply, and a table called `contacts.tsv` should still get its second figure.
     *
     * `src/qc/paths.ts` builds the same names, and `test/qc/paths.test.ts` pins the pair the way
     * `bids.test.ts` pins the load-side templates.
     */
    {
      id: 'qc-figures',
      title: 'Save QC figures (PDF + PNG)',
      filters: [{ name: 'PDF figure', extensions: ['pdf'] }],
      siblings: [
        'sub-{id}_desc-implant3d_qc.pdf',
        '{stem}-implant3d.pdf',
        // 0.2.2: seegprep ships each QC figure as a PNG, so the export writes the same pixels under
        // the same name beside the PDF -- one Save sheet still admits every one of them.
        'sub-{id}_desc-reslice_qc.png',
        '{stem}.png',
        'sub-{id}_desc-implant3d_qc.png',
        '{stem}-implant3d.png',
        '{name}.{stamp}.bak',
        '{derivatives}/tetravox/dataset_description.json',
      ],
    },
  ],
  operations: [
    // `t1` is `'path?'` (2026-08-30, at the merge): §13.6's `ArgType` gained the optional path form
    // for exactly this argument. A `path?` is `${VAR}`-expanded, resolved against the job file's
    // directory and allow-listed before the window opens; a `string?` would have named a file the
    // module is told about and main never admitted, which is the wrong promise to make about a T1.
    //
    // What the module does with it: a module cannot open a dataset, so `t1` names a volume the job
    // has **already opened** (`scene.files`, or an earlier `open` action). `load` gives that layer
    // the T1 half of the display preset — visible, grey, opaque: the anatomy the CT's 150 HU floor
    // exists to reveal — and records the file in the scene block's `source`. When it is not open the
    // operation reports `{ t1: 'not-open' }` and everything else it did still stands, so a job
    // author learns which file the scene is missing instead of getting contacts over nothing.
    { id: 'load', args: { ct: 'path', tsv: 'path', t1: 'path?' } },
    // `scope` is contact | electrode | all. Every scope fits the electrode's axis and puts the
    // contacts on it, using the manufacturer's gaps where a model resolved; the result says per
    // electrode which mode ran (`axis` or `axis-model`).
    {
      id: 'snap',
      args: { scope: 'string', electrode: 'string?', contact: 'string?', radiusMm: 'number?' },
    },
    // `extend` is the one operation here that *adds* contacts, so it is deliberately not folded
    // into `snap`: a batch that wanted a shaft completed has to say so.
    { id: 'extend', args: { electrode: 'string?', radiusMm: 'number?' } },
    { id: 'renumber', args: { electrode: 'string?' } },
    { id: 'ghost', args: { on: 'boolean' } },
    // Appended 2026-08-30 beside `ghost`, and for the same reason it exists: which of a contact
    // set's three display switches are on is part of what a figure *is*, so a job that renders one
    // has to be able to say. Fifteen shafts' worth of lines over a bone-window CT is exactly the
    // clutter a slice figure does not want, and there was no way to turn it off headlessly.
    { id: 'wire', args: { on: 'boolean' } },
    // The third display switch, appended 2026-08-30. It is an **operation with no command**, which
    // is the one direction §13.6's parity rule allows: the rule is "every panel action is also an
    // operation", and it is silent about an operation the panel reaches through a stepper rather
    // than a bindable command (§13.5 keeps `+`/`-` for the engine's zoom). The job that produced
    // this wave's figures had to reach around the module — `{"type": "set", "layer": "Contacts · …",
    // "patch": {"dotRadiusPx": 7}}`, naming a module-owned layer from outside by its display name —
    // once per screenshot. `px` is held to the stepper's own 2–12 by `clampDotRadius`, so a job
    // cannot ask for a size the panel refuses.
    { id: 'size', args: { px: 'number' } },
    { id: 'stats', args: {} },
    { id: 'save', args: { out: 'out' } },
    /**
     * The QC export, as an operation (0.2.1). Until now the export sheet was panel-only, which made
     * it the module's one automation-only gap *in reverse*: a figure a paper needs could not be
     * regenerated from a job file, and the export's failures could not be reproduced without a
     * person clicking Export. `out` names the **reslice** PDF under `--out`; the 3-D figure is
     * written beside it under the `qc-figures` writer's sibling name, which main admits along with
     * every other writer's siblings when it admits an `out` (host `job.ts#moduleOutTargets`).
     */
    { id: 'export-qc', args: { out: 'out', reslice: 'boolean?', implant3d: 'boolean?' } },
    // Appended 2026-08-30. `tip: 'auto'` is a heuristic — DECISIONS says an occipital shaft entering
    // near the midline defeats it — and `renumber` applies whatever the tip currently is, so without
    // a way to flip it a job could number a shaft tip-last and had no remedy at all short of an
    // interactive session that saved a scene first. `revert` and `delete` are here for the same
    // reason: both are deterministic, neither needs a person, and a batch pipeline that can localise
    // but cannot drop an artefact contact is a pipeline with a hole in it.
    { id: 'flip-tip', args: { electrode: 'string?' } },
    { id: 'revert', args: {} },
    // Named, never "the selected one": a job has no selection to speak of. Matches the table's own
    // contact name (`LINS01`) or the id the scene block keys on.
    { id: 'delete', args: { contact: 'string' } },
  ],
  sceneBlock: { version: 1 },
  /**
   * §13.10, 2026-08-31. Pop-out is *allowed* rather than *preferred*: the panel's own feedback loop
   * is the Info panel's Cursor block and the slice panes beside it, so the slot is still the right
   * place to start, and a clinician localising one subject should not be handed a second window
   * they did not ask for. It is offered because this is the module that most wants the room — a
   * fifteen-shaft subject is ~200 contact rows behind a `max-h-[55%]` scroller, and on a second
   * monitor the whole table can be open beside a full-height view grid.
   *
   * The **size is measured, not guessed** (2026-09-03). The controls column is 22 rem plus the
   * list column, and the panel's own type is 11 px, so at the host's default font the left column
   * of a subject with a nine-contact model — source row 22, electrode row 26, four snap buttons 26,
   * snap note 16, six edit buttons on two rows 56, stats 16, shaft sketch 20, model section 232
   * (a name row, Extend, an eight-gap table and its summary) and seven 8 px gaps — measures
   * ~470 px, and the right column's fixed furniture (footer 30, QC block ~150) leaves the contact
   * list the rest. 620 px of window gives the left column its whole content with room for the
   * banner / warning / message lines, and the list ~25 rows before it scrolls; 760 px of width is
   * 22 rem of controls, an 8 px gutter and ~300 px of list — enough for the longest contact name a
   * site writes (`L-CING-MID01`) beside its status, its spacing and its two row buttons without
   * ellipsis. Both fit inside a 1440x900 laptop's work area, and `ModuleWindow` clamps to
   * `screen.avail*` besides, so this can only ever be smaller than the screen.
   *
   * The width stays well over the two-column threshold (560 px, `Panel.tsx`'s `WIDE_PX`): the panel
   * reflows on its *measured width* rather than on `placement`, so a user who narrows this window
   * gets the docked layout back and nothing is conditioned on which surface it is drawn on.
   */
  ui: { popout: 'allowed', windowWidth: 760, windowHeight: 620 },
};
