# Changelog

## 0.2.1 — Unreleased

- **The pop-out window opens sized for the panel, and a contact keeps its name.** Three things
  were wrong at once in a popped-out window. The contact list's name cell was a fixed 64 px with
  `truncate` on it, so a site naming its contacts `L-CING-MID01` read `L-CING-…` on every row while
  the column beside it was empty — the name now takes the width the fixed cells leave and is never
  shortened, and the status word is the only cell that may ellipsis. The controls column had no
  scroller of its own, so on a shaft with a model the per-gap table and its summary ran off the
  bottom of the window; both columns now scroll independently and the window itself never does.
  And the window asked for was 720 x 420 — narrower and less than half as tall as its own contents —
  so it opened with the controls cut off and the list squeezed; it now asks for 760 x 620, measured
  from the panel's own CSS against a subject with an eight-gap model, and still well inside a
  1440x900 laptop's work area.
- The controls column is 22 rem rather than 19, which is where the six edit buttons stop wrapping
  to a third row; the status and snap-mode lines stay on one line and ellipsis rather than wrapping;
  the column stacks are on an 8 px gap. The docked panel is unchanged.

## 0.2.0 — 2026-09-03

Requires Tetravox 0.3.5 or newer: the QC exports and the axis snap use host capabilities (`scene.sampleVolume`,
`files.writeBinary`, `capture.*`, `{derivatives}` writer targets) that older hosts do not have.

- **Snap now puts a contact on its electrode's shaft, not beside it.** A depth electrode is one rigid
  rod, so its contacts are collinear by construction — and until now every contact snapped to its own
  blob's intensity-weighted centroid, independently of its neighbours. On P073 that made the contacts
  **zigzag 0.3–0.7 mm around the straight trajectory line** the drag guide draws, because CT bloom is
  not symmetric about the rod: a neighbouring shaft, a bright skull edge or an anisotropic voxel pulls
  each centroid a different way. There is one snap now, for every scope (`s`, `⇧S`, **Snap all…**),
  with a model or without one:
  - the electrode's axis is fitted through all its contacts, rejecting one that is off the line;
  - each contact goes to the **orthogonal projection onto that axis** of its blob's
    intensity-weighted centroid (`scene.peakCentroid`) — the sideways part of the centroid is the
    part the hardware says cannot be true and is dropped, the along-axis part is measured metal and
    is kept;
  - the axis is then re-fitted through those centroids and the projections retaken. **That is the
    only lateral freedom there is, and it belongs to the whole electrode.** No contact carries a
    sideways offset of its own, so every snapped contact lies exactly on the line — the same line the
    drag guide draws;
  - the 1-D CT profile along the axis (a 1 mm tube, sampled every 0.1 mm through ±0.45 × the shaft's
    pitch) decides **whether a contact has metal**, not where along the rod it is: a contact whose
    peak is under 35% of the electrode's median peak has none, and takes the model's slot when a
    model resolved or keeps its own projection when none did. Measured on two hand-corrected subjects
    in `seegprep`: taking the profile's peak *as* the position instead wanders 0.35 mm mean and
    2.3 mm max and costs recall and precision, because between 5 mm-pitch contacts the profile is a
    bloom-merged ripple rather than one peak per contact, and saturated platinum makes a flat top
    whose argmax is biased by half a contact length. Any profile peak still taken is the midpoint of
    its top-90% plateau for the same reason;
  - and where the model resolved, the manufacturer's gap template is anchored on the contacts that
    have metal and used as a **check, not as a mover**: a detected contact more than 0.35 × the local
    gap from its slot stays on its metal and is reported in the per-gap table. Pulling it onto the
    template would hide exactly the shaft a human needs to look at. Without a model the measured
    median pitch sizes the profile **window** and nothing else — an observed median is not a datasheet
    and never re-spaces a shaft.
  - The panel prints which ran: `snapped along axis · model BF10R-SP21X`, or `· measured pitch
    5.0 mm`. A host without `scene.sampleVolume` snaps the same way and simply cannot tell a missing
    contact from a present one, so nothing is held to the template. An electrode with fewer than
    three contacts has no rod to fit and keeps the old per-contact centroid snap.
