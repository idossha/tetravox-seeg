/**
 * The PDF writer, checked by **reading the bytes back** rather than by re-deriving what
 * `buildPdf` believes it wrote.
 *
 * Every assertion below re-parses the produced file: the header, the object offsets out of the
 * xref table (each one followed to the `N 0 obj` it claims to point at), the page tree's `/Count`,
 * and the JPEG bytes located verbatim inside the stream that declared their length. A writer that
 * miscounts one byte anywhere fails the offset walk, which is the failure a hand-rolled PDF
 * actually has — a viewer that opens the file is not evidence, since most of them repair a broken
 * xref silently.
 */

import { describe, expect, it } from 'vitest';
import { buildPdf, pdfText } from '../../src/qc/pdf';

const DECODER = new TextDecoder('latin1');

/** A JPEG-shaped byte run. Not a decodable image — nothing here decodes it, and nor does `buildPdf`. */
function fakeJpeg(seed: number, length = 64): Uint8Array {
  const bytes = new Uint8Array(length);
  // SOI + APP0, so the run starts with the marker a reader would look for, and carries the 0x0D
  // 0x0A pair that a text-mode write would mangle.
  bytes.set([0xff, 0xd8, 0xff, 0xe0, 0x0d, 0x0a], 0);
  for (let i = 6; i < length - 2; i += 1) bytes[i] = (seed * 31 + i * 7) % 256;
  bytes.set([0xff, 0xd9], length - 2);
  return bytes;
}

function page(seed: number, title: string): Parameters<typeof buildPdf>[0][number] {
  return {
    widthPt: 842,
    heightPt: 595,
    jpeg: fakeJpeg(seed),
    imageWidthPx: 800,
    imageHeightPx: 500,
    imageRect: { x: 24, y: 40, width: 794, height: 496 },
    text: [{ x: 24, y: 560, sizePt: 12, value: title }],
  };
}

/** The xref table's offsets, parsed out of the trailer the way a reader does. */
function xrefOffsets(bytes: Uint8Array): number[] {
  const text = DECODER.decode(bytes);
  const startxref = /startxref\s+(\d+)\s+%%EOF/.exec(text);
  expect(startxref).not.toBeNull();
  const at = Number(startxref?.[1]);
  expect(text.slice(at, at + 4)).toBe('xref');
  const header = /^xref\n0 (\d+)\n/.exec(text.slice(at));
  expect(header).not.toBeNull();
  const count = Number(header?.[1]);
  const first = at + (header?.[0].length ?? 0);
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const entry = text.slice(first + i * 20, first + i * 20 + 20);
    // Fixed-width, 20 bytes each, or a reader cannot index into the table at all.
    expect(entry).toMatch(/^\d{10} \d{5} [nf] \n$/);
    offsets.push(Number(entry.slice(0, 10)));
  }
  return offsets;
}

/** Find `needle` inside `haystack`, or -1. `indexOf` on bytes, which no built-in offers. */
function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe('buildPdf', () => {
  it('writes a %PDF-1.4 header and a binary comment line', () => {
    const bytes = buildPdf([page(1, 'A')]);
    expect(DECODER.decode(bytes.subarray(0, 9))).toBe('%PDF-1.4\n');
    // The four high bytes on line 2: without them a transfer that translates line endings is not
    // detectable, and this file's own streams are the thing that would be corrupted.
    expect([...bytes.subarray(9, 15)]).toEqual([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);
    expect(DECODER.decode(bytes.subarray(bytes.length - 6))).toBe('%%EOF\n');
  });

  it('gives every xref entry the byte offset of the object it names', () => {
    const bytes = buildPdf([page(1, 'A'), page(2, 'B'), page(3, 'C')]);
    const text = DECODER.decode(bytes);
    const offsets = xrefOffsets(bytes);
    // 3 fixed objects + 3 per page + the info dictionary, plus the free-list head at index 0.
    expect(offsets).toHaveLength(3 + 3 * 3 + 1 + 1);
    expect(offsets[0]).toBe(0);
    for (let id = 1; id < offsets.length; id += 1) {
      expect(text.slice(offsets[id] as number).startsWith(`${id} 0 obj\n`)).toBe(true);
    }
    // The trailer's /Size is the same count, and the catalog is object 1.
    expect(text).toContain(`/Size ${offsets.length} /Root 1 0 R`);
    // And the objects really are in the file in that order — a table that happened to be sorted
    // while the offsets were wrong would pass the check above only by accident.
    expect([...offsets].slice(1).every((v, i, a) => i === 0 || v > (a[i - 1] as number))).toBe(true);
  });

  it('makes one page per figure, with the page tree agreeing', () => {
    const bytes = buildPdf([page(1, 'A'), page(2, 'B')]);
    const text = DECODER.decode(bytes);
    expect(text).toContain('/Type /Pages /Count 2 /Kids [4 0 R 7 0 R]');
    expect(text.match(/\/Type \/Page\b/g)).toHaveLength(2);
  });

  it('carries each JPEG verbatim in its own /DCTDecode stream', () => {
    const first = fakeJpeg(11, 96);
    const second = fakeJpeg(22, 128);
    const bytes = buildPdf([
      { ...page(1, 'A'), jpeg: first },
      { ...page(2, 'B'), jpeg: second },
    ]);
    // Byte for byte, not "a stream of the right length": this writer's whole claim about JPEG is
    // that it passes the encoder's output through untouched.
    expect(indexOfBytes(bytes, first)).toBeGreaterThan(0);
    expect(indexOfBytes(bytes, second)).toBeGreaterThan(0);
    const text = DECODER.decode(bytes);
    expect(text).toContain(`/Filter /DCTDecode /Length ${first.length}`);
    expect(text).toContain(`/Filter /DCTDecode /Length ${second.length}`);
    // /Length must be the stream's real byte count, measured from `stream\n` to `endstream`.
    for (const jpeg of [first, second]) {
      const at = indexOfBytes(bytes, jpeg);
      expect(DECODER.decode(bytes.subarray(at - 7, at))).toBe('stream\n');
      expect(DECODER.decode(bytes.subarray(at + jpeg.length, at + jpeg.length + 10))).toBe(
        '\nendstream'
      );
    }
  });

  it('draws its captions in base-14 Helvetica, with no font embedded', () => {
    const text = DECODER.decode(buildPdf([page(1, 'LHIP  gap 3.51 mm')]));
    expect(text).toContain('/BaseFont /Helvetica /Encoding /WinAnsiEncoding');
    expect(text).not.toContain('/FontFile');
    expect(text).toContain('(LHIP  gap 3.51 mm) Tj');
  });

  it('escapes what a PDF string cannot hold, and drops what Helvetica cannot name', () => {
    expect(pdfText('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
    expect(pdfText('LHIP—中')).toBe('LHIP');
    expect(pdfText('one\ntwo')).toBe('one two');
  });

  it('refuses to write a document with no pages', () => {
    expect(() => buildPdf([])).toThrow(/at least one page/);
  });
});
