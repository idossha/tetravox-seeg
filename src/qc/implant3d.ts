/**
 * The 3-D implant figure — `sub-{id}_desc-implant3d_qc.png`.
 *
 * **What could not be built as specified.** The spec asked for four `capture.screenshot` calls
 * (superior/left/right/anterior) with the camera set before each one; `host.ts` (PR #18) has no
 * camera-control call a module can reach — `capture.screenshot` reads whatever is already on
 * screen, and nothing in the scene API lets a module aim the 3-D view. So this exports **one**
 * capture of the current 3-D view, tiled with a legend, rather than four angles. The moment a
 * camera-control API ships, `buildImplant3dTiles` below is the one function to change: it already
 * takes an array of `{ label, screenshot }` pairs, so a caller with four screenshots (or a future
 * `angles` argument) produces the four-panel figure with no change to how a tile is drawn.
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
