/**
 * The depth-electrode geometry (§13.4).
 *
 * The tip rule is the interesting one, because Slicer's is a stub that always answers `+1` and this
 * one is a stated heuristic: **contact 1 is the end nearer the reference centre**. It is tested from
 * both ends — a shaft entering from the left and one entering from the right must number in opposite
 * directions in world coordinates and in the same direction anatomically.
 */

import { describe, expect, it } from "vitest";
import { HAS_CONTACTS } from "./setup";
import { contacts } from "@tetravox/module-sdk";
import type { Contact, ContactSet, vec3 } from "@tetravox/module-sdk";
import {
  allShaftStats,
  flippedTip,
  refitShaft,
  renumberTipFirst,
  resolveTip,
  shaftDiagram,
  shaftStats,
  tipEnd,
  tipFirstOrder,
  tipReference,
} from "../src/shaft";
import type { ShaftDiagram } from "../src/shaft";

const { contactsOf, paletteColor } = contacts;

/** `n` contacts of one electrode, `pitch` apart from `start` along `dir`, numbered in array order. */
function shaft(
  group: string,
  start: vec3,
  dir: vec3,
  pitch: number,
  n: number,
  jitter: (i: number) => vec3 = () => [0, 0, 0],
): Contact[] {
  const len = Math.hypot(dir[0], dir[1], dir[2]);
  const u: vec3 = [dir[0] / len, dir[1] / len, dir[2] / len];
  return Array.from({ length: n }, (_v, i) => {
    const wobble = jitter(i);
    return {
      id: `${group}-${i + 1}`,
      name: `${group}${String(i + 1).padStart(2, "0")}`,
      group,
      ordinal: i + 1,
      position: [
        start[0] + u[0] * pitch * i + wobble[0],
        start[1] + u[1] * pitch * i + wobble[1],
        start[2] + u[2] * pitch * i + wobble[2],
      ] as vec3,
      original: [
        start[0] + u[0] * pitch * i + wobble[0],
        start[1] + u[1] * pitch * i + wobble[1],
        start[2] + u[2] * pitch * i + wobble[2],
      ] as vec3,
      originalName: `${group}${String(i + 1).padStart(2, "0")}`,
      loadedStatus: null,
      extra: {},
    };
  });
}

function setOf(...contacts: Contact[]): ContactSet {
  const names = [...new Set(contacts.map((c) => c.group))];
  return {
    contacts,
    groups: names.map((name, i) => ({
      name,
      color: paletteColor(i),
      tip: "auto" as const,
    })),
  };
}

const HEAD_CENTRE: vec3 = [0, 0, 0];

describe.skipIf(!HAS_CONTACTS)("tipEnd — the stated heuristic", () => {
  it("numbers from the end nearer the reference centre", () => {
    // A left-hemisphere shaft entering at x = -60 and running inward to x = -20: the deep end is the
    // HIGH end of the fitted line (whose canonical axis points along +x), so the tip is 'high'.
    const inward = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 8).map(
      (c) => c.position,
    );
    expect(tipEnd(inward, HEAD_CENTRE)).toBe("high");

    // The mirror image on the right: entering at x = +60 and running inward to +20. The canonical
    // axis still points along +x, so now the deep end is the LOW one.
    const mirrored = shaft("R", [60, 0, 0], [-1, 0, 0], 3.5, 8).map(
      (c) => c.position,
    );
    expect(tipEnd(mirrored, HEAD_CENTRE)).toBe("low");
  });

  it("keeps the low end on a tie, so the rule is total", () => {
    // Symmetric about the reference: both ends are exactly equidistant.
    const symmetric: vec3[] = [
      [-10, 0, 0],
      [0, 0, 0],
      [10, 0, 0],
    ];
    expect(tipEnd(symmetric, HEAD_CENTRE)).toBe("low");
    expect(tipEnd([[1, 1, 1]], HEAD_CENTRE)).toBe("low");
  });

  it("is overridden by a pinned tip, and `t` pins the other end", () => {
    const positions = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 8).map(
      (c) => c.position,
    );
    const auto = { name: "L", color: paletteColor(0), tip: "auto" as const };
    expect(resolveTip(auto, positions, HEAD_CENTRE)).toBe("high");
    expect(flippedTip(auto, positions, HEAD_CENTRE)).toBe("low");
    const pinned = { ...auto, tip: "low" as const };
    expect(resolveTip(pinned, positions, HEAD_CENTRE)).toBe("low");
    expect(flippedTip(pinned, positions, HEAD_CENTRE)).toBe("high");
  });
});

