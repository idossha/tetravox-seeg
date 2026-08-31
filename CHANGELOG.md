# Changelog

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
