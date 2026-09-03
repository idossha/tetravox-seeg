/**
 * The reference geometry drawn while one contact is being dragged.
 *
 * The whole point of this overlay is that the rod does not follow the contact you are moving: fit
 * the axis from the electrode's *other* contacts, so the dragged one is seen to leave the line
 * rather than dragging it along. `shaftDiagram` (`src/shaft.ts`) already lives with this rule for
 * degenerate input — a real export can hold contacts that share one position — and the same guard
 * applies here: a non-finite endpoint reaching a `Float32Array` bound for the renderer is a visible
 * defect, not a crash, so it is caught and turned into "no axis" rather than propagated.
 *
 * Neighbours are found by `ordinal`, not by array position, for the same reason `shaftGeometry`
 * draws its segments that way: the array is drawing order, and a contact inserted between 4 and 5
 * still belongs between them regardless of where the editor happened to put it in the list.
 */

import { contacts } from "@tetravox/module-sdk";
import type { Contact, ContactSet, vec3 } from "@tetravox/module-sdk";
import { perpendicularTo } from "./modelsnap";

const { contactsOf, distanceMm, fitLine, projectOntoLine } = contacts;

/** What is drawn over the contacts layer while one contact is being dragged. */
export interface DragGuide {
  /** The fitted shaft axis as ONE unbroken segment: 6 floats, two world-mm endpoints. Empty when there is no line to fit. */
  axis: Float32Array;
  /**
   * Distance readouts, one per immediate neighbour, at the midpoint of the pair offset sideways by
   * `LABEL_OFFSET_MM` so the text clears the shaft line and the contact-name labels.
   */
  labels: { position: vec3; text: string }[];
}

const EMPTY_AXIS = new Float32Array(0);

/**
 * How far a distance label is pushed off the shaft, in world millimetres.
 *
 * At the midpoint exactly, the text sits on top of both the shaft line and the nearby contact-name
 * labels. A module has no camera, so there is no way to push "toward the viewer" the way a
 * screen-space UI would; the offset instead has to be a stable world-space direction, which is why
 * it is perpendicular to the fitted axis rather than to anything screen-relative.
 */
export const LABEL_OFFSET_MM = 2.5;

