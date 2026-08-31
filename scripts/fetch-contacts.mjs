/**
 * The shared contacts kit, for the tests only.
 *
 * The kit lives in Tetravox and stays there: a module's second module is a library, not a fork, and
 * the app hands a loaded module *its own* instance through `sdk.contacts`, so two contact modules
 * share one TSV reader, one editlog and one snap. The SDK tarball carries the kit's `.d.ts` — enough
 * to typecheck against — and no runtime, which is right for the shipped bundle and leaves this
 * repository's unit tests with nothing to execute.
 *
 * So the tests fetch the pinned sources. Not a vendored copy: `contacts.pin.json` names one commit
 * and the sha256 of every file, each byte is verified on arrival, and `.contacts/` is ignored by
 * git. A kit that changed under the pin fails here rather than quietly changing what the tests mean.
 * The files are plain TypeScript whose only outside imports are type-only, so vitest loads them from
 * source with nothing else installed.
 *
 * Offline, or pointed at a checkout with `TETRAVOX_CONTACTS`, this script is unnecessary: the suites
 * that need the kit skip when it is absent, loudly.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const pin = JSON.parse(readFileSync('contacts.pin.json', 'utf8'));
const out = process.argv[2] ?? '.contacts';
mkdirSync(out, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

let fetched = 0;
for (const [name, want] of Object.entries(pin.files)) {
  const target = join(out, name);
  if (existsSync(target) && sha256(readFileSync(target)) === want) continue;
  const url = `https://raw.githubusercontent.com/${pin.repo}/${pin.commit}/${pin.path}/${name}`;
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`${url}: HTTP ${response.status}`);
    process.exit(1);
  }
  const body = Buffer.from(await response.arrayBuffer());
  const got = sha256(body);
  if (got !== want) {
    console.error(`${name}: sha256 ${got}, expected ${want} (contacts.pin.json is stale or wrong)`);
    process.exit(1);
  }
  writeFileSync(target, body);
  fetched += 1;
}

console.log(
  `${out}: ${Object.keys(pin.files).length} files from ${pin.repo}@${pin.commit.slice(0, 7)} ` +
    `(${fetched} downloaded, ${Object.keys(pin.files).length - fetched} already verified)`
);
