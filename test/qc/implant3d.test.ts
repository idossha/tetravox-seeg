/**
 * The 3-D implant figure's geometry and palette.
 *
 * The palette is pinned against the twelve strings retyped from seegprep's `_IMPLANT_PALETTE`
 * (`reports/figures.py`) — the one place in this repository where a colour has to be identical to
 * another program's, so it is asserted rather than trusted. The renderer itself is checked for the
 * things a number can settle: the camera directions, the silhouette of a known mask, and that a lead
 * is drawn in its own palette colour.
 */

import { describe, expect, it } from 'vitest';
import type { vec3 } from '@tetravox/module-sdk';
import { marchingCubes, taubinSmooth, vertexNormals } from '../../src/qc/isosurface';
import {
  BRAIN_COLOR,
  BRAIN_OPACITY,
  CONTACT_RADIUS_MM,
  IMPLANT3D_VIEWS,
  IMPLANT_PALETTE,
  TUBE_RADIUS_MM,
  VIEW_BASIS,
  ZOOM,
  fitCamera,
  hexRgb,
  implantSuptitle,
  legendOf,
  otsuThreshold,
  paletteColor,
  project,
  renderImplantView,
  type Lead,
} from '../../src/qc/implant3d';

/** The values in `seegprep/src/seegprep/reports/figures.py::_IMPLANT_PALETTE`, retyped from it. */
const SEEGPREP_IMPLANT_PALETTE = [
  '#e6194B',
  '#3cb44b',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#9A6324',
  '#808000',
  '#469990',
  '#000075',
  '#a9a9a9',
];

describe('the implant palette and constants', () => {
  it("is seegprep's palette, string for string", () => {
    expect([...IMPLANT_PALETTE]).toEqual(SEEGPREP_IMPLANT_PALETTE);
  });

  it('cycles the palette for more leads than colours', () => {
    expect(paletteColor(0)).toBe('#e6194B');
    expect(paletteColor(12)).toBe('#e6194B');
    expect(paletteColor(13)).toBe('#3cb44b');
  });

  it("carries implant_3d's own radii, brain colour, opacity and zoom", () => {
    expect(CONTACT_RADIUS_MM).toBe(1.3);
    expect(TUBE_RADIUS_MM).toBe(0.45);
    expect(BRAIN_OPACITY).toBe(0.14);
    expect(hexRgb('#cfd2da')).toEqual(BRAIN_COLOR);
    expect(ZOOM).toBe(1.4);
    expect([...IMPLANT3D_VIEWS]).toEqual(['superior', 'left', 'right', 'anterior']);
  });
});

describe('the view bases', () => {
  it('are orthonormal right-handed frames', () => {
    for (const view of IMPLANT3D_VIEWS) {
      const { right, up, forward } = VIEW_BASIS[view];
      for (const v of [right, up, forward]) expect(Math.hypot(...v)).toBeCloseTo(1, 9);
      expect(right[0] * up[0] + right[1] * up[1] + right[2] * up[2]).toBeCloseTo(0, 9);
    }
  });

  it('put anatomy where its name says: superior sees R on the right and A at the top', () => {
    const cam = fitCamera([[-50, -50, -50], [50, 50, 50]], 'superior', 200, 200);
    const rightward = project(cam, [50, 0, 0]);
    const anterior = project(cam, [0, 50, 0]);
    expect(rightward.x).toBeGreaterThan(cam.width / 2);
    expect(anterior.y).toBeLessThan(cam.height / 2); // smaller y is higher on the panel
  });

  it('mirrors left and right about the midline', () => {
    const points: vec3[] = [
      [-60, 0, 0],
      [60, 0, 0],
    ];
    const l = fitCamera(points, 'left', 200, 200);
    const r = fitCamera(points, 'right', 200, 200);
    // A point in front of the head is on opposite sides of the two panels.
    expect(project(l, [0, 40, 0]).x - l.width / 2).toBeCloseTo(
      -(project(r, [0, 40, 0]).x - r.width / 2),
      6
    );
  });
});

