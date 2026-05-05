/**
 * Build Clerque-Pricing-Draft-v1.pdf — a presentable, brand-themed PDF.
 *
 * Pure Node, no system dependencies (no LibreOffice / Word required).
 * Run: node scripts/build-pricing-pdf-direct.js
 *
 * Mirrors the content of the DOCX template — same structure, same data —
 * so you can hand the PDF to prospects and edit the DOCX as pricing evolves.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

// ── Brand palette ────────────────────────────────────────────────────────────
const C = {
  brown:      '#8B5E3C',
  brownDark:  '#6B3F1D',
  cream:      '#EEE9DF',
  creamLight: '#F7F4EE',
  textDark:   '#2C2018',
  textMuted:  '#6B7280',
  gold:       '#D4A574',
  tier4:      '#FFF4E0',
  border:     '#D9CFC0',
  white:      '#FFFFFF',
};

// ── Page ─────────────────────────────────────────────────────────────────────
const PAGE_W = 612;     // US Letter in points (8.5 × 72)
const PAGE_H = 792;     // 11 × 72
const MARGIN = 54;      // 0.75 inch
const CONTENT_W = PAGE_W - 2 * MARGIN;
const CONTENT_H = PAGE_H - 2 * MARGIN;

const doc = new PDFDocument({
  size: 'LETTER',
  margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
  info: {
    Title:    'Clerque Pricing Guide — Draft v1',
    Author:   'HNS Corporation Philippines',
    Subject:  'Pricing template for Clerque POS + Ledger + Payroll',
    Keywords: 'Clerque, POS, Pricing, MSME, Philippines',
  },
  bufferPages: true,
});

const outPath = path.join(__dirname, '..', 'Clerque-Pricing-Draft-v1.pdf');
doc.pipe(fs.createWriteStream(outPath));

// ── Helpers ──────────────────────────────────────────────────────────────────

// Track page-virginity to avoid double page breaks (a pageBreak() right after
// the table/card already overflowed onto a new page would otherwise produce
// an empty page).
let pageIsFresh = true;

function ensureSpace(needed) {
  const remaining = PAGE_H - MARGIN - doc.y;
  if (remaining < needed) {
    doc.addPage();
    pageIsFresh = true;
  } else if (doc.y > MARGIN + 4) {
    pageIsFresh = false;
  }
}

function pageBreak() {
  if (!pageIsFresh) {
    doc.addPage();
  }
  pageIsFresh = true;
}

function h1(text) {
  ensureSpace(60);
  doc.moveDown(0.3);
  doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(24).text(text, MARGIN, doc.y, { width: CONTENT_W });
  doc.moveDown(0.4);
}

function h2(text) {
  ensureSpace(45);
  doc.moveDown(0.5);
  doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(16).text(text, MARGIN, doc.y, { width: CONTENT_W });
  doc.moveDown(0.3);
}

function h3(text) {
  ensureSpace(35);
  doc.moveDown(0.3);
  doc.fillColor(C.textDark).font('Helvetica-Bold').fontSize(13).text(text, MARGIN, doc.y, { width: CONTENT_W });
  doc.moveDown(0.2);
}

function p(text, opts = {}) {
  doc.fillColor(opts.color || C.textDark)
     .font(opts.bold ? 'Helvetica-Bold' : (opts.italics ? 'Helvetica-Oblique' : 'Helvetica'))
     .fontSize(opts.size || 11)
     .text(text, MARGIN, doc.y, { width: CONTENT_W, align: opts.align || 'left', lineGap: 2 });
  doc.moveDown(opts.spaceAfter ?? 0.4);
}

function bullet(text, opts = {}) {
  const indent = 18;
  const startY = doc.y;
  doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(11).text('•', MARGIN + 4, startY);
  doc.fillColor(opts.color || C.textDark)
     .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
     .fontSize(11)
     .text(text, MARGIN + indent, startY, { width: CONTENT_W - indent, lineGap: 2 });
  doc.moveDown(0.2);
}

// Inline-styled bullet — accepts an array of [text, opts] segments
function bulletInline(segments, opts = {}) {
  const indent = 18;
  const startY = doc.y;
  doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(11).text('•', MARGIN + 4, startY);
  let firstSeg = true;
  for (const seg of segments) {
    const text = typeof seg === 'string' ? seg : seg[0];
    const o    = typeof seg === 'string' ? {}   : (seg[1] || {});
    doc.fillColor(o.color || C.textDark)
       .font(o.bold ? 'Helvetica-Bold' : (o.italics ? 'Helvetica-Oblique' : 'Helvetica'))
       .fontSize(11);
    if (firstSeg) {
      doc.text(text, MARGIN + indent, startY, { continued: !!o.continued, width: CONTENT_W - indent });
      firstSeg = false;
    } else {
      doc.text(text, { continued: !!o.continued });
    }
  }
  if (!doc._textOptions || doc._textOptions.continued !== false) doc.text('');
  doc.moveDown(0.2);
}

function rule(color = C.border, thickness = 0.5) {
  doc.strokeColor(color).lineWidth(thickness)
     .moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).stroke();
  doc.moveDown(0.3);
}

function spacer(amount = 0.5) { doc.moveDown(amount); }

// ── Tables ──────────────────────────────────────────────────────────────────

function table({ headers, rows, columnWidths, highlightRowIndex = -1 }) {
  const rowHeight = 28;
  const headerHeight = 30;
  const x0 = MARGIN;
  let y = doc.y;

  // Header
  ensureSpace(headerHeight + rowHeight * Math.min(rows.length, 4));
  y = doc.y;
  doc.rect(x0, y, CONTENT_W, headerHeight).fill(C.brown);
  let cx = x0;
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(10);
  headers.forEach((header, i) => {
    const w = columnWidths[i];
    doc.text(header, cx + 6, y + 10, { width: w - 12, align: 'center' });
    cx += w;
  });
  y += headerHeight;
  doc.y = y;

  // Body rows
  rows.forEach((row, rowIdx) => {
    if (doc.y + rowHeight > PAGE_H - MARGIN) {
      doc.addPage();
      y = doc.y;
    } else {
      y = doc.y;
    }
    const isHighlight = rowIdx === highlightRowIndex;
    const isZebra    = rowIdx % 2 === 1;
    const fill = isHighlight ? C.tier4 : (isZebra ? C.creamLight : C.white);
    doc.rect(x0, y, CONTENT_W, rowHeight).fill(fill);
    // Left highlight stripe for the recommended row
    if (isHighlight) {
      doc.rect(x0, y, 4, rowHeight).fill(C.gold);
    }
    cx = x0;
    row.forEach((cell, i) => {
      const w = columnWidths[i];
      const text = typeof cell === 'string' ? cell : cell.text;
      const align = (typeof cell === 'object' && cell.align) || 'left';
      const bold  = (typeof cell === 'object' && cell.bold)  || false;
      const color = (typeof cell === 'object' && cell.color) || (isHighlight ? C.brownDark : C.textDark);
      doc.fillColor(color)
         .font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(10)
         .text(text, cx + 6, y + 9, { width: w - 12, align });
      cx += w;
    });
    // Row border
    doc.strokeColor(C.border).lineWidth(0.5)
       .moveTo(x0, y + rowHeight).lineTo(x0 + CONTENT_W, y + rowHeight).stroke();
    doc.y = y + rowHeight;
  });

  doc.moveDown(0.6);
}

// Tier-detail card — colored title block + bullet list
function tierCard(tier, name, price, target, features, isPopular = false) {
  const titleHeight = isPopular ? 78 : 70;
  const featureHeight = features.length * 18 + 24;
  const totalHeight = titleHeight + featureHeight;
  ensureSpace(totalHeight + 20);

  const x0 = MARGIN;
  let y = doc.y;

  // Title block (colored background)
  const titleBg = isPopular ? C.tier4 : C.cream;
  doc.rect(x0, y, CONTENT_W, titleHeight).fill(titleBg);
  // Top accent bar
  doc.rect(x0, y, CONTENT_W, 4).fill(C.brown);

  // Tier code small caps
  doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(10)
     .text(tier, x0 + 16, y + 14, { width: CONTENT_W - 32, characterSpacing: 1.5 });

  // Tier name (large)
  doc.fillColor(isPopular ? C.brownDark : C.brown).font('Helvetica-Bold').fontSize(20)
     .text(name, x0 + 16, y + 28, { width: CONTENT_W - 32, lineBreak: false });

  // Most popular badge
  if (isPopular) {
    const popularText = '★ MOST POPULAR';
    doc.fillColor('#B45309').font('Helvetica-Bold').fontSize(9);
    const popularWidth = doc.widthOfString(popularText) + 12;
    doc.rect(x0 + CONTENT_W - 16 - popularWidth, y + 14, popularWidth, 18).fillAndStroke('#FEE2C8', '#F59E0B');
    doc.fillColor('#B45309').text(popularText, x0 + CONTENT_W - 16 - popularWidth + 6, y + 18.5);
  }

  // Price
  const priceY = y + 50;
  doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(22).text(price, x0 + 16, priceY, { lineBreak: false, continued: true });
  doc.fillColor(C.textMuted).font('Helvetica').fontSize(11).text('  /month', { continued: false });

  // Target line below
  if (isPopular) {
    doc.fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(10)
       .text(`Target: ${target}`, x0 + 16, y + titleHeight - 16, { width: CONTENT_W - 32 });
  } else {
    doc.fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(10)
       .text(`Target: ${target}`, x0 + 16, y + titleHeight - 16, { width: CONTENT_W - 32 });
  }

  y += titleHeight;

  // Features block (white background, bordered)
  doc.rect(x0, y, CONTENT_W, featureHeight).fillAndStroke(C.white, C.border);
  doc.lineWidth(0.5);
  doc.rect(x0, y, CONTENT_W, featureHeight).stroke(C.border);
  let fy = y + 12;
  features.forEach((feat) => {
    const isContinuation = feat.startsWith('Everything in');
    doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(11).text('✓', x0 + 16, fy);
    doc.fillColor(isContinuation ? C.textMuted : C.textDark)
       .font(isContinuation ? 'Helvetica-Oblique' : 'Helvetica')
       .fontSize(11)
       .text(feat, x0 + 32, fy, { width: CONTENT_W - 48 });
    fy += 18;
  });

  doc.y = y + featureHeight + 14;
}

// Promo card — header band + bullet list
function promoCard(title, description, items) {
  const itemsHeight = items.length * 18 + 18;
  const headerHeight = 52;
  const totalHeight = headerHeight + itemsHeight;
  ensureSpace(totalHeight + 16);

  const x0 = MARGIN;
  let y = doc.y;

  // Header
  doc.rect(x0, y, CONTENT_W, headerHeight).fill(C.cream);
  doc.rect(x0, y, CONTENT_W, 4).fill(C.brown);  // top accent

  doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(14)
     .text(title, x0 + 16, y + 14, { width: CONTENT_W - 32 });
  doc.fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(10)
     .text(description, x0 + 16, y + 32, { width: CONTENT_W - 32 });

  y += headerHeight;

  // Body
  doc.rect(x0, y, CONTENT_W, itemsHeight).fillAndStroke(C.white, C.border);
  doc.rect(x0, y, CONTENT_W, itemsHeight).stroke(C.border);
  let fy = y + 12;
  items.forEach((it) => {
    doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(11).text('✓', x0 + 16, fy);
    doc.fillColor(C.textDark).font('Helvetica').fontSize(11)
       .text(it, x0 + 32, fy, { width: CONTENT_W - 48 });
    fy += 18;
  });

  doc.y = y + itemsHeight + 14;
}

// Callout box (gold-bordered note)
function callout(parts) {
  ensureSpace(60);
  const x0 = MARGIN;
  const y = doc.y;
  // Compute height by drawing in a memory pass — we just use a fixed height based on text length
  const text = parts.map(p => p.text).join('');
  doc.font('Helvetica').fontSize(11);
  const textH = doc.heightOfString(text, { width: CONTENT_W - 36 });
  const h = textH + 24;

  doc.rect(x0, y, CONTENT_W, h).fillAndStroke(C.tier4, C.gold);
  doc.lineWidth(2);
  doc.moveTo(x0, y).lineTo(x0, y + h).stroke(C.gold);
  doc.lineWidth(0.5);

  let firstSeg = true;
  parts.forEach((seg) => {
    doc.fillColor(seg.color || C.textDark)
       .font(seg.bold ? 'Helvetica-Bold' : (seg.italics ? 'Helvetica-Oblique' : 'Helvetica'))
       .fontSize(11);
    if (firstSeg) {
      doc.text(seg.text, x0 + 18, y + 12, { width: CONTENT_W - 36, continued: !!seg.continued });
      firstSeg = false;
    } else {
      doc.text(seg.text, { continued: !!seg.continued });
    }
  });
  doc.y = y + h + 10;
}

// ── Page footer/header (drawn after content) ─────────────────────────────────

function drawHeaderFooter() {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    // Skip header/footer on cover page
    if (i === 0) continue;

    // Header
    doc.fillColor(C.textMuted).font('Helvetica').fontSize(8)
       .text('Clerque Pricing Guide  —  Draft v1',
             MARGIN, MARGIN / 2, { width: CONTENT_W, align: 'right' });

    // Footer rule
    doc.strokeColor(C.border).lineWidth(0.5)
       .moveTo(MARGIN, PAGE_H - MARGIN + 12).lineTo(MARGIN + CONTENT_W, PAGE_H - MARGIN + 12).stroke();

    // Footer text
    doc.fillColor(C.textMuted).font('Helvetica').fontSize(8)
       .text('HNS Corporation Philippines  •  clerque.hnscorpph.com',
             MARGIN, PAGE_H - MARGIN + 18, { width: CONTENT_W / 2 });
    doc.text(`Page ${i + 1} / ${range.count}`,
             MARGIN + CONTENT_W / 2, PAGE_H - MARGIN + 18, { width: CONTENT_W / 2, align: 'right' });
  }
}

// ── PAGE 1 — COVER ──────────────────────────────────────────────────────────

// Top accent
doc.rect(MARGIN, MARGIN + 60, 80, 4).fill(C.brown);

// Title block
doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(48)
   .text('Clerque', MARGIN, MARGIN + 100, { width: CONTENT_W });
doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(40)
   .text('Pricing Guide', MARGIN, doc.y, { width: CONTENT_W });

doc.moveDown(0.6);
doc.fillColor(C.brown).font('Helvetica').fontSize(20)
   .text('Draft v1 — May 2026', MARGIN, doc.y, { width: CONTENT_W });

doc.moveDown(0.4);
doc.fillColor(C.textMuted).font('Helvetica-Oblique').fontSize(15)
   .text('Built for Philippine MSMEs', MARGIN, doc.y, { width: CONTENT_W });

// Decorative coffee-themed accent
doc.moveDown(2);
const accentY = doc.y;
doc.rect(MARGIN, accentY, CONTENT_W, 1).fill(C.gold);
doc.rect(MARGIN, accentY + 6, CONTENT_W * 0.4, 1).fill(C.gold);

// Footer block
const coverFooterY = PAGE_H - MARGIN - 110;
doc.strokeColor(C.border).lineWidth(0.5)
   .moveTo(MARGIN, coverFooterY).lineTo(MARGIN + CONTENT_W, coverFooterY).stroke();

doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(13)
   .text('Clerque', MARGIN, coverFooterY + 14, { width: CONTENT_W });
doc.fillColor(C.textMuted).font('Helvetica').fontSize(11)
   .text('by HNS Corporation Philippines', MARGIN, doc.y);
doc.text('clerque.hnscorpph.com', MARGIN, doc.y);
doc.font('Helvetica-Oblique').fontSize(10).fillColor(C.textMuted)
   .text('Confidential — Draft', MARGIN, doc.y + 4);

pageBreak();

// ── PAGE 2 — Pricing Philosophy ─────────────────────────────────────────────

h1('Pricing Philosophy');
p('Three principles guide everything in this document.', { italics: true, color: C.textMuted, spaceAfter: 0.7 });

// Principle 1
doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(20).text('1.', MARGIN, doc.y, { lineBreak: false, continued: true });
doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(15).text('  Match the staff count, not the revenue.');
doc.moveDown(0.3);
p('A coffee shop owner shouldn’t fear succeeding. Our pricing scales with the team they hire, not the volume they sell. A busy week of latte sales doesn’t change what they pay us.', { spaceAfter: 0.7 });

// Principle 2
doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(20).text('2.', MARGIN, doc.y, { lineBreak: false, continued: true });
doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(15).text('  Predictable flat-fee tiers.');
doc.moveDown(0.3);
p('No surprise per-transaction fees. No locked-up data fees. No extraction. The tier they sign for is the price they pay every month.', { spaceAfter: 0.7 });

// Principle 3
doc.fillColor(C.brown).font('Helvetica-Bold').fontSize(20).text('3.', MARGIN, doc.y, { lineBreak: false, continued: true });
doc.fillColor(C.brownDark).font('Helvetica-Bold').fontSize(15).text('  Honest add-ons.');
doc.moveDown(0.3);
p('Things that genuinely cost us money (AI usage, extra branches) are charged transparently. Everything else is bundled into the tier. We don’t nickel-and-dime our customers.', { spaceAfter: 0.5 });

pageBreak();

// ── PAGE 3 — Subscription Tiers ─────────────────────────────────────────────

h1('Subscription Tiers');
p('Monthly recurring pricing. All prices in Philippine Pesos (₱) and exclusive of 12% VAT.', { italics: true, color: C.textMuted, spaceAfter: 0.5 });

table({
  headers: ['Tier', 'Name', 'Staff Cap', 'Floor Layout', 'Monthly', 'Setup Fee'],
  columnWidths: [70, 80, 90, 110, 80, 74],
  rows: [
    [
      { text: 'TIER_1', bold: true, align: 'center' }, { text: 'Solo', bold: true },
      '0 (owner only)', 'CS_1',
      { text: '₱599',   bold: true, align: 'right' }, { text: '₱2,500',  align: 'right' },
    ],
    [
      { text: 'TIER_2', bold: true, align: 'center' }, { text: 'Duo', bold: true },
      '1', 'CS_1 / CS_2',
      { text: '₱999',   bold: true, align: 'right' }, { text: '₱3,500',  align: 'right' },
    ],
    [
      { text: 'TIER_3', bold: true, align: 'center' }, { text: 'Trio', bold: true },
      '2–3', 'CS_1 — CS_3',
      { text: '₱1,799', bold: true, align: 'right' }, { text: '₱5,000',  align: 'right' },
    ],
    [
      { text: 'TIER_4', bold: true, align: 'center' }, { text: 'Squad ★', bold: true },
      '4–5', 'CS_1 — CS_4',
      { text: '₱2,999', bold: true, align: 'right' }, { text: '₱7,500',  align: 'right' },
    ],
    [
      { text: 'TIER_5', bold: true, align: 'center' }, { text: 'Team', bold: true },
      '6–10', 'CS_1 — CS_5',
      { text: '₱4,999', bold: true, align: 'right' }, { text: '₱12,000', align: 'right' },
    ],
    [
      { text: 'TIER_6', bold: true, align: 'center' }, { text: 'Multi', bold: true },
      'Unlimited', 'CS_1 — CS_5',
      { text: '₱8,999', bold: true, align: 'right' }, { text: '₱20,000', align: 'right' },
    ],
  ],
  highlightRowIndex: 3,
});

callout([
  { text: '★ Recommended:', bold: true, color: C.brownDark, continued: true },
  { text: '  TIER_4 (Squad) is the expected sweet spot for typical cafés — bar + kitchen + 2 cashier tablets. The setup fee is one-time and waivable during the launch promo.' },
]);

pageBreak();

// ── PAGES 4-5 — Tier Details ────────────────────────────────────────────────

h1('What Each Tier Includes');
p('Each tier is fully self-contained. Upgrading to a higher tier unlocks more features without losing access to anything below it.',
  { italics: true, color: C.textMuted, spaceAfter: 0.5 });

tierCard(
  'TIER_1', 'Solo', '₱599',
  'Sari-sari with espresso, food cart, owner-only kiosk',
  [
    'POS Counter — sell, print BIR-compliant receipts, offline mode',
    'Inventory — products + stock tracking',
    'Owner login (1 account)',
    'PWD/SC discounts, BIR Sales Invoice / OR',
    'Optional customer display',
  ]
);

tierCard(
  'TIER_2', 'Duo', '₱999',
  'Tiny café, 1 cashier + owner',
  [
    'Everything in TIER_1, plus:',
    '1 staff account (CASHIER role)',
    'Customer-facing display included',
    'POS Outstanding Sales (collect later)',
    'Cash Out / Paid In during shift',
  ]
);

tierCard(
  'TIER_3', 'Trio', '₱1,799',
  'Specialty coffee shop, 2–3 staff',
  [
    'Everything in TIER_2, plus:',
    '2–3 staff accounts',
    'Ledger (read-only) — Dashboard, Trial Balance, Chart of Accounts',
    'Time monitoring — clock in/out',
    '1 prep station (Bar) with KDS + Bar printer',
    'Inventory ingredients with BOM tracking',
  ]
);

pageBreak();

tierCard(
  'TIER_4', 'Squad', '₱2,999',
  'Café-restaurant hybrid, 4–5 staff',
  [
    'Everything in TIER_3, plus:',
    '4–5 staff accounts',
    'Full Ledger — Journal, Period Close, IS, BS, Cash Flow',
    'Multi-branch (up to 2)',
    'Multi-terminal (POS-01, POS-02 with per-terminal Z-Read)',
    '2 prep stations (Bar + Kitchen) with KDS + 2 station printers',
    'Customer Master + AR — invoices, aging, statements',
    'Vendor Master + AP — bills, payments, Net-30 workflow',
    'WAC or FIFO inventory costing',
  ],
  true
);

tierCard(
  'TIER_5', 'Team', '₱4,999',
  'Mid-size restaurant, 6–10 staff',
  [
    'Everything in TIER_4, plus:',
    '6–10 staff accounts',
    'Full Payroll — pay runs, payslips, SSS/PhilHealth/Pag-IBIG',
    'Multi-branch (up to 5)',
    '4 prep stations (Hot Bar / Cold Bar / Kitchen / Pastry Pass)',
    'Shared FIFO queue for multi-cashier setups',
  ]
);

pageBreak();

tierCard(
  'TIER_6', 'Multi', '₱8,999',
  'Multi-branch chain, franchise',
  [
    'Everything in TIER_5, plus:',
    'Unlimited staff',
    'Unlimited branches',
    'BIR forms — 2550Q, 1701Q, 2551Q, EWT, SAWT, EIS data export',
    'Audit log viewer with forensic search',
    'Priority support — same-business-day response',
    'White-label option (custom logo on receipts)',
  ]
);

pageBreak();

// ── Coffee Shop Floor Tiers ─────────────────────────────────────────────────

h1('Coffee Shop Floor Tiers (CS_1 — CS_5)');
p('The Coffee Shop floor tier is the physical layout of your operation — separate from the staff/subscription tier. It’s auto-suggested based on subscription tier and bounded by what each tier supports.', { spaceAfter: 0.4 });

callout([
  { text: 'Important:', bold: true, color: C.brownDark, continued: true },
  { text: '  The floor layout doesn’t add cost — it’s part of the subscription tier. CS_4 is included in TIER_4. CS_5 is included in TIER_5/6.' },
]);

table({
  headers: ['CS Tier', 'Layout', 'Available on'],
  columnWidths: [140, 244, 120],
  rows: [
    [
      { text: 'CS_1 Solo Counter', bold: true },
      '1 cashier tablet, no customer display',
      { text: 'TIER_1+', align: 'center' },
    ],
    [
      { text: 'CS_2 Counter + Customer Display', bold: true },
      '+ customer-facing tablet',
      { text: 'TIER_2+', align: 'center' },
    ],
    [
      { text: 'CS_3 Counter + Bar', bold: true },
      '+ bar KDS + bar printer',
      { text: 'TIER_3+', align: 'center' },
    ],
    [
      { text: 'CS_4 Bar + Kitchen', bold: true },
      '+ kitchen KDS + kitchen printer',
      { text: 'TIER_4+', align: 'center' },
    ],
    [
      { text: 'CS_5 Multi-Station', bold: true },
      'Hot/Cold bars + kitchen + pastry pass',
      { text: 'TIER_5+', align: 'center' },
    ],
  ],
});

pageBreak();

// ── Add-Ons ─────────────────────────────────────────────────────────────────

h1('Add-Ons');
p('Optional services that bolt onto any subscription tier.', { italics: true, color: C.textMuted, spaceAfter: 0.5 });

h2('AI Add-On');
p('For tenants who want AI-assisted features (Receipt OCR, Smart JE Picker, JE Drafter).');

table({
  headers: ['Package', 'Monthly Prompts', 'Price / month'],
  columnWidths: [160, 200, 144],
  rows: [
    [{ text: 'AI Lite',       bold: true }, '100 prompts',    { text: '₱250',          bold: true, align: 'right' }],
    [{ text: 'AI Plus',       bold: true }, '500 prompts',    { text: '₱600',          bold: true, align: 'right' }],
    [{ text: 'AI Pro',        bold: true }, '2,000 prompts',  { text: '₱1,400',        bold: true, align: 'right' }],
    [{ text: 'AI Enterprise', bold: true }, 'Custom',         { text: 'Contact sales', align: 'right' }],
  ],
});

p('A "prompt" = one AI-assisted action (a journal entry drafted, a receipt OCR’d, etc.). Most cafés stay under AI Lite.',
  { italics: true, color: C.textMuted, size: 10, spaceAfter: 0.5 });

h2('Extra Branches');
bullet('First 2 branches included on TIER_4, first 5 on TIER_5');
bullet('Beyond that: ₱500/mo per additional branch (TIER_4–5)');
bullet('Unlimited included on TIER_6');
spacer(0.4);

h2('Premium Support');
p('₱500/month — guaranteed 4-hour response time, weekend coverage. Available on any tier.');
p('Standard support is free on all tiers (business-hour reply, weekday only).', { spaceAfter: 0.4 });

h2('Custom Setup / Migration');
bullet('Migrating from another POS (Loyverse, Vend, etc.): ₱5,000 flat');
bullet('Customized Chart of Accounts for unusual industries: ₱3,000 flat');

pageBreak();

// ── Annual Pricing ──────────────────────────────────────────────────────────

h1('Annual Pricing — Save 10–15%');
p('Pay annually upfront and lock in 1–2 months free, depending on the tier.', { italics: true, color: C.textMuted, spaceAfter: 0.5 });

table({
  headers: ['Tier', 'Monthly × 12', 'Annual Prepay', 'Savings'],
  columnWidths: [110, 120, 120, 154],
  rows: [
    [
      { text: 'TIER_1 Solo',   bold: true },
      { text: '₱7,188',         align: 'right' },
      { text: '₱6,588',         bold: true, align: 'right', color: C.brownDark },
      'Save ₱600 (1 month free)',
    ],
    [
      { text: 'TIER_2 Duo',    bold: true },
      { text: '₱11,988',        align: 'right' },
      { text: '₱10,788',        bold: true, align: 'right', color: C.brownDark },
      'Save ₱1,200 (1.2 months free)',
    ],
    [
      { text: 'TIER_3 Trio',   bold: true },
      { text: '₱21,588',        align: 'right' },
      { text: '₱19,188',        bold: true, align: 'right', color: C.brownDark },
      'Save ₱2,400 (1.3 months free)',
    ],
    [
      { text: 'TIER_4 Squad ★', bold: true },
      { text: '₱35,988',        align: 'right' },
      { text: '₱30,588',        bold: true, align: 'right', color: C.brownDark },
      'Save ₱5,400 (1.8 months free)',
    ],
    [
      { text: 'TIER_5 Team',   bold: true },
      { text: '₱59,988',        align: 'right' },
      { text: '₱50,388',        bold: true, align: 'right', color: C.brownDark },
      'Save ₱9,600 (1.9 months free)',
    ],
    [
      { text: 'TIER_6 Multi',  bold: true },
      { text: '₱107,988',       align: 'right' },
      { text: '₱89,988',        bold: true, align: 'right', color: C.brownDark },
      'Save ₱18,000 (2 months free)',
    ],
  ],
  highlightRowIndex: 3,
});

pageBreak();

// ── Launch Promotions ───────────────────────────────────────────────────────

h1('Launch Promotions');
p('Limited-time offers to bring early adopters onto the platform.',
  { italics: true, color: C.textMuted, spaceAfter: 0.5 });

promoCard(
  'Founding Café Discount',
  'For the first 50 paying coffee shop tenants',
  [
    'Setup fee waived (save ₱2,500–₱20,000)',
    'First month free (monthly plan) OR 2 months free (annual)',
    'Lifetime 15% off the published price',
    'Listed as a "Founding Customer" on our website (opt-in)',
  ]
);

promoCard(
  'Switch From a Competitor',
  'For cafés migrating from Loyverse, Vend, or any other POS',
  [
    'Migration help included free (worth ₱5,000)',
    '3 months at 50% off after migration',
    'Conditions: must show invoice from prior provider; 3-month minimum commitment',
  ]
);

promoCard(
  'Educational / Non-Profit Rate',
  'Schools, NGOs, church-run cafés, social enterprises',
  [
    '50% off any tier, indefinitely',
    'Application required (we verify)',
    'Approval within 5 business days',
  ]
);

pageBreak();

// ── Free Trial & Demo ───────────────────────────────────────────────────────

h1('Free Trial & Demo');
p('Two paths to "try before you buy" — designed to remove friction.', { italics: true, color: C.textMuted, spaceAfter: 0.5 });

h2('Public Demo Tenant');
doc.fillColor(C.brownDark).font('Courier-Bold').fontSize(11)
   .text('clerque.hnscorpph.com/demo', MARGIN, doc.y);
doc.moveDown(0.3);
bullet('Pre-loaded with realistic café data; resets nightly at 3 AM PHT');
bullet('Full read + write functionality');
bullet('No signup, no email, no time limit');
bullet('Shared with all visitors (don’t enter sensitive data)');
spacer(0.5);

h2('Free 14-Day Trial');
p('A real account with the prospect’s own data.');
bulletInline([
  ['Sign up at '],
  ['/signup', { bold: true, color: C.brownDark }],
]);
bullet('Full TIER_4 access for 14 days (so they see everything we offer)');
bullet('After trial: pick a paid tier or downgrade to free archive (read-only forever)');
bulletInline([
  ['No credit card required upfront', { bold: true, color: C.brownDark }],
]);

pageBreak();

// ── Payment Methods ─────────────────────────────────────────────────────────

h1('Payment Methods');

h2('Initial Launch');
bullet('Bank transfer — BDO, BPI, Metrobank, UnionBank');
bullet('GCash business');
bullet('Maya business');
bullet('Manual invoicing for the first 6 months');
spacer(0.5);

h2('Phase 2 (after 50 paying tenants)');
bullet('Stripe / PayMongo for auto-charging');
bullet('Card on file with PCI-compliant tokenization');

pageBreak();

// ── Subscription Lifecycle ──────────────────────────────────────────────────

h1('Subscription Lifecycle');

table({
  headers: ['State', 'Meaning', 'Duration'],
  columnWidths: [110, 274, 120],
  rows: [
    [{ text: 'TRIAL',     bold: true, align: 'center' }, '14-day free trial', { text: '14 days', align: 'center' }],
    [{ text: 'ACTIVE',    bold: true, align: 'center' }, 'Paid, current', { text: 'Indefinite', align: 'center' }],
    [{ text: 'GRACE',     bold: true, align: 'center' }, 'Payment overdue 1–30 days, full access continues', { text: '30 days', align: 'center' }],
    [{ text: 'SUSPENDED', bold: true, align: 'center' }, '30+ days overdue, read-only access', { text: 'Until paid', align: 'center' }],
    [{ text: 'ARCHIVED',  bold: true, align: 'center' }, 'Cancelled — data preserved 1 year, then deleted', { text: '1 year', align: 'center' }],
  ],
});

callout([
  { text: 'Our promise:', bold: true, color: C.brownDark, continued: true },
  { text: '  We don’t lock out paying customers within 30 days of a missed payment. Bills get lost, banks delay, life happens — we give people the benefit of the doubt.', italics: true },
]);

pageBreak();

// ── Contact ─────────────────────────────────────────────────────────────────

doc.moveDown(2);
h1('Get in Touch');
p('We’d love to talk to you about how Clerque fits your business.',
  { italics: true, color: C.textMuted, spaceAfter: 1 });

h3('Pricing & Sales');
doc.fillColor(C.brownDark).font('Courier-Bold').fontSize(13).text('sales@hnscorpph.com', MARGIN, doc.y);
doc.moveDown(0.5);

h3('Technical Support');
doc.fillColor(C.brownDark).font('Courier-Bold').fontSize(13).text('support@hnscorpph.com', MARGIN, doc.y);
doc.moveDown(0.5);

h3('Partnerships');
doc.fillColor(C.brownDark).font('Courier-Bold').fontSize(13).text('partnerships@hnscorpph.com', MARGIN, doc.y);
doc.moveDown(0.5);

h3('Website');
doc.fillColor(C.brownDark).font('Courier-Bold').fontSize(13).text('clerque.hnscorpph.com', MARGIN, doc.y);
doc.moveDown(2);

rule();

doc.fillColor(C.textMuted).font('Helvetica').fontSize(9)
   .text('Clerque is operated by HNS Corporation Philippines.', MARGIN, doc.y);
doc.text('All prices in Philippine Pesos (₱) and exclusive of 12% VAT. Subject to change.');
doc.text('© 2026 HNS Corporation Philippines. All rights reserved.');

// Apply header/footer to all pages
drawHeaderFooter();

// Finalize
doc.end();
console.log('Wrote:', outPath);
