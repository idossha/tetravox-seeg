# sEEG contacts — a Tetravox extension

![The sEEG contact editor in Tetravox, editing subject P077 — coloured electrode shafts across the panes, labelled contacts on the head mesh, and the SEEG CONTACTS panel.](docs/seeg-extension-p077.png)

`tetravox.seeg` is a contact editor for stereo-EEG depth electrodes, built as a downloadable
[Tetravox](https://github.com/idossha/tetravox) extension: open a registered CT and the BIDS
`electrodes.tsv` that was localised on it, fix what the localiser got wrong, and write the table back
— reversibly, with a backup and a provenance sidecar.

It ships as **one ESM file plus its manifest**. Tetravox downloads both, verifies each against its own
sha256, asks you what it may do, and only then lets it run.

|           |                                                            |
| --------- | ---------------------------------------------------------- |
| Module id | `tetravox.seeg`                                            |
| Host API  | 1                                                          |
| Requires  | Tetravox with downloadable extensions (File ▸ Extensions…) |
| Licence   | MIT                                                        |

---

## Install

### Through Tetravox

**File ▸ Extensions…**, find _sEEG contacts_, **Install**, then **Enable** and read the permission
sheet. That is the whole of it: the download is verified against the catalogue's hashes, the manifest
is validated before anything is registered, and nothing is executable until you have consented.

### By hand

Every release attaches its two files twice — once under a human name, once under the file's own
sha256, which is the name Tetravox's catalogue fetches. To install by hand, take the human-named
copies:

```sh
ID=tetravox.seeg
VERSION=0.1.0
DIR=~/.tetravox/modules/$ID/$VERSION
mkdir -p "$DIR"
cd "$DIR"
curl -LO https://github.com/idossha/tetravox-seeg/releases/download/v$VERSION/index.js
curl -LO https://github.com/idossha/tetravox-seeg/releases/download/v$VERSION/manifest.json
```

Then write the **install receipt** beside them. Tetravox re-hashes every file against this receipt
each time the module is enabled — a downloaded file is a script, and one that changed after it was
installed is one that never runs:

```sh
cat > tetravox-module.json <<JSON
{
  "schema": 1,
  "id": "$ID",
  "version": "$VERSION",
  "installedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "files": [
    { "name": "index.js",      "bytes": $(wc -c < index.js),      "sha256": "$(shasum -a 256 index.js | cut -d' ' -f1)" },
    { "name": "manifest.json", "bytes": $(wc -c < manifest.json), "sha256": "$(shasum -a 256 manifest.json | cut -d' ' -f1)" }
  ]
}
JSON
```

Restart Tetravox and enable it in **File ▸ Extensions…**. (`TETRAVOX_MODULE_DIR` overrides
`~/.tetravox/modules` if you keep extensions elsewhere.)

---

## Using it

### Opening a subject

Drop, or **Open…**, either of these and the module finds the other beside it:

| File                 | Where                                                                    |
| -------------------- | ------------------------------------------------------------------------ |
| the registered CT    | `derivatives/seegprep/sub-<id>/ct/sub-<id>_acq-bone_space-T1w_ct.nii.gz` |
| the electrodes table | `derivatives/seegprep/sub-<id>/ieeg/sub-<id>_space-T1w_electrodes.tsv`   |

From the CT it also looks for the `_coordsystem.json`, an existing `_editlog.json`, and the subject's
T1 at `derivatives/SimNIBS/sub-<id>/m2m_<id>/T1.nii.gz`. Nothing is searched for: the module knows those
four names and asks whether each one exists.

Opening the **table first** is fine — it is read and held until a volume arrives, and the panel says so.
The CT has to be open for anything that needs image intensities (that is Snap), because a module reads
the volume through the app rather than opening files itself.

The reader is deliberately forgiving. It detects tab, comma, semicolon or whitespace; strips a UTF-8
BOM; matches column names case-insensitively (`name`/`label`, `x`/`pos_x`/`x_mm`, or `R`/`A`/`S`);
takes the electrode from `electrode`, `group`, `shaft` or `lead`, or infers it by stripping the trailing
digits off the contact name (`LHIP8` → `LHIP`); and truncates a ragged row rather than refusing the file.
A 3D Slicer `.fcsv` markups file works too, LPS coordinates and all. A missing required column is the one
thing it refuses, and the message names the delimiter it detected and the columns it found.

If an `_editlog.json` already sits beside the table, the panel shows a banner saying when it was
hand-edited: somebody has been here before you.

### Editing

The contacts are one points layer named `Contacts · <table stem>`, one dot per contact, with the shaft
drawn as a line between consecutive contacts and each contact's name beside it. **The dot, its shaft
line and its name are all the electrode's own colour**, so on a fifteen-shaft implant you can tell at a
glance which line belongs to which contact. Contacts that are not on the current slice are drawn as
**ghosts** at 0.6 opacity so a shaft reads as a shaft while you scroll; `g` turns that off and on.

Three switches decide how much of that is drawn, and none of them touches the table:

| Switch          | Does                                                                              |
| --------------- | --------------------------------------------------------------------------------- |
| **Ghost** (`g`) | draw the contacts that are not on this slice, faintly                             |
| **Wire** (`d`)  | draw the shaft lines. Off is for a figure about one slice's contacts              |
| **size − / +**  | how big a contact is drawn, 2–12 px. The bigger dot is also a bigger click target |

All three are saved with the scene, so a figure reopens looking the way you left it, and all three are job-file
operations (`ghost`, `wire`, `size`) — which of them are on is part of what a figure _is_.

| Do this                   | With                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| select a contact          | click it in a pane — ghosts included — or click its row in the list                      |
| move one                  | drag it in a 2D pane, once the slice is on it                                            |
| add contacts              | **Add** (`a`) — then every click in a pane drops a new contact on the chosen electrode   |
| walk the electrode        | `n` / `p`, or the list — the crosshair follows, so every pane slices through the contact |
| snap to the metal         | `s` for the selected contact, `⇧S` for the whole electrode, **Snap all…** for every one  |
| re-fit the shaft          | `f`                                                                                      |
| renumber from the tip     | **Renumber tip-first**                                                                   |
| flip which end is the tip | `t`                                                                                      |
| delete                    | `Delete` or `⌫`                                                                          |
| undo / redo               | `z` / `⇧Z`                                                                               |

**Clicking a contact selects it**, and everything follows: the electrode dropdown switches to that
contact's shaft, the crosshair moves onto it so every pane slices through it, and a ring is drawn round
the one you have. You do not arm anything first — while the panel is open, clicking contacts is what a
click does, and `Esc` puts you back into selecting rather than turning the tool off. A click that is not
on a contact still moves the crosshair, exactly as it does with no module open.

**Clicking a ghosted contact jumps the slice to it.** A ghost is a contact that lives on another slice, so
there is no sensible way to _drag_ one — it would move in a plane it is not in. Clicking one therefore does
the useful half instead: it selects that contact and takes the crosshair there, so every pane re-cuts through
it. The contact you clicked is now on the slice, and a second click grabs it in the ordinary way. In practice
you click the marker you can see, the view comes to it, and you drag from there — you never have to scroll
onto a contact first to be able to pick it.

**Snap** moves a contact to the intensity-weighted peak of a small box around it — the metal it is
inside — at the radius the panel's field sets (0.5–5 mm, 1.5 mm by default). A contact with nothing
bright near it does not move and is not counted. _Snap all_ asks first, because it touches every
electrode at once; one snap of any scope is a single undo step.

**Re-fit shaft** fits a line through the electrode's contacts, projects them onto it, re-spaces them
evenly at the _median_ observed gap — median, so one missing contact does not stretch the rest — and
relabels them from the tip. It reports the line RMS and the spacing CV, which are the two numbers that
say whether the shaft is straight and evenly spaced.

**Numbering only ever changes when you ask.** Loading, placing, dragging, snapping and deleting all leave
every contact's number and name exactly as they were — a clinical table's numbering is wired to the
recording system through its `csc` column, and nothing should renumber it behind your back. Only
_Re-fit_ and _Renumber tip-first_ relabel, and both say so on the button. New names keep the zero-padding
the file used (`LINS01`, not `LINS1`).

**Which end is the tip** is a heuristic, and the panel shows the answer: _contact 1 is the end of the
shaft nearer the centre of the volume_, and the other end is the entry. That is right for nearly every
depth electrode and wrong for some — a shaft entering near the midline can defeat it — so the tip
contact is marked in the list and `t` flips it. A flip is remembered per electrode and saved with the
scene.

### Saving

**Save** writes the table back over the file it came from; **Save as…** picks a new one. Either way three
things happen, in this order:

1. the previous table is copied to `<name>.<YYYYMMDD-HHMMSS>.bak`;
2. the table is written — tab-separated, LF, **your original columns in their original order**, with
   `electrode`, `contact` and `status` appended if they were not already there. `status` is `kept`,
   `edited` (moved by more than 0.001 mm) or `added`; a row that has not moved keeps whatever status the
   localiser gave it, so `located` and `gapfilled` survive;
3. `<stem>_editlog.json` is written beside it, recording what changed — counts, and one entry per
   contact added, moved, **renamed** or deleted, with where it was and where it is now. Renumber and
   Re-fit relabel contacts that may not have moved at all, and those entries carry the name the table
   had (`renamed_from`) beside the name it has now: relabelling is the one edit that changes how the
   `csc` column maps onto your recording system, so an editlog silent about it would be lying.

That editlog name matters: `seegprep` looks for `*_electrodes_editlog.json` in the subject's `ieeg/`
directory and **refuses to re-run over a hand-edited subject unless you pass `--force`**. If you save
under a name whose stem does not end in `_electrodes`, or outside an `ieeg/` directory, the module warns
you that the guard will not see it.

**Revert to loaded positions** puts every contact back where the file had it and forgets the additions,
which is the in-session undo of everything; the `.bak` is the on-disk one.

⌘S saves the **scene**, not the table. When contacts are unsaved the module says so, the window title
carries a `•`, and closing the window, starting a new scene, opening another one or closing the CT all
ask first.

**By default, Save writes the corrected table** to
`derivatives/tetravox/sub-<id>/ieeg/sub-<id>_space-<space>_electrodes_corrected.tsv` — a copy under the
dataset's own `derivatives/`, alongside a matching `..._corrected_editlog.json` — rather than back over
`seegprep`'s own output; `seegprep`'s `--force` guard now looks for either name. If the table's anchor
is not inside a BIDS dataset the module can find a `derivatives/` root for, Save falls back to the
table's own source path, same as before.

### QC exports

The panel's **QC export** section writes three figures plus a spacing table, to
`derivatives/tetravox/sub-<id>/ieeg/figures/` by default (a `Save as…` there redirects any one of them):

| File                                          | What it shows                                                        |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `sub-<id>_desc-spacing_qc.svg`                | A histogram of consecutive-contact 3-D distances, with one dashed line per electrode model's nominal pitch |
| `sub-<id>_desc-spacing_qc.tsv`                | The distances behind the histogram: `electrode`, `contact_a`, `contact_b`, `distance_mm` |
| `sub-<id>_desc-reslice_qc.png`                | Every electrode's shaft-axis plane, T1 in grey with a CT bone overlay, tiled 3 to a row |
| `sub-<id>_desc-implant3d_qc.png`              | Four angles (superior, left, right, anterior) tiled 2×2, with a colour legend |

A `derivatives/tetravox/dataset_description.json` marks the folder as a BIDS derivative, written once
if it is not already there.

**The 3-D implant figure rotates the camera through four RAS presets** — superior, left, right,
anterior, in that order, via `host.capture.setView` (Tetravox PR #18) — and screenshots each one.
There is no camera-restore API, so once the four shots are in hand the module sets the view back to
`superior` and leaves it there; your 3-D view will be at the superior preset after an export, not
wherever it was before. On a host built before PR #18 (no `capture.setView`), the export falls back
to a single capture of whatever the 3-D view already shows and shows a toast noting only the current
view was captured — `src/qc/implant3d.ts`'s `captureImplant3dViews` owns this behaviour and its
degraded-host fallback.

**Outside a BIDS derivatives tree**, there is no `{sub}`-shaped default folder to write into. QC
export asks for one — the same `Save as…` folder chooser — the first time it needs it, and then
writes every figure you asked for into that folder; cancelling the chooser writes nothing. Filenames
in that case are built from the loaded table's own stem instead of `sub-<id>`, e.g.
`<stem>_desc-spacing_qc.svg`, and `dataset_description.json` is written only when a real derivatives
tree was found.

### Scenes, and a build without the module

The contacts are ordinary scene layers, so a `*.tetravox.json` written here opens anywhere — including
in a build that has no sEEG module, which still draws every contact with its name, its electrode and its
number. What that build cannot carry is the module's own record: which table the contacts came from,
where that table put each one, and its other columns. Re-open such a scene here and the module rebuilds
the electrodes from the layer, tells you the provenance is gone, and turns Save into Save as… rather than
writing a table in which everything looks new.

### From a job file

Every button is also a job-file operation, so a batch can do what the panel does — `load`, `snap`,
`refit`, `renumber`, `flip-tip`, `revert`, `delete`, `ghost`, `wire`, `size`, `stats` and `save`. `flip-tip` matters more
than it looks: which end of a shaft is contact 1 comes from a heuristic, `renumber` applies whatever the
tip currently is, and this is how a batch corrects the shaft the heuristic read backwards — the same thing
`t` does in the panel. See [Automation](https://idossha.github.io/tetravox/AUTOMATION.html).

---

## Developing

```sh
pnpm install                     # the SDK comes from vendor/, see below
node scripts/fetch-contacts.mjs  # the shared contacts kit, for the tests
pnpm run typecheck               # tsc against the SDK's declarations
pnpm run test                    # vitest
pnpm run build                   # dist/index.js + dist/manifest.json
pnpm run check                   # zero imports, size, and the app's own manifest validator
```

`pnpm run verify` is all five in order, and is what CI runs.

### What this module is written against

Everything comes from **`@tetravox/module-sdk`** — the host surface (`ModuleHost`, `ModuleInstance`,
`ExtensionBlock`), the manifest contract, the type-only slice of the engine a module may name, the
shared contacts kit, and React. It is generated from the Tetravox tree by `scripts/emit-module-sdk.mjs`
there, never hand-written and never published to npm: an SDK belongs to one core release, and a URL
says which.

Until Tetravox cuts the release that carries it, this repository pins the tarball it was emitted from
as a **file dependency** in `vendor/`:

```json
"@tetravox/module-sdk": "file:vendor/tetravox-module-sdk-1-0.2.0.tgz"
```

At the next core release that becomes the release-asset URL and `vendor/` goes away:

```json
"@tetravox/module-sdk": "https://github.com/idossha/tetravox/releases/download/v<core>/tetravox-module-sdk-1-<core>.tgz"
```

### The one rule: the bundle has no imports

Tetravox loads a module over `tetravox://module/<id>/<version>/index.js`, where nothing resolves a bare
specifier — no import map, no `node_modules`, and a CSP that grants script execution to that host and
to nothing else. So the SDK is **inlined** rather than external (`rollup.config.mjs` has
`external: []`), and `scripts/check-bundle.mjs` asserts on the built bytes that there is no `import`,
no `export … from`, no dynamic `import()`, that the file is under the app's 32 MiB ceiling for a module
file, and that the shim really is in there.

That inlined shim reads `globalThis.__tetravoxModuleSdk`, which the app assigns before any module
activates. It is how a downloaded panel renders inside the app's **own** React tree: a second copy of
React would be an "invalid hook call" the first time the panel drew.

### The shared contacts kit

`contacts.*` — the TSV reader, the editlog, the line fit, the snap, the palette — is Tetravox's, not
this repository's. A module's second module is a library, not a fork, so two contact modules share one
implementation and the app hands each of them its own single instance.

The SDK tarball carries the kit's declarations, which is enough to typecheck against and nothing to
execute, so the **tests** fetch the sources: `contacts.pin.json` names one Tetravox commit and every
file's sha256, `scripts/fetch-contacts.mjs` downloads and verifies them into `.contacts/` (git-ignored),
and `test/setup.ts` installs them on the host global exactly as the app does. Point
`TETRAVOX_CONTACTS` at a Tetravox checkout's
`packages/app/src/renderer/src/modules/shared/contacts` to use one instead. With neither, the suites
that execute the kit skip — loudly — rather than asserting against a re-implementation of it.

### Layout

```
src/
  manifest.ts   what the module declares — data only; scripts/emit-manifest.mjs makes the JSON
  index.ts      activate(host) → ModuleInstance
  editor.ts     the state and every command; every command is also a job operation
  Panel.tsx     chrome: reads the model through useSyncExternalStore, one call per control
  block.ts      the module's own record inside a scene file
  shaft.ts      depth-electrode geometry — the tip rule, re-fit, renumber
  bids.ts       the seegprep derivative layout
test/           vitest; test/setup.ts is the app's half of the SDK global
scripts/        build, validate, fetch, release
```

## Releasing

```sh
pnpm run verify
scripts/publish-release.sh v0.1.0 --upload
```

Every asset is uploaded **under its own sha256** — the content-addressed store layout Tetravox already
uses for sample data, and what lets a download be verified against its own URL — with a human-named
copy beside it for people reading the release page. The script then prints the two fragments the other
repositories need: the `modules.lock` entry for Tetravox (which bundles this module into its packaged
builds) and the `versions[]` entry for the extensions registry. Both carry the same hashes, and the app
refuses any file whose bytes do not match.

## Licence

MIT, matching Tetravox. See [LICENSE](LICENSE).
