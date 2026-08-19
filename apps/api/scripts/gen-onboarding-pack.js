#!/usr/bin/env node
/**
 * Generates onboarding/Clerque-Onboarding-Pack.pdf (client-facing).
 *
 * Re-runnable:  node apps/api/scripts/gen-onboarding-pack.js
 * Uses the pdfkit already installed for apps/api (0.18). Plain ASCII only.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const OUT_DIR = path.resolve(__dirname, '../../../onboarding');
const OUT_FILE = path.join(OUT_DIR, 'Clerque-Onboarding-Pack.pdf');
const GENERATED = new Date().toISOString().slice(0, 10);
const SUPPORT_EMAIL = 'devsupport@hnscorpph.com';

// ── Palette ──────────────────────────────────────────────────────────────────
const INK = '#1f2937';
const MUTED = '#6b7280';
const ACCENT = '#7c4a1e'; // coffee brown
const RULE = '#d1d5db';
const HEAD_BG = '#f3f4f6';
const ZEBRA = '#fafafa';
const RED_BG = '#fef2f2';
const RED = '#b91c1c';
const GREEN_BG = '#f0fdf4';
const GREEN = '#166534';
const AMBER_BG = '#fffbeb';
const AMBER = '#92400e';

const PAGE = { size: 'A4', margin: 50 };
const doc = new PDFDocument({
  size: PAGE.size,
  margin: PAGE.margin,
  bufferPages: true,
  info: {
    Title: 'Clerque Onboarding Pack',
    Author: 'HNS Corporation Philippines',
    Subject: 'Coffee shop onboarding - details, import order, rules, limitations, BIR notes',
  },
});

const W = doc.page.width - PAGE.margin * 2;
const BOTTOM = doc.page.height - PAGE.margin;

// ── Helpers ──────────────────────────────────────────────────────────────────
function ensure(h) {
  if (doc.y + h > BOTTOM) doc.addPage();
}

function sectionTitle(t) {
  ensure(60);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(16).fillColor(ACCENT).text(t, { width: W });
  const y = doc.y + 4;
  doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + W, y).lineWidth(1).strokeColor(ACCENT).stroke();
  doc.y = y + 10;
  doc.fillColor(INK);
}

function subTitle(t) {
  ensure(40);
  doc.moveDown(0.4);
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(INK).text(t, { width: W });
  doc.moveDown(0.25);
}

function para(t, opts) {
  const o = Object.assign({ size: 10, color: INK, font: 'Helvetica', gap: 0.5 }, opts || {});
  doc.font(o.font).fontSize(o.size).fillColor(o.color);
  ensure(doc.heightOfString(t, { width: W }) + 4);
  doc.text(t, { width: W, align: 'left' });
  doc.moveDown(o.gap);
  doc.fillColor(INK);
}

function bullets(items, opts) {
  const o = Object.assign({ size: 10, indent: 14 }, opts || {});
  doc.font('Helvetica').fontSize(o.size).fillColor(INK);
  for (const it of items) {
    const h = doc.heightOfString(it, { width: W - o.indent });
    ensure(h + 4);
    const y = doc.y;
    doc.text('-', PAGE.margin, y, { width: o.indent, lineBreak: false });
    doc.text(it, PAGE.margin + o.indent, y, { width: W - o.indent });
    doc.moveDown(0.2);
  }
  doc.x = PAGE.margin;
  doc.moveDown(0.4);
}

function callout(title, body, tone) {
  const colors = { red: [RED_BG, RED], green: [GREEN_BG, GREEN], amber: [AMBER_BG, AMBER] }[tone || 'amber'];
  const pad = 10;
  doc.font('Helvetica-Bold').fontSize(10.5);
  const th = title ? doc.heightOfString(title, { width: W - pad * 2 }) + 4 : 0;
  doc.font('Helvetica').fontSize(10);
  const bh = doc.heightOfString(body, { width: W - pad * 2 });
  const h = th + bh + pad * 2;
  ensure(h + 6);
  const y = doc.y;
  doc.save();
  doc.rect(PAGE.margin, y, W, h).fillColor(colors[0]).fill();
  doc.rect(PAGE.margin, y, 3, h).fillColor(colors[1]).fill();
  doc.restore();
  let cy = y + pad;
  if (title) {
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(colors[1]).text(title, PAGE.margin + pad, cy, { width: W - pad * 2 });
    cy += th;
  }
  doc.font('Helvetica').fontSize(10).fillColor(INK).text(body, PAGE.margin + pad, cy, { width: W - pad * 2 });
  doc.x = PAGE.margin;
  doc.y = y + h + 10;
}

/**
 * Simple wrapped-cell table. cols: [{ label, width (fraction), bold? }], rows: string[][]
 */
