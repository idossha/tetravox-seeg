/**
 * The manifest, held to the rules the app holds it to.
 *
 * In the Tetravox repository `modules.test.ts` iterates every compiled-in manifest and asserts these
 * for all of them at once. A module that ships from its own repository has to bring the ones that
 * are about *it*: the shape (the app's own validator, from the SDK), the host API it claims, and
 * §13.6's parity rule — every scene-mutating command is also an operation, or there is a written
 * reason it cannot be.
 */

import { describe, expect, it } from 'vitest';
import { validateManifest } from '@tetravox/module-sdk/manifest-schema.mjs';
import { MODULE_HOST_VERSION } from '@tetravox/module-sdk/manifest-types.mjs';
import { seegManifest } from '../src/manifest';

/**
 * The commands with no operation of the same id, and why each one cannot have one.
 *
 * Lifted verbatim from `modules.test.ts`'s `COMMANDS_THAT_ARE_NOT_OPERATIONS`. The assertion is
 * *equality*, so adding a scene-mutating command without an operation fails until somebody either
 * writes the operation or writes down why there cannot be one.
 */
const COMMANDS_THAT_ARE_NOT_OPERATIONS: Record<string, string> = {
  add: 'arms place mode — every contact it adds comes from a live click in a pane',
  next: 'moves the selection; changes nothing a saved file would show',
  prev: 'moves the selection; changes nothing a saved file would show',
  undo: 'the session’s own history stack, which a job has no use for',
  redo: 'the session’s own history stack, which a job has no use for',
  'snap-electrode': 'the `snap` operation with `scope: "electrode"`',
  'snap-all': 'the `snap` operation with `scope: "all"`, plus a confirmation',
  'save-as': 'opens a file sheet; the `save` operation is handed `out` instead',
};

describe('the manifest', () => {
  it('is what the app’s own validator calls a manifest', () => {
    // Through JSON, because that is the carrier: the release ships `manifest.json` and the app
    // parses it. A field a `ModuleManifest` may not have would survive the type and fail here.
    const result = validateManifest(JSON.parse(JSON.stringify(seegManifest)));
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('claims the host API this SDK was emitted for', () => {
    expect(seegManifest.hostApi).toBe(MODULE_HOST_VERSION);
  });

  it('documents itself at a URL, because the app’s guide has no heading for it', () => {
    expect(seegManifest.docs).toMatch(/^https:\/\/github\.com\/idossha\/tetravox-seeg/);
  });

  it('gives every scene-mutating command an operation, or says why it cannot have one', () => {
    const operations = new Set((seegManifest.operations ?? []).map((o) => o.id));
    const orphans = seegManifest.commands.map((c) => c.id).filter((id) => !operations.has(id));
    expect(new Set(orphans)).toEqual(new Set(Object.keys(COMMANDS_THAT_ARE_NOT_OPERATIONS)));
  });

  it('declares sibling patterns that compile and ascend at most three directories', () => {
    for (const sibling of seegManifest.siblings ?? []) {
      expect(() => new RegExp(sibling.from)).not.toThrow();
      for (const candidate of sibling.candidates) {
        expect(candidate.startsWith('/')).toBe(false);
        expect(candidate.split('/').filter((s) => s === '..').length).toBeLessThanOrEqual(3);
      }
    }
  });
});
