/**
 * `spacingMmAt` — the panel row's 3-D neighbour-spacing value.
 *
 * The panel's distance column used to show `offPlaneMm` (distance from the active pane's plane, a
 * 2-D notion). This feature's standing rule is that every distance shown is a true 3-D distance, so
 * the column is now the centre-to-centre distance to the previous contact by ordinal within the same
 * electrode. `spacingMmAt` is the pure piece of that: given an ordinal-ordered contact list (what
 * `contactsOf` returns) and an index, it is `null` at the first contact and `distanceMm` to the
 * previous one everywhere else.
 */

import { describe, expect, it } from "vitest";
import { HAS_CONTACTS } from "./setup";
import { contacts } from "@tetravox/module-sdk";
import type { Contact, ContactSet, vec3 } from "@tetravox/module-sdk";
import { spacingMmAt, TOOL } from "../src/editor";
import { seegManifest } from "../src/manifest";

const { contactsOf, distanceMm, paletteColor } = contacts;

function contact(id: string, group: string, ordinal: number, position: vec3): Contact {
  return {
    id,
    name: `${group}${ordinal}`,
    group,
    ordinal,
    position,
    original: position,
    originalName: `${group}${ordinal}`,
    loadedStatus: null,
    extra: {},
  };
}

function setOf(...cs: Contact[]): ContactSet {
  const names = [...new Set(cs.map((c) => c.group))];
  return {
    contacts: cs,
    groups: names.map((name, i) => ({ name, color: paletteColor(i), tip: "auto" as const })),
  };
}

describe.skipIf(!HAS_CONTACTS)("spacingMmAt", () => {
  it("is a true 3-D distance, not a projection onto any one plane", () => {
    // [0,0,0] -> [3,4,12]: hypot(3,4,12) = 13. Any 2D drop of an axis would not land on 13.
    const ordered = [
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [3, 4, 12]),
    ];
    expect(spacingMmAt(ordered, 1)).toBeCloseTo(13, 5);
    expect(spacingMmAt(ordered, 1)).toBeCloseTo(distanceMm(ordered[0]!.position, ordered[1]!.position), 10);
  });

  it("the first contact of a group has null spacing", () => {
    const ordered = [contact("a", "A", 1, [0, 0, 0]), contact("b", "A", 2, [10, 0, 0])];
    expect(spacingMmAt(ordered, 0)).toBeNull();
  });

  it("the second contact's spacing is the distance to the first", () => {
    const ordered = [contact("a", "A", 1, [0, 0, 0]), contact("b", "A", 2, [10, 0, 0])];
    expect(spacingMmAt(ordered, 1)).toBeCloseTo(10, 5);
  });

  it("follows ordinal, not array order, once fed through contactsOf", () => {
    // Array order is deliberately scrambled relative to ordinal order, exactly like dragguide's
    // "finds neighbours by ordinal, not by array index" fixture.
    const set = setOf(
      contact("mid", "A", 2, [10, 0, 0]),
      contact("tip", "A", 1, [0, 0, 0]),
      contact("far", "A", 3, [30, 0, 0]),
    );
    const ordered = contactsOf(set, "A");
    expect(ordered.map((c) => c.id)).toEqual(["tip", "mid", "far"]);

    expect(spacingMmAt(ordered, 0)).toBeNull();
    expect(spacingMmAt(ordered, 1)).toBeCloseTo(10, 5); // tip(0) -> mid(10)
    expect(spacingMmAt(ordered, 2)).toBeCloseTo(20, 5); // mid(10) -> far(30)
  });
});

/**
 * The editlog's `tool` field, held to the manifest.
 *
 * It was a hand-maintained literal through 0.1.5 and read `Tetravox sEEG contacts 0.1.0` in all six
 * of those releases, so the one field whose job is to say which build produced an edit could not
 * tell them apart. `seegprep` reads it. The docstring said "derived, never written down" — this is
 * what holds it to that, and `manifest.test.ts` holds the manifest to `package.json` in turn.
 */
describe("the editlog's tool field", () => {
  it("names the manifest's version, never a literal of its own", () => {
    expect(TOOL).toBe(`Tetravox sEEG contacts ${seegManifest.version}`);
    expect(TOOL).toContain(seegManifest.version);
    // And it is a version, not a placeholder: a `0.1.0` surviving a bump is the exact defect.
    expect(TOOL).toMatch(/ \d+\.\d+\.\d+$/);
  });
});
