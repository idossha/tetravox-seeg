/**
 * The matplotlib stand-in (`src/qc/mpl.ts`).
 *
 * The colormaps are checked against matplotlib's own definitions rather than against a rendered
 * sample: `autumn` is literally `(1, g, 0)` in `matplotlib/_cm.py`, so its three canonical points can
 * be asserted exactly, and a drift in either LUT is what would make the QC figure stop matching
 * seegprep's without anything else looking wrong.
 */

import { describe, expect, it } from 'vitest';
import {
  Axes,
  DPI,
  tightBox,
  autoTicks,
  autumnLut,
  grayLut,
  nanPercentile,
  pt,
  tickLabel,
} from '../../src/qc/mpl';

describe('the colormaps', () => {
  it("matches matplotlib's autumn at 0, 0.5 and 1", () => {
    expect(autumnLut(0)).toEqual([255, 0, 0]);
    expect(autumnLut(0.5)).toEqual([255, 128, 0]);
    expect(autumnLut(1)).toEqual([255, 255, 0]);
  });

  it('clips autumn outside the window, like a Normalize with over/under end colours', () => {
    expect(autumnLut(-3)).toEqual([255, 0, 0]);
    expect(autumnLut(9)).toEqual([255, 255, 0]);
  });

  it("matches matplotlib's gray at 0, 0.5 and 1", () => {
    expect(grayLut(0)).toEqual([0, 0, 0]);
    expect(grayLut(0.5)).toEqual([128, 128, 128]);
    expect(grayLut(1)).toEqual([255, 255, 255]);
  });
});

describe('nanPercentile', () => {
  it("interpolates linearly, like numpy's default method", () => {
    // np.nanpercentile([0, 1, 2, 3], 50) == 1.5
    expect(nanPercentile([0, 1, 2, 3], 50)).toBeCloseTo(1.5, 9);
    expect(nanPercentile([0, 10], 2)).toBeCloseTo(0.2, 9);
    expect(nanPercentile([0, 10], 99)).toBeCloseTo(9.9, 9);
  });

  it('ignores NaN and is null when nothing is finite', () => {
    expect(nanPercentile([Number.NaN, 4, Number.NaN], 50)).toBe(4);
    expect(nanPercentile([Number.NaN], 50)).toBeNull();
  });
});

describe('points and axes', () => {
  it('converts points to pixels at the style sheet dpi', () => {
    expect(DPI).toBe(150);
    expect(pt(72)).toBeCloseTo(150, 9);
  });

  it("keeps a millimetre square under aspect='equal'", () => {
    const ax = new Axes(
      { x: 0, y: 0, width: 400, height: 100 },
      { x0: -20, x1: 20, y0: -11, y1: 11 }
    );
    const perMmX = (ax.px(1) - ax.px(0));
    const perMmY = (ax.py(0) - ax.py(1));
    expect(perMmX).toBeCloseTo(perMmY, 6);
    expect(ax.box.width).toBeLessThanOrEqual(400.001);
    expect(ax.box.height).toBeLessThanOrEqual(100.001);
  });

  it("maps origin='lower' so a larger y is higher on the canvas", () => {
    const ax = new Axes({ x: 0, y: 0, width: 100, height: 100 }, { x0: 0, x1: 10, y0: 0, y1: 10 });
    expect(ax.py(9)).toBeLessThan(ax.py(1));
  });
});

describe('autoTicks', () => {
  it('lands on a 1/2/2.5/5/10 step covering the interval', () => {
    expect(autoTicks(0, 10)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(autoTicks(-11, 11)).toEqual([-10, -7.5, -5, -2.5, 0, 2.5, 5, 7.5, 10]);
  });

  it('prints the shortest decimal', () => {
    expect(tickLabel(0)).toBe('0');
    expect(tickLabel(-7.5)).toBe('-7.5');
    expect(tickLabel(10)).toBe('10');
  });
});

describe('tightBox', () => {
  it("crops the white border to matplotlib's 0.1 inch pad", () => {
    const w = 100;
    const h = 80;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    const ink = (x: number, y: number): void => {
      data[(y * w + x) * 4] = 0;
      data[(y * w + x) * 4 + 1] = 0;
      data[(y * w + x) * 4 + 2] = 0;
    };
    ink(40, 30);
    ink(60, 50);
    // pad = 0.1 in x 150 dpi = 15 px, clipped to the canvas on every side it reaches.
    expect(tightBox(data, w, h)).toEqual({ x: 25, y: 15, width: 51, height: 51 });
  });

  it('leaves an all-white figure alone rather than cropping it to nothing', () => {
    const data = new Uint8ClampedArray(20 * 10 * 4).fill(255);
    expect(tightBox(data, 20, 10)).toEqual({ x: 0, y: 0, width: 20, height: 10 });
  });
});
