/**
 * `tetravox.seeg` — the sEEG contact editor's `activate` (ARCHITECTURE.md §13.1).
 *
 * Deliberately thin: `editor.ts` holds the state and every command, `Panel.tsx` is chrome, and this
 * is the `ModuleInstance` that connects them to the host. The whole of §13.6's promise is visible
 * here — `runCommand` and `runOperation` reach the same model, so a button and a job file cannot
 * drift apart.
 *
 * **Imports.** `@tetravox/module-sdk` and this directory, and nothing else — the host surface, the
 * contacts kit (through `editor.ts`) and React all arrive through the one package, because a
 * downloaded bundle resolves no bare specifier of its own. `scripts/check-bundle.mjs` re-proves it
 * by reading the built file.
 */

import { createElement } from '@tetravox/module-sdk';
import type { ExtensionBlock, ModuleHost, ModuleInstance } from '@tetravox/module-sdk';
import { createModel } from './editor';
import { SeegPanel } from './Panel';

export const activate = (host: ModuleHost): ModuleInstance => {
  const model = createModel(host);

  return {
    Panel: () => createElement(SeegPanel, { model }),

    runCommand(id: string): void | Promise<void> {
      return model.run(id);
    },

    runOperation(op, args) {
      return model.runOperation(op, args);
    },

    openPath(readerId, path) {
      return model.openPath(readerId, path);
    },

    onSibling(anchor, found) {
      return model.onSibling(anchor, found);
    },

    restoreBlock(block: ExtensionBlock) {
      return model.restoreBlock(block);
    },

    dirty: () => model.dirty(),

    dispose(): void {
      model.dispose();
    },
  };
};