describe.skipIf(!HAS_CONTACTS)("tipReference", () => {
  it("is the centre of the bound volume’s bounds when there is one", () => {
    const set = setOf(...shaft("A", [10, 10, 10], [1, 0, 0], 3.5, 4));
    expect(
      tipReference({ min: [-10, -20, -30], max: [10, 20, 30] }, set),
    ).toEqual([0, 0, 0]);
  });

  it("falls back to the centroid of every contact in the set", () => {
    const set = setOf(...shaft("A", [0, 0, 0], [1, 0, 0], 2, 3));
    expect(tipReference(null, set)).toEqual([2, 0, 0]);
    expect(tipReference(null, setOf())).toEqual([0, 0, 0]);
  });
});

describe.skipIf(!HAS_CONTACTS)("renumberTipFirst", () => {
  it("numbers 1…n from the tip without moving anything", () => {
    // Entering at x = -60, running inward: the deepest contact is the last of the array.
    const contacts = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 5);
    const before = contacts.map((c) => [...c.position]);
    const { set, renamed } = renumberTipFirst(
      setOf(...contacts),
      "L",
      HEAD_CENTRE,
      2,
    );

    const ordered = contactsOf(set, "L");
    expect(ordered.map((c) => c.name)).toEqual([
      "L01",
      "L02",
      "L03",
      "L04",
      "L05",
    ]);
    // Contact 1 is now the one that was deepest, i.e. the last of the original array.
    expect((ordered[0] as Contact).position[0]).toBeCloseTo(-46, 9);
    expect((ordered[4] as Contact).position[0]).toBeCloseTo(-60, 9);
    // Nothing moved.
    expect(set.contacts.map((c) => [...c.position])).toEqual(before);
    expect(renamed).toHaveLength(4);
  });

  it("pads to the width the file used, which is the LINS01 → LINS1 defect", () => {
    const contacts = shaft("LINS", [-60, 0, 0], [1, 0, 0], 3.5, 3);
    expect(
      renumberTipFirst(setOf(...contacts), "LINS", HEAD_CENTRE, 2).set
        .contacts[0]?.name,
    ).toMatch(/^LINS0\d$/);
    expect(
      renumberTipFirst(setOf(...contacts), "LINS", HEAD_CENTRE, 1).set
        .contacts[0]?.name,
    ).toMatch(/^LINS\d$/);
  });

  it("is a no-op for an electrode with no contacts", () => {
    const set = setOf(...shaft("A", [0, 0, 0], [1, 0, 0], 2, 2));
    expect(renumberTipFirst(set, "Z", HEAD_CENTRE, 2)).toEqual({
      set,
      renamed: [],
    });
  });
});