/** The componentwise midpoint of two world positions. */
function midpoint(a: vec3, b: vec3): vec3 {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

/*
 * The perpendicular the labels are offset along comes from `modelsnap.ts`, which needs the same
 * construction to build its sampling tube: whichever world basis vector is *least* aligned with the
 * axis, crossed into it. Crossing with world-up — the obvious version — degenerates to zero for a
 * vertical shaft, which is exactly the case a depth-electrode guide most has to handle. It is
 * derived from the fitted axis alone, so the same shaft always picks the same side and the labels
 * never flip mid-drag.
 */

/**
 * A distance readout for one neighbour pair, always a true 3D distance, offset beside the shaft.
 *
 * With a model resolved for the electrode the label reads `4.9 / 5.0 mm` — measured first, then
 * what the manufacturer says that gap is. Measured first because it is the number that changes
 * while the contact is held, and the model's is the constant it is being aimed at. `modelMm` is
 * `null` for an electrode with no model, and the label is then the bare measurement it always was.
 */
function labelFor(
  a: vec3,
  b: vec3,
  offset: vec3,
  modelMm: number | null,
): { position: vec3; text: string } {
  const mid = midpoint(a, b);
  const position: vec3 = [
    mid[0] + offset[0] * LABEL_OFFSET_MM,
    mid[1] + offset[1] * LABEL_OFFSET_MM,
    mid[2] + offset[2] * LABEL_OFFSET_MM,
  ];
  return {
    position: position.every((v) => Number.isFinite(v)) ? position : mid,
    text:
      modelMm === null
        ? `${distanceMm(a, b).toFixed(1)} mm`
        : `${distanceMm(a, b).toFixed(1)} / ${modelMm.toFixed(1)} mm`,
  };
}

/**
 * The fitted axis, extended to span every position in `extent`, as 6 finite floats — or empty.
 *
 * `fit` is over the electrode's other contacts (or all of them on the fallback) but `extent` is
 * every contact of the group, dragged one included, so the drawn rod always reaches the contact
 * being dragged rather than stopping short of it.
 */
function fittedAxis(
  fit: ReturnType<typeof fitLine>,
  extent: readonly vec3[],
): Float32Array {
  if (fit === null) return EMPTY_AXIS;

  const ts = extent.map((p) => {
    const projected = projectOntoLine(p, fit.centroid, fit.axis);
    // Signed position along the axis, via its projection's offset from the centroid.
    return (
      (projected[0] - fit.centroid[0]) * fit.axis[0] +
      (projected[1] - fit.centroid[1]) * fit.axis[1] +
      (projected[2] - fit.centroid[2]) * fit.axis[2]
    );
  });
  const tMin = Math.min(...ts);
  const tMax = Math.max(...ts);

  // A point built as `centroid + t · axis` already lies on the line, so there is nothing left to
  // project: the two endpoints are that arithmetic and no more.
  const at = (t: number): vec3 => [
    fit.centroid[0] + fit.axis[0] * t,
    fit.centroid[1] + fit.axis[1] * t,
    fit.centroid[2] + fit.axis[2] * t,
  ];
  const low = at(tMin);
  const high = at(tMax);

  const endpoints = [low[0], low[1], low[2], high[0], high[1], high[2]];
  return endpoints.every((v) => Number.isFinite(v))
    ? Float32Array.from(endpoints)
    : EMPTY_AXIS;
}

/**
 * The overlay for a drag in flight.
 *
 * `modelGapsMm` is the electrode's model spacing, tip-first, or `null` — `modelGapsMm[k − 1]` is the
 * gap between contacts `k` and `k + 1`, which is the shape `ElectrodeModel.gapsMm` already has. The
 * pair is indexed by **ordinal**, like the neighbour search itself, so a table numbered from the
 * other end (a flipped tip) reads the same gap the panel's table does.
 */
export function dragGuide(
  set: ContactSet,
  draggedId: string,
  modelGapsMm: readonly number[] | null = null,
): DragGuide | null {
  const dragged = set.contacts.find((c) => c.id === draggedId);
  if (dragged === undefined) return null;

  const group = contactsOf(set, dragged.group);
  const others = group.filter((c) => c.id !== draggedId);

  // Neighbours by ordinal: the greatest ordinal strictly below, and the least strictly above.
  const below = others
    .filter((c) => c.ordinal < dragged.ordinal)
    .sort((a, b) => b.ordinal - a.ordinal)[0] as Contact | undefined;
  const above = others
    .filter((c) => c.ordinal > dragged.ordinal)
    .sort((a, b) => a.ordinal - b.ordinal)[0] as Contact | undefined;

  // Fit from the electrode's other contacts; fewer than two remain, fall back to the whole group.
  const fitPositions =
    others.length >= 2 ? others.map((c) => c.position) : group.map((c) => c.position);
  const fit = fitLine(fitPositions);
  // Derived from the fitted axis alone (never from the dragged position), so both labels of one
  // shaft land on the same side and stay there for the length of the drag.
  const offset = fit === null ? ([0, 0, 0] as vec3) : perpendicularTo(fit.axis);

  // The gap between ordinals k and k + 1 is `modelGapsMm[k - 1]`. A gap the model does not reach —
  // an electrode carrying more contacts than its model has — is `null` rather than the last one
  // repeated, so the label never states a number the manufacturer did not.
  const modelGap = (lowerOrdinal: number): number | null =>
    modelGapsMm?.[lowerOrdinal - 1] ?? null;

  const labels: { position: vec3; text: string }[] = [];
  if (below !== undefined) {
    labels.push(
      labelFor(below.position, dragged.position, offset, modelGap(below.ordinal)),
    );
  }
  if (above !== undefined) {
    labels.push(
      labelFor(dragged.position, above.position, offset, modelGap(dragged.ordinal)),
    );
  }

  const axis = fittedAxis(fit, group.map((c) => c.position));

  return { axis, labels };
}