function table(cols, rows, opts) {
  const o = Object.assign({ size: 9.5, pad: 5 }, opts || {});
  const widths = cols.map((c) => Math.floor(W * c.width));
  const xs = [];
  let x = PAGE.margin;
  for (const w of widths) { xs.push(x); x += w; }

  function rowHeight(cells, font) {
    let h = 0;
    cells.forEach((c, i) => {
      doc.font(cols[i].bold && font !== 'Helvetica-Bold' ? 'Helvetica-Bold' : font).fontSize(o.size);
      h = Math.max(h, doc.heightOfString(String(c), { width: widths[i] - o.pad * 2 }));
    });
    return h + o.pad * 2;
  }

  function drawRow(cells, font, bg, color) {
    const h = rowHeight(cells, font);
    if (doc.y + h > BOTTOM) { doc.addPage(); drawHeader(); }
    const y = doc.y;
    if (bg) { doc.save(); doc.rect(PAGE.margin, y, W, h).fillColor(bg).fill(); doc.restore(); }
    cells.forEach((c, i) => {
      doc.font(cols[i].bold && font !== 'Helvetica-Bold' ? 'Helvetica-Bold' : font).fontSize(o.size).fillColor(color);
      doc.text(String(c), xs[i] + o.pad, y + o.pad, { width: widths[i] - o.pad * 2 });
    });
    doc.moveTo(PAGE.margin, y + h).lineTo(PAGE.margin + W, y + h).lineWidth(0.5).strokeColor(RULE).stroke();
    doc.x = PAGE.margin;
    doc.y = y + h;
  }

  function drawHeader() {
    drawRow(cols.map((c) => c.label), 'Helvetica-Bold', HEAD_BG, INK);
  }

  ensure(rowHeight(cols.map((c) => c.label), 'Helvetica-Bold') + rowHeight(rows[0], 'Helvetica') + 4);
  drawHeader();
  rows.forEach((r, i) => drawRow(r, 'Helvetica', i % 2 ? ZEBRA : null, INK));
  doc.fillColor(INK);
  doc.moveDown(0.8);
}

// ── Cover ────────────────────────────────────────────────────────────────────
doc.y = 150;
doc.font('Helvetica-Bold').fontSize(30).fillColor(ACCENT).text('Clerque Onboarding Pack', { width: W });
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(14).fillColor(MUTED).text('Coffee Shop | Philippines | POS + Ledger', { width: W });
doc.moveDown(2);
doc.font('Helvetica').fontSize(11).fillColor(INK).text(
  'Prepared by HNS Corporation Philippines for the onboarding of our first Clerque client. ' +
  'This pack lists every detail we need from you, the order to load your data, the rules that keep the first import clean, ' +
  'and what Clerque is and is not for BIR purposes.',
  { width: W }
);
doc.moveDown(0.8);
doc.fontSize(10).fillColor(MUTED).text('All amounts are in Philippine Pesos (PHP). Generated ' + GENERATED + '.', { width: W });
doc.moveDown(2);
doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('Contents', { width: W });
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(10.5).fillColor(INK);
[
  'A. Details we need from you',
  'B. The order to load your data',
  'C. Rules that keep the import clean',
  'D. Known limitations (as of today)',
  'E. About your VAT question',
  'F. Go-live checklist',
  'G. Support',
  'H. What Clerque is and is not, for BIR purposes',
].forEach((l) => doc.text(l, { width: W, indent: 10 }));

// ── A ────────────────────────────────────────────────────────────────────────
doc.addPage();
sectionTitle('A. Details we need from you');
para('We cannot create your account until block A1 is complete. Everything in A2 can follow later.');

