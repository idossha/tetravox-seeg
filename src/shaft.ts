/**
 * The geometry of a **depth electrode**, as opposed to the geometry of any contact set.
 *
 * The SDK's contacts kit (`contacts.fitLine`) fits the line; this file knows what an sEEG shaft
 * *is*: a rigid rod pushed through the skull, contacts evenly spaced along it, numbered **1 at the
 * deepest end**. Every rule below is a fact about that hardware and about a head, which is exactly
 * why none of it belongs in the shared kit — that kit stays in the app and serves every contact
 * module, and a second contact module is a library's user, not a fork.
 *
 * ## The tip rule, stated
 *
 * Slicer's `_tipSign` is a **stub**: its docstring describes a heuristic and its body is
 * `return 1.0  # neutral default`, so "Renumber tip-first" there numbers from whichever end the line
 * fit happened to point at, and the module's own README lists "verify contact 1 = deepest" as a known
 * limitation. This build implements the heuristic the docstring describes, and states it:
 *
 * > **Contact 1 is the end of the shaft nearer the reference centre; the entry is the end farther
 * > from it.** The reference is the centre of the bound volume's bounding box — the head, near
 * > enough — falling back to the centroid of every contact in the set when there is no volume.
 *
 * Why that reference and not the electrode's own centroid: a shaft's own centroid lies *between* its
 * ends, so both ends are about equidistant from it and the rule would be a coin toss. The head's
 * centre is the thing "deep" is measured against, and every shaft is inserted from the outside
 * inward. It is a **heuristic**, not a brain mask: an occipital shaft entering close to the midline
 * can defeat it, which is why the tip is shown in the panel, `t` flips it, and **nothing renumbers
 * implicitly** — see below.
 *
 * ## What renumbers, and what does not
 *
 * Only **Renumber tip-first** ever changes a contact's number or name. Loading a table, placing a
 * contact, dragging one, snapping and deleting all leave the numbering exactly as it was. So a
 * clinical table's numbering — which is wired to the recording system through `csc` — can only be
 * changed by a button that says it changes it.
 *
 * Slicer's **Re-fit** was the second such button and is gone as of 0.2.1: it re-spaced a shaft at
 * its own median gap, which is a worse answer than the electrode model's own gaps `snap` now uses,
 * and it relabelled while doing so — two effects behind one button.
 */

import { contacts } from "@tetravox/module-sdk";
import type {
  Contact,
  ContactSet,
  Group,
  TipEnd,
  vec3,
} from "@tetravox/module-sdk";

const {
  centroidOf,
  contactName,
  contactsOf,
  distanceMm,
  fitLine,
  lineMetrics,
  orderAlong,
} = contacts;
/** Two ends that are this close to equidistant from the reference are a tie, in millimetres. */
const TIP_TIE_MM = 1e-6;

/** Which end of the fitted line is the tip, by the heuristic above. `'low'` on a tie or no fit. */
export function tipEnd(
  positions: readonly vec3[],
  reference: vec3,
): "low" | "high" {
  const fit = fitLine(positions);
  if (fit === null) return "low";
  const order = orderAlong(positions);
  const low = positions[order[0] as number] as vec3;
  const high = positions[order[order.length - 1] as number] as vec3;
  const dLow = distanceMm(low, reference);
  const dHigh = distanceMm(high, reference);
  // Nearer the head's centre is deeper. A tie keeps the low end, so the rule is total.
  return dHigh < dLow - TIP_TIE_MM ? "high" : "low";
}

/** The end this electrode is numbered from: what the user pinned, or the heuristic. */
export function resolveTip(
  group: Group,
  positions: readonly vec3[],
  reference: vec3,
): "low" | "high" {
  return group.tip === "auto" ? tipEnd(positions, reference) : group.tip;
}

/** `t` — pin the other end, whichever one is currently in force. Never `'auto'` again. */
export function flippedTip(
  group: Group,
  positions: readonly vec3[],
  reference: vec3,
): TipEnd {
  return resolveTip(group, positions, reference) === "low" ? "high" : "low";
}

/**
 * The reference the tip rule measures "deep" against.
 *
 * The centre of the bound volume's bounds when there is one, and otherwise the centroid of every
 * contact in the set — which is a poor proxy for one electrode and a decent one for a whole implant.
 */
export function tipReference(
  bounds: { min: vec3; max: vec3 } | null,
  set: ContactSet,
): vec3 {
  if (bounds !== null) {
    return [
      (bounds.min[0] + bounds.max[0]) / 2,
      (bounds.min[1] + bounds.max[1]) / 2,
      (bounds.min[2] + bounds.max[2]) / 2,
    ];
  }
  return centroidOf(set.contacts.map((c) => c.position)) ?? [0, 0, 0];
}

/** The contacts of `group`, ordered from the tip outward. */
export function tipFirstOrder(
  contacts: readonly Contact[],
  tip: "low" | "high",
): Contact[] {
  const order = orderAlong(contacts.map((c) => c.position));
  const along = order.map((index) => contacts[index] as Contact);
  return tip === "low" ? along : along.reverse();
}

/** One electrode's three numbers, for the panel and for the `stats` operation. */
export interface ShaftStats {
  electrode: string;
  n: number;
  rmsMm: number | null;
  spacingCv: number | null;
  pitchMm: number | null;
}

export function shaftStats(set: ContactSet, group: string): ShaftStats {
  const contacts = contactsOf(set, group);
  const metrics = lineMetrics(contacts.map((c) => c.position));
  return {
    electrode: group,
    n: contacts.length,
    rmsMm: metrics?.rmsMm ?? null,
    spacingCv: metrics?.spacingCv ?? null,
    pitchMm: metrics?.pitchMm ?? null,
  };
}

