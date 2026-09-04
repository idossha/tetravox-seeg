/**
 * A stand-in `OffscreenCanvas` for the suites that drive the QC export end to end.
 *
 * Lifted out of `exportadmission.test.ts` when `background.test.ts` needed the same one: two copies
 * of a fake canvas would be two chances for them to disagree about what a canvas does.
 */

/**
 * The smallest `OffscreenCanvas` that lets the export reach `files.writeBinary`.
 *
 * It draws nothing and encodes nothing — the picture is not what this file is about, and what a
 * real canvas produces is exactly what `qc/export.ts`'s header says cannot be checked outside a
 * running host. Everything downstream of the bytes is checked for real in `test/qc/pdf.test.ts`.
 */
export function stubOffscreenCanvas(): { restore: () => void } {
  const context = {
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => undefined,
    // The tight-bbox crop reads the figure back; an all-white read leaves the canvas uncropped.
    getImageData: (_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4).fill(255),
    }),
    drawImage: () => undefined,
    measureText: (text: string) => ({ width: text.length * 6 }),
    save: () => undefined,
    restore: () => undefined,
    translate: () => undefined,
    rotate: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    arc: () => undefined,
    rect: () => undefined,
    stroke: () => undefined,
    fill: () => undefined,
    strokeRect: () => undefined,
    fillRect: () => undefined,
    fillText: () => undefined,
    strokeText: () => undefined,
    imageSmoothingEnabled: false,
    lineWidth: 1,
    textAlign: '',
    textBaseline: '',
    strokeStyle: '',
    fillStyle: '',
    font: '',
  };
  class Stub {
    constructor(
      public width: number,
      public height: number
    ) {}
    getContext(): unknown {
      return context;
    }
    async convertToBlob(): Promise<{ arrayBuffer: () => Promise<ArrayBuffer> }> {
      return { arrayBuffer: async () => new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer };
    }
  }
  // `ImageData` too: the figure painter constructs one per panel to blit the sampled slab.
  class StubImageData {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number
    ) {}
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = scope['OffscreenCanvas'];
  const previousImageData = scope['ImageData'];
  scope['OffscreenCanvas'] = Stub;
  if (previousImageData === undefined) scope['ImageData'] = StubImageData;
  return {
    restore: () => {
      if (previous === undefined) delete scope['OffscreenCanvas'];
      else scope['OffscreenCanvas'] = previous;
      if (previousImageData === undefined) delete scope['ImageData'];
    },
  };
}