- **The separate Snap to model is gone**, and with it the `⇧F` key, the **Snap all to model…** button
  and the `snap-model` operation. A model changes what the ordinary Snap *does* rather than offering a
  second kind of snap to choose between, and a button labelled "this time, do it properly" was a
  question the user should never have been asked. Removed rather than deprecated: 0.2.0 is unreleased,
  so no job file can be relying on it. The `snap` operation's arguments are unchanged, and its result
  now names, per electrode, the mode that ran (`axis` or `axis-model`), the model, the pitch, and how
  many contacts had no metal and took the model's slot.
- **The editor knows which electrode it is looking at.** A model section in the panel names the
  electrode's model, says where that came from, shows how many contacts it should have against how
  many it has, and prints every gap three ways: the measured 3-D distance, what the manufacturer says
  it is, and the difference — flagged when it is more than 0.75 mm out.
  - Why it matters: an Ad-Tech Behnke-Fried lead is **3.0 mm** between contacts 1 and 2 and **5.5 mm**
    from there out. Re-fit, which re-spaces at the shaft's own median gap, turns that into a uniform
    5.5 mm and leaves contact 2 two and a half millimetres off the metal it is inside — with every
    number the panel prints about it self-consistent and wrong.
- **Extend along axis** places the contacts a shaft is missing. When an electrode has fewer contacts
  than its model, the button asks first and then puts the missing ones beyond the *entry* end at the
  model's own spacing and snaps them; they save with `status: added`, exactly like a contact placed by
  hand. That is where a localiser loses them: the deep contacts sit in brain and are easy, the shallow
  ones sit in the skull's own brightness and are not.
- **Where the geometry comes from**, most specific first: this subject's `seegprep`
  `sub-<id>_electrodes-geometry.json` sidecar where it names a model, then a gap table for 44 electrode models bundled from
  `seegprep`'s own catalogue and keyed by the table's `model` column or a site part number
  (`BF10R-SP21X-0C3` finds `BF10R-SP21X`), then **nothing** — and nothing is a supported state, not a
  failure. With no model resolved Snap still puts the contacts on the axis; only the template
  regularisation is absent, and the panel says so instead of pretending.
  - seegprep's sidecar always states a spacing, and writes `model: "n/a"` with the shaft's own
    measured median pitch repeated when *its* catalogue matched nothing. That is read as **no model**
    — the table's `model` column may still hold a real one, which seegprep never saw — and if nothing
    else knows either, the measured vector is used and shown as **measured pitch · sidecar-measured**
    rather than as a part number. A Behnke-Fried lead's measured median is 5.5 mm and its first gap
    is 3.0 mm; the two must not be printed as though they were the same kind of number.
  - **List…** in the model section reads a site electrode list
    (`name,target,part_number,n_contacts,…`) for its part numbers. It is a file sheet rather than an
    automatic discovery because the list lives four directories above the derivative's `ieeg/` and a
    sibling rule may ascend at most three.
- **The drag guide states the model distance beside the measured one.** Dragging a contact on an
  electrode with a model now reads `4.9 / 5.0 mm` — where it is, and where it is being aimed. Both are
  3-D distances, like every distance this module prints.
- The editlog records **`model`** and **`snap_mode`** beside each electrode — additive to
  `tetravox.contacts/editlog@1`, so a reader that knows only the old keys is unaffected. `snap_mode`
  is `axis`, `axis-model`, or `free` for an electrode nothing snapped or one too short to fit an axis
  through. Those make different claims about a position, and `snapped: true` alone could not tell them
  apart.
