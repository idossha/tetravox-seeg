/**
 * Insert a `versions[]` entry into a checkout of the app's shipped extensions catalogue.
 *
 * The catalogue lives in `idossha/tetravox` (`packages/app/src/shared/extensions-index.json`) and is
 * what File ▸ Extensions… offers when there is no network. It was refreshed by hand, from a fragment
 * printed into a release job summary, and the paste is easy to forget: 0.1.4 shipped on 2026-08-31
 * and was never catalogued, so nobody was offered it until 0.1.5 went out three days later. Worse,
 * the paste *cannot* happen before the release exists — the app verifies a download against the
 * sha256 in its own URL, so the numbers have to come off published assets — which puts the step
 * after the moment everyone considers the release finished.
 *
 * Reads the entry `print-fragments.mjs --registry-json` produced, so the automated path and the
 * paste-it-yourself path derive it from exactly one place.
 *
 *   node scripts/insert-catalogue-entry.mjs <catalogue.json> <entry.json>
 *
 * Exits 0 and changes nothing when the version is already listed, so re-running a release — the
 * `workflow_dispatch` path exists precisely to do that — is a no-op rather than a duplicate entry.
 * Prints `changed=true|false` to `$GITHUB_OUTPUT` when there is one, so the caller can skip opening
 * an empty PR.
 */

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const [cataloguePath, entryPath] = process.argv.slice(2);
if (cataloguePath === undefined || entryPath === undefined) {
  console.error('usage: insert-catalogue-entry.mjs <catalogue.json> <entry.json>');
  process.exit(1);
}

const catalogue = JSON.parse(readFileSync(cataloguePath, 'utf8'));
const entry = JSON.parse(readFileSync(entryPath, 'utf8'));

const MODULE_ID = 'tetravox.seeg';
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

if (module.versions.some((v) => v.version === entry.version)) {
  console.log(`${MODULE_ID} ${entry.version} is already catalogued; nothing to do`);
  report(false);
  process.exit(0);
}

module.versions.push(entry);
catalogue.generated = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
writeFileSync(cataloguePath, `${JSON.stringify(catalogue, null, 2)}\n`);
console.log(`added ${MODULE_ID} ${entry.version} to ${cataloguePath}`);
report(true);
