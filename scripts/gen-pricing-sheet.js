/**
 * Generates docs/Clerque-Counter-Pricing.pdf — a branded one-page pricing sheet
 * for the active Solo lineup. Prices are read from the canonical PLAN_CAPS in
 * shared-types (built dist) so this sheet can never drift from what the system
 * actually bills.
 *
 * Run: node scripts/gen-pricing-sheet.js
 * (pdfkit is a local dependency of apps/api; run from repo root.)
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { PLAN_CAPS } = require('../packages/shared-types/dist/plans.js');

const peso = (code) => Math.round(PLAN_CAPS[code].pricePhpMonthlyCents / 100);
const SOLO_PRICE  = peso('SOLO_PRO');    // ₱299 — full-access POS
const BOOKS_PRICE = peso('SOLO_BOOKS');  // ₱399 — full POS + simple ledger

// ── Brand palette ───────────────────────────────────────────────────────────
const C = {
  brown:     '#8B5E3C',
  brownDark: '#5C3D26',
  cream:     '#EEE9DF',
  creamLite: '#F7F4EE',
  ink:       '#2C2018',
  muted:     '#6B7280',
  gold:      '#C8A06A',
  white:     '#FFFFFF',
};

const PAGE_W = 612, PAGE_H = 792, M = 54;
const CONTENT_W = PAGE_W - 2 * M;

const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: M, bottom: M, left: M, right: M },
  info: { Title: 'Clerque Counter — Pricing', Author: 'Clerque' },
});

// Embed Arial so the ₱ peso glyph renders (PDFKit's built-in Helvetica lacks it).
const FONT  = 'C:/Windows/Fonts/arial.ttf';
const FONTB = 'C:/Windows/Fonts/arialbd.ttf';
doc.registerFont('A',  FONT);
doc.registerFont('AB', FONTB);

const outPath = path.join(__dirname, '..', 'docs', 'Clerque-Counter-Pricing.pdf');
doc.pipe(fs.createWriteStream(outPath));

// ── Header band ───────────────────────────────────────────────────────────────
doc.rect(0, 0, PAGE_W, 96).fill(C.brown);
doc.fillColor(C.white).font('AB').fontSize(26).text('Clerque Counter', M, 28);
doc.fillColor(C.cream).font('A').fontSize(12)
   .text('Pricing — full-access POS for Philippine cafés, bakeries & shops', M, 62);

let y = 128;
doc.fillColor(C.muted).font('A').fontSize(10)
   .text('Flat monthly price. No per-transaction fees. All prices in Philippine pesos, exclusive of 12% VAT.', M, y);
y += 28;

// ── Two plan cards ──────────────────────────────────────────────────────────
const gap = 20;
const cardW = (CONTENT_W - gap) / 2;
const cardH = 360;
const cardY = y;

function card(x, opts) {
  const { code, name, price, tagline, bullets, recommended } = opts;
  // Card body
  doc.roundedRect(x, cardY, cardW, cardH, 10)
     .fillAndStroke(recommended ? C.creamLite : C.white, recommended ? C.gold : C.cream);
  if (recommended) {
    doc.roundedRect(x, cardY, cardW, cardH, 10).lineWidth(2).stroke(C.gold);
    // Ribbon
    doc.roundedRect(x + cardW - 132, cardY - 11, 120, 22, 11).fill(C.gold);
    doc.fillColor(C.white).font('AB').fontSize(9)
       .text('RECOMMENDED', x + cardW - 132, cardY - 5, { width: 120, align: 'center' });
  }
  let cy = cardY + 22;
  doc.fillColor(C.brownDark).font('AB').fontSize(20).text(name, x + 20, cy);
  cy += 30;
  doc.fillColor(C.brown).font('AB').fontSize(30)
     .text(`₱${price.toLocaleString('en-PH')}`, x + 20, cy, { continued: true })
     .font('A').fontSize(12).fillColor(C.muted).text('  / month');
  cy += 44;
  doc.fillColor(C.ink).font('A').fontSize(11).text(tagline, x + 20, cy, { width: cardW - 40 });
  cy += 26;
  doc.moveTo(x + 20, cy).lineTo(x + cardW - 20, cy).lineWidth(0.75).stroke(C.cream);
  cy += 12;
  doc.font('A').fontSize(10).fillColor(C.ink);
  bullets.forEach((b) => {
    doc.fillColor(C.brown).text('✓', x + 20, cy, { continued: true, width: 14 });
    doc.fillColor(C.ink).text('  ' + b, { width: cardW - 48 });
    cy = doc.y + 6;
  });
}

card(M, {
  code: 'SOLO_PRO',
  name: 'Solo',
  price: SOLO_PRICE,
  tagline: 'Everything you need to sell, the complete point of sale.',
  bullets: [
    'Up to 5 users / cashiers',
    'Unlimited products, recipes & FEFO inventory',
    'GCash · Maya · QR Ph · card tendering',
    'BIR-compliant Z-read & receipts',
    'PWD / Senior discounts',
    'Audit log, custom roles & maker-checker',
    'Advanced reports & Loyalty Pro',
    'API read access + daily auto-backup',
  ],
});

card(M + cardW + gap, {
  code: 'SOLO_BOOKS',
  name: 'Solo Books',
  price: BOOKS_PRICE,
  tagline: 'Everything in Solo, plus simple bookkeeping.',
  recommended: true,
  bullets: [
    'Everything in Solo',
    'Record income & expenses',
    'See money owed from charge sales',
    'Simple income-vs-expense summary',
    'Cash & e-wallet settlement view',
    'Upgrade anytime for full accounting',
  ],
});

y = cardY + cardH + 28;

// ── Upgrade note ──────────────────────────────────────────────────────────────
doc.roundedRect(M, y, CONTENT_W, 64, 8).fill(C.cream);
doc.fillColor(C.brownDark).font('AB').fontSize(12)
   .text('Need full accounting?', M + 16, y + 12);
doc.fillColor(C.ink).font('A').fontSize(10)
   .text('Solo Books covers day-to-day bookkeeping. When you need double-entry journals, BIR forms (2550Q / 1701Q / 2551Q), financial statements, AR/AP and period close, upgrade to a full-accounting plan — your data carries over.',
     M + 16, y + 32, { width: CONTENT_W - 32 });

y += 88;
doc.fillColor(C.muted).font('A').fontSize(9)
   .text('Clerque · Built for Filipino businesses · clerque.cc · support@hnscorpph.com', M, y, { width: CONTENT_W, align: 'center' });

doc.end();
doc.on('end', () => {});
process.on('exit', () => console.log('Wrote', outPath));
