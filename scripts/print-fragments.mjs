/**
 * The two JSON fragments a module release has to hand to somebody else.
 *
 *  * **`modules.lock`** in the Tetravox repository — the hash-pinned list of what a release bundles.
 *    `tetravox.seeg` is `bundled: true` because it is the flagship module and has to work out of the
 *    box; `scripts/fetch-locked-modules.mjs` downloads and verifies it into the packaged app.
 *  * **`versions[]`** in `idossha/tetravox-extensions`'s `index.json` — what File ▸ Extensions…
 *    offers. `files[].url` is the asset's own sha256 on this release, which is the sample-data store
 *    layout verbatim, and `permissions` is a deliberate copy of what the manifest implies so a card
 *    can be drawn without downloading anything. The consent sheet always shows the *installed*
 *    manifest's derived list, and a disagreement between the two is a hard install failure.
 *
 * Both are printed rather than written: they belong to repositories this one does not own.
 */

import { readFileSync } from 'node:fs';
import { derivePermissions, validateManifest } from '@tetravox/module-sdk/manifest-schema.mjs';

const [tag, repo, ...rest] = process.argv.slice(2);
const files = rest.map((entry) => {
  const [name, bytes, sha256] = entry.split(' ');
  return { name, bytes: Number(bytes), sha256 };
});

const validated = validateManifest(JSON.parse(readFileSync('dist/manifest.json', 'utf8')));
if (!validated.ok) {
  console.error(validated.errors.join('\n'));
  process.exit(1);
}
const manifest = validated.manifest;
const store = `https://github.com/${repo}/releases/download/${tag}`;

const lock = {
  id: manifest.id,
  version: manifest.version,
  hostApi: manifest.hostApi,
  repo,
  tag,
  bundled: true,
  files,
};

const registry = {
  version: manifest.version,
  tag,
  hostApi: manifest.hostApi,
  published: new Date().toISOString().slice(0, 10),
  files: files.map((f) => ({ ...f, url: `${store}/${f.sha256}` })),
  permissions: derivePermissions(manifest),
};

console.log('\n--- modules.lock fragment (idossha/tetravox, modules[]) ---');
console.log(JSON.stringify(lock, null, 2));
console.log('\n--- registry versions[] entry (idossha/tetravox-extensions, index.json) ---');
console.log(JSON.stringify(registry, null, 2));
