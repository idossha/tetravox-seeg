/**
 * `seegprep`'s electrode catalogue → `src/catalogue.gen.ts`, hash-pinned like the contacts kit.
 *
 * The gap table is **seegprep's**, not this repository's, for the same reason the contacts kit is
 * Tetravox's: two programs that disagree about how far apart an RD10R-SP05X's contacts are would
 * produce two different answers to "is this shaft right", and the one that ships in a module
 * bundle is the one a clinician sees. So the numbers are generated from
 * `seegprep/src/seegprep/data/electrode_models.json` and `catalogue.pin.json` records the sha256 of
 * the file they came from and of the file they were written to.
 *
 * **Why generated rather than fetched at run time.** A module bundle has no `node_modules`, no
 * import map and no network; and a lab's subject directory is not guaranteed to carry seegprep's
 * package data. Forty-four models is 3 kB of JSON — small enough that baking it in is cheaper than
 * any way of not baking it in, and it is why "no catalogue at all" is still a supported state
 * rather than the only one.
 *
 * Only the four fields the module uses are carried over — `model`, `n_macro_contacts`,
 * `contact_spacing_mm`, `contact_length_mm`. Manufacturer, material and diameters are seegprep's
 * business and would be bytes in every download for nothing.
 *
 * ## Usage
 *
 * ```sh
 * node scripts/gen-catalogue.mjs                       # regenerate from $SEEGPREP_MODELS or the default
 * node scripts/gen-catalogue.mjs --from path/to.json   # ... from a named file
 * node scripts/gen-catalogue.mjs --check               # verify the committed file against the pin
 * ```
 *
 * `--check` is what `pnpm run check` runs, and it works **offline and without a seegprep checkout**:
 * the pin's `generated` hash is a property of a file this repository owns, so a hand-edited
 * `src/catalogue.gen.ts` fails there. The pin's `source` hash is only checked when the source file
 * is actually present, which is the honest thing for a CI machine that has never seen seegprep.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const PIN = 'catalogue.pin.json';
const OUT = 'src/catalogue.gen.ts';
const DEFAULT_SOURCE =
  process.env['SEEGPREP_MODELS'] ?? '../seegprep/src/seegprep/data/electrode_models.json';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

const args = process.argv.slice(2);
const check = args.includes('--check');
const fromAt = args.indexOf('--from');
const source = fromAt >= 0 ? args[fromAt + 1] : DEFAULT_SOURCE;

/** The catalogue's entries, in `model` order, as the module's own shape. */
function entriesOf(raw) {
  const models = raw?.models;
  if (!Array.isArray(models)) throw new Error('the catalogue has no `models` array');
  const entries = models.map((m) => {
    const spacing = m['contact_spacing_mm'];
    if (typeof m['model'] !== 'string' || m['model'] === '') {
      throw new Error(`a model entry has no \`model\` key: ${JSON.stringify(m)}`);
    }
    const n = m['n_macro_contacts'];
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`${m['model']}: n_macro_contacts must be a positive integer`);
    }
    // A scalar pitch is expanded here rather than in the module: a module that had to know both
    // shapes would carry the branch into every reader of the table, and `gapsMm.length` is the one
    // invariant everything downstream leans on.
    let gaps;
    if (typeof spacing === 'number') gaps = Array.from({ length: n - 1 }, () => spacing);
    else if (Array.isArray(spacing)) gaps = spacing.map(Number);
    else throw new Error(`${m['model']}: contact_spacing_mm must be a number or a list`);
    if (gaps.length !== n - 1) {
      throw new Error(
        `${m['model']}: ${gaps.length} gaps for ${n} contacts (a list must be n − 1 long)`
      );
    }
    if (!gaps.every((g) => Number.isFinite(g) && g > 0)) {
      throw new Error(`${m['model']}: every gap must be a positive number`);
    }
    const length = m['contact_length_mm'];
    return {
      model: m['model'],
      nContacts: n,
      gapsMm: gaps,
      ...(typeof length === 'number' ? { contactLengthMm: length } : {}),
    };
  });
  entries.sort((a, b) => a.model.localeCompare(b.model));
  const seen = new Set();
  for (const entry of entries) {
    const key = entry.model.toUpperCase();
    if (seen.has(key)) throw new Error(`${entry.model}: two entries with the same model key`);
    seen.add(key);
  }
  return entries;
}

