/**
 * Build all Clerque import templates as standalone .xlsx files.
 *
 * Mirrors the exact template definitions from:
 *   apps/api/src/import/import.service.ts
 *
 * Run:  node scripts/build-import-templates.js
 *
 * Output: 7 .xlsx files written to <Desktop>/clerque-import-templates/
 */

const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const ExcelJS  = require('exceljs');

const DESKTOP_DIR = path.join(os.homedir(), 'Desktop', 'clerque-import-templates');
fs.mkdirSync(DESKTOP_DIR, { recursive: true });

// ─── makeTemplate helper (mirrors import.service.ts:86) ─────────────────────

async function makeTemplate(filename, sheetName, headers, sampleRows, opts = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Clerque';
  const ws = wb.addWorksheet(sheetName);

  let cursor = 1;
  const colCount = headers.length;
  const lastColLetter = String.fromCharCode(64 + colCount);

  if (opts.title) {
    ws.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
    const c = ws.getCell(`A${cursor}`);
    c.value = opts.title;
    c.font  = { bold: true, size: 14, color: { argb: 'FF8B5E3C' } };
    c.alignment = { vertical: 'middle' };
    ws.getRow(cursor).height = 22;
    cursor++;
  }

  if (opts.instructions?.length) {
    for (const line of opts.instructions) {
      ws.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
      const c = ws.getCell(`A${cursor}`);
      c.value = line;
      c.font  = { italic: true, color: { argb: 'FF666666' }, size: 10 };
      c.alignment = { wrapText: true, vertical: 'top' };
      cursor++;
    }
    cursor++;
  }

  const headerRowIdx = cursor;
  ws.getRow(cursor).values = headers;
  ws.getRow(cursor).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(cursor).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
  ws.getRow(cursor).alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(cursor).height = 20;
  cursor++;

  if (opts.columnHints?.length) {
    ws.getRow(cursor).values = opts.columnHints;
    ws.getRow(cursor).font = { italic: true, color: { argb: 'FF888888' }, size: 9 };
    ws.getRow(cursor).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F1EC' } };
    cursor++;
  }

  for (const r of sampleRows) {
    ws.getRow(cursor).values = r;
    cursor++;
  }

  headers.forEach((_, i) => { ws.getColumn(i + 1).width = 22; });
  ws.views = [{ state: 'frozen', ySplit: opts.columnHints ? headerRowIdx + 1 : headerRowIdx }];

  const out = path.join(DESKTOP_DIR, filename);
  await wb.xlsx.writeFile(out);
  console.log('  ✓', filename);
}

// ─── Template definitions ──────────────────────────────────────────────────

