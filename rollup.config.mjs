/**
 * The module bundle: **one ESM file with no imports in it**.
 *
 * That is the whole contract (`@tetravox/module-sdk`'s README, "The one rule"). Tetravox loads a
 * downloaded module over `tetravox://module/<id>/<version>/index.js`, where nothing resolves a bare
 * specifier — no import map, no `node_modules`, and a CSP that grants script execution to that host
 * and to nothing else. So `external` is empty and the SDK shim is **inlined**: it is forty lines
 * that read the host's React, the contacts kit and `ModuleHostError` off
 * `globalThis.__tetravoxModuleSdk`, which is how a downloaded panel renders inside the app's own
 * React tree instead of a second copy of it.
 *
 * `scripts/check-bundle.mjs` re-asserts the property on the emitted file, because a config is an
 * intention and the built bytes are the fact.
 */

import { nodeResolve } from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';

export default {
  input: 'src/index.ts',
  output: { file: 'dist/index.js', format: 'es', sourcemap: false },
  external: [], // nothing is external — the SDK shim is inlined
  plugins: [
    nodeResolve({ extensions: ['.ts', '.tsx', '.js', '.mjs'] }),
    // Compiler options are passed flat: the plugin merges them into the tsconfig's own. The one
    // place the checked configuration and the emitting one differ is `noEmit` — `tsconfig.json` is
    // a check and a bundler needs output.
    typescript({
      tsconfig: './tsconfig.json',
      noEmit: false,
      declaration: false,
      declarationMap: false,
      sourceMap: false,
    }),
  ],
  // An unresolved bare specifier would become an `import` in the output, which is the failure this
  // whole file exists to prevent. Fail the build where it happens instead.
  onwarn(warning) {
    throw new Error(`${warning.code ?? 'WARN'}: ${warning.message}`);
  },
};
