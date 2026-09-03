/**
 * The chunking and file-write sequencing half of the QC export sheet — the part a mock host can
 * exercise. `sampleVolume`'s and `capture.screenshot`'s actual pixel output cannot be checked here;
 * see `src/qc/export.ts`'s header.
 */

import { describe, expect, it, vi } from 'vitest';
import { chunkPoints, ensureDatasetDescription, MAX_SAMPLE_POINTS, sampleVolumeChunked } from '../../src/qc/export';
import type { ExportHost } from '../../src/qc/export';

function mockHost(overrides: Partial<ExportHost> = {}): ExportHost {
  return {
    scene: { sampleVolume: vi.fn(async (_id, points) => new Float32Array(points.length / 3).fill(1)) },
    capture: { screenshot: vi.fn(async () => new Uint8Array()) },
    files: {
      readText: vi.fn(async () => null),
      writeText: vi.fn(async () => ({ ok: true, backupPath: null })),
      writeBinary: vi.fn(async () => ({ ok: true, backupPath: null })),
    },
    ...overrides,
  } as ExportHost;
}

describe('chunkPoints', () => {
  it('does not split a request under the cap', () => {
    const points = new Float32Array(300);
    expect(chunkPoints(points)).toHaveLength(1);
  });

  it('splits a request over the cap into chunks of at most MAX_SAMPLE_POINTS points', () => {
    const totalPoints = MAX_SAMPLE_POINTS + 5;
    const points = new Float32Array(totalPoints * 3);
    const chunks = chunkPoints(points);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length / 3).toBe(MAX_SAMPLE_POINTS);
    expect(chunks[1]!.length / 3).toBe(5);
    const reassembled = chunks.reduce((n, c) => n + c.length / 3, 0);
    expect(reassembled).toBe(totalPoints);
  });
});

describe('sampleVolumeChunked', () => {
  it('reassembles chunked sampleVolume calls in point order', async () => {
    const totalPoints = MAX_SAMPLE_POINTS + 10;
    const points = new Float32Array(totalPoints * 3);
    const calls: number[] = [];
    const host = mockHost({
      scene: {
        sampleVolume: vi.fn(async (_id, chunk) => {
          const n = chunk.length / 3;
          calls.push(n);
          return new Float32Array(n).fill(n);
        }),
      },
    });
    const out = await sampleVolumeChunked(host, 'ct', points);
    expect(calls).toEqual([MAX_SAMPLE_POINTS, 10]);
    expect(out.length).toBe(totalPoints);
    expect(out[0]).toBe(MAX_SAMPLE_POINTS);
    expect(out[out.length - 1]).toBe(10);
  });
});

describe('ensureDatasetDescription', () => {
  it('writes once if absent', async () => {
    const host = mockHost();
    await ensureDatasetDescription(host, '/x/dataset_description.json', '0.1.7');
    expect(host.files.writeText).toHaveBeenCalledTimes(1);
    const [, text] = (host.files.writeText as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(JSON.parse(text)).toMatchObject({ Name: 'tetravox', DatasetType: 'derivative' });
  });

  it('does nothing if the file already exists', async () => {
    const host = mockHost({
      files: {
        readText: vi.fn(async () => '{}'),
        writeText: vi.fn(async () => ({ ok: true as const, backupPath: null })),
        writeBinary: vi.fn(async () => ({ ok: true as const, backupPath: null })),
      },
    });
    await ensureDatasetDescription(host, '/x/dataset_description.json', '0.1.7');
    expect(host.files.writeText).not.toHaveBeenCalled();
  });
});