async function buildAll() {
  console.log('Generating Clerque import templates...');
  console.log(`Output: ${DESKTOP_DIR}\n`);

  // ── 1. Products ──
  await makeTemplate(
    'clerque-products-template.xlsx',
    'Products',
    ['Name*', 'Category', 'Price*', 'Cost Price*', 'VAT (Y/N)', 'Barcode', 'Description'],
    [
      ['Garlic Rice',     'Food',   '35',  '12', 'Y', '',              'Steamed garlic fried rice'],
      ['Bottled Water',   'Drinks', '20',  '8',  'N', '4806507000123', '500ml'],
      ['Iced Latte 16oz', 'Drinks', '110', '35', 'Y', '',              'Espresso + cold milk + ice'],
      ['Plain Donut',     'Bakery', '25',  '9',  'N', '',              'Sugar-glazed cake donut'],
    ],
    {
      title: 'Clerque — Product Master Import Template',
      instructions: [
        'How to use:',
        '  1. Fill the rows below the headers. Remove the sample rows when ready.',
        '  2. Columns marked * are required. Existing products matched by Name (or Barcode) and updated.',
        '  3. Cost Price is REQUIRED. Drives COGS posting on every sale. Enter 0 for complimentary items.',
        '  4. VAT column accepts Y / Yes / 1 / true (case-insensitive); anything else means no VAT.',
        '  5. Category — auto-creates if new. Use consistent spelling across rows.',
        '  6. Save as .xlsx (or .csv). Upload via POS → Products → Import.',
        'Tip: After import, head to Inventory and import opening stock per branch using the Inventory template.',
      ],
      columnHints: [
        'Required. Unique within tenant.',
        'Optional. Auto-creates if new.',
        'Required. Selling price (₱).',
        'REQUIRED. Unit cost (₱) for COGS.',
        'Y or N. Default N.',
        'Optional. EAN-13 / UPC etc.',
        'Optional. Free text.',
      ],
    },
  );

  // ── 2. Inventory (opening stock) ──
  await makeTemplate(
    'clerque-inventory-template.xlsx',
    'Inventory',
    ['Product Name or Barcode*', 'Quantity on Hand*', 'Low Stock Alert'],
    [
      ['Garlic Rice',     '100', '10'],
      ['Bottled Water',   '200', '20'],
      ['4806507000123',   '50',  '5'],
      ['Iced Latte 16oz', '0',   ''],
    ],
    {
      title: 'Clerque — Opening Inventory Import Template',
      instructions: [
        'How to use:',
        '  1. Set the branch in Clerque BEFORE running this import (POS → Inventory → pick branch).',
        '  2. Each row updates the on-hand quantity for one product at the selected branch.',
        '  3. Match by Product Name OR Barcode — the import tries both.',
        '  4. Quantity REPLACES (not adds to) the current quantity. Use 0 if no stock.',
        '  5. Low Stock Alert is the threshold below which the dashboard flags re-ordering. Optional.',
        '  6. Save as .xlsx (or .csv). Upload via POS → Inventory → Import.',
        'Tip: Run the Products import FIRST so all SKUs exist; then this Inventory import sets opening balances.',
      ],
      columnHints: [
        'Required. Must match an existing product.',
        'Required. Number ≥ 0.',
        'Optional. Re-order trigger.',
      ],
    },
  );

  // ── 3. Chart of Accounts ──
  await makeTemplate(
    'clerque-coa-template.xlsx',
    'Chart of Accounts',
    [
      'Code*',
      'Name*',
      'Type* (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE)',
      'Normal Balance (DEBIT/CREDIT)',
      'Description',
      'Parent Code',
    ],
    [
      ['1010', 'Cash on Hand',        'ASSET',     'DEBIT',  'Petty cash and cash on premises', ''],
      ['1020', 'Cash in Bank — BDO',  'ASSET',     'DEBIT',  'BDO checking account',            '1020'],
      ['2010', 'Accounts Payable',    'LIABILITY', 'CREDIT', 'Trade payables',                  ''],
      ['4010', 'Sales Revenue',       'REVENUE',   'CREDIT', 'Revenue from sales of goods',     ''],
      ['6010', 'Salaries and Wages',  'EXPENSE',   'DEBIT',  'Regular employee salaries',       ''],
    ],
    {
      title: 'Clerque — Chart of Accounts Import Template',
      instructions: [
        'How to use:',
        '  1. Clerque ships with a 59-account PH-standard COA already seeded. Use this template only',
        '     when adding tenant-specific accounts (e.g., a new bank account, custom revenue stream).',
        '  2. Code: 4-digit numeric. Reserved ranges: 1xxx Assets, 2xxx Liab, 3xxx Equity,',
        '     4xxx Revenue, 5xxx COGS, 6xxx OpEx, 7xxx Other.',
        '  3. Type drives report grouping. Spell exactly as listed.',
        '  4. Normal Balance: DEBIT for ASSET/EXPENSE, CREDIT for LIABILITY/EQUITY/REVENUE.',
        '  5. Parent Code: optional, for nested grouping (e.g., Bank Accounts under "1020").',
        '  6. Save as .xlsx (or .csv). Upload via Ledger → Chart of Accounts → Import.',
      ],
      columnHints: [
        'Required. 4-digit unique.',
        'Required. Display name.',
        'Required. One of 5 enum values.',
        'Required. DEBIT or CREDIT.',
        'Optional. Free text.',
        'Optional. For nesting.',
      ],
    },
  );

  // ── 4. Journal Entries ──
  await makeTemplate(
    'clerque-journal-template.xlsx',
    'Journal Entries',
    ['Reference*', 'Date* (YYYY-MM-DD)', 'Description', 'Account Code*', 'Debit', 'Credit', 'Memo'],
    [
      ['JE-2026-001', '2026-04-26', 'Office supplies purchase', '6100', '500',   '',    'Paper and pens'],
      ['JE-2026-001', '2026-04-26', 'Office supplies purchase', '1010', '',      '500', 'Cash payment'],
      ['JE-2026-002', '2026-04-26', 'Rent expense April',       '6051', '15000', '',    ''],
      ['JE-2026-002', '2026-04-26', 'Rent expense April',       '1010', '',      '15000', ''],
    ],
    {
      title: 'Clerque — Journal Entries Import Template',
      instructions: [
        'How to use:',
        '  1. Each ROW is one journal LINE. Multiple lines with the same Reference become one Journal Entry.',
        '  2. Reference: any unique string per JE — keeps lines together. JE-YYYY-### convention recommended.',
        '  3. Each JE must balance: sum of debits = sum of credits across rows with the same Reference.',
        '  4. Account Code must match an existing GL account (see Chart of Accounts in Ledger).',
        '  5. Use Debit OR Credit per row, not both. Leave the other blank or 0.',
        '  6. Save as .xlsx (or .csv). Upload via Ledger → Journal Entries → Import.',
        'Common use: posting opening balances, importing historical entries from old accounting software.',
      ],
      columnHints: [
        'Required. Groups lines into a JE.',
        'Required. ISO format.',
        'Optional. JE narrative.',
        'Required. Must exist in COA.',
        'Optional. Use one or the other.',
        'Optional. Use one or the other.',
        'Optional. Per-line note.',
      ],
    },
  );

  // ── 5. Customers (AR Master) ──
  await makeTemplate(
    'clerque-customers-template.xlsx',
    'Customers',
    ['Name*', 'TIN', 'Address', 'Email', 'Phone', 'Credit Term Days', 'Credit Limit', 'Notes'],
    [
      ['ABC Trading Inc.',    '123-456-789-000', '123 EDSA, Quezon City',   'ar@abc.ph', '0917-1234567', '30', '500000', 'B2B reseller'],
      ['Reyes Bakery',        '',                'Brgy. San Roque, Pasig',  '',          '0922-9876543', '15', '50000',  'Daily bread orders'],
      ['Walk-in (Anonymous)', '',                '',                        '',          '',             '0',  '',       'For one-off cash sales'],
    ],
    {
      title: 'Clerque — Customers Import Template (AR Master)',
      instructions: [
        'How to use:',
        '  1. One row per customer. Name is required and must be unique within your tenant.',
        '  2. Existing customers (matched by exact Name) are updated; new names create new records.',
        '  3. TIN is optional but required for VAT-registered B2B customers (12-digit format).',
        '  4. Credit Term Days: 0 = cash on delivery; 15/30/60 = net days.',
        '  5. Credit Limit: max outstanding receivable (₱). Leave blank for no limit.',
        '  6. Save as .xlsx (or .csv). Upload via Ledger → Receivables → Customers → Import.',
      ],
      columnHints: [
        'Required. Unique within tenant.',
        'Optional. PH 12-digit TIN.',
        'Optional. Free text.',
        'Optional. Email format.',
        'Optional. Mobile or landline.',
        'Optional. Net days for billing terms.',
        'Optional. Max receivable (₱).',
        'Optional. Free text.',
      ],
    },
  );

  // ── 6. Vendors (AP Master) ──
  await makeTemplate(
    'clerque-vendors-template.xlsx',
    'Vendors',
    ['Name*', 'TIN', 'Address', 'Email', 'Phone', 'Default ATC Code', 'Default WHT Rate', 'Notes'],
    [
      ['BDO Unibank',          '000-123-456-000', 'BDO Tower, Makati City',  'corp@bdo.com.ph', '0917-1112222', 'WI160', '0.02', 'Bank fees'],
      ['Davao Coffee Beans',   '111-222-333-444', 'Davao City',              'sales@dvcoffee.ph', '082-1234567', 'WC158', '0.01', 'Green-bean supplier'],
      ['eSecure Filings Inc.', '999-888-777-666', 'Manila',                  '',                  '',           'WC158', '0.02', 'SEC compliance services'],
    ],
    {
      title: 'Clerque — Vendors Import Template (AP Master)',
      instructions: [
        'How to use:',
        '  1. One row per vendor. Name is required and must be unique within your tenant.',
        '  2. Existing vendors (matched by exact Name) are updated; new names create new records.',
        '  3. TIN required for any vendor you withhold tax from (BIR Form 2307 generation).',
        '  4. Default ATC Code: BIR Alphanumeric Tax Code that pre-fills on bills (e.g. WC158 for services).',
        '  5. Default WHT Rate: decimal (0.02 = 2%, 0.01 = 1%, 0.05 = 5%). Used to auto-compute 2307 amounts.',
        '  6. Save as .xlsx (or .csv). Upload via Ledger → Payables → Vendors → Import.',
      ],
      columnHints: [
        'Required. Unique within tenant.',
        'Optional but required for WHT.',
        'Optional. Free text.',
        'Optional. Email format.',
        'Optional. Mobile or landline.',
        'Optional. e.g. WC158, WI160.',
        'Optional. Decimal: 0.02 = 2%.',
        'Optional. Free text.',
      ],
    },
  );

  // ── 7. Setup Pack (Products + Inventory in one workbook) ──
  // Multi-sheet workbook — built directly with ExcelJS rather than makeTemplate
  const setupWb = new ExcelJS.Workbook();
  setupWb.creator = 'Clerque';

  const readme = setupWb.addWorksheet('Read Me');
  readme.mergeCells('A1:F1');
  const t = readme.getCell('A1');
  t.value = 'Clerque — Business Setup Pack';
  t.font  = { bold: true, size: 16, color: { argb: 'FF8B5E3C' } };
  readme.getRow(1).height = 26;
  const lines = [
    '',
    'This single file lets you stand up your product catalog and opening stock in one upload.',
    '',
    'Step 1 — Fill the "Products" sheet with every SKU you sell.',
    'Step 2 — Fill the "Inventory" sheet with opening stock for each SKU at your selected branch.',
    'Step 3 — Save and upload via POS → Products → Setup Pack.',
    '',
    'The system runs both imports atomically — if any product fails, no inventory rows are committed.',
    'See the Products and Inventory sheets for column-level guidance and sample rows.',
  ];
  for (let i = 0; i < lines.length; i++) {
    const row = readme.getRow(i + 2);
    row.getCell(1).value = lines[i];
    row.getCell(1).font  = { color: { argb: 'FF333333' }, size: 11 };
  }
  readme.getColumn(1).width = 90;

  // Products sheet
  const ps = setupWb.addWorksheet('Products');
  ps.getRow(1).values = ['Name*', 'Category', 'Price*', 'Cost Price*', 'VAT (Y/N)', 'Barcode', 'Description'];
  ps.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ps.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
  ps.getRow(2).values = ['Garlic Rice',     'Food',   '35',  '12', 'Y', '',              'Steamed garlic fried rice'];
  ps.getRow(3).values = ['Bottled Water',   'Drinks', '20',  '8',  'N', '4806507000123', '500ml'];
  ps.getRow(4).values = ['Iced Latte 16oz', 'Drinks', '110', '35', 'Y', '',              ''];
  for (let c = 1; c <= 7; c++) ps.getColumn(c).width = 22;

  // Inventory sheet
  const inv = setupWb.addWorksheet('Inventory');
  inv.getRow(1).values = ['Product Name or Barcode*', 'Quantity on Hand*', 'Low Stock Alert'];
  inv.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  inv.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
  inv.getRow(2).values = ['Garlic Rice',     '100', '10'];
  inv.getRow(3).values = ['Bottled Water',   '200', '20'];
  inv.getRow(4).values = ['Iced Latte 16oz', '0',   ''];
  for (let c = 1; c <= 3; c++) inv.getColumn(c).width = 30;

  await setupWb.xlsx.writeFile(path.join(DESKTOP_DIR, 'clerque-setup-pack.xlsx'));
  console.log('  ✓ clerque-setup-pack.xlsx');

  console.log(`\n✓ Done. 7 templates written to:\n  ${DESKTOP_DIR}`);
}

buildAll().catch((err) => { console.error(err); process.exit(1); });
