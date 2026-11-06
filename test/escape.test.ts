/**
 * Add, Esc, Esc with a contact selected must end selecting, never placing.
 *
 * The engine's Esc grammar is place → select → off, and the first step emits no event. The second
 * emits `cleared`, and with a contact selected the handler repaints to drop the drag guide. That
 * repaint fires `layers` synchronously, which re-arms whatever mode was last wanted, so `wantMode`
 * has to be settled before it. A click after this used to add a contact.
 */

import { expect, it } from "vitest";
import { HAS_CONTACTS } from "./setup";
import { createModel } from "../src/editor";
import { seegManifest } from "../src/manifest";

function fakeHost() {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const fire = (name: string, event?: unknown): void => {
    for (const cb of [...(listeners.get(name) ?? [])]) cb(event);
  };
  let layer: Record<string, unknown> = {
    id: "layer1",
    kind: "points",
    module: seegManifest.id,
    datasetId: null,
    visible: true,
    opacity: 1,
    points: [{ id: "p1", name: "A01", group: "A", position: [0, 0, 0] }, { id: "p2", name: "A02", group: "A", position: [0, 0, 3] }],
  };
  let tool: { layerId: string; mode: string } | null = null;
  const host = {
    id: seegManifest.id,
    subscribe: () => undefined,
    history: () => ({ push: () => undefined, clear: () => undefined, undo: () => null, redo: () => null, canUndo: () => false, canRedo: () => false }),
    scene: {
      on: (name: string, cb: (e: unknown) => void) => {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(cb);
        return () => listeners.get(name)!.delete(cb);
      },
      layers: () => [layer],
      datasets: () => [],
      block: () => null,
      setBlock: () => undefined,
      setCursor: () => undefined,
      updateLayer: (_id: string, patch: Record<string, unknown>) => {
        layer = { ...layer, ...patch };
        fire("layers");
      },
    },
    tool: {
      pointTool: () => tool,
      setPointTool: (spec: { layerId: string; mode: string } | null) => {
        tool = spec;
      },
      select: () => undefined,
    },
    ui: { status: () => undefined, setDirty: () => undefined, toast: () => undefined },
    files: {},
  };
  return { host, fire, mode: () => tool?.mode ?? null, esc1: () => (tool = { ...tool!, mode: "select" }), off: () => (tool = null) };
}

it.skipIf(!HAS_CONTACTS)("Add, Esc, Esc with a contact selected ends selecting, not placing", async () => {
  const f = fakeHost();
  const model = createModel(f.host as never);
  // A module-owned layer with no block of its own is adopted as the model starts, and armed.
  await model.run("add");
  expect(f.mode()).toBe("place");
  f.fire("pointTool", { layerId: "layer1", kind: "selected", pointId: "p1", index: 0 });
  // Esc #1 is silent, as in the engine.
  f.esc1();
  expect(f.mode()).toBe("select");
  // Esc #2: the tool is gone by the time `cleared` arrives.
  f.off();
  f.fire("pointTool", { layerId: "layer1", kind: "cleared", pointId: null, index: -1, reason: "esc" });
  expect(f.mode()).toBe("select");
});