subTitle('A1. To create the account (required)');
table(
  [
    { label: 'Field', width: 0.24, bold: true },
    { label: 'What it means', width: 0.5 },
    { label: 'Example', width: 0.26 },
  ],
  [
    ['Registered business name', 'Exactly as printed on your BIR Certificate of Registration (Form 2303)', 'Juan Dela Cruz Coffee Co.'],
    ['Trade name', 'The name customers see on the receipt, if different', 'Kape Central'],
    ['Company code', 'Short code your staff type when signing in on the till app. Lowercase, no spaces', 'kapecentral'],
    ['Owner full name', 'The person who holds the owner login', 'Juan Dela Cruz'],
    ['Owner email', 'Used to log in and to reset the password', 'juan@kapecentral.ph'],
    ['BIR TIN', '000-000-000-000 or 000-000-000-00000, exactly as on your COR', '010-986-552-000'],
    ['VAT status', 'VAT-registered / Non-VAT / not yet BIR-registered. See Section E', 'VAT'],
    ['Registered address', 'As printed on your COR', 'Naga City, Camarines Sur'],
    ['Contact number', 'For support and account recovery', '0917-000-0000'],
  ]
);

subTitle('A2. To set up your shop (can follow)');
table(
  [
    { label: 'Item', width: 0.26, bold: true },
    { label: 'Notes', width: 0.74 },
  ],
  [
    ['Branches', 'Name of each outlet. One is fine to start.'],
    ['Staff', 'Name, role (cashier / manager) and email for everyone who will log in.'],
    ['Menu and prices', 'Every drink and food item with its selling price.'],
    ['Ingredients and costs', 'Beans, milk, syrups, cups, with cost per unit.'],
    ['Recipes', 'How much of each ingredient goes into each drink. This is what makes profit-per-cup real.'],
    ['Suppliers', 'Name, TIN, contact, payment terms.'],
    ['Opening balances', 'Your trial balance as of go-live day: cash, inventory, payables, capital.'],
    ['Receipt details', 'Anything BIR requires printed on your sales document: ATP / PTU number, MIN, serial range (see Section H).'],
  ]
);

// ── B ────────────────────────────────────────────────────────────────────────
doc.addPage();
sectionTitle('B. The order to load your data');
para(
  'Order matters. Recipes reference products and ingredients by name, so those must exist first. ' +
  'Loading out of order produces rows that fail with "not found".'
);
table(
  [
    { label: '#', width: 0.05, bold: true },
    { label: 'Load this', width: 0.3, bold: true },
    { label: 'Where', width: 0.3 },
    { label: 'What it creates', width: 0.35 },
  ],
  [
    ['1', 'Chart of Accounts (only if you need extra accounts)', 'Ledger > Chart of Accounts', 'About 196 PH-standard accounts are already built in. Most cafes need none.'],
    ['2', 'Products', 'POS > Products', 'Your menu items and prices.'],
    ['3', 'Ingredients', 'Template: Settings > Imports. We upload the filled file with you (no self-serve button yet).', 'Raw materials with cost per unit.'],
    ['4', 'Recipes', 'Template: Settings > Imports. We upload the filled file with you (no self-serve button yet).', 'Links each drink to its ingredients. Needs 2 and 3 first.'],
    ['5', 'Suppliers', 'Ledger > Vendors page (we open it with you)', 'Your suppliers.'],
    ['6', 'Customers (only if you sell on credit)', 'Ledger > Invoices > Customers', 'Charge accounts.'],
    ['7', 'Opening balances', 'Ledger > Journal > Trial Balance Import', 'Your starting financial position.'],
  ]
);
callout('Tip', 'Upload two or three rows first, check them on screen, then upload the rest.', 'green');

// ── C ────────────────────────────────────────────────────────────────────────
sectionTitle('C. Rules that keep the import clean');
callout(
  'About the example rows',
  'Example rows start with "SAMPLE - " and are ignored on import - leave them or delete them, either is safe. ' +
  'Add your real rows below.',
  'green'
);
subTitle('Filling in the cells');
bullets([
  'Amounts: commas and peso signs are fine. 1,250.50 and PHP 1,250.50 both import correctly.',
  'Dates: type them as YYYY-MM-DD (for example 2026-08-31). Other formats can be read as the wrong month.',
  'Do NOT use Excel formulas such as =600/250. Type the final number.',
  'Names must match exactly across files. "Whole Milk" in Ingredients must be spelled the same in Recipes.',
  'Keep the file as .xlsx. Saving the Setup Pack as .csv deletes every sheet but one.',
  'Do not add, remove or reorder columns. The importer reads them by position.',
  'For phone numbers and barcodes that start with zero, format the column as Text before typing.',
  'Give every product a Category (Coffee, Pastry, and so on). Categories drive drink-station tickets and your sales reports.',
]);