function render(entries, sourceName) {
  const rows = entries
    .map((e) => {
      const length = e.contactLengthMm === undefined ? '' : `, contactLengthMm: ${e.contactLengthMm}`;
      return `  { model: '${e.model}', nContacts: ${e.nContacts}, gapsMm: [${e.gapsMm.join(', ')}]${length} },`;
    })
    .join('\n');
  return `/**
 * GENERATED — do not edit. \`node scripts/gen-catalogue.mjs\`, from ${sourceName}.
 *
 * The depth-electrode gap table, bundled at build time so a module with no network and no seegprep
 * package data still knows how far apart an RD10R-SP05X's contacts are. \`catalogue.pin.json\`
 * carries the sha256 of the source it came from and of this file; \`pnpm run check\` re-asserts both.
 *
 * A scalar \`contact_spacing_mm\` is expanded to \`n − 1\` equal gaps here, so every reader
 * downstream sees one shape. Ordered tip-first: \`gapsMm[i]\` is the distance from contact \`i + 1\`
 * to contact \`i + 2\`.
 */

/** One catalogue model, as the module reads it. */
export interface CatalogueEntry {
  /** The canonical model key. Matched **case-insensitively, as a prefix** of a part number. */
  readonly model: string;
  readonly nContacts: number;
  /** \`nContacts − 1\` centre-to-centre gaps in millimetres, tip-first. */
  readonly gapsMm: readonly number[];
  /** The exposed recording-surface length, when the catalogue states one. */
  readonly contactLengthMm?: number;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
${rows}
];
`;
}

if (check) {
  if (!existsSync(PIN)) {
    console.error(`${PIN} is missing: run \`node scripts/gen-catalogue.mjs\` to create it.`);
    process.exit(1);
  }
  const pin = JSON.parse(readFileSync(PIN, 'utf8'));
  const generated = readFileSync(OUT, 'utf8');
  const got = sha256(generated);
  if (got !== pin.generated) {
    console.error(
      `${OUT}: sha256 ${got}, expected ${pin.generated}. It is generated — edit ` +
        `${pin.source.path} in seegprep and re-run \`node scripts/gen-catalogue.mjs\`.`
    );
    process.exit(1);
  }
  let sourceNote = 'source not present, not checked';
  if (existsSync(source)) {
    const raw = readFileSync(source, 'utf8');
    const sourceHash = sha256(raw);
    if (sourceHash !== pin.source.sha256) {
      console.error(
        `${source}: sha256 ${sourceHash}, expected ${pin.source.sha256} — seegprep's catalogue ` +
          `moved under the pin. Re-run \`node scripts/gen-catalogue.mjs --from ${source}\`.`
      );
      process.exit(1);
    }
    sourceNote = `source verified against ${source}`;
  }
  console.log(`${OUT}: ${pin.models} models, pin ok (${sourceNote})`);
  process.exit(0);
}

if (!existsSync(source)) {
  console.error(
    `${source} is not there. Point --from, or $SEEGPREP_MODELS, at seegprep's ` +
      'src/seegprep/data/electrode_models.json.'
  );
  process.exit(1);
}

const raw = readFileSync(source, 'utf8');
const entries = entriesOf(JSON.parse(raw));
const text = render(entries, 'seegprep’s src/seegprep/data/electrode_models.json');
writeFileSync(OUT, text);
writeFileSync(
  PIN,
  `${JSON.stringify(
    {
      $comment:
        'The depth-electrode gap table src/catalogue.gen.ts was generated from. seegprep owns the ' +
        'numbers; this repository owns the copy that ships inside the bundle, and the two hashes ' +
        'are what keep the copy honest. `node scripts/gen-catalogue.mjs --check` re-asserts them, ' +
        'and is part of `pnpm run check`.',
      schema: 1,
      source: { repo: 'seegprep', path: 'src/seegprep/data/electrode_models.json', sha256: sha256(raw) },
      generated: sha256(text),
      models: entries.length,
    },
    null,
    2
  )}\n`
);
console.log(`${OUT}: ${entries.length} models from ${source}`);
