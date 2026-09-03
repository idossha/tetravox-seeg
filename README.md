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

From the CT it also looks for the `_coordsystem.json`, an existing `_editlog.json`, `seegprep`'s
`sub-<id>_electrodes-geometry.json`, and the subject's T1 at
`derivatives/SimNIBS/sub-<id>/m2m_<id>/T1.nii.gz`. Nothing is searched for: the module knows those
five names and asks whether each one exists.

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
| snap to the model         | `⇧F` for the electrode, **Snap all to model…** for every one that has a model            |
| add the missing contacts  | **Extend**, when the model says the shaft has more than the table does                   |
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

### Which electrode is this?

`seegprep`'s catalogue knows forty-four depth-electrode models, and knowing which one a shaft is
changes what "correct" means for it. An Ad-Tech Behnke-Fried lead is **3.0 mm** between contacts 1
and 2 and **5.5 mm** from there out; Re-fit, which re-spaces at the shaft's own *median* gap, turns
that into a uniform 5.5 mm and leaves contact 2 two and a half millimetres off the metal it is
inside. So the panel has a model section, and it looks in three places in this order:

| Where                                                   | What it gives                                       |
| ------------------------------------------------------- | --------------------------------------------------- |
| `sub-<id>_electrodes-geometry.json` beside the table    | this subject's own per-electrode gaps, from seegprep |
| the bundled gap table, keyed by a model or part number   | the manufacturer's geometry for that model           |
| nothing                                                  | today's behaviour: Re-fit's observed median gap      |

The key is the table's own `model` column, or a part number from the site's electrode list, matched
as a **case-insensitive prefix** — `BF10R-SP21X-0C3` finds `BF10R-SP21X`, so nobody has to know which
trailing segments are options. **List…** reads that list (`name,target,part_number,n_contacts,…`)
through a file sheet; it has to be a sheet rather than an automatic discovery, because the list lives
at `sub-<id>/etc/sub-<id>_electrodes.csv`, four directories above the derivative's `ieeg/`, and a
module's sibling rule may ascend at most three.

**No model at all is a supported state, not a degraded one.** With nothing resolved the module does
exactly what it did before this existed, and the section says so rather than pretending.

**Snap to model** (`⇧F`) fits a line through the electrode's contacts, **rejects one contact that is
off it** (a single stray drags a least-squares axis, and a wrong axis is a wrong template
everywhere), slides the model's gap template along that axis until it sits on the brightest metal,
and then moves each contact to its own local peak — *unless* the peak lands more than **1 mm off the
rod**, in which case the contact keeps the template position. That last rule is the one that matters
on a dense implant: `Snap`'s box weighs everything bright inside it, and next to one shaft that is
often the neighbouring shaft. The gaps are the manufacturer's and are never stretched, so the search
has exactly one free parameter and a wrong model cannot be made to fit — the per-gap table is what
says so, flagging anything more than 0.75 mm out. Snapping to model **never renumbers**.

**Extend** places the contacts a shaft is missing, when the model says there are more than the table
has. They go beyond the *entry* end at the model's spacing and are then snapped, and they save with
`status: added` like any contact placed by hand. It asks first, because it adds rows to a clinical
table.

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
3. `<stem>_editlog.json` is written beside it ([what is in it](docs/EDITLOG.md)), recording what changed — counts, and one entry per
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

### Scenes, and a build without the module

The contacts are ordinary scene layers, so a `*.tetravox.json` written here opens anywhere — including
in a build that has no sEEG module, which still draws every contact with its name, its electrode and its
number. What that build cannot carry is the module's own record: which table the contacts came from,
where that table put each one, and its other columns. Re-open such a scene here and the module rebuilds
the electrodes from the layer, tells you the provenance is gone, and turns Save into Save as… rather than
writing a table in which everything looks new.

### From a job file

Every button is also a job-file operation, so a batch can do what the panel does — `load`, `snap`,
`snap-model`, `extend`, `refit`, `renumber`, `flip-tip`, `revert`, `delete`, `ghost`, `wire`, `size`,
`stats` and `save`. `flip-tip` matters more
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
pnpm run check                   # zero imports, size, the manifest validator, the catalogue pin
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

### The bundled electrode catalogue

`src/catalogue.gen.ts` is **generated**, from `seegprep`'s own
`src/seegprep/data/electrode_models.json`. seegprep owns the numbers — two programs disagreeing about
how far apart an RD10R-SP05X's contacts are would give a clinician two different answers to "is this
shaft right" — and this repository owns the copy that ships inside the bundle:

```sh
node scripts/gen-catalogue.mjs --from ../seegprep/src/seegprep/data/electrode_models.json
node scripts/gen-catalogue.mjs --check   # part of `pnpm run check`
```

`catalogue.pin.json` records the sha256 of the source it came from *and* of the generated file, like
`contacts.pin.json` does for the kit. `--check` verifies the generated file always, and the source
only when a seegprep checkout is actually present — so CI, which has never seen seegprep, still
catches a hand-edited catalogue.

It is baked in rather than read at run time because a module bundle has no `node_modules`, no import
map and no network, and a lab's subject directory is not guaranteed to carry seegprep's package data.
Forty-four models is 3 kB.

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
  modelsnap.ts  which electrode this *is* — model resolution, the template slide, extend
  catalogue.gen.ts  GENERATED: the gap table, from seegprep's electrode_models.json
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
