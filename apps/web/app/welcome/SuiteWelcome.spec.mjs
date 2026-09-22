/**
 * Run: cd apps/web && node --test app/welcome/SuiteWelcome.spec.mjs
 *
 * The welcome page is JSX, which plain Node cannot load, so this reads the
 * source and pins the rules written at the top of SuiteWelcome.tsx: no price,
 * no "coming soon", no mangled dash, and "Talk to us" goes to the one support
 * mailbox. The two route files must render it and nothing else.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** The source without its comments: the comments may tell the history ("used to print …"). */
function code(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

const page   = code(readFileSync(new URL('./SuiteWelcome.tsx', import.meta.url), 'utf8'));
const pos    = code(readFileSync(new URL('./pos/page.tsx', import.meta.url), 'utf8'));
const ledger = code(readFileSync(new URL('./ledger/page.tsx', import.meta.url), 'utf8'));

describe('/welcome: what Clerque is for, and no price', () => {
  test('prints no peso amount and no price label', () => {
    for (const src of [page, pos, ledger]) {
      assert.doesNotMatch(src, /₱|PHP\s?\d|\/mo\b|per month|pricePhp|PLAN_CAPS/i);
      assert.doesNotMatch(src, /pricing coming soon|coming soon/i);
    }
  });
  test('no literal dash placeholder or mangled em dash', () => {
    for (const src of [page, pos, ledger]) {
      assert.doesNotMatch(src, /â€"|â/);
      assert.doesNotMatch(src, />\s*[-–—]\s*</); // a bare dash as the only text of an element
    }
  });
  test('says it is the full suite with a bookkeeper included, and how to reach us', () => {
    assert.match(page, /bookkeeper included/i);
    assert.match(page, /Procure/);
    assert.match(page, /Ledger/);
    assert.match(page, /POS/);
    assert.match(page, /supportMailto\(/);
    assert.match(page, /SUPPORT_EMAIL/);
    assert.doesNotMatch(page, /mailto:[a-z]/i); // no hard-coded address
  });
  test('both routes render the shared page', () => {
    assert.match(pos, /<SuiteWelcome focus="counter" \/>/);
    assert.match(ledger, /<SuiteWelcome focus="books" \/>/);
  });
});
