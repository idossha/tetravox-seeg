/**
 * The 3-D implant figure — `sub-{id}_desc-implant3d_qc.png`.
 *
 * Four angles, tiled 2x2: superior, left, right, anterior, each captured after
 * `host.capture.setView` rotates the 3-D view's camera to that RAS preset (host PR #18). Superior
 * is asked with `{ fit: true }` so the reset-view runs once, before the first shot; the remaining
 * three presets reuse that fit. There is no restore call in the host API — `setView` "restores
 * nothing" per its own doc comment — so `captureImplant3dViews` leaves the camera at `superior`
 * once the four shots are in hand, rather than the angle the user had before exporting. That is a
 * deliberate, documented side effect of running a 3-D export, not a bug: the alternative is a host
 * API this module cannot ask for.
 *
 * **Older hosts.** `host.capture.setView` is undefined on a host built before PR #18. Rather than
 * throw, `captureImplant3dViews` falls back to the pre-PR-18 behaviour: one capture of whatever the
 * 3-D view already shows, and `degraded: true` in its result so the caller can tell the user only
 * the current view was captured.
 */

import type { Group } from '@tetravox/module-sdk';

export interface Implant3dTile {
  label: string;
  png: Uint8Array;
}

export interface LegendEntry {
  name: string;
  color: string;
}

/** The four RAS presets `captureImplant3dViews` shoots, in the order they are captured and tiled. */
export const IMPLANT3D_PRESETS = ['superior', 'left', 'right', 'anterior'] as const;
export type Implant3dPreset = (typeof IMPLANT3D_PRESETS)[number];

const PRESET_LABEL: Record<Implant3dPreset, string> = {
  superior: 'Superior',
  left: 'Left',
  right: 'Right',
  anterior: 'Anterior',
};

/** The narrow slice of `ModuleHost.capture` this module needs, for mocking. */
export interface Implant3dCaptureHost {
  setView?(
    preset: 'superior' | 'inferior' | 'left' | 'right' | 'anterior' | 'posterior',
    opts?: { viewId?: string; fit?: boolean }
  ): Promise<void>;
  screenshot(opts: {
    target: 'view' | 'grid';
    viewId?: string;
    width?: number;
    height?: number;
    background?: 'transparent' | 'theme';
  }): Promise<Uint8Array>;
}

export interface Implant3dCaptureResult {
  tiles: Implant3dTile[];
  /** True when `setView` was unavailable and only the current view could be captured. */
  degraded: boolean;
}

/**
 * Captures the 3-D implant figure's raw tiles: four angles when `host.setView` exists, one
 * (whatever the view already shows) when it does not. Leaves the camera at `superior` afterward —
 * see this file's header — except in the degraded path, where nothing set the camera in the first
 * place and nothing should move it.
 */
export async function captureImplant3dViews(
  host: Implant3dCaptureHost,
  screenshotOpts: {
    width?: number;
    height?: number;
    background?: 'transparent' | 'theme';
  } = {}
): Promise<Implant3dCaptureResult> {
  if (typeof host.setView !== 'function') {
    const png = await host.screenshot({ target: 'view', ...screenshotOpts });
    return { tiles: [{ label: 'Current view', png }], degraded: true };
  }

  const tiles: Implant3dTile[] = [];
  for (const [index, preset] of IMPLANT3D_PRESETS.entries()) {
    await host.setView(preset, index === 0 ? { fit: true } : undefined);
    const png = await host.screenshot({ target: 'view', ...screenshotOpts });
    tiles.push({ label: PRESET_LABEL[preset], png });
  }
  // Leave the user at a neutral, known view — there is no camera to restore to (see header).
  await host.setView('superior');
  return { tiles, degraded: false };
}

/** `Group.color` (0..1 rgba) as a CSS colour string, for the legend. */
export function legendOf(groups: readonly Group[]): LegendEntry[] {
  return groups.map((g) => ({
    name: g.name,
    color: `rgba(${Math.round(g.color[0] * 255)}, ${Math.round(g.color[1] * 255)}, ${Math.round(
      g.color[2] * 255
    )}, ${g.color[3]})`,
  }));
}

/**
 * Draws the implant figure's tiles and legend into `ctx`. `tiles` holds already-decoded bitmaps
 * (the caller decodes each PNG via `createImageBitmap`, which requires a running host) — this
 * function only lays them out, so it can be exercised with synthetic bitmaps in a test.
 */
export function compositeImplant3d(
  ctx: OffscreenCanvasRenderingContext2D,
  tiles: Array<{ label: string; bitmap: ImageBitmap | OffscreenCanvas }>,
  legend: LegendEntry[],
  tileWidthPx: number,
  tileHeightPx: number
): void {
  const columns = Math.min(2, Math.max(1, tiles.length));
  tiles.forEach((tile, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const ox = col * tileWidthPx;
    const oy = row * tileHeightPx;
    ctx.drawImage(tile.bitmap as CanvasImageSource, ox, oy, tileWidthPx, tileHeightPx);
    ctx.fillStyle = '#ffffff';
    ctx.font = '12px sans-serif';
    ctx.fillText(tile.label, ox + 6, oy + 16);
  });

  const legendX = 8;
  let legendY = Math.ceil(tiles.length / columns) * tileHeightPx + 16;
  ctx.fillStyle = '#000000';
  for (const entry of legend) {
    ctx.fillStyle = entry.color;
    ctx.fillRect(legendX, legendY - 8, 10, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = '11px sans-serif';
    ctx.fillText(entry.name, legendX + 14, legendY);
    legendY += 14;
  }
}
