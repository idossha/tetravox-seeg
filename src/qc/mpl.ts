/**
 * The small slice of matplotlib the QC figures actually use, reimplemented on a 2-D canvas.
 *
 * The owner's requirement is that these figures be *visually 1:1* with seegprep's
 * (`src/seegprep/reports/figures.py` + `reports/style.py`), which are matplotlib. A module bundle is
 * zero-import by build rule, so the way to get matplotlib's look is to write the parts of it the two
 * figures touch: `publication_style`'s rcParams, a figure in inches at a DPI, axes laid out on a
 * grid, `imshow` with an extent and `aspect="equal"`, spines/ticks/labels/titles, a `suptitle`, and
 * the `gray` / `autumn` colormaps.
 *
 * **What is faithful and what is approximate.** The colormaps, the point-to-pixel arithmetic, the
 * data-to-axes mapping, the marker geometry and every literal (sizes, margins, HU windows, strings)
 * are the same numbers seegprep passes to matplotlib. The *layout engine* is not: matplotlib's
 * `tight_layout` measures rendered text and then solves for the subplot rectangle, and this uses
 * fixed padding derived from the same font sizes. Panel positions can therefore differ from a
 * matplotlib render by a few pixels. `savefig(bbox="tight")` *is* reproduced, by {@link tightBox}:
 * the all-white border is measured on the rendered pixels and cropped back to matplotlib's 0.1 inch
 * pad, which is what makes the emitted PNG the same size as seegprep's.
 *
 * Everything here takes a {@link Ctx2D} — the structural subset of `CanvasRenderingContext2D` these
 * figures call — so a test can pass a spy and assert on the draw calls without an `OffscreenCanvas`.
 */

/** The subset of a 2-D canvas context these figures use. A test may supply a spy of this shape. */
export interface Ctx2D {
  canvas?: unknown;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  imageSmoothingEnabled: boolean;
  save(): void;
  restore(): void;
  translate(x: number, y: number): void;
  rotate(angle: number): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arc(x: number, y: number, r: number, a0: number, a1: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  stroke(): void;
  fill(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  drawImage(image: never, dx: number, dy: number, dw: number, dh: number): void;
}

/** `savefig.dpi` from seegprep's `_STYLE`. Every inch-valued literal below is scaled by it. */
export const DPI = 150;

/** Points to device pixels at {@link DPI} — matplotlib's own `pt * dpi / 72`. */
export function pt(points: number): number {
  return (points * DPI) / 72;
}

/**
 * matplotlib's default font families. DejaVu Sans/Serif ship with matplotlib itself and are what
 * rendered the reference figures; the rest of each stack is the fallback on a machine without them.
 */
export const SANS = '"DejaVu Sans", Verdana, Geneva, sans-serif';
export const SERIF = '"DejaVu Serif", "Times New Roman", Times, serif';

/** `font.size` 10 / `axes.titlesize` 11 (bold) / `axes.labelsize` 10, from `style.py::_STYLE`. */
export const FONT_SIZE = 10;
/** `figure.titlesize` defaults to `large` = 1.2 × `font.size`. */
export const SUPTITLE_SIZE = FONT_SIZE * 1.2;

/** A font string for the canvas, in points at {@link DPI}. */
export function fontSpec(
  sizePt: number,
  opts: { weight?: 'normal' | 'bold'; family?: string } = {}
): string {
  return `${opts.weight === 'bold' ? 'bold ' : ''}${pt(sizePt)}px ${opts.family ?? SANS}`;
}

/** A rectangle in device pixels, y measured downward from the top of the canvas. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- colormaps ---------------------------------------------------------------------------------

/** An RGB triple, 0..255. */
export type Rgb = [number, number, number];

/**
 * matplotlib's `gray`: a linear ramp from black to white.
 *
 * `t` is already normalised to 0..1 by the caller's `vmin`/`vmax` window (matplotlib's `Normalize`),
 * and is clipped here the way `Normalize(clip=False)` + the colormap's over/under handling does for
 * a linear map — out-of-range values take the end colours.
 */
export function grayLut(t: number): Rgb {
  const c = Math.round(255 * Math.min(1, Math.max(0, t)));
  return [c, c, c];
}

/**
 * matplotlib's `autumn`: `(1, g, 0)` with `g` ramping 0 → 1. Red at the low end, yellow at the high.
 *
 * This is the literal definition in matplotlib's `_cm.py` (`_autumn_data`), which is why it can be
 * checked exactly rather than sampled: at 0 it is `(255, 0, 0)`, at 0.5 `(255, 128, 0)` (127.5
 * rounded half-up), at 1 `(255, 255, 0)`.
 */
export function autumnLut(t: number): Rgb {
  const g = Math.min(1, Math.max(0, t));
  return [255, Math.round(255 * g), 0];
}

/**
 * `np.nanpercentile` with linear interpolation — the same rule numpy's default `method="linear"`
 * uses, so the T1 window matches seegprep's rather than being a nearest-rank approximation.
 *
 * Returns `null` when nothing is finite, which is the caller's cue to fall back to `vmin/vmax=None`
 * exactly as `electrode_reslice` does.
 */
export function nanPercentile(values: ArrayLike<number>, p: number): number | null {
  const finite: number[] = [];
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isFinite(v)) finite.push(v);
  }
  if (finite.length === 0) return null;
  finite.sort((a, b) => a - b);
  const pos = ((p / 100) * (finite.length - 1));
  const lo = Math.floor(pos);
  const hi = Math.min(finite.length - 1, lo + 1);
  const frac = pos - lo;
  return (finite[lo] as number) * (1 - frac) + (finite[hi] as number) * frac;
}

