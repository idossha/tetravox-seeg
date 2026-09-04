# The editlog this module writes

`<stem>_editlog.json`, written beside every saved table, is a **contract with another program**
before it is a log. `seegprep`'s CLI globs `<derivatives>/sub-<id>/ieeg/*_electrodes_editlog.json`
and refuses to overwrite a hand-edited subject unless it is passed `--force`, so the file's *name*
is the signal and the counts inside it are what a reader checks first.

The shape comes from the shared contacts kit (`tetravox.contacts/editlog@1`, in the Tetravox
repository — this module is a reader of that kit, not its owner). What this page records is what
**this module adds**, and the rule those additions live under.

## The rule

> A key that a reader can ignore without being misled is **additive**, and the schema string does not
> move for it. A key that changes what an existing key *means* is a new schema.

Two keys have arrived under that rule so far: `renamed` (the shared kit's, 2026-08-30) and the pair
below (this module's, 0.2.0). A reader that knows only the keys Slicer's editor wrote keeps working;
a log written before these existed reads as their absence, which is the truth about it.

## What 0.2.0 adds

Each entry of `electrodes[]` carries two more fields:

| Field       | Type              | Means                                                          |
| ----------- | ----------------- | -------------------------------------------------------------- |
| `model`     | `string \| null`  | The electrode model resolved for this shaft, or `null` for none |
| `snap_mode` | `"free" \| "model"` | Which kind of snap last ran on this electrode                 |

```json
{
  "schema": "tetravox.contacts/editlog@1",
  "tool": "Tetravox sEEG contacts 0.2.0",
  "electrodes": [
    {
      "name": "LHIP",
      "n_contacts": 10,
      "refit": false,
      "renumbered": false,
      "snapped": true,
      "model": "BF10R-SP21X",
      "snap_mode": "model"
    },
    {
      "name": "LAMY",
      "n_contacts": 8,
      "refit": false,
      "renumbered": false,
      "snapped": true,
      "model": null,
      "snap_mode": "free"
    }
  ]
}
```

### Why they are not one field

`snapped: true` already said *that* an electrode was snapped. It could not say **what kind of claim
that makes about a position**, and the two kinds are different enough to matter to anything reading
the log afterwards:

- `snap_mode: "free"` — each contact was moved independently to the intensity-weighted peak of a
  small box around it. Nothing constrains the result to a straight rod or to any spacing; a contact
  with nothing bright near it did not move at all.
- `snap_mode: "model"` — a line was fitted through the shaft with one outlier rejected, the named
  model's gap template was slid along it onto the brightest metal, and each contact was then moved to
  its local peak *unless* that peak was more than 1 mm off the fitted line, in which case it kept the
  template position. Every position is therefore either on the manufacturer's grid or within a
  millimetre of it.

`model` is stated even when `snap_mode` is `"free"`, because "we knew which electrode this was and
snapped it freely anyway" and "we never knew" are different states of the record.

### `"measured"` is a value `model` can take

seegprep's geometry sidecar always writes a `spacing_gaps_mm`; when its own catalogue matched nothing
it writes `model: "n/a"` and fills that vector with the shaft's measured median pitch, repeated. This
module reads `"n/a"` as no model, tries the catalogue with the keys seegprep never saw, and only then
falls back to that vector — recording the model as the literal string `"measured"`. It is never a
part number, so a reader can tell a snap onto a manufacturer's grid from a snap onto the shaft's own
average without knowing this module's internals.

### Where they are written

In this module (`src/editor.ts`, `withModelFields`), not in the shared kit — a model is a fact about
a **rod**, and the kit serves ECoG grids and DBS leads too. That is the same line `src/shaft.ts`
sits on.

### Scope

Both fields are **per table, not per window**, like the `refit` / `renumbered` / `snapped` flags
beside them. (`refit` is **always `false`** since 0.2.1: the Re-fit button was removed, and the flag
is kept so a reader looking it up by name — `seegprep`'s does — is not broken by a button going
away.) Anatomical naming means sub-02's shafts are usually called what sub-01's were, so
opening another table forgets every one of them; otherwise a snap-to-model on one subject would write
`snap_mode: "model"` beside a same-named electrode of a table it never ran on.

## `snap_radius_mm`

Unchanged, and it still means what it did: the radius the panel's field was set to when the table was
saved. A model snap uses the same radius for its per-contact peak step, so the field describes both
kinds of snap.
