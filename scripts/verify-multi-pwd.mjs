#!/usr/bin/env node
/**
 * Verifies the multi-PWD/SC math end-to-end.
 *
 * This duplicates the formulas from apps/web/lib/pos/utils.ts and the
 * vatAmount() logic from apps/web/store/pos/cart.ts so we can assert
 * the totals without booting the full Next.js / Zustand stack.
 *
 * Run: node scripts/verify-multi-pwd.mjs
 */

// ── Re-implement the formulas (kept in sync with lib/pos/utils.ts) ───────────

function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function computeVat(amountInclusive) {
  const base = round2(amountInclusive / 1.12);
  const vat  = round2(amountInclusive - base);
  return { base, vat };
}

function computePwdScDiscountVat(totalVatInclusive) {
  const vatExclusiveBase       = round2(totalVatInclusive / 1.12);
  const discountOnBase         = round2(vatExclusiveBase * 0.2);
  const discountedVatExclusive = round2(vatExclusiveBase * 0.8);
  const vatOnDiscounted        = round2(discountedVatExclusive * 0.12);
  const discountedTotal        = round2(discountedVatExclusive + vatOnDiscounted);
  const totalSavings           = round2(totalVatInclusive - discountedTotal);
  return { vatExclusiveBase, discountOnBase, vatOnDiscounted, discountedTotal, totalSavings };
}

function computePwdScDiscountNonVat(grossTotal) {
  const discountOnBase  = round2(grossTotal * 0.2);
  const discountedTotal = round2(grossTotal * 0.8);
  return {
    vatExclusiveBase: round2(grossTotal),
    discountOnBase,
    vatOnDiscounted:  0,
    discountedTotal,
    totalSavings:     discountOnBase,
  };
}

function computeDiscount(gross, taxStatus) {
  return taxStatus === 'VAT' ? computePwdScDiscountVat(gross) : computePwdScDiscountNonVat(gross);
}

// ── Cart vatAmount() — replicates the store's multi-PWD logic ────────────────

function cartVatAmount({ lines, orderDiscount, additionalEntries, taxStatus }) {
  if (taxStatus !== 'VAT') return 0;
  const isPwdSc = orderDiscount?.type === 'PWD' || orderDiscount?.type === 'SENIOR_CITIZEN';

  if (isPwdSc && orderDiscount) {
    const claimed = new Set([
      ...(orderDiscount.selectedLineKeys ?? []),
      ...additionalEntries.flatMap((e) => e.selectedLineKeys ?? []),
    ]);

    if (claimed.size === 0 && additionalEntries.length === 0) {
      return orderDiscount.vatOnDiscounted + (orderDiscount.vatOnUnselected ?? 0);
    }

    const unclaimedVatableSubtotal = lines
      .filter((l) => l.isVatable && !claimed.has(l.lineKey))
      .reduce((s, l) => s + (l.unitPrice - l.itemDiscount) * l.quantity, 0);
    const vatOnUnclaimed = unclaimedVatableSubtotal > 0
      ? computeVat(unclaimedVatableSubtotal).vat
      : 0;
    const additionalVatOnDiscounted = additionalEntries.reduce((s, e) => s + e.vatOnDiscounted, 0);
    return orderDiscount.vatOnDiscounted + additionalVatOnDiscounted + vatOnUnclaimed;
  }

  // Non-PWD path (proportional vat reduction) — not exercised in this script
  const fullSubtotal = lines.reduce((s, l) => s + (l.unitPrice - l.itemDiscount) * l.quantity, 0);
  const vatableSubtotal = lines.filter((l) => l.isVatable)
    .reduce((s, l) => s + (l.unitPrice - l.itemDiscount) * l.quantity, 0);
  if (vatableSubtotal === 0) return 0;
  const discountOnBase = orderDiscount?.discountOnBase ?? 0;
  const discountRatio = fullSubtotal > 0 ? (fullSubtotal - discountOnBase) / fullSubtotal : 1;
  return computeVat(round2(vatableSubtotal * discountRatio)).vat;
}

// ── Assertion helpers ────────────────────────────────────────────────────────

let passes = 0;
let failures = 0;
const results = [];

function approxEq(a, b, eps = 0.01) {
  return Math.abs(a - b) <= eps;
}

function assert(label, actual, expected, eps = 0.01) {
  const ok = typeof expected === 'number' ? approxEq(actual, expected, eps) : actual === expected;
  if (ok) {
    passes++;
    results.push(`  ✅ ${label}: ${actual}`);
  } else {
    failures++;
    results.push(`  ❌ ${label}: expected ${expected}, got ${actual}`);
  }
}

function section(name) {
  results.push(`\n── ${name} ────────────────────────────────────────`);
}

// ─── SCENARIO 1: Single PWD on a VAT cart (regression — should match before) ──

