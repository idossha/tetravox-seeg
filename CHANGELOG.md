# Changelog

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
