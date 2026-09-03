/**
 * `captureImplant3dViews`'s setView/screenshot sequence — the part a mock host can exercise.
 * `compositeImplant3d`'s pixel output needs `OffscreenCanvas`; see `src/qc/implant3d.ts`'s header.
 */

import { describe, expect, it, vi } from 'vitest';
import { captureImplant3dViews, IMPLANT3D_PRESETS } from '../../src/qc/implant3d';
import type { Implant3dCaptureHost } from '../../src/qc/implant3d';

function mockHost(overrides: Partial<Implant3dCaptureHost> = {}): Implant3dCaptureHost {
  return {
    setView: vi.fn(async () => undefined),
    screenshot: vi.fn(async () => new Uint8Array([1, 2, 3])),
    ...overrides,
  };
}

describe('captureImplant3dViews', () => {
  it('calls setView then screenshot for each preset, in order, with fit only on the first', async () => {
    const calls: string[] = [];
    const host = mockHost({
      setView: vi.fn(async (preset, opts) => {
        calls.push(`setView(${preset}${opts?.fit ? ', fit' : ''})`);
      }),
      screenshot: vi.fn(async () => {
        calls.push('screenshot');
        return new Uint8Array([9]);
      }),
    });

    const result = await captureImplant3dViews(host);

    expect(calls).toEqual([
      'setView(superior, fit)',
      'screenshot',
      'setView(left)',
      'screenshot',
      'setView(right)',
      'screenshot',
      'setView(anterior)',
      'screenshot',
      'setView(superior)',
    ]);
    expect(IMPLANT3D_PRESETS).toEqual(['superior', 'left', 'right', 'anterior']);
    expect(result.degraded).toBe(false);
    expect(result.tiles.map((t) => t.label)).toEqual(['Superior', 'Left', 'Right', 'Anterior']);
  });

  it('leaves the camera at superior after the four captures', async () => {
    const setView = vi.fn<NonNullable<Implant3dCaptureHost['setView']>>(async () => undefined);
    const host = mockHost({ setView });
    await captureImplant3dViews(host);
    const calls = setView.mock.calls;
    const lastCall = calls[calls.length - 1] as [string, unknown];
    expect(lastCall[0]).toBe('superior');
    expect(lastCall[1]).toBeUndefined();
  });

  it('falls back to a single current-view capture when setView is unavailable', async () => {
    const screenshot = vi.fn(async () => new Uint8Array([7]));
    const host: Implant3dCaptureHost = { screenshot };

    const result = await captureImplant3dViews(host);

    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(result.degraded).toBe(true);
    expect(result.tiles).toEqual([{ label: 'Current view', png: new Uint8Array([7]) }]);
  });
});