describe.skipIf(!HAS_CONTACTS)("refitShaft", () => {
  /**
   * Perpendicular noise whose covariance with position along the shaft is exactly zero — the ends
   * out one way, the middle out the other — so the fitted axis is the authored one and the pitch
   * after a re-fit is exactly the authored 3.5 mm. Noise that leaned one way would tilt the fit and
   * make the expectation a tolerance rather than a number.
   */
  const wobbleOf =
    (n: number) =>
    (i: number): vec3 => [0, 0, i === 0 || i === n - 1 ? 0.3 : -0.3];

  it("puts the contacts on the fitted line and re-spaces them evenly", () => {
    const contacts = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 6, wobbleOf(6));
    const result = refitShaft(setOf(...contacts), "L", HEAD_CENTRE, 2);
    expect(result).not.toBeNull();
    const after = (result as { set: ContactSet }).set;
    const stats = shaftStats(after, "L");
    // The residual collapses and the spacing becomes exact.
    expect(stats.rmsMm).toBeCloseTo(0, 9);
    expect(stats.spacingCv).toBeCloseTo(0, 9);
    expect(stats.pitchMm).toBeCloseTo(3.5, 9);
  });

  it("relabels tip-first, and Re-fit is the only thing besides Renumber that relabels", () => {
    const contacts = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 4, wobbleOf(4));
    const after = (
      refitShaft(setOf(...contacts), "L", HEAD_CENTRE, 2) as { set: ContactSet }
    ).set;
    const ordered = contactsOf(after, "L");
    expect(ordered.map((c) => c.name)).toEqual(["L01", "L02", "L03", "L04"]);
    // Contact 1 is the deep end (largest x for a shaft entering from the left).
    expect((ordered[0] as Contact).position[0]).toBeGreaterThan(
      (ordered[3] as Contact).position[0],
    );
  });

  it("respects a pinned tip rather than re-deriving it", () => {
    const contacts = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 4, wobbleOf(4));
    const set = setOf(...contacts);
    const pinned: ContactSet = {
      ...set,
      groups: [{ name: "L", color: paletteColor(0), tip: "low" }],
    };
    const after = (
      refitShaft(pinned, "L", HEAD_CENTRE, 2) as { set: ContactSet }
    ).set;
    const ordered = contactsOf(after, "L");
    // Pinned the other way: contact 1 is now the shallow end.
    expect((ordered[0] as Contact).position[0]).toBeLessThan(
      (ordered[3] as Contact).position[0],
    );
  });

  it("leaves `original` alone, so `status` still says the file was wrong", () => {
    const contacts = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 4, wobbleOf(4));
    const after = (
      refitShaft(setOf(...contacts), "L", HEAD_CENTRE, 2) as { set: ContactSet }
    ).set;
    for (const contact of after.contacts)
      expect(contact.original).not.toBeNull();
  });

  it("refuses a shaft with fewer than two contacts", () => {
    expect(
      refitShaft(
        setOf(...shaft("A", [0, 0, 0], [1, 0, 0], 2, 1)),
        "A",
        HEAD_CENTRE,
        2,
      ),
    ).toBeNull();
  });
});

describe.skipIf(!HAS_CONTACTS)("stats", () => {
  it("reports one row per electrode, in the set’s group order", () => {
    const set = setOf(
      ...shaft("A", [-60, 0, 0], [1, 0, 0], 3.5, 5),
      ...shaft("B", [60, 0, 0], [-1, 0, 0], 4, 3),
    );
    const stats = allShaftStats(set);
    expect(stats.map((s) => s.electrode)).toEqual(["A", "B"]);
    expect(stats[0]?.n).toBe(5);
    expect(stats[0]?.pitchMm).toBeCloseTo(3.5, 9);
    expect(stats[1]?.pitchMm).toBeCloseTo(4, 9);
  });

  it("answers nulls rather than numbers for an electrode with one contact", () => {
    const set = setOf(...shaft("A", [0, 0, 0], [1, 0, 0], 2, 1));
    expect(shaftStats(set, "A")).toEqual({
      electrode: "A",
      n: 1,
      rmsMm: null,
      spacingCv: null,
      pitchMm: null,
    });
  });
});

describe.skipIf(!HAS_CONTACTS)("tipFirstOrder", () => {
  it("walks the shaft from whichever end the tip is", () => {
    const contacts = shaft("A", [0, 0, 0], [1, 0, 0], 2, 3);
    expect(tipFirstOrder(contacts, "low").map((c) => c.name)).toEqual([
      "A01",
      "A02",
      "A03",
    ]);
    expect(tipFirstOrder(contacts, "high").map((c) => c.name)).toEqual([
      "A03",
      "A02",
      "A01",
    ]);
  });
});

