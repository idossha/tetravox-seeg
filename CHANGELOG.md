# Changelog

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
