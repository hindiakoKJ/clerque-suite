/**
 * Run: cd apps/web && node --test "app/pos/(pos)/dashboard/vat-line.spec.mjs"
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VAT_LINE_ROUTE, vatLineCard } from './vat-line.ts';

const nonVat = (grossSales) => ({
  applies: true, grossSales, line: 3_000_000, warnAt: 2_400_000, from: '2025-10-14', to: '2026-10-13',
});

test('the card asks the route the API really has', () => {
  assert.equal(VAT_LINE_ROUTE, '/reports/vat-line');
});

test('hidden under ₱2,400,000', () => {
  assert.equal(vatLineCard(nonVat(0)), null);
  assert.equal(vatLineCard(nonVat(2_399_999.99)), null);
});

test('amber from ₱2,400,000, saying how far along the shop is', () => {
  assert.deepEqual(vatLineCard(nonVat(2_400_000)), {
    tone: 'amber',
    headline: 'Sales in the last 12 months: ₱2,400,000 of the ₱3,000,000 VAT line',
    advice: null,
  });
  // Rounded down, so a shop just short of the line never reads as on it.
  assert.equal(vatLineCard(nonVat(2_999_999.6)).tone, 'amber');
  assert.match(vatLineCard(nonVat(2_999_999.6)).headline, /₱2,999,999 of the ₱3,000,000/);
});

test('red at or over ₱3,000,000, with what to do about it', () => {
  for (const sales of [3_000_000, 3_412_500.25]) {
    const card = vatLineCard(nonVat(sales));
    assert.equal(card.tone, 'red');
    assert.equal(card.advice, 'Talk to your bookkeeper about VAT registration (BIR Form 1905).');
  }
  assert.match(vatLineCard(nonVat(3_412_500.25)).headline, /₱3,412,500 of the ₱3,000,000 VAT line/);
});

test('a VAT-registered shop never sees it, nor does a page still loading', () => {
  assert.equal(vatLineCard({ applies: false }), null);
  assert.equal(vatLineCard(undefined), null);
  assert.equal(vatLineCard(null), null);
});

test('the dashboard asks only for the owner, and shows the card only for the owner', () => {
  const src = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8');
  assert.match(src, /api\.get\(VAT_LINE_ROUTE\)/);
  assert.match(src, /const isOwner = user\?\.role === 'BUSINESS_OWNER'/);
  assert.match(src, /enabled:\s*isOwner/);
  assert.match(src, /const vatCard = isOwner \? vatLineCard\(vatLine\) : null/);
});
