# Changelog

## 0.2.0 — 2026-09-03

- **The editor now knows which electrode it is looking at, and snaps to it.** A new model section in
  the panel names the electrode's model, says where that came from, shows how many contacts it should
  have against how many it has, and prints every gap three ways: the measured 3-D distance, what the
  manufacturer says it is, and the difference — flagged when it is more than 0.75 mm out. **Snap to
  model** (`⇧F`, or **Snap all to model…**) fits a line through the shaft, rejects one contact that is
  off it, slides the manufacturer's gap template along the rod until it sits on the brightest metal,
  and then moves each contact onto its local peak — refusing any peak that lands more than 1 mm off
  the rod, because that is usually the *neighbouring* electrode. The whole thing is one undo step and
  it never renumbers.
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
  failure. With no model resolved the module behaves exactly as it did before: Re-fit re-spaces at the
  observed median gap, and the panel says so instead of pretending.
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
- The editlog records **`model`** and **`snap_mode`** (`free` or `model`) beside each electrode —
  additive to `tetravox.contacts/editlog@1`, so a reader that knows only the old keys is unaffected
  and a log written before these existed reads as "no model, free snap", which is what it was. Two
  kinds of move make different claims about a position, and `snapped: true` alone could not tell them
  apart.
- `snap-model` and `extend` are job-file operations, so a batch has both. `snap-model` with no
  `electrode` does every electrode that has a model and **reports** the ones it skipped rather than
  quietly re-spacing them.

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
