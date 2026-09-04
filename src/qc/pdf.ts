/**
 * A minimal PDF writer — enough for a QC report, and no more.
 *
 * The module bundle is zero-import by build rule (`scripts/check-bundle.mjs`), so a PDF library is
 * not an option and none is needed: the two QC figures are *pictures with a caption*, which is the
 * one PDF shape that can be written honestly in a page of code.
 *
 *  * **The picture is a JPEG, passed through.** A `/DCTDecode` image XObject carries the bytes
 *    `canvas.convertToBlob({ type: 'image/jpeg' })` produced, byte for byte — no re-encoding, no
 *    colour management, no filter of our own. That is the whole reason JPEG rather than PNG: a PNG
 *    would have to be decoded and re-emitted as `/FlateDecode`, which means shipping a deflate
 *    implementation to say the same thing.
 *  * **The text is base-14 Helvetica**, so no font is embedded. A viewer supplies it; the file has
 *    no glyph data and no `/FontFile`. Characters outside WinAnsi are dropped rather than mis-mapped
 *    ({@link pdfText}) — an electrode is named in ASCII, and a mangled glyph is worse than a missing
 *    one.
 *  * **The xref table is real.** Every object's byte offset is measured on the bytes actually
 *    emitted, which is what `test/qc/pdf.test.ts` reads back: it re-parses the produced file rather
 *    than re-deriving what this code believes it wrote.
 *
 * Object layout is fixed and dense: `1` catalog, `2` page tree, `3` the Helvetica font, then three
 * objects per page (page, content stream, image). Nothing is compressed and there is no object
 * stream, so the file is a little larger than it needs to be and is readable in a hex dump, which
 * for an artefact a lab keeps beside its data is the better trade.
 */

/** A page: one JPEG placed on it, and the caption lines drawn above and below. */
export interface PdfPage {
  /** Page size in points (1 pt = 1/72 inch). A4 landscape is 842 x 595. */
  widthPt: number;
  heightPt: number;
  /** The JPEG bytes, emitted verbatim as a `/DCTDecode` image XObject. */
  jpeg: Uint8Array;
  /** The JPEG's own pixel dimensions — the `/Width` and `/Height` of the XObject. */
  imageWidthPx: number;
  imageHeightPx: number;
  /** Where the image goes, in points, PDF coordinates (origin bottom-left). */
  imageRect: { x: number; y: number; width: number; height: number };
  /** Text drawn at the given point, in Helvetica. Origin bottom-left, like everything else here. */
  text?: { x: number; y: number; sizePt: number; value: string }[];
}

const ENCODER = new TextEncoder();

/**
 * A PDF string literal's body: WinAnsi-representable characters only, with `(`, `)` and `\`
 * escaped.
 *
 * Everything above U+00FF is dropped. There is no `/ToUnicode` map and no embedded font here, so a
 * character the base-14 encoding cannot name would be drawn as some other glyph — a silent wrong
 * answer, where an absent one at least looks absent.
 */
export function pdfText(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0xff) continue;
    if (char === '(' || char === ')' || char === '\\') out += `\\${char}`;
    else if (code < 0x20) out += ' ';
    else out += char;
  }
  return out;
}

/** `%010d` — an xref entry's offset field, which is fixed-width or the table is unreadable. */
function offset10(value: number): string {
  return String(value).padStart(10, '0');
}

/** Trims a number to at most 4 decimals and drops the trailing zeros PDF has no use for. */
function num(value: number): string {
  return String(Math.round(value * 10000) / 10000);
}

/**
 * The whole file, as bytes.
 *
 * Throws on an empty page list rather than emitting a zero-page document: a PDF with no pages is
 * accepted by some viewers and refused by others, and either way it is never what a caller meant.
 */
export function buildPdf(pages: readonly PdfPage[], meta: { title?: string } = {}): Uint8Array {
  if (pages.length === 0) throw new Error('a PDF needs at least one page');

  const chunks: Uint8Array[] = [];
  let length = 0;
  const push = (bytes: Uint8Array): void => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const write = (text: string): void => push(ENCODER.encode(text));

  // Object 0 is the free-list head and has no body; index 0 of `offsets` is never read.
  const offsets: number[] = [0];
  const begin = (id: number): void => {
    offsets[id] = length;
    write(`${id} 0 obj\n`);
  };
  const end = (): void => write('endobj\n');

  // The binary comment on line 2 is what tells a transfer agent this is not a text file. Its four
  // high bytes are the convention every PDF writer follows, and dropping them is how a file gets
  // line-ending-translated in transit.
  write('%PDF-1.4\n');
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  const FIRST_PAGE_OBJECT = 4;
  const pageId = (index: number): number => FIRST_PAGE_OBJECT + index * 3;
  const contentId = (index: number): number => pageId(index) + 1;
  const imageId = (index: number): number => pageId(index) + 2;

  begin(1);
  write('<< /Type /Catalog /Pages 2 0 R >>\n');
  end();

  begin(2);
  const kids = pages.map((_page, index) => `${pageId(index)} 0 R`).join(' ');
  write(`<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\n`);
  end();

  begin(3);
  write('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\n');
  end();

  pages.forEach((page, index) => {
    begin(pageId(index));
    write(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.widthPt)} ${num(page.heightPt)}] ` +
        `/Resources << /Font << /F1 3 0 R >> /XObject << /Im0 ${imageId(index)} 0 R >> >> ` +
        `/Contents ${contentId(index)} 0 R >>\n`
    );
    end();

    // `cm` maps the unit square onto the target rectangle, which is how a PDF places an image:
    // the XObject is always drawn into 0..1 x 0..1 and the matrix does the rest.
    const rect = page.imageRect;
    let content =
      `q\n${num(rect.width)} 0 0 ${num(rect.height)} ${num(rect.x)} ${num(rect.y)} cm\n/Im0 Do\nQ\n`;
    for (const line of page.text ?? []) {
      content +=
        `BT\n/F1 ${num(line.sizePt)} Tf\n1 0 0 1 ${num(line.x)} ${num(line.y)} Tm\n` +
        `(${pdfText(line.value)}) Tj\nET\n`;
    }
    const contentBytes = ENCODER.encode(content);
    begin(contentId(index));
    write(`<< /Length ${contentBytes.length} >>\nstream\n`);
    push(contentBytes);
    write('endstream\n');
    end();

    begin(imageId(index));
    write(
      `<< /Type /XObject /Subtype /Image /Width ${page.imageWidthPx} /Height ${page.imageHeightPx} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\n` +
        'stream\n'
    );
    push(page.jpeg);
    write('\nendstream\n');
    end();
  });

  const infoId = pageId(pages.length);
  begin(infoId);
  write(
    `<< /Producer (tetravox.seeg) /Title (${pdfText(meta.title ?? 'Tetravox sEEG QC')}) >>\n`
  );
  end();

  const count = infoId + 1;
  const startxref = length;
  write(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let id = 1; id < count; id += 1) write(`${offset10(offsets[id] ?? 0)} 00000 n \n`);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${startxref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