// ── D ────────────────────────────────────────────────────────────────────────
doc.addPage();
sectionTitle('D. Known limitations (as of today)');
para(
  'Stated up front so nothing surprises you mid-onboarding. The items below are still open and we will work around them together.'
);
table(
  [
    { label: 'Area', width: 0.2, bold: true },
    { label: 'What to know', width: 0.45 },
    { label: 'What we will do', width: 0.35 },
  ],
  [
    ['Sizes and add-ons', 'Recipes import at product level only. Small/Medium/Large or an extra-shot add-on cannot be imported.', 'Import the base drink, then set sizes and add-ons on screen with you.'],
    ['Opening stock', 'The Inventory import sets quantities but does not post them to the ledger, and covers products only, not ingredients.', 'We load the accounting side through the Trial Balance import.'],
    ['Re-uploading a file', 'Re-uploading a corrected Recipes file does not remove lines you deleted.', 'Tell us before re-uploading and we clear the old rows first.'],
    ['Opening balances', 'Use the Trial Balance import for opening balances. It checks your accounts and posts all-or-nothing.', 'We will run this one with you.'],
  ]
);

// ── E ────────────────────────────────────────────────────────────────────────
sectionTitle('E. About your VAT question');
para(
  'You asked whether we can pause the VAT charges. Two different questions are hiding in that, and they have different answers.'
);
subTitle('In the software');
para(
  'Yes. Clerque can run a shop as VAT-registered, Non-VAT, or not yet BIR-registered, and that changes what is computed ' +
  'and what prints on your receipt.'
);
subTitle('In law');
callout(
  'If you are VAT-registered with the BIR, VAT cannot simply be paused.',
  'While your registration says VAT, you are required to charge 12% output VAT, show it on your invoices and receipts, ' +
  'and file your VAT returns. Setting Clerque to Non-VAT while your BIR registration still says VAT would print ' +
  'non-compliant receipts and understate your output VAT. That exposure sits with you, not with the software.',
  'red'
);
subTitle('What you can actually do');
bullets([
  'Ask your accountant whether you should change your registration from VAT to Non-VAT. That is a BIR filing (Form 1905), not a settings toggle.',
  'It is generally only available if your gross sales for the past 12 months do not exceed PHP 3,000,000. If you registered for VAT voluntarily, a lock-in period normally applies before you may change.',
  'Non-VAT does not mean no tax. You would pay percentage tax on gross sales instead, and file that return.',
  'Until the BIR approves any change, we set your account to VAT so your receipts stay correct. We can switch it the day your 1905 is approved.',
]);
para(
  'This is general information, not tax advice. HNS Corp PH is not your licensed tax agent. Please confirm with your ' +
  'accountant or the BIR before deciding.',
  { size: 9, color: MUTED, font: 'Helvetica-Oblique' }
);

// ── F ────────────────────────────────────────────────────────────────────────
doc.addPage();
sectionTitle('F. Go-live checklist');
table(
  [
    { label: 'Step', width: 0.82 },
    { label: 'Who', width: 0.18, bold: true },
  ],
  [
    ['[ ] Send us the Section A1 details', 'You'],
    ['[ ] We create the account and send the owner login', 'HNS'],
    ['[ ] Confirm VAT status with your accountant (Section E)', 'You'],
    ['[ ] Fill the Products and Ingredients templates (example rows are skipped automatically)', 'You'],
    ['[ ] We import and review it with you on a screen share', 'Both'],
    ['[ ] Fill Recipes so profit-per-cup is correct', 'You'],
    ['[ ] Set drink sizes and add-ons on screen', 'Both'],
    ['[ ] Send your trial balance as of go-live day', 'You'],
    ['[ ] We load opening balances', 'HNS'],
    ['[ ] Add staff logins and set their roles', 'Both'],
    ['[ ] Keep issuing your existing BIR-registered sales documents (Section H)', 'You'],
    ['[ ] Test day: ring 10 real sales, close the shift, check the Z-read', 'You'],
    ['[ ] Review the first day of books together', 'Both'],
    ['[ ] Go live', 'Both'],
  ]
);