section('SCENARIO 1 — Single PWD, all items, VAT cart');
{
  const lines = [
    { lineKey: 'L1', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },
  ];
  const taxStatus = 'VAT';
  const fullSubtotal = 150;
  const d = computeDiscount(fullSubtotal, taxStatus);

  const orderDiscount = {
    type: 'SENIOR_CITIZEN',
    vatExclusiveBase: d.vatExclusiveBase,
    discountOnBase:   d.discountOnBase,
    vatOnDiscounted:  d.vatOnDiscounted,
    vatOnUnselected:  0,
    totalSavings:     d.totalSavings,
    selectedLineKeys: [],  // legacy "covers entire cart" path
  };
  const vat = cartVatAmount({ lines, orderDiscount, additionalEntries: [], taxStatus });
  const grand = fullSubtotal - orderDiscount.totalSavings;

  assert('vatExclusiveBase',  d.vatExclusiveBase, 133.93);
  assert('discountOnBase',    d.discountOnBase,    26.79);
  assert('vatOnDiscounted',   d.vatOnDiscounted,   12.86);
  assert('totalSavings',      d.totalSavings,      30.00);
  assert('cart vatAmount',    vat,                 12.86);
  assert('grandTotal',        grand,              120.00);
}

// ─── SCENARIO 2: Two seniors share a 4-item cart, each claims 2 items ────────

section('SCENARIO 2 — 2 seniors share 4 items × ₱150 (₱600 total), each claims 2');
{
  const lines = [
    { lineKey: 'L1', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },
    { lineKey: 'L2', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },
    { lineKey: 'L3', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },
    { lineKey: 'L4', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },
  ];
  const taxStatus = 'VAT';
  const fullSubtotal = 600;

  // First PWD claims L1, L2 (₱300)
  const d1 = computeDiscount(300, taxStatus);
  const orderDiscount = {
    type: 'SENIOR_CITIZEN',
    vatExclusiveBase: d1.vatExclusiveBase,
    discountOnBase:   d1.discountOnBase,
    vatOnDiscounted:  d1.vatOnDiscounted,
    vatOnUnselected:  0,
    totalSavings:     d1.totalSavings,
    selectedLineKeys: ['L1', 'L2'],
  };

  // Second PWD claims L3, L4 (₱300)
  const d2 = computeDiscount(300, taxStatus);
  const additional = [{
    type: 'SENIOR_CITIZEN',
    selectedLineKeys: ['L3', 'L4'],
    selectedSubtotal: 300,
    discountOnBase:   d2.discountOnBase,
    vatExclusiveBase: d2.vatExclusiveBase,
    vatOnDiscounted:  d2.vatOnDiscounted,
    totalSavings:     d2.totalSavings,
  }];

  const vat = cartVatAmount({ lines, orderDiscount, additionalEntries: additional, taxStatus });
  const totalDiscount = orderDiscount.discountOnBase + additional.reduce((s, e) => s + e.discountOnBase, 0);
  const totalSavings  = orderDiscount.totalSavings   + additional.reduce((s, e) => s + e.totalSavings,   0);
  const grand = fullSubtotal - totalSavings;

  assert('PWD#1 vatExclusiveBase',  d1.vatExclusiveBase, 267.86);
  assert('PWD#1 discountOnBase',    d1.discountOnBase,    53.57);
  assert('PWD#1 vatOnDiscounted',   d1.vatOnDiscounted,   25.71);
  assert('PWD#1 totalSavings',      d1.totalSavings,      60.00);

  assert('PWD#2 totalSavings',      d2.totalSavings,      60.00);

  assert('cart vatAmount (= 2 × 25.71)',  vat,           51.43, 0.02);
  assert('cart total discount (2 × 53.57)', totalDiscount, 107.14);
  assert('cart total savings (2 × 60.00)',  totalSavings,  120.00);
  assert('grandTotal (600 − 120)',          grand,         480.00);
}

// ─── SCENARIO 3: 2 PWDs claim only PART of cart, rest at full VAT ────────────

section('SCENARIO 3 — 2 PWDs claim 2 of 4 items; remaining 2 pay full VAT');
{
  const lines = [
    { lineKey: 'L1', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },  // claimed by PWD#1
    { lineKey: 'L2', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },  // claimed by PWD#2
    { lineKey: 'L3', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },  // unclaimed
    { lineKey: 'L4', isVatable: true, unitPrice: 150, itemDiscount: 0, quantity: 1 },  // unclaimed
  ];
  const taxStatus = 'VAT';

  const d1 = computeDiscount(150, taxStatus);
  const orderDiscount = {
    type: 'SENIOR_CITIZEN',
    vatExclusiveBase: d1.vatExclusiveBase,
    discountOnBase:   d1.discountOnBase,
    vatOnDiscounted:  d1.vatOnDiscounted,
    vatOnUnselected:  0,
    totalSavings:     d1.totalSavings,
    selectedLineKeys: ['L1'],
  };

  const d2 = computeDiscount(150, taxStatus);
  const additional = [{
    type: 'SENIOR_CITIZEN',
    selectedLineKeys: ['L2'],
    selectedSubtotal: 150,
    discountOnBase:   d2.discountOnBase,
    vatExclusiveBase: d2.vatExclusiveBase,
    vatOnDiscounted:  d2.vatOnDiscounted,
    totalSavings:     d2.totalSavings,
  }];

  // Unclaimed: L3 + L4 = ₱300 → VAT = 300 - (300/1.12) = ₱32.14
  const expectedUnclaimedVat = round2(300 - round2(300 / 1.12));

  const vat = cartVatAmount({ lines, orderDiscount, additionalEntries: additional, taxStatus });
  // Expected: PWD#1 vatOnDiscounted (12.86) + PWD#2 vatOnDiscounted (12.86) + 32.14 unclaimed
  const expectedVat = d1.vatOnDiscounted + d2.vatOnDiscounted + expectedUnclaimedVat;

  assert('expected unclaimed VAT', expectedUnclaimedVat, 32.14);
  assert('cart vatAmount', vat, expectedVat, 0.02);
}

