/**
 * One setup file, because a module cannot be imported at all until the host global exists.
 *
 * `test/setup.ts` assigns `globalThis.__tetravoxModuleSdk`; the SDK's `index.js` reads it at module
 * evaluation and throws a named error when it is absent, which is exactly the behaviour the app
 * relies on and exactly why the assignment has to happen first.
 */

import { defineConfig } from 'vitest/config';

const contacts = process.env['TETRAVOX_CONTACTS'];

export default defineConfig({
  server: {
    // The contacts kit is read from a Tetravox checkout outside this repository (see
    // `test/setup.ts`), so Vite has to be told it may serve it.
    fs: { allow: [process.cwd(), ...(contacts === undefined ? [] : [contacts])] },
  },
  test: {
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
  },
});