describe.skipIf(!HAS_CONTACTS)(
  "shaftDiagram — never a non-finite SVG coordinate",
  () => {
    /** Every number the panel writes into an `<svg>`: the baseline's ends and every dot's centre. */
    const coordinates = (diagram: ShaftDiagram): number[] => [
      diagram.line.x1,
      diagram.line.y1,
      diagram.line.x2,
      diagram.line.y2,
      ...diagram.dots.flatMap((dot) => [dot.cx, dot.cy]),
    ];

    it("spreads a normal multi-contact shaft along the baseline, in order", () => {
      const positions = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 8).map(
        (c) => c.position,
      );
      const diagram = shaftDiagram(positions);
      expect(diagram).not.toBeNull();
      const drawn = diagram as ShaftDiagram;

      expect(coordinates(drawn).every((v) => Number.isFinite(v))).toBe(true);
      expect(drawn.dots).toHaveLength(8);
      // The dots march monotonically to the right, and the baseline runs from the first to the last.
      const xs = drawn.dots.map((dot) => dot.cx);
      for (let i = 1; i < xs.length; i += 1) {
        expect(xs[i] as number).toBeGreaterThan(xs[i - 1] as number);
      }
      expect(drawn.line.x1).toBeCloseTo(xs[0] as number, 9);
      expect(drawn.line.x2).toBeCloseTo(xs[xs.length - 1] as number, 9);
    });

    it("keeps every coordinate finite for a one-contact electrode (P077 had these)", () => {
      // A single contact: `fitLine` returns null, so there is no line to project onto. The span-based
      // normalisation would divide by a zero range; the guard puts the one dot at the midpoint.
      const one = shaft("S", [12, -4, 30], [1, 0, 0], 3.5, 1).map(
        (c) => c.position,
      );
      const diagram = shaftDiagram(one);
      expect(diagram).not.toBeNull();
      const drawn = diagram as ShaftDiagram;
      expect(coordinates(drawn).every((v) => Number.isFinite(v))).toBe(true);
      expect(drawn.dots).toHaveLength(1);
    });

    it("keeps every coordinate finite when every contact projects to one point", () => {
      // A degenerate export: several rows carrying the identical coordinate. The fit spans nothing, so
      // the natural `(t - min) / (max - min)` is `0 / 0`. This is the case that logged `Infinity` on
      // `<line>` x1/x2 for P077's fifteen shafts.
      const stacked: vec3[] = Array.from({ length: 5 }, () => [7, 7, 7]);
      const diagram = shaftDiagram(stacked);
      expect(diagram).not.toBeNull();
      const drawn = diagram as ShaftDiagram;
      expect(coordinates(drawn).every((v) => Number.isFinite(v))).toBe(true);
      expect(drawn.dots).toHaveLength(5);
    });

    it("marks the tip dot and no other, and draws nothing for an empty electrode", () => {
      const positions = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 6).map(
        (c) => c.position,
      );
      const drawn = shaftDiagram(positions, 0) as ShaftDiagram;
      expect(drawn.dots.filter((dot) => dot.tip)).toHaveLength(1);
      expect(drawn.dots[0]?.tip).toBe(true);
      expect(shaftDiagram([])).toBeNull();
    });

    it("marks the selected dot, independently of the tip, and nothing when there is no selection", () => {
      const positions = shaft("L", [-60, 0, 0], [1, 0, 0], 3.5, 6).map(
        (c) => c.position,
      );
      const drawn = shaftDiagram(positions, 0, 3) as ShaftDiagram;
      expect(drawn.dots.filter((dot) => dot.selected)).toHaveLength(1);
      expect(drawn.dots[3]?.selected).toBe(true);
      expect(drawn.dots[3]?.tip).toBe(false);
      // `-1` is what `findIndex` answers with nothing selected, and it must mark no dot.
      const none = shaftDiagram(positions, 0, -1) as ShaftDiagram;
      expect(none.dots.some((dot) => dot.selected)).toBe(false);
    });
  },
);