// ─── SCENARIO 4: 5-PWD cap (boundary case) ───────────────────────────────────

section('SCENARIO 4 — 5 PWDs claim 5 separate items (cap enforced upstream)');
{
  const lines = Array.from({ length: 5 }, (_, i) => ({
    lineKey: `L${i + 1}`,
    isVatable: true,
    unitPrice: 100,
    itemDiscount: 0,
    quantity: 1,
  }));
  const taxStatus = 'VAT';

  // PWD#1 in orderDiscount + 4 in additional = 5 total
  const d1 = computeDiscount(100, taxStatus);
  const orderDiscount = {
    type: 'PWD',
    vatExclusiveBase: d1.vatExclusiveBase,
    discountOnBase:   d1.discountOnBase,
    vatOnDiscounted:  d1.vatOnDiscounted,
    vatOnUnselected:  0,
    totalSavings:     d1.totalSavings,
    selectedLineKeys: ['L1'],
  };
  const additional = ['L2', 'L3', 'L4', 'L5'].map((key) => {
    const d = computeDiscount(100, taxStatus);
    return {
      type: 'PWD',
      selectedLineKeys: [key],
      selectedSubtotal: 100,
      discountOnBase:   d.discountOnBase,
      vatExclusiveBase: d.vatExclusiveBase,
      vatOnDiscounted:  d.vatOnDiscounted,
      totalSavings:     d.totalSavings,
    };
  });

  const totalSavings = orderDiscount.totalSavings + additional.reduce((s, e) => s + e.totalSavings, 0);
  const grand = 500 - totalSavings;
  const vat = cartVatAmount({ lines, orderDiscount, additionalEntries: additional, taxStatus });
  // 5 × vatOnDiscounted (each = 10.71) + 0 unclaimed = 53.57
  // Note: each ₱100 item discounted = ₱100 / 1.12 × 0.8 × 0.12 = ~8.57
  //       Wait, recheck: 100 / 1.12 = 89.29, × 0.8 = 71.43, × 0.12 = 8.57
  const expectedPerVat = round2(round2(100 / 1.12) * 0.8 * 0.12);

  assert('PWD#1 vatOnDiscounted (₱100 item)', d1.vatOnDiscounted, expectedPerVat);
  assert('total VAT (5 × per)',                vat,               5 * expectedPerVat, 0.05);
  assert('total savings (5 × per)',            totalSavings,      5 * d1.totalSavings, 0.02);
  assert('grandTotal',                         grand,             500 - 5 * d1.totalSavings, 0.05);
}

// ─── SCENARIO 5: Non-VAT tenant — VAT calc must short-circuit to 0 ───────────

section('SCENARIO 5 — Non-VAT tenant with multiple PWDs (vat = 0)');
{
  const lines = [
    { lineKey: 'L1', isVatable: false, unitPrice: 50, itemDiscount: 0, quantity: 1 },
    { lineKey: 'L2', isVatable: false, unitPrice: 50, itemDiscount: 0, quantity: 1 },
  ];
  const taxStatus = 'NON_VAT';
  const d1 = computeDiscount(50, taxStatus);
  const orderDiscount = {
    type: 'PWD',
    vatExclusiveBase: d1.vatExclusiveBase,
    discountOnBase:   d1.discountOnBase,
    vatOnDiscounted:  0,
    vatOnUnselected:  0,
    totalSavings:     d1.totalSavings,
    selectedLineKeys: ['L1'],
  };
  const additional = [{
    type: 'PWD',
    selectedLineKeys: ['L2'],
    selectedSubtotal: 50,
    discountOnBase:   d1.discountOnBase,
    vatExclusiveBase: d1.vatExclusiveBase,
    vatOnDiscounted:  0,
    totalSavings:     d1.totalSavings,
  }];

  const vat = cartVatAmount({ lines, orderDiscount, additionalEntries: additional, taxStatus });
  assert('non-VAT cart vatAmount = 0', vat, 0);
  assert('non-VAT discountOnBase = 20% of gross', d1.discountOnBase, 10);
  assert('non-VAT totalSavings = 10', d1.totalSavings, 10);
}

// ─── Print results ───────────────────────────────────────────────────────────

console.log(results.join('\n'));
console.log(`\n${'─'.repeat(60)}`);
if (failures === 0) {
  console.log(`✅ ALL ${passes} ASSERTIONS PASSED`);
  process.exit(0);
} else {
  console.log(`❌ ${failures} FAILURE(S), ${passes} pass(es)`);
  process.exit(1);
}