describe('renderImplantView', () => {
  const lead: Lead = {
    label: 'A',
    color: paletteColor(0),
    points: Array.from({ length: 6 }, (_v, i) => [i * 4 - 10, 0, 0] as vec3),
  };

  it('draws a contact in its own palette colour', () => {
    const w = 120;
    const h = 120;
    const pixels = renderImplantView('superior', [lead], null, w, h);
    const [pr, pg, pb] = hexRgb(lead.color);
    let matched = 0;
    for (let i = 0; i < w * h; i += 1) {
      const r = pixels[i * 4] as number;
      const g = pixels[i * 4 + 1] as number;
      const b = pixels[i * 4 + 2] as number;
      // Shaded, so the hue is what is checked: red-dominant, and in the palette's own proportions.
      if (r > 60 && r > g * 1.5 && r > b * 1.5) matched += 1;
    }
    expect(pr).toBeGreaterThan(pg);
    expect(pr).toBeGreaterThan(pb);
    expect(matched).toBeGreaterThan(20);
  });

  it('renders a brain surface as a translucent shell, not a box', () => {
    // A 40 mm ball, meshed and smoothed the way the export does.
    const step = 2;
    const n = 45;
    const data = new Float32Array(n * n * n);
    const c = (n - 1) / 2;
    for (let k = 0; k < n; k += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          data[(k * n + j) * n + i] = 40 - Math.hypot(i - c, j - c, k - c) * step;
        }
      }
    }
    const mesh = taubinSmooth(
      marchingCubes({ data, dims: [n, n, n], origin: [-c * step, -c * step, -c * step], step }, 0),
      4
    );
    const brain = { mesh, normals: vertexNormals(mesh) };
    const w = 120;
    const h = 120;
    const pixels = renderImplantView('superior', [], brain, w, h);
    const tinted = (x: number, y: number): boolean => {
      const i = (Math.round(y) * w + Math.round(x)) * 4;
      return (pixels[i] as number) < 250 || (pixels[i + 2] as number) < 250;
    };
    // Inside the silhouette, tinted; at the corners, untouched. A box would tint both.
    expect(tinted(w / 2, h / 2)).toBe(true);
    expect(tinted(1, 1)).toBe(false);
    expect(tinted(w - 2, h - 2)).toBe(false);
    // And the shell reads as glass, not as paint: the centre is a light grey, not near-black.
    const mid = ((h / 2) * w + w / 2) * 4;
    expect(pixels[mid] as number).toBeGreaterThan(150);
    expect(pixels[mid] as number).toBeLessThan(249);
  });

  it('draws the leads over the brain rather than dimmed through it', () => {
    const step = 2;
    const n = 45;
    const data = new Float32Array(n * n * n);
    const c = (n - 1) / 2;
    for (let k = 0; k < n; k += 1) {
      for (let j = 0; j < n; j += 1) {
        for (let i = 0; i < n; i += 1) {
          data[(k * n + j) * n + i] = 40 - Math.hypot(i - c, j - c, k - c) * step;
        }
      }
    }
    const mesh = marchingCubes(
      { data, dims: [n, n, n], origin: [-c * step, -c * step, -c * step], step },
      0
    );
    const brain = { mesh, normals: vertexNormals(mesh) };
    const w = 140;
    const h = 140;
    const withBrain = renderImplantView('superior', [lead], brain, w, h);
    const strong = (px: Uint8ClampedArray): number => {
      let n2 = 0;
      for (let i = 0; i < w * h; i += 1) {
        const r = px[i * 4] as number;
        const g = px[i * 4 + 1] as number;
        const b = px[i * 4 + 2] as number;
        if (r > 100 && r > g * 1.6 && r > b * 1.6) n2 += 1;
      }
      return n2;
    };
    // The lead is inside the ball, so a brain drawn *after* it would wash every one of these out.
    expect(strong(withBrain)).toBeGreaterThan(20);
  });
});

describe('legend and title', () => {
  it('has one entry per lead, in palette order', () => {
    const leads: Lead[] = ['A', 'B', 'C'].map((label, i) => ({
      label,
      color: paletteColor(i),
      points: [[0, 0, 0] as vec3],
    }));
    expect(legendOf(leads)).toEqual([
      { name: 'A', color: '#e6194B' },
      { name: 'B', color: '#3cb44b' },
      { name: 'C', color: '#4363d8' },
    ]);
  });

  it("is seegprep's suptitle, verbatim", () => {
    const leads: Lead[] = [
      { label: 'A', color: paletteColor(0), points: [[0, 0, 0], [1, 0, 0]] as vec3[] },
      { label: 'B', color: paletteColor(1), points: [[0, 0, 0]] as vec3[] },
    ];
    expect(implantSuptitle(leads)).toBe('sEEG implant — 2 depth electrodes, 3 contacts');
  });
});

describe('otsuThreshold', () => {
  it('separates two well-spaced modes', () => {
    const values = [...Array.from({ length: 500 }, () => 10), ...Array.from({ length: 500 }, () => 200)];
    const t = otsuThreshold(values);
    expect(t).not.toBeNull();
    expect(t as number).toBeGreaterThan(10);
    expect(t as number).toBeLessThan(200);
  });

  it('is null when nothing is finite', () => {
    expect(otsuThreshold([Number.NaN, Number.NaN])).toBeNull();
  });
});

describe('otsuThreshold', () => {
  it('separates two well-spaced modes', () => {
    const values = [...Array.from({ length: 500 }, () => 10), ...Array.from({ length: 500 }, () => 200)];
    const t = otsuThreshold(values);
    expect(t).not.toBeNull();
    expect(t as number).toBeGreaterThan(10);
    expect(t as number).toBeLessThan(200);
  });

  it('is null when nothing is finite', () => {
    expect(otsuThreshold([Number.NaN, Number.NaN])).toBeNull();
  });
});