// ── G ────────────────────────────────────────────────────────────────────────
sectionTitle('G. Support');
para('HNS Corporation Philippines', { font: 'Helvetica-Bold', gap: 0.1 });
para('Email: ' + SUPPORT_EMAIL, { gap: 0.6 });
para(
  'Your Terms of Service, Privacy Policy, Data Processing Agreement and Refund & Cancellation Policy are available in the app under Legal.',
  { size: 9.5, color: MUTED }
);

// ── H ────────────────────────────────────────────────────────────────────────
doc.addPage();
sectionTitle('H. What Clerque is and is not, for BIR purposes');
para(
  'Plain-language summary of how Clerque behaves around BIR sales documents, so there is no confusion on go-live day.'
);

subTitle('1. Clerque prints the document that matches YOUR registration, not ours');
table(
  [
    { label: 'Your situation', width: 0.36, bold: true },
    { label: 'What Clerque prints at the till', width: 0.64 },
  ],
  [
    ['Not yet BIR-registered', 'Acknowledgement Receipt.'],
    ['BIR-registered, but Clerque is not yet authorised for your sales document (no ATP / PTU / MIN for it)',
      'Acknowledgement Receipt, marked "NOT A SALES INVOICE OR OFFICIAL RECEIPT - FOR INTERNAL MANAGEMENT USE ONLY".'],
    ['BIR-registered AND Clerque authorised for your sales document (PTU / MIN on file)',
      'Sales Invoice, with a VAT line if you are VAT-registered. We switch this on for you once your PTU / MIN is on file.'],
  ]
);

subTitle('2. On go-live you are in the middle case');
callout(
  'Keep issuing your existing BIR-registered sales documents exactly as today. Do not stop them.',
  'Clerque is your POS, inventory, recipe costing and books. The slip it prints is for your internal management use. ' +
  'Your customers must still receive your existing BIR-registered sales document (your current invoice / receipt series) for every sale.',
  'amber'
);

subTitle('3. Whose authority covers what');
bullets([
  'HNS Corporation Philippines\' own SEC / BIR registration covers HNS\'s invoice to you for the Clerque subscription. It does not authorise your till.',
  'Authority for YOUR sales document is yours to obtain from your RDO (ATP for printed documents, PTU / MIN for a computerised POS).',
  'When you decide to apply, we supply the system documentation the BIR asks for with your application.',
]);

subTitle('4. Books of accounts');
para(
  'If Clerque is to become your computerised books of accounts, that is a separate BIR registration (Acknowledgement Certificate / ' +
  'Computerised Accounting System path). It is not a go-live decision, and nothing in this pack starts it.'
);

doc.moveDown(0.5);
para(
  'This is general information, not tax advice. Please confirm with your accountant or your RDO. Invoicing rules changed under ' +
  'RA 11976 (Ease of Paying Taxes Act); what applies to you depends on your registration and your RDO\'s guidance.',
  { size: 9, color: MUTED, font: 'Helvetica-Oblique' }
);

// ── Footer on every page ──────────────────────────────────────────────────────
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
  // Footer sits inside the bottom margin; drop the margin so pdfkit does not auto-add a page.
  doc.page.margins.bottom = 0;
  doc.font('Helvetica').fontSize(8).fillColor(MUTED);
  doc.text(
    'Clerque Onboarding Pack  |  HNS Corporation Philippines  |  ' + SUPPORT_EMAIL + '  |  Page ' + (i + 1) + ' of ' + range.count,
    PAGE.margin,
    doc.page.height - 35,
    { width: W, align: 'center', lineBreak: false }
  );
}

// ── Write ────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT_DIR, { recursive: true });
const stream = fs.createWriteStream(OUT_FILE);
doc.pipe(stream);
doc.end();
stream.on('finish', () => {
  const size = fs.statSync(OUT_FILE).size;
  console.log('Wrote ' + OUT_FILE + ' (' + size + ' bytes, ' + range.count + ' pages)');
});
