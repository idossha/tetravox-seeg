/**
 * `dragGuide` — the reference rod and distance readouts drawn while one contact is being dragged.
 *
 * The two rules worth failing loudly on: the axis is fitted from the electrode's *other* contacts
 * (so the rod does not follow the drag), and neighbours are found by ordinal, not by array order
 * (the array is drawing order, exactly as `shaftGeometry` treats it).
 */

import { describe, expect, it } from "vitest";
import { HAS_CONTACTS } from "./setup";
import { contacts } from "@tetravox/module-sdk";
import type { Contact, ContactSet, vec3 } from "@tetravox/module-sdk";
import { dragGuide, LABEL_OFFSET_MM } from "../src/dragguide";

const { distanceMm, fitLine, paletteColor } = contacts;

function contact(
  id: string,
  group: string,
  ordinal: number,
  position: vec3,
): Contact {
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
    groups: names.map((name, i) => ({
      name,
      color: paletteColor(i),
      tip: "auto" as const,
    })),
  };
}

describe.skipIf(!HAS_CONTACTS)("dragGuide", () => {
  it("names 'nope' — returns null", () => {
    const set = setOf(contact("a", "A", 1, [0, 0, 0]));
    expect(dragGuide(set, "nope")).toBeNull();
  });

  it("reports a true 3D distance, not an in-plane 2D one", () => {
    // [0,0,0] -> [3,4,12]: hypot(3,4,12) = 13. A 2D distance dropping any one axis would not be 13.
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [3, 4, 12]),
    );
    const guide = dragGuide(set, "a");
    expect(guide).not.toBeNull();
    expect(guide?.labels).toHaveLength(1);
    expect(guide?.labels[0]?.text).toBe("13.0 mm");
    // Offset off the exact midpoint, by LABEL_OFFSET_MM, so it no longer equals [1.5, 2, 6].
    const mid: vec3 = [1.5, 2, 6];
    const pos = guide?.labels[0]?.position as vec3;
    expect(distanceMm(pos, mid)).toBeCloseTo(LABEL_OFFSET_MM, 5);
  });

  it("offsets each label perpendicular to the fitted axis, by LABEL_OFFSET_MM, on the same side", () => {
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [10, 0, 0]),
      contact("c", "A", 3, [20, 0, 0]),
    );
    const guide = dragGuide(set, "b");
    expect(guide).not.toBeNull();
    expect(guide?.labels).toHaveLength(2);

    const fit = fitLine([
      [0, 0, 0],
      [20, 0, 0],
    ]);
    expect(fit).not.toBeNull();
    const axis = fit!.axis;

    for (const label of guide?.labels ?? []) {
      const mid: vec3 =
        label === guide?.labels[0] ? [5, 0, 0] : [15, 0, 0];
      const offset: vec3 = [
        label.position[0] - mid[0],
        label.position[1] - mid[1],
        label.position[2] - mid[2],
      ];
      const offsetLen = Math.hypot(offset[0], offset[1], offset[2]);
      expect(offsetLen).toBeCloseTo(LABEL_OFFSET_MM, 5);
      const dot = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
      expect(dot).toBeCloseTo(0, 5);
      for (const v of offset) expect(Number.isFinite(v)).toBe(true);
    }

    // Both labels' offsets point the same direction (same side of the shaft).
    const [l0, l1] = guide?.labels ?? [];
    const o0: vec3 = [l0!.position[0] - 5, l0!.position[1], l0!.position[2]];
    const o1: vec3 = [l1!.position[0] - 15, l1!.position[1], l1!.position[2]];
    expect(o0[1] / LABEL_OFFSET_MM).toBeCloseTo(o1[1] / LABEL_OFFSET_MM, 5);
    expect(o0[2] / LABEL_OFFSET_MM).toBeCloseTo(o1[2] / LABEL_OFFSET_MM, 5);
  });

  it("a purely vertical shaft still gets a finite, unit-scaled perpendicular offset", () => {
    // A naive cross(axis, worldUp) degenerates to zero here — the axis IS world-up.
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [0, 5, 0]),
      contact("c", "A", 3, [0, 10, 0]),
    );
    const guide = dragGuide(set, "b");
    expect(guide).not.toBeNull();
    expect(guide?.labels).toHaveLength(2);

    const axis: vec3 = [0, 1, 0];
    for (const label of guide?.labels ?? []) {
      for (const v of label.position) expect(Number.isFinite(v)).toBe(true);
    }
    const mids: vec3[] = [
      [0, 2.5, 0],
      [0, 7.5, 0],
    ];
    (guide?.labels ?? []).forEach((label, i) => {
      const mid = mids[i]!;
      const offset: vec3 = [
        label.position[0] - mid[0],
        label.position[1] - mid[1],
        label.position[2] - mid[2],
      ];
      const offsetLen = Math.hypot(offset[0], offset[1], offset[2]);
      expect(offsetLen).toBeCloseTo(LABEL_OFFSET_MM, 5);
      const dot = offset[0] * axis[0] + offset[1] * axis[1] + offset[2] * axis[2];
      expect(dot).toBeCloseTo(0, 5);
    });
  });

  it("finds neighbours by ordinal, not by array index", () => {
    // Array order is deliberately scrambled relative to ordinal order.
    const set = setOf(
      contact("mid", "A", 2, [10, 0, 0]),
      contact("tip", "A", 1, [0, 0, 0]),
      contact("far", "A", 3, [30, 0, 0]),
    );
    const guide = dragGuide(set, "mid");
    expect(guide).not.toBeNull();
    expect(guide?.labels).toHaveLength(2);
    const texts = (guide?.labels ?? []).map((l) => l.text).sort();
    // mid(10) to tip(0): 10 mm; mid(10) to far(30): 20 mm.
    expect(texts).toEqual(["10.0 mm", "20.0 mm"]);
  });

  it("the tip contact has exactly one neighbour; a mid-shaft contact has two", () => {
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [10, 0, 0]),
      contact("c", "A", 3, [20, 0, 0]),
    );
    expect(dragGuide(set, "a")?.labels).toHaveLength(1);
    expect(dragGuide(set, "b")?.labels).toHaveLength(2);
    expect(dragGuide(set, "c")?.labels).toHaveLength(1);
  });

  it("a group of one contact: empty axis, empty labels, not null", () => {
    const set = setOf(contact("a", "A", 1, [5, 5, 5]));
    const guide = dragGuide(set, "a");
    expect(guide).not.toBeNull();
    expect(guide?.axis).toEqual(new Float32Array(0));
    expect(guide?.labels).toEqual([]);
  });

  it("dragging a contact off the line does not move the axis, apart from the extent rule", () => {
    const clean = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [10, 0, 0]),
      contact("c", "A", 3, [20, 0, 0]),
      contact("d", "A", 4, [30, 0, 0]),
      contact("e", "A", 5, [40, 0, 0]),
    );
    const before = dragGuide(clean, "c");
    expect(before).not.toBeNull();

    // Move the dragged contact ('c') 10 mm sideways; the other four contacts are untouched.
    const dragged = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [10, 0, 0]),
      contact("c", "A", 3, [20, 10, 0]),
      contact("d", "A", 4, [30, 0, 0]),
      contact("e", "A", 5, [40, 0, 0]),
    );
    const after = dragGuide(dragged, "c");
    expect(after).not.toBeNull();

    // The axis is fitted from a,b,d,e in both cases (c is excluded), so it is identical. Only the
    // extent (which must still reach the moved contact's projection) is allowed to differ, and here
    // the moved contact projects onto the same x it always did, so even the extent is unchanged.
    expect(Array.from(after?.axis ?? [])).toEqual(Array.from(before?.axis ?? []));
  });

  it("every axis and label coordinate is finite when all contacts share one position", () => {
    const set = setOf(
      contact("a", "A", 1, [7, 7, 7]),
      contact("b", "A", 2, [7, 7, 7]),
      contact("c", "A", 3, [7, 7, 7]),
    );
    const guide = dragGuide(set, "b");
    expect(guide).not.toBeNull();
    expect(Array.from(guide?.axis ?? []).every((v) => Number.isFinite(v))).toBe(
      true,
    );
    for (const label of guide?.labels ?? []) {
      expect(label.position.every((v) => Number.isFinite(v))).toBe(true);
    }
  });
});