// --- axes --------------------------------------------------------------------------------------

/** A data-space window, in the axes' own units (millimetres for both QC figures). */
export interface Extent {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/**
 * An axes: a rectangle of the figure plus the data window drawn into it.
 *
 * `aspect: 'equal'` shrinks the box to the data's own aspect ratio inside the allotted rectangle
 * (matplotlib's `adjustable="box"`, the default for `imshow`), so a millimetre is the same length on
 * both axes — which is the whole point of the reslice figure.
 */
export class Axes {
  readonly box: Rect;

  constructor(
    readonly slot: Rect,
    readonly extent: Extent,
    aspect: 'equal' | 'auto' = 'equal'
  ) {
    if (aspect === 'auto') {
      this.box = slot;
      return;
    }
    const dataW = Math.abs(extent.x1 - extent.x0);
    const dataH = Math.abs(extent.y1 - extent.y0);
    if (dataW <= 0 || dataH <= 0) {
      this.box = slot;
      return;
    }
    const scale = Math.min(slot.width / dataW, slot.height / dataH);
    const width = dataW * scale;
    const height = dataH * scale;
    this.box = {
      x: slot.x + (slot.width - width) / 2,
      y: slot.y + (slot.height - height) / 2,
      width,
      height,
    };
  }

  /** Data x (mm) to a device pixel. */
  px(x: number): number {
    return this.box.x + ((x - this.extent.x0) / (this.extent.x1 - this.extent.x0)) * this.box.width;
  }

  /** Data y (mm) to a device pixel — `origin="lower"`, so y grows upward and pixels grow down. */
  py(y: number): number {
    return (
      this.box.y +
      this.box.height -
      ((y - this.extent.y0) / (this.extent.y1 - this.extent.y0)) * this.box.height
    );
  }

  /** Millimetres to pixels along x — used for marker sizes given in data units. */
  scaleX(mm: number): number {
    return (mm / (this.extent.x1 - this.extent.x0)) * this.box.width;
  }
}

/**
 * matplotlib's `MaxNLocator` as `AutoLocator` uses it: at most `nbins` ticks on a 1/2/2.5/5/10 step,
 * covering the view interval. Reproduced rather than approximated because the tick *values* are what
 * a reader compares between two figures.
 */
export function autoTicks(lo: number, hi: number, nbins = 9): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / nbins;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const steps = [1, 2, 2.5, 5, 10];
  const step = (steps.find((s) => s * magnitude >= raw) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) {
    // -0 prints as "-0"; snapping tiny residue to 0 also keeps 0.30000000000000004 off the axis.
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : Number(v.toFixed(10)));
  }
  return ticks;
}

/** matplotlib's default tick format for these ranges: the shortest decimal that is not exponential. */
export function tickLabel(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(12)));
}

/**
 * The spines, ticks and tick labels of one axes, in `publication_style`'s configuration: left and
 * bottom spines only (`axes.spines.top/right = False`), ticks outward, labels at `labelsize`.
 */
