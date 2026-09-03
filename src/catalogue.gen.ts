/**
 * GENERATED — do not edit. `node scripts/gen-catalogue.mjs`, from seegprep’s src/seegprep/data/electrode_models.json.
 *
 * The depth-electrode gap table, bundled at build time so a module with no network and no seegprep
 * package data still knows how far apart an RD10R-SP05X's contacts are. `catalogue.pin.json`
 * carries the sha256 of the source it came from and of this file; `pnpm run check` re-asserts both.
 *
 * A scalar `contact_spacing_mm` is expanded to `n − 1` equal gaps here, so every reader
 * downstream sees one shape. Ordered tip-first: `gapsMm[i]` is the distance from contact `i + 1`
 * to contact `i + 2`.
 */

/** One catalogue model, as the module reads it. */
export interface CatalogueEntry {
  /** The canonical model key. Matched **case-insensitively, as a prefix** of a part number. */
  readonly model: string;
  readonly nContacts: number;
  /** `nContacts − 1` centre-to-centre gaps in millimetres, tip-first. */
  readonly gapsMm: readonly number[];
  /** The exposed recording-surface length, when the catalogue states one. */
  readonly contactLengthMm?: number;
}

export const CATALOGUE: readonly CatalogueEntry[] = [
  { model: '2102-08-091', nContacts: 8, gapsMm: [5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2 },
  { model: '2102-10-091', nContacts: 10, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2 },
  { model: '2102-12-091', nContacts: 12, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2 },
  { model: '2102-16-091', nContacts: 16, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2 },
  { model: 'BF08R-SP05X', nContacts: 8, gapsMm: [5, 5, 5, 5, 5, 5, 5], contactLengthMm: 1.57 },
  { model: 'BF08R-SP21X', nContacts: 8, gapsMm: [5, 5, 5, 5, 5, 5, 5], contactLengthMm: 1.57 },
  { model: 'BF10R-SP05X', nContacts: 10, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 1.57 },
  { model: 'BF10R-SP21X', nContacts: 10, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 1.57 },
  { model: 'D08-05AM', nContacts: 5, gapsMm: [3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'D08-08AM', nContacts: 8, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'D08-10AM', nContacts: 10, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'D08-12AM', nContacts: 12, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'D08-15AM', nContacts: 15, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'D08-15CM', nContacts: 15, gapsMm: [3.5, 3.5, 3.5, 3.5, 13, 3.5, 3.5, 3.5, 3.5, 13, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'D08-18AM', nContacts: 18, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'MM16C-SP05X', nContacts: 6, gapsMm: [5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'MM16D-SP05X', nContacts: 8, gapsMm: [5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'RD06R-SP05X', nContacts: 6, gapsMm: [5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'RD08R-SP04X', nContacts: 8, gapsMm: [4, 4, 4, 4, 4, 4, 4], contactLengthMm: 2.29 },
  { model: 'RD08R-SP05X', nContacts: 8, gapsMm: [5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'RD10R-SP03X', nContacts: 10, gapsMm: [3, 3, 3, 3, 3, 3, 3, 3, 3], contactLengthMm: 2.29 },
  { model: 'RD10R-SP04X', nContacts: 10, gapsMm: [4, 4, 4, 4, 4, 4, 4, 4, 4], contactLengthMm: 2.29 },
  { model: 'RD10R-SP05X', nContacts: 10, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'RD10R-SP06X', nContacts: 10, gapsMm: [6, 6, 6, 6, 6, 6, 6, 6, 6], contactLengthMm: 2.29 },
  { model: 'RD10R-SP07X', nContacts: 10, gapsMm: [7, 7, 7, 7, 7, 7, 7, 7, 7], contactLengthMm: 2.29 },
  { model: 'RD10R-SP08X', nContacts: 10, gapsMm: [8, 8, 8, 8, 8, 8, 8, 8, 8], contactLengthMm: 2.29 },
  { model: 'RD12R-SP05X', nContacts: 12, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'RD14R-SP05X', nContacts: 14, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'RD16R-SP05X', nContacts: 16, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.29 },
  { model: 'SD04R-AP58X', nContacts: 4, gapsMm: [2.2, 2.2, 2.2], contactLengthMm: 1.32 },
  { model: 'SD04R-SP05X', nContacts: 4, gapsMm: [5, 5, 5], contactLengthMm: 2.41 },
  { model: 'SD04R-SP10X', nContacts: 4, gapsMm: [10, 10, 10], contactLengthMm: 2.41 },
  { model: 'SD06R-AP58X', nContacts: 6, gapsMm: [2.2, 2.2, 2.2, 2.2, 2.2], contactLengthMm: 1.32 },
  { model: 'SD06R-SP05X', nContacts: 6, gapsMm: [5, 5, 5, 5, 5], contactLengthMm: 2.41 },
  { model: 'SD06R-SP10X', nContacts: 6, gapsMm: [10, 10, 10, 10, 10], contactLengthMm: 2.41 },
  { model: 'SD08R-AP58X', nContacts: 8, gapsMm: [2.2, 2.2, 2.2, 2.2, 2.2, 2.2, 2.2], contactLengthMm: 1.32 },
  { model: 'SD08R-SP05X', nContacts: 8, gapsMm: [5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.41 },
  { model: 'SD08R-SP10X', nContacts: 8, gapsMm: [10, 10, 10, 10, 10, 10, 10], contactLengthMm: 2.41 },
  { model: 'SD10R-SP05X', nContacts: 10, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.41 },
  { model: 'SD10R-SP10X', nContacts: 10, gapsMm: [10, 10, 10, 10, 10, 10, 10, 10, 10], contactLengthMm: 2.41 },
  { model: 'SD12R-SP05X', nContacts: 12, gapsMm: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5], contactLengthMm: 2.41 },
  { model: 'SDE-08-S08', nContacts: 8, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'SDE-08-S12', nContacts: 12, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
  { model: 'SDE-08-S16', nContacts: 16, gapsMm: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5, 3.5], contactLengthMm: 2 },
];