- `extend` is a job-file operation, so a batch has it too.
- **A QC export sheet**: the panel gained a checklist for a spacing histogram, a per-electrode
  reslice figure and a 3-D implant figure, plus a `Save as…` to redirect any one of them. Exports
  land under `derivatives/tetravox/sub-<id>/ieeg/figures/` by default — `sub-<id>_desc-spacing_qc.svg`,
  `..._desc-reslice_qc.png`, `..._desc-implant3d_qc.png`, `..._desc-spacing_qc.tsv` (electrode,
  contact_a, contact_b, distance_mm — 3-D world distances) — alongside a
  `derivatives/tetravox/dataset_description.json` marking the folder as a BIDS derivative, written
  once if it is not already there. The spacing histogram draws one dashed nominal-pitch line per
  electrode model present, from the table's own `model` column or `seegprep`'s geometry sidecar.
  **The 3-D implant figure now captures all four angles.** `host.capture.setView` (Tetravox PR #18)
  rotates the 3-D view to superior, left, right and anterior in turn — `fit: true` only on the first,
  since a reset-view need only run once — and each is screenshotted and tiled 2×2 with the electrode
  legend. There is no camera-restore call in the host API, so once the four shots are taken the module
  sets the view back to `superior` and leaves it there rather than the angle you had before exporting.
  On a host built before PR #18 (no `capture.setView`), the export falls back to a single capture of
  whatever the 3-D view is already showing and warns via toast that only the current view was
  captured (`src/qc/implant3d.ts`'s `captureImplant3dViews`).
- **The corrected table's default save location moved** to
  `derivatives/tetravox/sub-<id>/ieeg/sub-<id>_space-<space>_electrodes_corrected.tsv` (and its
  matching `..._corrected_editlog.json`), away from writing back over `seegprep`'s own output. A
  table opened from an anchor with no resolvable BIDS derivatives root still falls back to its own
  source path, exactly as before. `seegprepWarning` now accepts either `_electrodes` or
  `_electrodes_corrected` stems, matching `seegprep`'s own `--force` guard.
- **Vendors a newer `@tetravox/module-sdk`** (`1.0.0-core.0.3.4`, tracking Tetravox PR #18's host
  API additions — `scene.sampleVolume`, `files.writeBinary`, `.svg`/`.html` in `writeText`,
  `capture.screenshot`, and `{derivatives}` manifest sibling templates). Pinned as
  `vendor/tetravox-module-sdk-1-0.3.4-pr18.tgz` at the time; a later chore moved the pin to the
  official `1.0.0-core.0.3.5` tarball once Tetravox cut that release.
- **Fix: QC export no longer silently writes nothing outside a derivatives tree.** A table opened
  from a plain folder — not inside a resolvable BIDS derivatives tree, and with no `Save as…`
  override already chosen — made every requested figure report `'no-derivatives'`, so the sheet
  toasted "QC export: 0/3 figures written" with no way to fix it from there. `runQcExport` now asks
  the same `Save as…` folder chooser once, up front, whenever any requested figure has no default
  path, and writes all of them into the chosen folder; cancelling the chooser writes nothing and
  toasts "QC export cancelled — no output folder." instead of a silent 0/N. Filenames outside BIDS
  are now built from the loaded table's own stem (`<stem>_desc-spacing_qc.svg`, `..._qc.tsv`,
  `..._desc-reslice_qc.png`, `..._desc-implant3d_qc.png`) instead of a fixed `spacing_qc.svg`-style
  name; `derivatives/tetravox/dataset_description.json` is still written only inside an actual
  derivatives tree.

## 0.1.6 — 2026-09-02

- **The editlog names the version that actually wrote it.** `tool` is derived from the manifest
  instead of a hand-maintained literal, which had read `Tetravox sEEG contacts 0.1.0` in every
  release from 0.1.0 through 0.1.5 — so the one field whose job is to record which build produced an
  edit could not tell those six apart. `seegprep` reads it. Nothing about an existing editlog
  changes; the next save is the first one to be accurate.
- The manifest's version and `package.json`'s are now **held equal by a test**. They are two
  hand-bumped copies of one number and nothing compared them: the shipped `dist/manifest.json` comes
  from the manifest, so a release that bumped only one would publish an asset disagreeing with its
  own tag.

## 0.1.5 — 2026-09-02

- **A drag now shows a guide**: while a contact is held, the layer draws the electrode's fitted
  shaft axis as one highlighted line and a 3D centre-to-centre distance beside each immediate
  neighbour, so a contact can be aimed back onto the line it left. Nothing about it persists — it
  disappears the instant the drag ends, on every path that can end one (a move, an unmoved click,
  and a clear). Each distance label is offset 2.5 mm perpendicular to the fitted shaft axis so the
  text clears the rod and the contact-name labels rather than sitting on top of them; the offset
  direction is derived from the axis alone (not the camera, which a module cannot see, and not the
  dragged position), so it stays stable — the same side, every render — including for a near-vertical
  shaft, where the obvious cross-with-world-up construction degenerates to zero.
- **The contact list's distance column is now 3-D neighbour spacing**, not the old plane-relative
  offset: each row shows the true centre-to-centre distance to the previous contact by ordinal on
  the same electrode (`—` for the first contact of a group), matching this feature's standing rule
  that every distance shown is 3D. It updates live while dragging.

## 0.1.4 — 2026-08-31

- **The pop-out window opens fitted to the panel** rather than mostly empty: the manifest asks for
  720 × 420 instead of 720 × 900. The wide layout's controls column is about 380 px tall and the
  contact list scrolls beside it, so the extra height was blank panel. A subject with many shafts is
  a window the user drags taller, which is the direction that costs nothing.

## 0.1.3 — 2026-08-31

- The editor can be **popped out into its own window** (Tetravox core §13.10, the release after
  0.3.1): the ⧉ in the slot header, or the switcher's own ⧉, moves the panel to a window of its own
  and closing that window brings it back. Nothing is unloaded by the move — the same editor, the same
  undo history, the same unsaved edits — and with the editor in a window a second module can hold the
  slot at the same time.
- **The panel reflows to two columns when it has the room**: the controls take a fixed column and the
  contact list becomes a full-height scroller beside them, which is what a fifteen-shaft subject's
  ~200 rows want and what the 320 px slot cannot give. The trigger is the panel's own *measured*
  width (560 px), not where it is drawn, so narrowing the window gives the one-column layout back and
  a future resizable aside gets the wide one without a pop-out.
- The manifest asks for a 720 × 900 window and declares `popout: 'allowed'` — not `'preferred'`: the
  editor's feedback loop is the Info panel's Cursor block beside the panes, so the slot stays the
  right place to start.

## 0.1.2 — 2026-08-31

- The selected contact is now visible in the panel: its row carries the theme's accent surface with an
  accent rule down its left edge and its name in accent, and the shaft sketch draws a halo around the
  matching dot. Selecting in a pane, in the list or with `n` / `p` moves both marks together, so the
  sketch, the list and the panes always point at the same contact.
- The slot header the panel lives in grew a fold arrow beside its ✕ (Tetravox core, the release after 0.3.1): it
  hides the panel body while the module stays active — no unloading, no reloading of the table.

## 0.1.1 — 2026-08-31

- The panel now draws the selected electrode as a small shaft sketch — a baseline with one dot per
  contact, contact 1 (the tip) larger — in the electrode's own colour.
- Its coordinate math is guarded so no SVG coordinate is ever non-finite. A one-contact electrode, or
  an export whose contacts all carry the identical position (P077, fifteen shafts), spans nothing, and
  a bare `(t − min) / span` there is `0 / 0`; the browser logged `<line> attribute x1: Expected
  length, "Infinity"` on every render. The dots now fall back to an even spread by index when there is
  no span to normalise against.

## 0.1.0 — 2026-08-31

First release, and the module's first release *of its own*: `tetravox.seeg` was developed inside the
Tetravox repository and is extracted here unchanged apart from where its imports come from.

- The sEEG contact editor: open a registered CT and a BIDS `electrodes.tsv`, edit, and save the table
  back with a timestamped backup and a `_editlog.json` provenance sidecar.
- Eighteen commands, thirteen job-file operations, a scene block, one reader, one writer and two
  sibling patterns — the manifest is unchanged from the compiled-in version except for `docs`, which
  is this README's URL because an external module documents itself at a URL.
- Built against `@tetravox/module-sdk` host API 1 (core 0.2.0): React, `ModuleHostError`, `stemOf` and
  the shared contacts kit all arrive through the SDK, and the bundle has no imports at all.