export function drawAxesFrame(
  ctx: Ctx2D,
  ax: Axes,
  opts: { tickLabelSize: number; color?: string }
): void {
  const color = opts.color ?? '#000000';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = pt(0.8); // axes.linewidth
  const { x, y, width, height } = ax.box;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height);
  ctx.lineTo(x + width, y + height);
  ctx.stroke();

  const tickLen = pt(3.5); // xtick.major.size
  const padPx = pt(3.5); // xtick.major.pad
  ctx.font = fontSpec(opts.tickLabelSize);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (const t of autoTicks(ax.extent.x0, ax.extent.x1)) {
    const tx = ax.px(t);
    if (tx < x - 0.5 || tx > x + width + 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(tx, y + height);
    ctx.lineTo(tx, y + height + tickLen);
    ctx.stroke();
    ctx.fillText(tickLabel(t), tx, y + height + tickLen + padPx);
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (const t of autoTicks(ax.extent.y0, ax.extent.y1)) {
    const ty = ax.py(t);
    if (ty < y - 0.5 || ty > y + height + 0.5) continue;
    ctx.beginPath();
    ctx.moveTo(x, ty);
    ctx.lineTo(x - tickLen, ty);
    ctx.stroke();
    ctx.fillText(tickLabel(t), x - tickLen - padPx, ty);
  }
  ctx.restore();
}

/** An axes title, centred above the box at `fontsize` — `axes.titleweight` is bold in this style. */
export function drawAxesTitle(ctx: Ctx2D, ax: Axes, text: string, sizePt: number): void {
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.font = fontSpec(sizePt, { weight: 'bold' });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(text, ax.box.x + ax.box.width / 2, ax.box.y - pt(6)); // axes.titlepad
  ctx.restore();
}

/** The x axis label, centred under the tick labels. */
export function drawXLabel(
  ctx: Ctx2D,
  ax: Axes,
  text: string,
  sizePt: number,
  tickLabelSize: number
): void {
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.font = fontSpec(sizePt);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const below = ax.box.y + ax.box.height + pt(3.5 + 3.5) + pt(tickLabelSize) + pt(4);
  ctx.fillText(text, ax.box.x + ax.box.width / 2, below);
  ctx.restore();
}

/** The y axis label, rotated a quarter turn anticlockwise like matplotlib's. */
export function drawYLabel(
  ctx: Ctx2D,
  ax: Axes,
  text: string,
  sizePt: number,
  leftOfBoxPx: number
): void {
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.font = fontSpec(sizePt);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.translate(ax.box.x - leftOfBoxPx, ax.box.y + ax.box.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * The figure's `suptitle`, wrapped to the figure width.
 *
 * seegprep's reslice suptitle is a long sentence; matplotlib draws it on one line and
 * `savefig(bbox="tight")` widens the saved image to fit it. There is no such widening here (the
 * canvas is a fixed `figsize`), so the line is wrapped instead of being clipped — the one deliberate
 * layout departure, and the alternative was losing half the sentence.
 */
export function drawSuptitle(
  ctx: Ctx2D,
  figureWidthPx: number,
  text: string,
  opts: {
    sizePt?: number;
    family?: string;
    topPx?: number;
    /** Anything but black — the QC figures' "no brain" note (0.2.2, re-released). */
    color?: string;
    measure(text: string): number;
  }
): number {
  const sizePt = opts.sizePt ?? SUPTITLE_SIZE;
  ctx.save();
  ctx.fillStyle = opts.color ?? '#000000';
  ctx.font = fontSpec(sizePt, { family: opts.family ?? SANS });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const maxWidth = figureWidthPx * 0.96;
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line === '' ? word : `${line} ${word}`;
    if (line !== '' && opts.measure(candidate) > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line !== '') lines.push(line);
  const lineHeight = pt(sizePt) * 1.2;
  let y = opts.topPx ?? pt(6);
  for (const l of lines) {
    ctx.fillText(l, figureWidthPx / 2, y);
    y += lineHeight;
  }
  ctx.restore();
  return y;
}


/**
 * `savefig(bbox_inches="tight")`, measured on the rendered pixels: the bounding box of everything
 * that is not the figure's white background, grown by matplotlib's `pad_inches` (0.1 in).
 *
 * matplotlib solves this from the artists' own extents; there are no artists here, so it is measured
 * instead — which gives the same answer for a figure drawn on white and is the reason the emitted
 * PNG is the same size as seegprep's rather than carrying a wide white frame.
 */
export function tightBox(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  padInches = 0.1
): Rect {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      if ((data[i] as number) > 250 && (data[i + 1] as number) > 250 && (data[i + 2] as number) > 250) {
        continue;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { x: 0, y: 0, width, height };
  const pad = Math.round(padInches * DPI);
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  return {
    x: left,
    y: top,
    width: Math.min(width, x1 + 1 + pad) - left,
    height: Math.min(height, y1 + 1 + pad) - top,
  };
}
