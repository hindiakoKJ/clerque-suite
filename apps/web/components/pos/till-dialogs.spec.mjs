/**
 * Run: cd apps/web && node --test components/pos/till-dialogs.spec.mjs
 * The web app has no test runner; these read the components' source.
 *
 * Two things a re-walk of the till at 1024x600 found.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
/** The code and the words on screen, without comments. */
const code = (s) => s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('every till dialog says it has no description, so the screen reader stops warning', () => {
  // Radix warns "Missing Description or aria-describedby" for a DialogContent with neither.
  for (const f of ['PaymentModal.tsx', 'ReceiptModal.tsx', 'OpenShiftModal.tsx', 'PwdScModal.tsx', 'CloseShiftModal.tsx']) {
    const s = code(src(f));
    const contents = s.match(/<DialogContent\b[^>]*>/g) ?? [];
    assert.ok(contents.length > 0, `${f}: no DialogContent`);
    const first = contents[0];
    assert.ok(/aria-describedby=/.test(first) || /<DialogDescription\b/.test(s), `${f}: ${first}`);
  }
});

test('the GCash / PayMaya tab shows no pretend QR code', () => {
  const s = code(src('PaymentModal.tsx'));
  const tab = s.slice(s.indexOf('function BrandTab('));
  assert.ok(tab.length > 0);
  assert.doesNotMatch(tab, />\s*QR Code\s*</);
  assert.doesNotMatch(tab, /Show this QR/);
  assert.doesNotMatch(tab, /Your business/);
});
