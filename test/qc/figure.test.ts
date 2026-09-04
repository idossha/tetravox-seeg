/**
 * The two figure painters, against a spying 2-D context (`Ctx2D`) — the way `src/qc/export.ts`'s
 * header says they are meant to be exercised, since vitest has no `OffscreenCanvas`.
 *
 * The fixture is a synthetic straight lead through a synthetic T1/CT: the T1 is a ramp so its
 * 2nd–99th percentile window is known, and the CT is 2400 HU inside a tube around the lead and 0
 * outside, so the `autumn` colour at a saturated voxel is a number this test can compute
 * independently of the painter.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ContactSet, vec3 } from '@tetravox/module-sdk';
import { HAS_CONTACTS } from '../setup';
import {
  CT_ALPHA,
  CT_METAL_HU,
  DISTANCE_LABEL_PT,
  RESLICE_SUPTITLE,
  buildResliceTiles,
  drawImplantFigure,
  drawResliceFigure,
  COLUMN_PITCH_PX,
  EDGE_MARGIN_PX,
  ROW_PITCH_PX,
  TOP_BAND_PX,
  resliceFigureSize,
  resliceLayout,
  resliceTileImage,
  type ExportHost,
  type ResliceTile,
} from '../../src/qc/export';
import { autumnLut, grayLut, pt, type Ctx2D } from '../../src/qc/mpl';
import { paletteColor, type Lead } from '../../src/qc/implant3d';

/** A recording `Ctx2D`: every call, and the style in force when it was made. */
function spyCtx(): { ctx: Ctx2D; calls: Array<{ op: string; args: unknown[]; style: string; font: string }> } {
  const calls: Array<{ op: string; args: unknown[]; style: string; font: string }> = [];
  const state = { fillStyle: '#000', strokeStyle: '#000', font: '' };
  const record =
    (op: string, styleKey: 'fillStyle' | 'strokeStyle') =>
    (...args: unknown[]) => {
      calls.push({ op, args, style: state[styleKey], font: state.font });
    };
  const ctx = {
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    lineWidth: 1,
    textAlign: '',
    textBaseline: '',
    imageSmoothingEnabled: false,
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: record('arc', 'strokeStyle'),
    rect: vi.fn(),
    stroke: vi.fn(),
    fill: record('fill', 'fillStyle'),
    fillRect: vi.fn(),
    strokeRect: record('strokeRect', 'strokeStyle'),
    fillText: record('fillText', 'fillStyle'),
    strokeText: record('strokeText', 'strokeStyle'),
    drawImage: vi.fn(),
  } as unknown as Ctx2D;
  return { ctx, calls };
}

const LEAD: Array<{ name: string; ordinal: number; position: vec3 }> = Array.from(
  { length: 6 },
  (_v, i) => ({ name: `A0${i + 1}`, ordinal: i + 1, position: [i * 3.5, 0, 0] as vec3 })
);

/** The electrode's Group colour, in the app's 0..1 rgba — a distinctive non-cyan hue. */
const GROUP_RGBA: [number, number, number, number] = [1, 0.4, 0, 1];
const GROUP_CSS = 'rgb(255, 102, 0)';

/** A T1 that ramps with x, and a CT that is 2400 HU within 1 mm of the lead's own axis. */
function mockHost(): ExportHost {
  return {
    scene: {
      sampleVolume: vi.fn(async (id: string, points: Float32Array) => {
        const out = new Float32Array(points.length / 3);
        for (let i = 0; i < out.length; i += 1) {
          const x = points[i * 3] as number;
          const y = points[i * 3 + 1] as number;
          const z = points[i * 3 + 2] as number;
          out[i] = id === 'ct' ? (Math.hypot(y, z) <= 1 ? 2400 : 0) : x;
        }
        return out;
      }),
    },
    files: {
      readText: vi.fn(async () => null),
      writeText: vi.fn(async () => ({ ok: true as const, backupPath: null })),
      writeBinary: vi.fn(async () => ({ ok: true as const, backupPath: null })),
    },
  };
}

