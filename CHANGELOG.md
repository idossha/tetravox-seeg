# Changelog

## 0.1.7 — 2026-09-03

- **A QC export sheet**: the panel gained a checklist for a spacing histogram, a per-electrode
  reslice figure and a 3-D implant figure, plus a `Save as…` to redirect any one of them. Exports
  land under `derivatives/tetravox/sub-<id>/ieeg/figures/` by default — `sub-<id>_desc-spacing_qc.svg`,
  `..._desc-reslice_qc.png`, `..._desc-implant3d_qc.png`, `..._desc-spacing_qc.tsv` (electrode,
  contact_a, contact_b, distance_mm — 3-D world distances) — alongside a
  `derivatives/tetravox/dataset_description.json` marking the folder as a BIDS derivative, written
  once if it is not already there. The spacing histogram draws one dashed nominal-pitch line per
  electrode model present, from the table's own `model` column or `seegprep`'s geometry sidecar.
  **The 3-D implant figure is a single capture, not the four angles originally planned**: the host
  has no camera-control call yet, so there is no way to aim the 3-D view before each shot (see
  `src/qc/implant3d.ts`).
- **The corrected table's default save location moved** to
  `derivatives/tetravox/sub-<id>/ieeg/sub-<id>_space-<space>_electrodes_corrected.tsv` (and its
  matching `..._corrected_editlog.json`), away from writing back over `seegprep`'s own output. A
  table opened from an anchor with no resolvable BIDS derivatives root still falls back to its own
  source path, exactly as before. `seegprepWarning` now accepts either `_electrodes` or
  `_electrodes_corrected` stems, matching `seegprep`'s own `--force` guard.
- **Vendors a newer `@tetravox/module-sdk`** (`1.0.0-core.0.3.4`, tracking Tetravox PR #18's host
  API additions — `scene.sampleVolume`, `files.writeBinary`, `.svg`/`.html` in `writeText`,
  `capture.screenshot`, and `{derivatives}` manifest sibling templates). Pinned as
  `vendor/tetravox-module-sdk-1-0.3.4-pr18.tgz`; this moves to the official
  `1.0.0-core.0.3.5` tarball once Tetravox cuts that release.

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