/**
 * The model column of the guide's distance readouts.
 *
 * A drag is aimed: the user is putting a contact back on the rod, and the number that says where
 * "back" is is the manufacturer's spacing for *that* gap. It is stated beside the measured one and
 * never instead of it — the measurement is the thing that moves while the contact is held.
 */
describe.skipIf(!HAS_CONTACTS)("dragGuide's model distances", () => {
  // A Behnke-Fried lead's first two gaps: 3.0 then 5.5. The pair matters because a shaft whose
  // gaps are all equal cannot tell an off-by-one indexing bug from a correct one.
  const BF_GAPS = [3, 5.5, 5.5];

  it("states the model gap beside the measured one, indexed by ordinal", () => {
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [3.2, 0, 0]),
      contact("c", "A", 3, [8.9, 0, 0]),
    );
    const guide = dragGuide(set, "b", BF_GAPS);
    expect(guide).not.toBeNull();
    // Below is the 1–2 gap (model 3.0); above is the 2–3 gap (model 5.5).
    expect(guide?.labels[0]?.text).toBe("3.2 / 3.0 mm");
    expect(guide?.labels[1]?.text).toBe("5.7 / 5.5 mm");
  });

  it("is the bare measurement it always was for an electrode with no model", () => {
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [3.2, 0, 0]),
      contact("c", "A", 3, [8.9, 0, 0]),
    );
    expect(dragGuide(set, "b")?.labels[0]?.text).toBe("3.2 mm");
    expect(dragGuide(set, "b", null)?.labels[0]?.text).toBe("3.2 mm");
  });

  it("says nothing rather than repeating the last gap past the model's end", () => {
    const set = setOf(
      contact("a", "A", 1, [0, 0, 0]),
      contact("b", "A", 2, [3, 0, 0]),
      contact("c", "A", 3, [8.5, 0, 0]),
    );
    // A one-gap model on a three-contact electrode: the 2–3 label has no model number to state.
    const guide = dragGuide(set, "b", [3]);
    expect(guide?.labels[0]?.text).toBe("3.0 / 3.0 mm");
    expect(guide?.labels[1]?.text).toBe("5.5 mm");
  });
});