function mockSet(): ContactSet {
  return {
    groups: [{ name: 'A', color: GROUP_RGBA, tip: 'low' as never }],
    contacts: LEAD.map((c) => ({
      id: c.name,
      name: c.name,
      group: 'A',
      ordinal: c.ordinal,
      position: c.position,
      original: c.position,
    })) as never,
  } as unknown as ContactSet;
}

describe.skipIf(!HAS_CONTACTS)('the reslice figure', () => {
  it('samples both volumes trilinearly and carries the electrode colour into the tile', async () => {
    const host = mockHost();
    const tiles = await buildResliceTiles(host, mockSet(), { ctDatasetId: 'ct', t1DatasetId: 't1' });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]?.color).toBe(GROUP_CSS);
    for (const call of (host.scene.sampleVolume as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[2]).toEqual({ order: 1 });
    }
  });

  it('paints a saturated CT voxel in autumn over the grey T1, at alpha 0.85', async () => {
    const host = mockHost();
    const [tile] = await buildResliceTiles(host, mockSet(), {
      ctDatasetId: 'ct',
      t1DatasetId: 't1',
    });
    const image = resliceTileImage(tile as ResliceTile);
    expect(image.width).toBe((tile as ResliceTile).grid.nAlong);
    expect(image.height).toBe((tile as ResliceTile).grid.nAcross);

    // `sv = arange(-11, 11, 0.4)` never lands exactly on 0, so the nearest row to the axis is the
    // one on the lead — still inside the 1 mm CT tube, so it reads 2400 HU.
    const t = (tile as ResliceTile).grid;
    let iv = 0;
    t.sv.forEach((v, i) => {
      if (Math.abs(v) < Math.abs(t.sv[iv] as number)) iv = i;
    });
    const iu = Math.floor(t.nAlong / 2);
    const src = iu * t.nAcross + iv;
    expect((tile as ResliceTile).ct?.[src]).toBeCloseTo(2400, 6);

    const t1 = (tile as ResliceTile).t1 as Float32Array;
    const sorted = Array.from(t1).sort((a, b) => a - b);
    const at = (p: number): number => {
      const pos = (p / 100) * (sorted.length - 1);
      const lo = Math.floor(pos);
      return (sorted[lo] as number) * (1 - (pos - lo)) + (sorted[lo + 1] as number) * (pos - lo);
    };
    const [gr] = grayLut(((t1[src] as number) - at(2)) / (at(99) - at(2)));
    const [cr, cg, cb] = autumnLut((2400 - CT_METAL_HU) / (3000 - CT_METAL_HU));
    const row = t.nAcross - 1 - iv;
    const px = (row * t.nAlong + iu) * 4;
    expect(image.data[px]).toBe(Math.round(gr * (1 - CT_ALPHA) + cr * CT_ALPHA));
    expect(image.data[px + 1]).toBe(Math.round((gr as number) * (1 - CT_ALPHA) + cg * CT_ALPHA));
    expect(image.data[px + 2]).toBe(Math.round((gr as number) * (1 - CT_ALPHA) + cb * CT_ALPHA));
  });

  it('gives a row more than the reference pitch only when its own panels need it', async () => {
    const host = mockHost();
    const tiles = await buildResliceTiles(host, mockSet(), { ctDatasetId: 'ct', t1DatasetId: 't1' });
    const layout = resliceLayout(tiles);
    expect(layout.boxes).toHaveLength(tiles.length);
    // One short lead: `aspect="equal"` makes its box taller than seegprep's 358 px row pitch, so the
    // row grows rather than clipping the tick labels off the bottom of the canvas.
    const box = layout.boxes[0] as { height: number };
    expect(layout.height).toBeGreaterThanOrEqual(TOP_BAND_PX + ROW_PITCH_PX + EDGE_MARGIN_PX);
    expect(box.height).toBeGreaterThan(0);
    expect(layout.boxes.every((b) => b.width === 716)).toBe(true);
  });

  it('draws the rings and the 3-D gap text in the electrode colour, and the tip square in lime', async () => {
    const host = mockHost();
    const tiles = await buildResliceTiles(host, mockSet(), { ctDatasetId: 'ct', t1DatasetId: 't1' });
    const { ctx, calls } = spyCtx();
    const drawImage = vi.fn();
    drawResliceFigure(ctx, tiles, drawImage, (text) => text.length * 6);

    // One ring per contact, all in the Group colour; ms=8 means a radius of 4 pt.
    const rings = calls.filter((c) => c.op === 'arc');
    expect(rings).toHaveLength(LEAD.length);
    expect(new Set(rings.map((r) => r.style))).toEqual(new Set([GROUP_CSS]));
    expect(rings[0]?.args[2]).toBeCloseTo(pt(8) / 2, 9);

    // Exactly one tip square, lime, ms=11 on a side.
    const squares = calls.filter((c) => c.op === 'strokeRect');
    expect(squares).toHaveLength(1);
    expect(squares[0]?.style).toBe('#00ff00');
    expect(squares[0]?.args[2]).toBeCloseTo(pt(11), 9);

    // Change 2: one distance per gap, "%.1f", in the electrode colour at fontsize 4.5.
    const distances = calls.filter((c) => c.op === 'fillText' && c.style === GROUP_CSS);
    expect(distances).toHaveLength(LEAD.length - 1);
    // Each one is haloed: a white strokeText under the coloured fill, so the number stays readable
    // over a metal-bright panel.
    const haloes = calls.filter((c) => c.op === 'strokeText' && c.style === '#ffffff');
    expect(haloes).toHaveLength(LEAD.length - 1);
    for (const d of distances) {
      expect(d.args[0]).toBe('3.5');
      expect(d.font).toContain(`${pt(DISTANCE_LABEL_PT)}px`);
    }

    // The suptitle and every panel's axis labels are on the figure.
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    expect(texts).toContain('along shaft (mm)');
    expect(texts).toContain('perp (mm)');
    expect(texts).toContain('A  (n=6)');
    expect(RESLICE_SUPTITLE.split(' ').every((w) => texts.some((t) => t.includes(w)))).toBe(true);
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("sizes the canvas from seegprep's laid-out geometry, not its figsize", () => {
    // `figsize` is 6.2 x 3.0 in per panel, but `tight_layout` + `bbox="tight"` emit a 799 x 358 px
    // pitch — measured on seegprep's own PNG, and what the export has to match to overlay.
    const one = resliceFigureSize(1);
    expect(one.ncols).toBe(1);
    expect(one.width).toBe(EDGE_MARGIN_PX + COLUMN_PITCH_PX);
    const seven = resliceFigureSize(7);
    expect(seven.ncols).toBe(3);
    expect(seven.nrows).toBe(3);
    expect(seven.width).toBe(EDGE_MARGIN_PX + COLUMN_PITCH_PX * 3);
    expect(seven.height).toBe(TOP_BAND_PX + ROW_PITCH_PX * 3 + EDGE_MARGIN_PX);
    // seegprep's sub-P076 figure is 12 leads in a 4 x 3 grid at 2406 x 1541 px after its tight crop.
    const twelve = resliceFigureSize(12);
    expect(Math.abs(twelve.width / 2406 - 1)).toBeLessThan(0.05);
    expect(Math.abs(twelve.height / 1541 - 1)).toBeLessThan(0.05);
  });

});

describe('the implant figure', () => {
  const leads: Lead[] = ['LA', 'RB', 'LC'].map((label, i) => ({
    label,
    color: paletteColor(i),
    points: Array.from({ length: 4 }, (_v, j) => [j * 4 - 6, i * 8 - 8, 0] as vec3),
  }));

  it('draws four panels with capitalised serif titles and one legend entry per lead', () => {
    const { ctx, calls } = spyCtx();
    const drawImage = vi.fn();
    drawImplantFigure(ctx, leads, null, drawImage, (text) => text.length * 6);

    expect(drawImage).toHaveBeenCalledTimes(4);
    const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.args[0]));
    for (const title of ['Superior', 'Left', 'Right', 'Anterior']) expect(texts).toContain(title);
    for (const lead of leads) expect(texts).toContain(lead.label);
    expect(texts.some((t) => t.includes('sEEG'))).toBe(true);

    // One filled legend marker per lead, each in that lead's palette colour.
    const markers = calls.filter((c) => c.op === 'fill');
    expect(markers.map((m) => m.style)).toEqual(leads.map((l) => l.color));
  });
});
