/**
 * A test run that skipped something is not a green run here.
 *
 * The suites that execute the shared contacts kit skip when the kit is absent (`test/setup.ts`),
 * which is the right behaviour for a developer with no Tetravox checkout and the wrong one for CI:
 * a build whose skipped half was the shaft geometry and the scene block would be green and would
 * mean nothing. So CI runs `scripts/fetch-contacts.mjs` first and then this, and a skip is a
 * failure that names itself.
 */

import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2] ?? '.build/vitest.json', 'utf8'));
const { numPassedTests = 0, numPendingTests = 0, numTodoTests = 0, numFailedTests = 0 } = report;

if (numFailedTests > 0) {
  console.error(`${numFailedTests} failed`);
  process.exit(1);
}
if (numPendingTests + numTodoTests > 0) {
  console.error(
    `${numPendingTests + numTodoTests} test(s) skipped — run scripts/fetch-contacts.mjs, or set ` +
      'TETRAVOX_CONTACTS, so the suites that execute the shared contacts kit actually run'
  );
  process.exit(1);
}

console.log(`${numPassedTests} tests, none skipped`);
