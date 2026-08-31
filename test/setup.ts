/**
 * The host global, for tests.
 *
 * A Tetravox module reaches React, `ModuleHostError`, `stemOf` and the shared contacts kit through
 * `globalThis.__tetravoxModuleSdk`, which the app assigns before any module activates. Vitest is not
 * the app, so this file is the app's half — the same five members, in the same shape
 * (`scripts/module-sdk/sdk-runtime.ts` in the Tetravox repository is the original, and its header
 * carries the snippet).
 *
 * Three of the five are the real thing here:
 *
 *  * `react` — the package this repository devDepends on. There is one copy in a test run, which is
 *    the invariant the global exists to keep;
 *  * `stemOf` and `hostVersion` — from the SDK tarball's own `manifest-types.mjs`, so they are the
 *    app's definitions and not a second opinion about what `{stem}` means;
 *  * `contacts` — see below.
 *
 * `ModuleHostError` is the one stand-in: the SDK ships the class's *type* and not the class, because
 * `host.ts` is emitted as declarations only. Nothing in this repository's suites asserts on it, and
 * the module's own `instanceof` is against whatever the host supplied, so a stand-in with the same
 * name and shape is honest here and would not be in the app.
 *
 * **`contacts` is not in the SDK as runtime code.** The kit stays in Tetravox (a module's second
 * module is a library, not a fork) and the tarball carries only its `.d.ts`, so a module repository
 * can typecheck against it but cannot execute it. Two ways in, in this order:
 * `TETRAVOX_CONTACTS` pointing at a checkout's
 * `packages/app/src/renderer/src/modules/shared/contacts`, or `.contacts/` — the pinned,
 * hash-verified copy `scripts/fetch-contacts.mjs` downloads (`contacts.pin.json` names the commit
 * and every file's sha256). The files are plain TypeScript whose only outside imports are type-only,
 * so vitest loads them from source. With neither, the suites that execute the kit skip — loudly —
 * rather than asserting against a re-implementation of it.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as react from 'react';
import { MODULE_HOST_VERSION, stemOf } from '@tetravox/module-sdk/manifest-types.mjs';

/** The kit's modules, in the order the SDK's generated barrel re-exports them. */
const CONTACTS_MODULES = ['editlog', 'geometry', 'layer', 'model', 'palette', 'snap', 'tsv'];

/** `renderer/src/modules/host.ts`'s class, stood in for. See the header. */
class ModuleHostError extends Error {
  constructor(
    message: string,
    readonly code: string = 'module'
  ) {
    super(message);
    this.name = 'ModuleHostError';
  }
}

/** Where the contacts kit is, or null. A checkout wins over the downloaded pin. */
export function contactsRoot(): string | null {
  const raw = process.env['TETRAVOX_CONTACTS'];
  for (const dir of [raw === undefined || raw === '' ? null : resolve(raw), resolve('.contacts')]) {
    if (dir !== null && existsSync(join(dir, 'model.ts'))) return dir;
  }
  return null;
}

/** True when the suites that execute the contacts kit can run. */
export const HAS_CONTACTS = contactsRoot() !== null;

async function loadContacts(): Promise<Record<string, unknown>> {
  const dir = contactsRoot();
  if (dir === null) {
    // Every member is a no-op rather than a throw, because a test file's fixtures call the kit
    // while it is being *imported* — `paletteColor(0)` inside a top-level `const` — and a throw
    // there would fail the file instead of skipping its suites.
    // `describe.skipIf(!HAS_CONTACTS)` is what keeps the no-ops from ever being asserted on.
    //
    // `then` is excluded and the exclusion is load-bearing: this object is `await`ed below, and a
    // proxy that answers `then` with a function is a thenable the await machinery calls and waits
    // on forever.
    return new Proxy(
      {},
      { get: (_target, key) => (key === 'then' || typeof key === 'symbol' ? undefined : () => undefined) }
    );
  }
  const loaded = await Promise.all(
    CONTACTS_MODULES.map((name) => import(/* @vite-ignore */ pathToFileURL(join(dir, `${name}.ts`)).href))
  );
  return Object.assign({}, ...loaded) as Record<string, unknown>;
}

(globalThis as Record<string, unknown>)['__tetravoxModuleSdk'] = {
  hostVersion: MODULE_HOST_VERSION,
  react,
  ModuleHostError,
  stemOf,
  contacts: await loadContacts(),
};

if (!HAS_CONTACTS) {
  console.warn(
    'The shared contacts kit is absent: the suites that execute it will SKIP. Run ' +
      '`node scripts/fetch-contacts.mjs`, or point TETRAVOX_CONTACTS at a Tetravox checkout\'s ' +
      'packages/app/src/renderer/src/modules/shared/contacts.'
  );
}
