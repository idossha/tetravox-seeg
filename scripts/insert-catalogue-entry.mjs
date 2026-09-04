/**
 * Insert (or re-point) a `versions[]` entry in a catalogue that carries a top-level `modules[]`.
 *
 * **The catalogue this targets is `idossha/tetravox-extensions`' `index.json`** — the live registry
 * the app fetches at launch. It used to target the app's *shipped* copy
 * (`idossha/tetravox/packages/app/src/shared/extensions-index.json`), which is why every extension
 * release dragged a core release behind it: an entry that only lands in the app repository is not
 * offered to anybody until a new Tetravox is built and downloaded. Publishing to the registry is
 * what makes a release visible the day it is merged. The two files have the same shape, so this
 * script still works on either — the workflow simply points it at the registry now.
 *
 * The paste it replaces is easy to forget and *cannot* happen before the release exists — the app
 * verifies a download against the sha256 in its own URL, so the numbers have to come off published
 * assets — which puts it after the moment everyone considers the release finished. 0.1.4 shipped on
 * 2026-08-31 and was never catalogued for exactly that reason.
 *
 * Reads the entry `print-fragments.mjs --registry-json` produced, so the automated path and the
 * paste-it-yourself path derive it from exactly one place.
 *
 *   node scripts/insert-catalogue-entry.mjs <catalogue.json> <entry.json> [--id <module id>]
 *
 * Exits 0 and changes nothing when the version is already listed **with the same files**, so
 * re-running a release — the `workflow_dispatch` path exists to do that — is a no-op rather than a
 * duplicate entry. A version already listed with *different* files is a re-release after a bad
 * build and is **replaced**: the app resolves such a collision in the live index's favour, so the
 * registry saying something other than the truth would be a divergence nobody could fix.
 * `versions[]` is left sorted oldest-first, which the registry's own validator requires.
 *
 * Prints `changed=true|false` to `$GITHUB_OUTPUT` when there is one, so the caller can skip opening
 * an empty PR.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const idAt = argv.indexOf('--id');
const MODULE_ID = idAt === -1 ? 'tetravox.seeg' : argv[idAt + 1];
// `indexOf` answers -1 when the flag is absent, and -1 matches no index — so the filter has to be
// guarded, or it would drop argv[0] on every call that did not pass `--id`.
const positional = argv.filter((_a, i) => idAt === -1 || (i !== idAt && i !== idAt + 1));
const [cataloguePath, entryPath] = positional;
if (cataloguePath === undefined || entryPath === undefined) {
  console.error('usage: insert-catalogue-entry.mjs <catalogue.json> <entry.json> [--id <module id>]');
  process.exit(1);
}

const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
const entry = JSON.parse(readFileSync(entryPath, 'utf8'));

const module = catalogue.modules?.find((m) => m.id === MODULE_ID);
if (module === undefined) {
  console.error(`${cataloguePath} has no ${MODULE_ID} entry to append to`);
  process.exit(1);
}

// Every field the app reads must be present and non-empty. A `bytes: 0` or an empty sha256 is the
// shape a mis-parsed fragment takes, and it produces a catalogue entry that looks well-formed and
// can never install -- worse than no entry at all, because the card offers an update that fails.
for (const file of entry.files ?? []) {
  if (!file.name || !file.sha256 || !Number.isInteger(file.bytes) || file.bytes <= 0) {
    console.error(`refusing an incomplete entry: ${JSON.stringify(file)}`);
    process.exit(1);
  }
  if (!file.url.endsWith(file.sha256)) {
    console.error(`refusing ${file.name}: the URL does not end in its own sha256`);
    process.exit(1);
  }
}

const report = (changed) => {
  if (process.env['GITHUB_OUTPUT'] !== undefined) {
    appendFileSync(process.env['GITHUB_OUTPUT'], `changed=${changed}\n`);
  }
};

/** Numeric-segment semver compare — the registry's validator requires oldest-first. */
const compare = (a, b) => {
  const parts = (v) => v.split('-')[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [l, r] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) {
    const d = (l[i] ?? 0) - (r[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  const pre = (v) => v.split('-').slice(1).join('-');
  const [pa, pb] = [pre(a), pre(b)];
  if (pa === pb) return 0;
  if (pa === '') return 1;
  if (pb === '') return -1;
  return pa < pb ? -1 : 1;
};

const at = module.versions.findIndex((v) => v.version === entry.version);
if (at !== -1) {
  const same = JSON.stringify(module.versions[at].files) === JSON.stringify(entry.files);
  if (same) {
    console.log(`${MODULE_ID} ${entry.version} is already catalogued; nothing to do`);
    report(false);
    process.exit(0);
  }
  console.log(`${MODULE_ID} ${entry.version} is catalogued with different files; re-pointing it`);
  module.versions[at] = entry;
} else {
  module.versions.push(entry);
}
module.versions.sort((a, b) => compare(a.version, b.version));
catalogue.generated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
writeFileSync(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`wrote ${MODULE_ID} ${entry.version} to ${cataloguePath}`);
report(true);