/** Every electrode's stats, in the set's group order — the `stats` operation's result. */
export function allShaftStats(set: ContactSet): ShaftStats[] {
  return set.groups.map((group) => shaftStats(set, group.name));
}

/** The panel's small shaft sketch: a baseline with one dot per contact, in draw order. */
export interface ShaftDiagram {
  width: number;
  height: number;
  /** The shaft baseline, from the first dot to the last. */
  line: { x1: number; y1: number; x2: number; y2: number };
  /** One dot per contact, in the set's order; `tip` marks contact 1, `selected` the current one. */
  dots: { cx: number; cy: number; tip: boolean; selected: boolean }[];
}

/** The viewBox the panel draws the sketch in. Pure numbers, so the helper stays testable. */
export interface ShaftDiagramLayout {
  width: number;
  height: number;
  /** Horizontal padding, so the two end dots are not clipped by the box. */
  padX: number;
}

const DIAGRAM_LAYOUT: ShaftDiagramLayout = { width: 200, height: 24, padX: 10 };

/** A projected span narrower than this is no span at all, in the fit's units (millimetres). */
const DIAGRAM_SPAN_EPS = 1e-9;

/**
 * Lay one electrode's contacts out along a horizontal baseline for the panel's sketch.
 *
 * Each dot sits at its own fraction along the shaft — its projection onto the fitted line,
 * normalised across the shaft's span. **The span is the trap.** A one-contact electrode, or one
 * whose contacts all project to a single point (every position identical, which real exports — the
 * owner's P077 among them — do contain), has a span of zero, and the natural `(t − min) / span` is
 * then `0 / 0 = NaN`, or `k / 0 = ±Infinity` for any contact off the minimum. Fed to an SVG `x1` /
 * `x2` / `cx` that logs `<line> attribute x1: Expected length, "Infinity"` on every render —
 * cosmetic, but it spams the console. So when there is no span to normalise against, the dots fall
 * back to an even spread by index, which is always finite and reads correctly for the one-contact
 * case: a single dot at the midpoint.
 *
 * `null` only for an electrode with no contacts — there is nothing to draw.
 *
 * `selectedIndex` is the row the panel has selected, so the sketch can say *which* dot the list and
 * the panes are talking about; `null`, or an index outside the electrode, marks nothing.
 */
export function shaftDiagram(
  positions: readonly vec3[],
  tipIndex: number | null = null,
  selectedIndex: number | null = null,
  layout: ShaftDiagramLayout = DIAGRAM_LAYOUT,
): ShaftDiagram | null {
  const n = positions.length;
  if (n === 0) return null;

  const { width, height, padX } = layout;
  const y = height / 2;
  const drawWidth = width - 2 * padX;

  // The along-shaft fraction of each contact, guaranteed finite. `fitLine` is `null` for a single
  // contact (nothing to project onto); an identical-position set fits but spans nothing.
  const fit = fitLine(positions);
  let fracs: number[];
  if (fit === null) {
    fracs = positions.map(() => 0.5);
  } else {
    const t = fit.t;
    const min = Math.min(...t);
    const max = Math.max(...t);
    const span = max - min;
    fracs =
      span > DIAGRAM_SPAN_EPS
        ? t.map((value) => (value - min) / span)
        : positions.map((_position, index) =>
            n === 1 ? 0.5 : index / (n - 1),
          );
  }

  const dots = fracs.map((frac, index) => ({
    cx: padX + frac * drawWidth,
    cy: y,
    tip: index === tipIndex,
    selected: index === selectedIndex,
  }));
  const xs = dots.map((dot) => dot.cx);
  return {
    width,
    height,
    line: { x1: Math.min(...xs), y1: y, x2: Math.max(...xs), y2: y },
    dots,
  };
}

/** Replace the named contacts inside a set, keeping the array's (drawing) order. */
function withContacts(
  set: ContactSet,
  replaced: readonly Contact[],
): ContactSet {
  const byId = new Map(replaced.map((c) => [c.id, c]));
  return {
    groups: set.groups,
    contacts: set.contacts.map((c) => byId.get(c.id) ?? c),
  };
}

export interface RenumberResult {
  set: ContactSet;
  /** The names that changed, `old → new`, for a toast and for the editlog. */
  renamed: { from: string; to: string }[];
}

/**
 * Number one electrode 1…n from the tip, **without moving anything**.
 *
 * The contact nearest the tip becomes 1, and every name becomes `<ELEC><n>` zero-padded to `pad` —
 * the width the file's own names use, which is the half Slicer got wrong (`LINS01` relabelled to
 * `LINS1`, so the next load read every contact as `added`).
 */
export function renumberTipFirst(
  set: ContactSet,
  group: string,
  reference: vec3,
  pad: number,
): RenumberResult {
  const contacts = contactsOf(set, group);
  if (contacts.length === 0) return { set, renamed: [] };
  const spec = set.groups.find((g) => g.name === group);
  const tip =
    spec === undefined
      ? "low"
      : resolveTip(
          spec,
          contacts.map((c) => c.position),
          reference,
        );
  const ordered = tipFirstOrder(contacts, tip);
  const renamed: { from: string; to: string }[] = [];
  const next = ordered.map((contact, index) => {
    const name = contactName(group, index + 1, pad);
    if (name !== contact.name) renamed.push({ from: contact.name, to: name });
    return { ...contact, name, ordinal: index + 1 };
  });
  return { set: withContacts(set, next), renamed };
}
