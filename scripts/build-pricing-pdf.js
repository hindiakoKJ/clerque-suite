/**
 * Builds Clerque-Pricing-Draft-v1.docx — a presentable, editable pricing template.
 *
 * Run with: node scripts/build-pricing-pdf.js
 *
 * Output: ./Clerque-Pricing-Draft-v1.docx (and a PDF if LibreOffice is available)
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  TabStopType, TabStopPosition,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  VerticalAlign, PageNumber, PageBreak,
} = require('docx');

// ── Brand palette ────────────────────────────────────────────────────────────
const BRAND_BROWN     = '8B5E3C';
const BRAND_BROWN_DARK = '6B3F1D';
const BRAND_CREAM     = 'EEE9DF';
const BRAND_CREAM_LIGHT = 'F7F4EE';
const TEXT_DARK       = '2C2018';
const TEXT_MUTED      = '6B7280';
const ACCENT_GOLD     = 'D4A574';
const TIER4_HIGHLIGHT = 'FFF4E0';
const BORDER_LIGHT    = 'D9CFC0';

// ── Layout constants (DXA: 1440 = 1 inch) ────────────────────────────────────
const PAGE_W   = 12240;  // US Letter
const PAGE_H   = 15840;
const MARGIN   = 1080;   // 0.75 inch margins for more content space
const CONTENT_W = PAGE_W - 2 * MARGIN;

// ── Helpers ──────────────────────────────────────────────────────────────────

function txt(text, opts = {}) {
  return new TextRun({
    text,
    font:   opts.font  || 'Calibri',
    size:   opts.size  || 22,         // half-points (11pt default)
    bold:   opts.bold  || false,
    color:  opts.color || TEXT_DARK,
    italics: opts.italics || false,
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after ?? 120, before: opts.before ?? 0, line: opts.line ?? 320 },
    alignment: opts.alignment ?? AlignmentType.LEFT,
    children: Array.isArray(text) ? text : [txt(text, opts)],
  });
}

function h1(text, opts = {}) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 200 },
    children: [new TextRun({ text, font: 'Calibri', size: 36, bold: true, color: BRAND_BROWN_DARK })],
    ...opts,
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 320, after: 160 },
    children: [new TextRun({ text, font: 'Calibri', size: 28, bold: true, color: BRAND_BROWN })],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: 'Calibri', size: 24, bold: true, color: TEXT_DARK })],
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 80 },
    children: Array.isArray(text) ? text : [txt(text, opts)],
  });
}

function spacer(after = 200) {
  return new Paragraph({ spacing: { after }, children: [new TextRun({ text: '' })] });
}

const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT };
const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

function tableHeaderCell(text, width) {
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: BRAND_BROWN, type: ShadingType.CLEAR },
    margins: { top: 120, bottom: 120, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({ text, font: 'Calibri', size: 20, bold: true, color: 'FFFFFF' })],
      alignment: AlignmentType.CENTER,
    })],
  });
}

function tableBodyCell(text, width, opts = {}) {
  const fillColor = opts.highlight ? TIER4_HIGHLIGHT : (opts.zebra ? BRAND_CREAM_LIGHT : 'FFFFFF');
  return new TableCell({
    borders: cellBorders,
    width: { size: width, type: WidthType.DXA },
    shading: { fill: fillColor, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 140, right: 140 },
    verticalAlign: VerticalAlign.CENTER,
    children: [new Paragraph({
      children: [new TextRun({
        text,
        font: 'Calibri',
        size: opts.size ?? 20,
        bold: opts.bold ?? false,
        color: opts.color ?? TEXT_DARK,
      })],
      alignment: opts.alignment ?? AlignmentType.LEFT,
    })],
  });
}

// ── Tier-detail card (as a styled paragraph block) ──────────────────────────

function tierCard(tier, name, price, target, features, isPopular = false) {
  const titleBg = isPopular ? TIER4_HIGHLIGHT : BRAND_CREAM;
  const titleColor = isPopular ? BRAND_BROWN_DARK : BRAND_BROWN;

  // Title row using a single-cell table for the colored background
  const titleTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 8, color: BRAND_BROWN },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
              left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
              right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
            },
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { fill: titleBg, type: ShadingType.CLEAR },
            margins: { top: 200, bottom: 100, left: 240, right: 240 },
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: tier, font: 'Calibri', size: 18, bold: true, color: BRAND_BROWN, characterSpacing: 30 }),
                  new TextRun({ text: '   ', font: 'Calibri', size: 18 }),
                  new TextRun({ text: name, font: 'Calibri', size: 32, bold: true, color: titleColor }),
                  ...(isPopular ? [new TextRun({ text: '   ★ MOST POPULAR', font: 'Calibri', size: 18, bold: true, color: 'B45309' })] : []),
                ],
              }),
              new Paragraph({
                spacing: { before: 60, after: 0 },
                children: [
                  new TextRun({ text: price, font: 'Calibri', size: 36, bold: true, color: BRAND_BROWN_DARK }),
                  new TextRun({ text: '  /month', font: 'Calibri', size: 22, color: TEXT_MUTED }),
                ],
              }),
              new Paragraph({
                spacing: { before: 80, after: 0 },
                children: [
                  new TextRun({ text: 'Target: ', font: 'Calibri', size: 20, italics: true, color: TEXT_MUTED }),
                  new TextRun({ text: target, font: 'Calibri', size: 20, italics: true, color: TEXT_DARK }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Features as bullet list inside another single-cell table for the body background
  const featureRows = features.map((f) => new TableRow({
    children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 320, right: 240 },
      children: [new Paragraph({
        children: [
          new TextRun({ text: '✓  ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN }),
          new TextRun({ text: f, font: 'Calibri', size: 22, color: TEXT_DARK }),
        ],
      })],
    })],
  }));

  // Closing border row
  featureRows.push(new TableRow({
    children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 240, right: 240 },
      children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
    })],
  }));

  const featuresTable = new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: featureRows,
  });

  return [titleTable, featuresTable, spacer(240)];
}

// ── Build sections ───────────────────────────────────────────────────────────

const coverPage = [
  // Top spacer
  spacer(2400),

  // Hairline above title
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BRAND_BROWN, space: 1 } },
    children: [new TextRun({ text: '' })],
    spacing: { after: 0 },
  }),

  // Title
  new Paragraph({
    spacing: { before: 300, after: 200 },
    alignment: AlignmentType.LEFT,
    children: [new TextRun({ text: 'Clerque Pricing Guide', font: 'Calibri', size: 72, bold: true, color: BRAND_BROWN_DARK })],
  }),

  // Subtitle
  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'Draft v1 — May 2026', font: 'Calibri', size: 32, color: BRAND_BROWN })],
  }),

  // Tagline
  new Paragraph({
    spacing: { after: 4000 },
    children: [new TextRun({ text: 'Built for Philippine MSMEs', font: 'Calibri', size: 26, italics: true, color: TEXT_MUTED })],
  }),

  // Hairline above footer
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER_LIGHT, space: 1 } },
    children: [new TextRun({ text: '' })],
    spacing: { after: 100 },
  }),

  // Cover footer block
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'Clerque', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK })],
  }),
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'by HNS Corporation Philippines', font: 'Calibri', size: 20, color: TEXT_MUTED })],
  }),
  new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: 'clerque.hnscorpph.com', font: 'Calibri', size: 20, color: TEXT_MUTED })],
  }),
  new Paragraph({
    spacing: { after: 0 },
    children: [new TextRun({ text: 'Confidential — Draft', font: 'Calibri', size: 20, italics: true, color: TEXT_MUTED })],
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 2 — Pricing Philosophy ───────────────────────────────────────────
const philosophyPage = [
  h1('Pricing Philosophy'),
  p('Three principles guide everything in this document.', { italics: true, color: TEXT_MUTED, after: 320 }),

  // Principle 1
  new Paragraph({
    spacing: { before: 80, after: 120 },
    children: [
      new TextRun({ text: '1.  ', font: 'Calibri', size: 28, bold: true, color: BRAND_BROWN }),
      new TextRun({ text: 'Match the staff count, not the revenue.', font: 'Calibri', size: 24, bold: true, color: BRAND_BROWN_DARK }),
    ],
  }),
  p('A coffee shop owner shouldn’t fear succeeding. Our pricing scales with the team they hire, not the volume they sell. A busy week of latte sales doesn’t change what they pay us.', { after: 320 }),

  // Principle 2
  new Paragraph({
    spacing: { before: 80, after: 120 },
    children: [
      new TextRun({ text: '2.  ', font: 'Calibri', size: 28, bold: true, color: BRAND_BROWN }),
      new TextRun({ text: 'Predictable flat-fee tiers.', font: 'Calibri', size: 24, bold: true, color: BRAND_BROWN_DARK }),
    ],
  }),
  p('No surprise per-transaction fees. No locked-up data fees. No extraction. The tier they sign for is the price they pay every month.', { after: 320 }),

  // Principle 3
  new Paragraph({
    spacing: { before: 80, after: 120 },
    children: [
      new TextRun({ text: '3.  ', font: 'Calibri', size: 28, bold: true, color: BRAND_BROWN }),
      new TextRun({ text: 'Honest add-ons.', font: 'Calibri', size: 24, bold: true, color: BRAND_BROWN_DARK }),
    ],
  }),
  p('Things that genuinely cost us money (AI usage, extra branches) are charged transparently. Everything else is bundled into the tier. We don’t nickel-and-dime our customers.', { after: 320 }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 3 — Subscription Tiers (main pricing table) ─────────────────────
// Column widths must sum to CONTENT_W (10080)
const TIER_COLS = [1100, 1300, 1500, 2280, 1900, 2000];

const subscriptionTiersPage = [
  h1('Subscription Tiers'),
  p('Monthly recurring pricing. All prices in Philippine Pesos (₱) and exclusive of 12% VAT.', { color: TEXT_MUTED, italics: true, after: 280 }),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: TIER_COLS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableHeaderCell('Tier', TIER_COLS[0]),
          tableHeaderCell('Name', TIER_COLS[1]),
          tableHeaderCell('Staff Cap', TIER_COLS[2]),
          tableHeaderCell('Floor Layout', TIER_COLS[3]),
          tableHeaderCell('Monthly', TIER_COLS[4]),
          tableHeaderCell('Setup Fee', TIER_COLS[5]),
        ],
      }),
      new TableRow({ children: [
        tableBodyCell('TIER_1', TIER_COLS[0], { bold: true, alignment: AlignmentType.CENTER }),
        tableBodyCell('Solo', TIER_COLS[1], { bold: true }),
        tableBodyCell('0 (owner only)', TIER_COLS[2]),
        tableBodyCell('CS_1', TIER_COLS[3]),
        tableBodyCell('₱599', TIER_COLS[4], { bold: true, alignment: AlignmentType.RIGHT }),
        tableBodyCell('₱2,500', TIER_COLS[5], { alignment: AlignmentType.RIGHT }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_2', TIER_COLS[0], { bold: true, alignment: AlignmentType.CENTER, zebra: true }),
        tableBodyCell('Duo', TIER_COLS[1], { bold: true, zebra: true }),
        tableBodyCell('1', TIER_COLS[2], { zebra: true }),
        tableBodyCell('CS_1 / CS_2', TIER_COLS[3], { zebra: true }),
        tableBodyCell('₱999', TIER_COLS[4], { bold: true, alignment: AlignmentType.RIGHT, zebra: true }),
        tableBodyCell('₱3,500', TIER_COLS[5], { alignment: AlignmentType.RIGHT, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_3', TIER_COLS[0], { bold: true, alignment: AlignmentType.CENTER }),
        tableBodyCell('Trio', TIER_COLS[1], { bold: true }),
        tableBodyCell('2–3', TIER_COLS[2]),
        tableBodyCell('CS_1 — CS_3', TIER_COLS[3]),
        tableBodyCell('₱1,799', TIER_COLS[4], { bold: true, alignment: AlignmentType.RIGHT }),
        tableBodyCell('₱5,000', TIER_COLS[5], { alignment: AlignmentType.RIGHT }),
      ]}),
      // TIER_4 highlighted
      new TableRow({ children: [
        tableBodyCell('TIER_4', TIER_COLS[0], { bold: true, alignment: AlignmentType.CENTER, highlight: true, color: BRAND_BROWN_DARK }),
        tableBodyCell('Squad ★', TIER_COLS[1], { bold: true, highlight: true, color: BRAND_BROWN_DARK }),
        tableBodyCell('4–5', TIER_COLS[2], { highlight: true }),
        tableBodyCell('CS_1 — CS_4', TIER_COLS[3], { highlight: true }),
        tableBodyCell('₱2,999', TIER_COLS[4], { bold: true, alignment: AlignmentType.RIGHT, highlight: true, color: BRAND_BROWN_DARK }),
        tableBodyCell('₱7,500', TIER_COLS[5], { alignment: AlignmentType.RIGHT, highlight: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_5', TIER_COLS[0], { bold: true, alignment: AlignmentType.CENTER, zebra: true }),
        tableBodyCell('Team', TIER_COLS[1], { bold: true, zebra: true }),
        tableBodyCell('6–10', TIER_COLS[2], { zebra: true }),
        tableBodyCell('CS_1 — CS_5', TIER_COLS[3], { zebra: true }),
        tableBodyCell('₱4,999', TIER_COLS[4], { bold: true, alignment: AlignmentType.RIGHT, zebra: true }),
        tableBodyCell('₱12,000', TIER_COLS[5], { alignment: AlignmentType.RIGHT, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_6', TIER_COLS[0], { bold: true, alignment: AlignmentType.CENTER }),
        tableBodyCell('Multi', TIER_COLS[1], { bold: true }),
        tableBodyCell('Unlimited', TIER_COLS[2]),
        tableBodyCell('CS_1 — CS_5', TIER_COLS[3]),
        tableBodyCell('₱8,999', TIER_COLS[4], { bold: true, alignment: AlignmentType.RIGHT }),
        tableBodyCell('₱20,000', TIER_COLS[5], { alignment: AlignmentType.RIGHT }),
      ]}),
    ],
  }),

  // Callout note
  spacer(160),
  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD },
        left:   { style: BorderStyle.SINGLE, size: 16, color: ACCENT_GOLD },
        right:  { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: TIER4_HIGHLIGHT, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 240, right: 240 },
      children: [new Paragraph({
        children: [
          new TextRun({ text: '★ Recommended: ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK }),
          new TextRun({ text: 'TIER_4 (Squad) is the expected sweet spot for typical cafés — bar + kitchen + 2 cashier tablets. The setup fee is one-time and waivable during the launch promo.', font: 'Calibri', size: 22, color: TEXT_DARK }),
        ],
      })],
    })] })],
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 4 — What Each Tier Includes ──────────────────────────────────────
const tierDetailsPages = [
  h1('What Each Tier Includes'),
  p('Each tier is fully self-contained. Upgrading to a higher tier unlocks more features without losing access to anything below it.', { color: TEXT_MUTED, italics: true, after: 280 }),

  ...tierCard(
    'TIER_1', 'Solo', '₱599',
    'Sari-sari with espresso, food cart, owner-only kiosk',
    [
      'POS Counter — sell, print BIR-compliant receipts, offline mode',
      'Inventory — products + stock tracking',
      'Owner login (1 account)',
      'PWD/SC discounts, BIR Sales Invoice / OR',
      'Optional customer display',
    ],
  ),

  ...tierCard(
    'TIER_2', 'Duo', '₱999',
    'Tiny café, 1 cashier + owner',
    [
      'Everything in TIER_1, plus:',
      '1 staff account (CASHIER role)',
      'Customer-facing display included',
      'POS Outstanding Sales (collect later)',
      'Cash Out / Paid In during shift',
    ],
  ),

  ...tierCard(
    'TIER_3', 'Trio', '₱1,799',
    'Specialty coffee shop, 2–3 staff',
    [
      'Everything in TIER_2, plus:',
      '2–3 staff accounts',
      'Ledger (read-only) — Dashboard, Trial Balance, Chart of Accounts',
      'Time monitoring — clock in/out',
      '1 prep station (Bar) with KDS + Bar printer',
      'Inventory ingredients with BOM tracking',
    ],
  ),

  new Paragraph({ children: [new PageBreak()] }),

  ...tierCard(
    'TIER_4', 'Squad', '₱2,999',
    'Café-restaurant hybrid, 4–5 staff',
    [
      'Everything in TIER_3, plus:',
      '4–5 staff accounts',
      'Full Ledger — Journal, Period Close, Income Statement, Balance Sheet, Cash Flow',
      'Multi-branch (up to 2)',
      'Multi-terminal (POS-01, POS-02 with per-terminal Z-Read)',
      '2 prep stations (Bar + Kitchen) with KDS + 2 station printers',
      'Customer Master + AR — invoices, aging, statements',
      'Vendor Master + AP — bills, payments, Net-30 workflow',
      'WAC or FIFO inventory costing',
    ],
    true, // popular
  ),

  ...tierCard(
    'TIER_5', 'Team', '₱4,999',
    'Mid-size restaurant, 6–10 staff',
    [
      'Everything in TIER_4, plus:',
      '6–10 staff accounts',
      'Full Payroll — pay runs, payslips, SSS/PhilHealth/Pag-IBIG',
      'Multi-branch (up to 5)',
      '4 prep stations (Hot Bar / Cold Bar / Kitchen / Pastry Pass)',
      'Shared FIFO queue for multi-cashier setups',
    ],
  ),

  new Paragraph({ children: [new PageBreak()] }),

  ...tierCard(
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
    ],
  ),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 5 — Coffee Shop Floor Tiers ──────────────────────────────────────
const CS_COLS = [2200, 5000, 2880];
const csTiersPage = [
  h1('Coffee Shop Floor Tiers (CS_1 — CS_5)'),
  p('The Coffee Shop floor tier is the physical layout of your operation — separate from the staff/subscription tier. It’s auto-suggested based on subscription tier and bounded by what each tier supports.', { after: 160 }),
  new Paragraph({
    spacing: { after: 280 },
    children: [
      new TextRun({ text: 'Important: ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK }),
      new TextRun({ text: 'The floor layout doesn’t add cost — it’s part of the subscription tier. CS_4 is included in TIER_4. CS_5 is included in TIER_5/6.', font: 'Calibri', size: 22, color: TEXT_DARK }),
    ],
  }),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: CS_COLS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableHeaderCell('CS Tier', CS_COLS[0]),
          tableHeaderCell('Layout', CS_COLS[1]),
          tableHeaderCell('Available on', CS_COLS[2]),
        ],
      }),
      new TableRow({ children: [
        tableBodyCell('CS_1 Solo Counter', CS_COLS[0], { bold: true }),
        tableBodyCell('1 cashier tablet, no customer display', CS_COLS[1]),
        tableBodyCell('TIER_1+', CS_COLS[2], { alignment: AlignmentType.CENTER }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('CS_2 Counter + Customer Display', CS_COLS[0], { bold: true, zebra: true }),
        tableBodyCell('+ customer-facing tablet', CS_COLS[1], { zebra: true }),
        tableBodyCell('TIER_2+', CS_COLS[2], { alignment: AlignmentType.CENTER, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('CS_3 Counter + Bar', CS_COLS[0], { bold: true }),
        tableBodyCell('+ bar KDS + bar printer', CS_COLS[1]),
        tableBodyCell('TIER_3+', CS_COLS[2], { alignment: AlignmentType.CENTER }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('CS_4 Bar + Kitchen', CS_COLS[0], { bold: true, zebra: true }),
        tableBodyCell('+ kitchen KDS + kitchen printer', CS_COLS[1], { zebra: true }),
        tableBodyCell('TIER_4+', CS_COLS[2], { alignment: AlignmentType.CENTER, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('CS_5 Multi-Station', CS_COLS[0], { bold: true }),
        tableBodyCell('Hot/Cold bars + kitchen + pastry pass', CS_COLS[1]),
        tableBodyCell('TIER_5+', CS_COLS[2], { alignment: AlignmentType.CENTER }),
      ]}),
    ],
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 6 — Add-Ons ──────────────────────────────────────────────────────
const ADDON_COLS = [2400, 4080, 3600];
const addOnsPage = [
  h1('Add-Ons'),
  p('Optional services that bolt onto any subscription tier.', { color: TEXT_MUTED, italics: true, after: 280 }),

  h2('AI Add-On'),
  p('For tenants who want AI-assisted features (Receipt OCR, Smart JE Picker, JE Drafter).', { after: 200 }),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: ADDON_COLS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableHeaderCell('Package', ADDON_COLS[0]),
          tableHeaderCell('Monthly Prompts', ADDON_COLS[1]),
          tableHeaderCell('Price / month', ADDON_COLS[2]),
        ],
      }),
      new TableRow({ children: [
        tableBodyCell('AI Lite', ADDON_COLS[0], { bold: true }),
        tableBodyCell('100 prompts', ADDON_COLS[1]),
        tableBodyCell('₱250', ADDON_COLS[2], { bold: true, alignment: AlignmentType.RIGHT }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('AI Plus', ADDON_COLS[0], { bold: true, zebra: true }),
        tableBodyCell('500 prompts', ADDON_COLS[1], { zebra: true }),
        tableBodyCell('₱600', ADDON_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('AI Pro', ADDON_COLS[0], { bold: true }),
        tableBodyCell('2,000 prompts', ADDON_COLS[1]),
        tableBodyCell('₱1,400', ADDON_COLS[2], { bold: true, alignment: AlignmentType.RIGHT }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('AI Enterprise', ADDON_COLS[0], { bold: true, zebra: true }),
        tableBodyCell('Custom', ADDON_COLS[1], { zebra: true }),
        tableBodyCell('Contact sales', ADDON_COLS[2], { alignment: AlignmentType.RIGHT, zebra: true }),
      ]}),
    ],
  }),

  spacer(160),
  new Paragraph({
    spacing: { after: 320 },
    children: [
      new TextRun({ text: 'Note: ', font: 'Calibri', size: 20, italics: true, bold: true, color: TEXT_MUTED }),
      new TextRun({ text: 'A "prompt" = one AI-assisted action (a journal entry drafted, a receipt OCR’d, etc.). Most cafés stay under AI Lite.', font: 'Calibri', size: 20, italics: true, color: TEXT_MUTED }),
    ],
  }),

  h2('Extra Branches'),
  bullet('First 2 branches included on TIER_4, first 5 on TIER_5'),
  bullet([
    new TextRun({ text: 'Beyond that: ', font: 'Calibri', size: 22 }),
    new TextRun({ text: '₱500/mo per additional branch ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK }),
    new TextRun({ text: '(TIER_4–5)', font: 'Calibri', size: 22 }),
  ]),
  bullet([
    new TextRun({ text: 'Unlimited included on ', font: 'Calibri', size: 22 }),
    new TextRun({ text: 'TIER_6', font: 'Calibri', size: 22, bold: true }),
  ]),
  spacer(120),

  h2('Premium Support'),
  p([
    new TextRun({ text: '₱500/month ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK }),
    new TextRun({ text: '— guaranteed 4-hour response time, weekend coverage. Available on any tier.', font: 'Calibri', size: 22 }),
  ]),
  p([
    new TextRun({ text: 'Standard support is ', font: 'Calibri', size: 22 }),
    new TextRun({ text: 'free on all tiers ', font: 'Calibri', size: 22, bold: true }),
    new TextRun({ text: '(business-hour reply, weekday only).', font: 'Calibri', size: 22 }),
  ]),
  spacer(120),

  h2('Custom Setup / Migration'),
  bullet([
    new TextRun({ text: 'Migrating from another POS (Loyverse, Vend, etc.): ', font: 'Calibri', size: 22 }),
    new TextRun({ text: '₱5,000 flat', font: 'Calibri', size: 22, bold: true }),
  ]),
  bullet([
    new TextRun({ text: 'Customized Chart of Accounts for unusual industries: ', font: 'Calibri', size: 22 }),
    new TextRun({ text: '₱3,000 flat', font: 'Calibri', size: 22, bold: true }),
  ]),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 7 — Annual Pricing ───────────────────────────────────────────────
const ANNUAL_COLS = [1800, 2400, 2400, 3480];
const annualPage = [
  h1('Annual Pricing — Save 10–15%'),
  p('Pay annually upfront and lock in 1–2 months free, depending on the tier.', { color: TEXT_MUTED, italics: true, after: 280 }),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: ANNUAL_COLS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableHeaderCell('Tier', ANNUAL_COLS[0]),
          tableHeaderCell('Monthly × 12', ANNUAL_COLS[1]),
          tableHeaderCell('Annual Prepay', ANNUAL_COLS[2]),
          tableHeaderCell('Savings', ANNUAL_COLS[3]),
        ],
      }),
      new TableRow({ children: [
        tableBodyCell('TIER_1 Solo', ANNUAL_COLS[0], { bold: true }),
        tableBodyCell('₱7,188', ANNUAL_COLS[1], { alignment: AlignmentType.RIGHT }),
        tableBodyCell('₱6,588', ANNUAL_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, color: BRAND_BROWN_DARK }),
        tableBodyCell('₱600 (1 month free)', ANNUAL_COLS[3], { italics: true, color: BRAND_BROWN }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_2 Duo', ANNUAL_COLS[0], { bold: true, zebra: true }),
        tableBodyCell('₱11,988', ANNUAL_COLS[1], { alignment: AlignmentType.RIGHT, zebra: true }),
        tableBodyCell('₱10,788', ANNUAL_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, color: BRAND_BROWN_DARK, zebra: true }),
        tableBodyCell('₱1,200 (1.2 months free)', ANNUAL_COLS[3], { italics: true, color: BRAND_BROWN, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_3 Trio', ANNUAL_COLS[0], { bold: true }),
        tableBodyCell('₱21,588', ANNUAL_COLS[1], { alignment: AlignmentType.RIGHT }),
        tableBodyCell('₱19,188', ANNUAL_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, color: BRAND_BROWN_DARK }),
        tableBodyCell('₱2,400 (1.3 months free)', ANNUAL_COLS[3], { italics: true, color: BRAND_BROWN }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_4 Squad ★', ANNUAL_COLS[0], { bold: true, highlight: true, color: BRAND_BROWN_DARK }),
        tableBodyCell('₱35,988', ANNUAL_COLS[1], { alignment: AlignmentType.RIGHT, highlight: true }),
        tableBodyCell('₱30,588', ANNUAL_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, color: BRAND_BROWN_DARK, highlight: true }),
        tableBodyCell('₱5,400 (1.8 months free)', ANNUAL_COLS[3], { italics: true, color: BRAND_BROWN, highlight: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_5 Team', ANNUAL_COLS[0], { bold: true, zebra: true }),
        tableBodyCell('₱59,988', ANNUAL_COLS[1], { alignment: AlignmentType.RIGHT, zebra: true }),
        tableBodyCell('₱50,388', ANNUAL_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, color: BRAND_BROWN_DARK, zebra: true }),
        tableBodyCell('₱9,600 (1.9 months free)', ANNUAL_COLS[3], { italics: true, color: BRAND_BROWN, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('TIER_6 Multi', ANNUAL_COLS[0], { bold: true }),
        tableBodyCell('₱107,988', ANNUAL_COLS[1], { alignment: AlignmentType.RIGHT }),
        tableBodyCell('₱89,988', ANNUAL_COLS[2], { bold: true, alignment: AlignmentType.RIGHT, color: BRAND_BROWN_DARK }),
        tableBodyCell('₱18,000 (2 months free)', ANNUAL_COLS[3], { italics: true, color: BRAND_BROWN }),
      ]}),
    ],
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 8 — Launch Promotions ────────────────────────────────────────────
const promoCard = (title, description, items) => {
  const itemRows = [
    new TableRow({ children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 12, color: BRAND_BROWN },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: BRAND_CREAM, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 80, left: 240, right: 240 },
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: title, font: 'Calibri', size: 26, bold: true, color: BRAND_BROWN_DARK })],
        }),
        new Paragraph({
          spacing: { after: 0 },
          children: [new TextRun({ text: description, font: 'Calibri', size: 20, italics: true, color: TEXT_MUTED })],
        }),
      ],
    })] }),
    ...items.map((it) => new TableRow({ children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 320, right: 240 },
      children: [new Paragraph({
        children: [
          new TextRun({ text: '✓  ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN }),
          new TextRun({ text: it, font: 'Calibri', size: 22, color: TEXT_DARK }),
        ],
      })],
    })] })),
    new TableRow({ children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        left:   { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
        right:  { style: BorderStyle.SINGLE, size: 4, color: BORDER_LIGHT },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
      margins: { top: 60, bottom: 60, left: 240, right: 240 },
      children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
    })] }),
  ];
  return [
    new Table({
      width: { size: CONTENT_W, type: WidthType.DXA },
      columnWidths: [CONTENT_W],
      rows: itemRows,
    }),
    spacer(220),
  ];
};

const promotionsPage = [
  h1('Launch Promotions'),
  p('Limited-time offers to bring early adopters onto the platform.', { color: TEXT_MUTED, italics: true, after: 280 }),

  ...promoCard(
    'Founding Café Discount',
    'For the first 50 paying coffee shop tenants',
    [
      'Setup fee waived (save ₱2,500—₱20,000)',
      'First month free (monthly plan) OR 2 months free (annual prepay)',
      'Lifetime 15% off the published price',
      'Listed as a "Founding Customer" on our website (opt-in)',
    ],
  ),

  ...promoCard(
    'Switch From a Competitor',
    'For cafés migrating from Loyverse, Vend, or any other POS',
    [
      'Migration help included free (worth ₱5,000)',
      '3 months at 50% off after migration',
      'Conditions: must show invoice from prior provider; 3-month minimum commitment',
    ],
  ),

  ...promoCard(
    'Educational / Non-Profit Rate',
    'Schools, NGOs, church-run cafés, social enterprises',
    [
      '50% off any tier, indefinitely',
      'Application required (we verify)',
      'Approval within 5 business days',
    ],
  ),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 9 — Free Trial & Demo ───────────────────────────────────────────
const trialPage = [
  h1('Free Trial & Demo'),
  p('Two paths to "try before you buy" — designed to remove friction.', { color: TEXT_MUTED, italics: true, after: 280 }),

  h2('Public Demo Tenant'),
  p([
    new TextRun({ text: 'clerque.hnscorpph.com/demo', font: 'Consolas', size: 22, bold: true, color: BRAND_BROWN_DARK }),
  ]),
  bullet('Pre-loaded with realistic café data; resets nightly at 3 AM PHT'),
  bullet('Full read + write functionality'),
  bullet('No signup, no email, no time limit'),
  bullet('Shared with all visitors (don’t enter sensitive data)'),

  spacer(280),

  h2('Free 14-Day Trial'),
  p('A real account with the prospect’s own data.'),
  bullet([
    new TextRun({ text: 'Sign up at ', font: 'Calibri', size: 22 }),
    new TextRun({ text: '/signup', font: 'Consolas', size: 22, bold: true, color: BRAND_BROWN_DARK }),
  ]),
  bullet('Full TIER_4 access for 14 days (so they see everything we offer)'),
  bullet('After trial: pick a paid tier or downgrade to free archive (read-only forever)'),
  bullet([
    new TextRun({ text: 'No credit card required upfront', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK }),
  ]),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 10 — Payment Methods ─────────────────────────────────────────────
const paymentPage = [
  h1('Payment Methods'),

  h2('Initial Launch'),
  bullet('Bank transfer — BDO, BPI, Metrobank, UnionBank'),
  bullet('GCash business'),
  bullet('Maya business'),
  bullet('Manual invoicing for the first 6 months'),
  spacer(180),

  h2('Phase 2 (after 50 paying tenants)'),
  bullet('Stripe / PayMongo for auto-charging'),
  bullet('Card on file with PCI-compliant tokenization'),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 11 — Subscription Lifecycle ─────────────────────────────────────
const LIFECYCLE_COLS = [1800, 5680, 2600];
const lifecyclePage = [
  h1('Subscription Lifecycle'),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: LIFECYCLE_COLS,
    rows: [
      new TableRow({
        tableHeader: true,
        children: [
          tableHeaderCell('State', LIFECYCLE_COLS[0]),
          tableHeaderCell('Meaning', LIFECYCLE_COLS[1]),
          tableHeaderCell('Duration', LIFECYCLE_COLS[2]),
        ],
      }),
      new TableRow({ children: [
        tableBodyCell('TRIAL', LIFECYCLE_COLS[0], { bold: true, alignment: AlignmentType.CENTER }),
        tableBodyCell('14-day free trial', LIFECYCLE_COLS[1]),
        tableBodyCell('14 days', LIFECYCLE_COLS[2], { alignment: AlignmentType.CENTER }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('ACTIVE', LIFECYCLE_COLS[0], { bold: true, alignment: AlignmentType.CENTER, zebra: true }),
        tableBodyCell('Paid, current', LIFECYCLE_COLS[1], { zebra: true }),
        tableBodyCell('Indefinite', LIFECYCLE_COLS[2], { alignment: AlignmentType.CENTER, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('GRACE', LIFECYCLE_COLS[0], { bold: true, alignment: AlignmentType.CENTER }),
        tableBodyCell('Payment overdue 1–30 days, full access continues', LIFECYCLE_COLS[1]),
        tableBodyCell('30 days', LIFECYCLE_COLS[2], { alignment: AlignmentType.CENTER }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('SUSPENDED', LIFECYCLE_COLS[0], { bold: true, alignment: AlignmentType.CENTER, zebra: true }),
        tableBodyCell('30+ days overdue, read-only access', LIFECYCLE_COLS[1], { zebra: true }),
        tableBodyCell('Until paid or cancelled', LIFECYCLE_COLS[2], { alignment: AlignmentType.CENTER, zebra: true }),
      ]}),
      new TableRow({ children: [
        tableBodyCell('ARCHIVED', LIFECYCLE_COLS[0], { bold: true, alignment: AlignmentType.CENTER }),
        tableBodyCell('Cancelled — data preserved 1 year, then deleted per Privacy Policy', LIFECYCLE_COLS[1]),
        tableBodyCell('1 year', LIFECYCLE_COLS[2], { alignment: AlignmentType.CENTER }),
      ]}),
    ],
  }),

  spacer(280),

  new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    rows: [new TableRow({ children: [new TableCell({
      borders: {
        top:    { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD },
        left:   { style: BorderStyle.SINGLE, size: 16, color: ACCENT_GOLD },
        right:  { style: BorderStyle.SINGLE, size: 4, color: ACCENT_GOLD },
      },
      width: { size: CONTENT_W, type: WidthType.DXA },
      shading: { fill: BRAND_CREAM_LIGHT, type: ShadingType.CLEAR },
      margins: { top: 160, bottom: 160, left: 240, right: 240 },
      children: [new Paragraph({
        children: [
          new TextRun({ text: 'Our promise: ', font: 'Calibri', size: 22, bold: true, color: BRAND_BROWN_DARK }),
          new TextRun({ text: 'We don’t lock out paying customers within 30 days of a missed payment. Bills get lost, banks delay, life happens — we give people the benefit of the doubt.', font: 'Calibri', size: 22, italics: true, color: TEXT_DARK }),
        ],
      })],
    })] })],
  }),

  new Paragraph({ children: [new PageBreak()] }),
];

// ── Section 12 — Contact ─────────────────────────────────────────────────────
const contactPage = [
  spacer(800),
  h1('Get in Touch'),
  p('We’d love to talk to you about how Clerque fits your business.', { color: TEXT_MUTED, italics: true, after: 480 }),

  h3('Pricing & Sales'),
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: 'sales@hnscorpph.com', font: 'Consolas', size: 24, bold: true, color: BRAND_BROWN_DARK })],
  }),

  h3('Technical Support'),
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: 'support@hnscorpph.com', font: 'Consolas', size: 24, bold: true, color: BRAND_BROWN_DARK })],
  }),

  h3('Partnerships'),
  new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text: 'partnerships@hnscorpph.com', font: 'Consolas', size: 24, bold: true, color: BRAND_BROWN_DARK })],
  }),

  h3('Website'),
  new Paragraph({
    spacing: { after: 480 },
    children: [new TextRun({ text: 'clerque.hnscorpph.com', font: 'Consolas', size: 24, bold: true, color: BRAND_BROWN_DARK })],
  }),

  new Paragraph({
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: BORDER_LIGHT, space: 1 } },
    children: [new TextRun({ text: '' })],
    spacing: { after: 120 },
  }),

  new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: 'Clerque is operated by HNS Corporation Philippines.', font: 'Calibri', size: 18, color: TEXT_MUTED }),
    ],
  }),
  new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: 'All prices in Philippine Pesos (₱) and exclusive of 12% VAT. Subject to change.', font: 'Calibri', size: 18, color: TEXT_MUTED }),
    ],
  }),
  new Paragraph({
    spacing: { after: 80 },
    children: [
      new TextRun({ text: '© 2026 HNS Corporation Philippines. All rights reserved.', font: 'Calibri', size: 18, color: TEXT_MUTED }),
    ],
  }),
];

// ── Document assembly ────────────────────────────────────────────────────────

const doc = new Document({
  creator:    'HNS Corporation Philippines',
  title:      'Clerque Pricing Guide — Draft v1',
  description: 'Pricing template for Clerque POS + Ledger + Payroll',
  styles: {
    default: { document: { run: { font: 'Calibri', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 36, bold: true, font: 'Calibri', color: BRAND_BROWN_DARK },
        paragraph: { spacing: { before: 240, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 28, bold: true, font: 'Calibri', color: BRAND_BROWN },
        paragraph: { spacing: { before: 320, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 24, bold: true, font: 'Calibri', color: TEXT_DARK },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{
        level: 0,
        format: LevelFormat.BULLET,
        text: '•',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }] },
      { reference: 'numbers', levels: [{
        level: 0,
        format: LevelFormat.DECIMAL,
        text: '%1.',
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 720, hanging: 360 } } },
      }] },
    ],
  },
  sections: [{
    properties: {
      page: {
        size:   { width: PAGE_W, height: PAGE_H },
        margin: { top: MARGIN, right: MARGIN, bottom: MARGIN, left: MARGIN },
      },
      titlePage: true,
    },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: 'Clerque Pricing Guide   —   Draft v1', font: 'Calibri', size: 18, color: TEXT_MUTED }),
        ],
      })] }),
      // No header on the cover (title) page
      first: new Header({ children: [new Paragraph({ children: [new TextRun({ text: '' })] })] }),
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        children: [
          new TextRun({ text: 'HNS Corporation Philippines   •   clerque.hnscorpph.com', font: 'Calibri', size: 18, color: TEXT_MUTED }),
          new TextRun({ text: '\t', font: 'Calibri', size: 18 }),
          new TextRun({ text: 'Page ', font: 'Calibri', size: 18, color: TEXT_MUTED }),
          new TextRun({ children: [PageNumber.CURRENT], font: 'Calibri', size: 18, color: TEXT_MUTED }),
          new TextRun({ text: ' / ', font: 'Calibri', size: 18, color: TEXT_MUTED }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Calibri', size: 18, color: TEXT_MUTED }),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      })] }),
      // No footer on the cover (title) page
      first: new Footer({ children: [new Paragraph({ children: [new TextRun({ text: '' })] })] }),
    },
    children: [
      ...coverPage,
      ...philosophyPage,
      ...subscriptionTiersPage,
      ...tierDetailsPages,
      ...csTiersPage,
      ...addOnsPage,
      ...annualPage,
      ...promotionsPage,
      ...trialPage,
      ...paymentPage,
      ...lifecyclePage,
      ...contactPage,
    ],
  }],
});

const outPath = path.join(__dirname, '..', 'Clerque-Pricing-Draft-v1.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote:', outPath, '(' + buf.length + ' bytes)');
});
