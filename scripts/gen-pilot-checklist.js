/**
 * Generate the Clerque Bakery Pilot — Pre-Launch Checklist as a .docx.
 *
 *   node scripts/gen-pilot-checklist.js
 *
 * Output: docs/CLERQUE_BAKERY_PILOT_CHECKLIST.docx
 *
 * Structured as a working document the founder + cashier can mark up
 * during pilot preparation. Each section has a printable checkbox table
 * and a "notes" area.
 */
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, TableOfContents, HeadingLevel,
  BorderStyle, WidthType, ShadingType, PageNumber, PageBreak, TabStopType,
  TabStopPosition,
} = require('docx');
const fs   = require('fs');
const path = require('path');

// ─── Brand + style constants ────────────────────────────────────────
const BROWN     = '8B5E3C';
const BROWN_DK  = '714A2D';
const CREAM     = 'EEE9DF';
const CREAM_LT  = 'F8F5EE';
const INK       = '2A1F18';
const MUTED     = '6F5B4B';
const RULE      = 'E0D6C5';
const ACCENT    = '7C3AED';
const SUCCESS   = '2F855A';
const WARN      = 'B45309';

// US Letter portrait at 1" margins → 9360 DXA content width.
const CONTENT_WIDTH = 9360;

// ─── Helpers ────────────────────────────────────────────────────────
const para = (text, opts = {}) =>
  new Paragraph({
    spacing: { before: 80, after: 80 },
    ...opts,
    children: [new TextRun({ text, font: 'Arial', size: 22, ...(opts.run ?? {}) })],
  });

const muted = (text, opts = {}) =>
  para(text, {
    ...opts,
    run: { color: MUTED, italics: true, size: 20, ...(opts.run ?? {}) },
  });

const h1 = (text, opts = {}) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    pageBreakBefore: opts.pageBreakBefore !== false,
    spacing: { before: 280, after: 200 },
    children: [new TextRun({ text, font: 'Arial', size: 36, bold: true, color: BROWN_DK })],
  });

const h2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: 'Arial', size: 28, bold: true, color: INK })],
  });

const h3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font: 'Arial', size: 24, bold: true, color: BROWN })],
  });

const lineBreak = () =>
  new Paragraph({
    spacing: { before: 60, after: 60 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
    children: [new TextRun({ text: '' })],
  });

// Checkbox table — left column is a "☐", middle is the task, right is "Done by / date".
const CHECK = '☐';
const tableBorder = { style: BorderStyle.SINGLE, size: 1, color: RULE };
const allBorders = { top: tableBorder, bottom: tableBorder, left: tableBorder, right: tableBorder };

function checklistTable(items, opts = {}) {
  const colCheck = 600;
  const colNote  = 2200;
  const colTask  = CONTENT_WIDTH - colCheck - colNote;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [colCheck, colTask, colNote],
    rows: [
      // Header row
      new TableRow({
        tableHeader: true,
        children: [
          new TableCell({
            borders: allBorders,
            width: { size: colCheck, type: WidthType.DXA },
            shading: { fill: BROWN, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 100, right: 100 },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: ' ', font: 'Arial', size: 20, color: 'FFFFFF', bold: true })] })],
          }),
          new TableCell({
            borders: allBorders,
            width: { size: colTask, type: WidthType.DXA },
            shading: { fill: BROWN, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: opts.taskHeader ?? 'Task', font: 'Arial', size: 20, color: 'FFFFFF', bold: true })] })],
          }),
          new TableCell({
            borders: allBorders,
            width: { size: colNote, type: WidthType.DXA },
            shading: { fill: BROWN, type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: opts.noteHeader ?? 'Done by / date', font: 'Arial', size: 20, color: 'FFFFFF', bold: true })] })],
          }),
        ],
      }),
      // Data rows
      ...items.map((item, idx) =>
        new TableRow({
          children: [
            new TableCell({
              borders: allBorders,
              width: { size: colCheck, type: WidthType.DXA },
              shading: { fill: idx % 2 === 0 ? 'FFFFFF' : CREAM_LT, type: ShadingType.CLEAR },
              margins: { top: 100, bottom: 100, left: 100, right: 100 },
              children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: CHECK, font: 'Arial', size: 28, color: BROWN })] })],
            }),
            new TableCell({
              borders: allBorders,
              width: { size: colTask, type: WidthType.DXA },
              shading: { fill: idx % 2 === 0 ? 'FFFFFF' : CREAM_LT, type: ShadingType.CLEAR },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: typeof item === 'string'
                ? [new Paragraph({ children: [new TextRun({ text: item, font: 'Arial', size: 22, color: INK })] })]
                : [
                    new Paragraph({ children: [new TextRun({ text: item.task, font: 'Arial', size: 22, color: INK, bold: !!item.bold })] }),
                    ...(item.detail ? [new Paragraph({
                      spacing: { before: 60 },
                      children: [new TextRun({ text: item.detail, font: 'Arial', size: 20, color: MUTED, italics: true })],
                    })] : []),
                  ],
            }),
            new TableCell({
              borders: allBorders,
              width: { size: colNote, type: WidthType.DXA },
              shading: { fill: idx % 2 === 0 ? 'FFFFFF' : CREAM_LT, type: ShadingType.CLEAR },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [new Paragraph({ children: [new TextRun({ text: ' ', font: 'Arial', size: 22 })] })],
            }),
          ],
        }),
      ),
    ],
  });
}

// 2-col "info table" (label : value with room for owner to write).
function infoTable(rows) {
  const colLabel = 3000;
  const colValue = CONTENT_WIDTH - colLabel;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [colLabel, colValue],
    rows: rows.map((r, idx) =>
      new TableRow({
        children: [
          new TableCell({
            borders: allBorders,
            width: { size: colLabel, type: WidthType.DXA },
            shading: { fill: idx % 2 === 0 ? CREAM : CREAM_LT, type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: r.label, font: 'Arial', size: 22, color: INK, bold: true })] })],
          }),
          new TableCell({
            borders: allBorders,
            width: { size: colValue, type: WidthType.DXA },
            shading: { fill: 'FFFFFF', type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: r.value ?? ' ', font: 'Arial', size: 22, color: r.value ? INK : MUTED })] })],
          }),
        ],
      }),
    ),
  });
}

// Callout / alert box.
function callout(title, body, tone = 'brown') {
  const bg = tone === 'warn' ? 'FFF3E0' : tone === 'success' ? 'E8F5E9' : CREAM;
  const fg = tone === 'warn' ? WARN    : tone === 'success' ? SUCCESS : BROWN_DK;
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: [CONTENT_WIDTH],
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: {
              top:    { style: BorderStyle.SINGLE, size: 4, color: fg },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: fg },
              left:   { style: BorderStyle.SINGLE, size: 16, color: fg },
              right:  { style: BorderStyle.SINGLE, size: 4, color: fg },
            },
            width: { size: CONTENT_WIDTH, type: WidthType.DXA },
            shading: { fill: bg, type: ShadingType.CLEAR },
            margins: { top: 140, bottom: 140, left: 220, right: 180 },
            children: [
              new Paragraph({ children: [new TextRun({ text: title, font: 'Arial', size: 24, color: fg, bold: true })] }),
              new Paragraph({
                spacing: { before: 80 },
                children: [new TextRun({ text: body, font: 'Arial', size: 22, color: INK })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// ─── Document content ──────────────────────────────────────────────
const children = [];

// ── COVER PAGE ──
children.push(
  new Paragraph({ spacing: { before: 1400 }, children: [new TextRun({ text: '' })] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'CLERQUE', font: 'Arial', size: 60, bold: true, color: BROWN_DK, characterSpacing: 60 })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 80 },
    children: [new TextRun({ text: 'Bakery Pilot — Pre-Launch Checklist', font: 'Arial', size: 36, color: BROWN })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 200 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: BROWN, space: 1 } },
    children: [new TextRun({ text: '', font: 'Arial' })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 400 },
    children: [new TextRun({ text: 'A working document for the founder + the bakery owner to walk through together before going live with real customers. Each section is a printable checkbox table you can sign off as items complete.', font: 'Arial', size: 22, color: MUTED, italics: true })],
  }),
);

// Cover info box
children.push(
  new Paragraph({ spacing: { before: 800 }, children: [new TextRun({ text: '' })] }),
  infoTable([
    { label: 'Bakery name',                  value: '' },
    { label: 'Business owner',               value: '' },
    { label: 'TIN',                          value: '' },
    { label: 'Branch / address',             value: '' },
    { label: 'Pilot start date',             value: '' },
    { label: 'Clerque project lead',         value: '' },
    { label: 'Phone / contact',              value: '' },
    { label: 'Document version',             value: 'v1 — 2026-06-05' },
  ]),
);

// ── TABLE OF CONTENTS ──
children.push(
  new Paragraph({ pageBreakBefore: true, children: [new TextRun({ text: '' })] }),
  new Paragraph({
    spacing: { before: 200, after: 200 },
    children: [new TextRun({ text: 'Contents', font: 'Arial', size: 36, bold: true, color: BROWN_DK })],
  }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
);

// ── HOW TO USE THIS DOCUMENT ──
children.push(
  h1('How to use this checklist'),
  para('This document covers seven days of pre-pilot prep plus the first soft-launch day. Print it, work top to bottom, and tick each box as you go. The order matters: hardware and tenant setup must land before product catalog can be built; catalog must land before smoke tests can happen.'),
  para('Each section ends with a notes area for sign-off. Use it to record who completed the work, when, and any issues raised — that audit trail matters if the merchant ever questions a missing feature, and it lets the next pilot reuse what you learned here.'),
  callout(
    'Day-0 rule',
    'Nothing on this list is optional. A skipped item on day 0 becomes a 2 AM phone call from the cashier during a busy Saturday morning rush.',
    'warn',
  ),
);

// ── SECTION 1: MERCHANT INTAKE ──
children.push(
  h1('1. Merchant intake — questions to ask the bakery owner'),
  para('Before any hardware or software setup, you need answers to these. Schedule a 1-hour call with the owner; do not skip. Most preventable day-1 outages are setup misalignment, not code bugs.'),

  h2('1.1 BIR registration'),
  checklistTable([
    { task: 'Confirm BIR-registered TIN (xxx-xxx-xxx-xxxxx)', detail: 'Required on every receipt. Wrong TIN = void OR.' },
    { task: 'Confirm tax status: VAT, Non-VAT, or Unregistered', detail: 'Drives receipt header (OR vs Acknowledgement Receipt) and the 12% VAT extraction.' },
    { task: 'Get a photo of the BIR Certificate of Registration (Form 2303)', detail: 'Source of truth for TIN and tax type.' },
    { task: 'Confirm BIR-printed OR booklet — is there one?', detail: 'Many small bakeries use BIR-printed manual ORs. Important to know before we set OR starting number.' },
    { task: 'If using BIR-printed OR booklet, record the next available OR number', detail: 'We MUST seed Clerque with the same number. Mismatched OR sequences = audit finding.' },
    { task: 'Get BIR Accreditation number (if they have a POS accreditation already)', detail: 'Goes on receipt footer.' },
    { task: 'Confirm renewal date of OR booklet (BIR allows 5 years per booklet)', detail: 'Owner needs to renew before expiry.' },
  ]),

  h2('1.2 Business profile'),
  checklistTable([
    { task: 'Confirm business legal name (registered with DTI/SEC)' },
    { task: 'Confirm DBA / brand name shown on receipts' },
    { task: 'Get full business address (must match BIR registration)' },
    { task: 'Confirm business hours' },
    { task: 'Confirm peak hours (so we can pre-warn about throughput)' },
    { task: 'How many active customers per day (average)?' },
    { task: 'Average transaction size (₱)?' },
    { task: 'Number of branches (today and planned next 6 months)?' },
  ]),

  h2('1.3 Staff'),
  checklistTable([
    { task: 'Who is the owner / sole proprietor?', detail: 'Becomes the BUSINESS_OWNER account.' },
    { task: 'How many cashiers will need to log in?', detail: 'Each cashier = 1 seat. Solo Lite = 1, Solo Standard = 3, Solo Pro = 5.' },
    { task: 'Will there be a Sales Lead (supervisor PIN holder)?', detail: 'Solo Standard = 1 Sales Lead, Solo Pro = unlimited.' },
    { task: 'Get the name and personal email of every staff member who needs an account' },
    { task: 'Get a 4-digit numeric kiosk PIN for each cashier (they pick their own)' },
    { task: 'Confirm if any staff are kiosk-only (cooks, prep, helpers who only clock in)', detail: 'Kiosk-only accounts don\'t need login passwords.' },
  ]),

  h2('1.4 Existing workflow (so we replace, not break)'),
  checklistTable([
    { task: 'Do they currently take custom-cake pre-orders? If yes, learn their flow.', detail: 'Note: deposit amount, lead time, how they communicate with the customer, where they record it.' },
    { task: 'Do they have wholesale customers (selling bread to a coffee shop, hotel, school)?', detail: 'If yes, get the price list to pre-load.' },
    { task: 'Do they offer Senior Citizen / PWD discounts today?', detail: 'Confirm RA 9994 / RA 10754 — yes, every bakery does.' },
    { task: 'Do they discount near-expiry bread at end-of-day?', detail: 'Drives EOD markdown feature setup.' },
    { task: 'Do they accept GCash / Maya / cards / QR PH today?', detail: 'Mix tells us which tender panels they need.' },
    { task: 'How do they currently record sales? (notebook, cash register, Excel)' },
    { task: 'How do they currently file BIR (manual, accountant, software)?' },
  ]),

  h2('1.5 Inventory and recipes'),
  checklistTable([
    { task: 'Get a list of every product they sell (with retail price)' },
    { task: 'For recipe products: get the ingredient list and quantity per unit', detail: 'Example: pandesal — flour 50g, sugar 10g, yeast 2g, etc.' },
    { task: 'Get raw material list with current cost per unit', detail: 'For WAC seed value. If unsure, use last invoice price.' },
    { task: 'Get a list of perishables that need FEFO expiry tracking', detail: 'Milk, oat milk, butter, fresh cream typically. Solo Standard = 10 items.' },
    { task: 'Identify supplier-of-record per ingredient', detail: 'Goes on Vendor records.' },
  ]),

  para('Notes / open questions from intake:'),
  para(' '),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 2: HARDWARE SETUP ──
children.push(
  h1('2. Hardware setup (Day 1-2)'),
  para('Do this in person at the bakery — every minute spent troubleshooting Bluetooth pairing on the bakery floor at 6 AM is worse than the same minute spent at your desk the week before.'),

  h2('2.1 Tablet'),
  checklistTable([
    { task: 'Confirm tablet model and Android version', detail: 'Recommended: Samsung Galaxy Tab A8 10.5″ or similar Android 9+. Smaller phones work too.' },
    { task: 'Update tablet to latest Android security patches' },
    { task: 'Set tablet to landscape lock if it\'s 10″ (better for terminal)' },
    { task: 'Disable auto-rotation lock unless they specifically need it' },
    { task: 'Enable always-on screen for terminal use', detail: 'Otherwise screen times out every 30 seconds.' },
    { task: 'Add a strong screen lock (PIN at minimum — face/fingerprint OK as primary)' },
    { task: 'Disable USB debugging if it\'s on (security)' },
    { task: 'Connect to bakery WiFi and confirm internet works' },
    { task: 'Test cellular fallback (if tablet has SIM) — turn off WiFi briefly, confirm 4G works' },
  ]),

  h2('2.2 Bluetooth thermal printer'),
  checklistTable([
    { task: 'Confirm printer model (e.g. Xprinter XP-58 / Bixolon SRP-150)' },
    { task: 'Confirm printer is ESC/POS compatible (must be — we don\'t support other dialects)' },
    { task: 'Confirm paper width (58mm or 80mm) — affects layout', detail: 'Counter defaults to 58mm; configurable to 80mm in Settings → Printer.' },
    { task: 'Load thermal paper roll (not plain paper)' },
    { task: 'Power on the printer, confirm self-test prints', detail: 'Most printers print a self-test page on power-on hold.' },
    { task: 'Charge printer battery or confirm wall power' },
    { task: 'Confirm Bluetooth on tablet is on' },
    { task: 'Pair printer in tablet\'s Android Bluetooth settings (NOT just in Clerque)', detail: 'Must be system-paired before Clerque can discover it.' },
    { task: 'Open Counter → Settings → Printer → Pair → select the printer', detail: 'Should appear in the discovered list. If not, troubleshoot pairing.' },
    { task: 'Send a test print from Counter Settings → Printer → Test print', detail: 'Confirms ESC/POS works end-to-end. Receipt should print with brand name, sample line items, totals.' },
    { task: 'Ring a real test sale and print the OR — verify all fields render', detail: 'Header, TIN, OR number, items, VAT line, total, change, footer.' },
  ]),
  callout(
    'Printer reality check',
    'Cheap thermal printers can be flaky. If pairing fails, try: power-cycle printer, forget device in Android Bluetooth settings, re-pair. If still failing, the printer firmware may need updating via the manufacturer\'s app. Worst case: swap printer.',
    'warn',
  ),

  h2('2.3 Barcode scanner (optional but recommended)'),
  checklistTable([
    { task: 'If using a USB-OTG barcode scanner, confirm scanner powers via OTG cable' },
    { task: 'If using Bluetooth scanner, pair via Android Bluetooth settings' },
    { task: 'Open Counter → Sell → tap the barcode-scan icon in the search bar', detail: 'Camera should open. Scan a sample product barcode.' },
    { task: 'Confirm scanned code adds the right product to cart' },
    { task: 'If using a hardware wedge scanner, scan into the search field directly (no camera)' },
  ]),

  h2('2.4 Cash drawer (optional)'),
  checklistTable([
    { task: 'Confirm cash drawer model (Posiflex / Star / generic)' },
    { task: 'Connect drawer to printer via RJ-11 cable' },
    { task: 'Test "Open drawer" command from printer settings', detail: 'Drawer should pop open on the print of every Cash receipt.' },
    { task: 'Configure float starting amount (₱200, ₱500, ₱1000 typical for bakeries)' },
  ]),

  h2('2.5 Owner\'s phone (for spot-checks)'),
  checklistTable([
    { task: 'Confirm owner\'s phone is Android 9+', detail: 'iOS will be supported later; for pilot, Android only.' },
    { task: 'Install Counter from Play Store (Internal Testing track)' },
    { task: 'Owner signs in with their BUSINESS_OWNER credentials' },
    { task: 'Confirm phone Dashboard shows pending pickups and today\'s totals' },
    { task: 'Confirm owner can see Z-Read remotely (read-only)' },
  ]),

  para('Hardware sign-off:'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 3: TENANT CONFIGURATION ──
children.push(
  h1('3. Tenant configuration in the web admin (Day 2)'),
  para('All of this is at clerque.cc. Sign in as the bakery owner; do this together so they see how it works.'),

  h2('3.1 Tenant profile'),
  checklistTable([
    { task: 'Settings → Business → confirm business legal name matches BIR' },
    { task: 'Settings → Business → set DBA (display name)' },
    { task: 'Settings → Business → set full address' },
    { task: 'Settings → Business → set TIN (xxx-xxx-xxx-xxxxx format)' },
    { task: 'Settings → Business → set tax status (VAT / NON_VAT / UNREGISTERED)' },
    { task: 'Settings → Business → set BIR Accreditation number (if applicable)' },
    { task: 'Settings → Business → upload logo (used on web admin AND receipts if printable logo enabled)' },
  ]),

  h2('3.2 BIR / Receipt configuration'),
  checklistTable([
    { task: 'Settings → Receipt → set OR starting number (match BIR booklet)', detail: 'Critical. If their booklet starts at 000001 and they\'ve used 50, set Clerque to 000051. If they have no booklet yet, start at 000001.', bold: true },
    { task: 'Settings → Receipt → set OR series prefix (if BIR assigned one)' },
    { task: 'Settings → Receipt → set receipt header (the legal copy line on every receipt)' },
    { task: 'Settings → Receipt → set receipt footer (thank-you message, return policy)' },
    { task: 'Settings → Receipt → upload printable logo (PNG, monochrome, ~200×60px)' },
    { task: 'Settings → Receipt → set VAT registered flag matching tax status' },
    { task: 'Print a test receipt and verify header/footer/OR look right' },
  ]),

  h2('3.3 Branches'),
  checklistTable([
    { task: 'Settings → Branches → confirm default branch exists (auto-created on signup)' },
    { task: 'Edit default branch: set the proper branch name and address' },
    { task: 'If they have more than one branch, create the others now' },
  ]),

  h2('3.4 Users / Staff accounts'),
  checklistTable([
    { task: 'Users → Add user → owner already exists; confirm their permissions are correct' },
    { task: 'Users → Add user → create one account per cashier with role CASHIER' },
    { task: 'Each cashier sets their own 4-digit kiosk PIN (have them do it in person)' },
    { task: 'If using Sales Lead — promote one cashier with isSalesLead = true', detail: 'Solo Standard: 1 Sales Lead; Solo Pro: unlimited.' },
    { task: 'Add kiosk-only accounts for non-login staff (cooks, prep)', detail: 'Helpers who only clock in/out. Cannot log into apps.' },
    { task: 'For each supervisor (owner, Sales Lead), set a 4-digit supervisor PIN', detail: 'Different from kiosk PIN. Used for void approvals and inventory write-offs.' },
  ]),

  h2('3.5 Subscription'),
  checklistTable([
    { task: 'Confirm tenant is on the right Solo plan (Lite ₱199, Standard ₱399, Pro ₱499)' },
    { task: 'Confirm billing is set up and first month\'s payment cleared', detail: 'Counter won\'t let cashiers ring without an active subscription.' },
    { task: 'Confirm BusinessType is set to BAKERY (NOT Coffee Shop)', detail: 'Drives which features show up: Bake list, Pre-orders, Price lists.', bold: true },
  ]),

  para('Web configuration sign-off:'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 4: PRODUCT CATALOG ──
children.push(
  h1('4. Product catalog setup (Day 2-3)'),
  para('Build the product catalog with the owner. If they have an existing price list, work from it. Otherwise, walk the bakery and price every SKU together.'),

  h2('4.1 Categories'),
  checklistTable([
    { task: 'POS → Settings → Categories → create one category per product family', detail: 'Typical bakery: Bread, Pastry, Cake, Coffee, Cold Drinks, Add-ons.' },
    { task: 'Assign a color or icon if visible at till — helps cashier speed' },
    { task: 'Set category sort order (most-sold first)' },
  ]),

  h2('4.2 Raw materials (ingredients)'),
  checklistTable([
    { task: 'Settings → Units (UoM) → confirm or add g, kg, mL, L, pcs', detail: 'Counter ships with standard units; add custom ones if needed.' },
    { task: 'Ingredients → add every raw material with current cost (will become WAC seed)' },
    { task: 'Set each ingredient\'s unit (kg or L for bulk, pcs for things sold by piece)' },
    { task: 'Identify perishables and assign expiry tracking + 7/3/0-day alerts', detail: 'Solo Standard: pick the 10 most critical (milk, oat milk, fresh cream, butter, yeast, eggs typical). Solo Pro: unlimited.' },
    { task: 'Identify supplier-of-record per ingredient (creates Vendor records)' },
    { task: 'Receive initial stock — POS → Inventory → Adjust → INITIAL for each item', detail: 'Will seed the WAC at the supplied unit cost.' },
  ]),

  h2('4.3 Products'),
  checklistTable([
    { task: 'Products → add every product with retail price' },
    { task: 'For recipe products: open product → Recipe tab → add Bill of Materials', detail: 'Each ingredient + quantity. Pandesal: flour 50g, sugar 10g, yeast 2g, etc.' },
    { task: 'For each product, decide: is it VAT-inclusive or VAT-exempt?', detail: 'VAT-registered bakery: most items are VAT. Bread sold below ₱100 may be exempt depending on classification — check with their accountant.' },
    { task: 'Set product cost (will be overridden by WAC once recipes consume)' },
    { task: 'Upload product photos (cashier tap target; not required but helps)', detail: 'PNG/JPG, square aspect, 512×512px.' },
    { task: 'Set sort order within category (most-sold first)' },
    { task: 'Mark fast-moving products as "Show on terminal home"' },
  ]),

  h2('4.4 Modifiers (size, add-ons)'),
  checklistTable([
    { task: 'Modifiers → create groups (Size, Milk type, Sweetener)', detail: 'Coffee: Regular / Grande. Pastry: Original / Cheese topping.' },
    { task: 'Assign each modifier group to relevant products' },
    { task: 'If a modifier adds an ingredient (e.g. extra cream), add it to Modifier Recipes', detail: 'Counter → /pos/modifier-recipes → assigns ingredients per option.' },
    { task: 'Set recipe multiplier for size options', detail: 'Grande = 1.25× the base ingredients. Counter handles the scaling.' },
  ]),

  h2('4.5 Pre-orders (custom cakes)'),
  checklistTable([
    { task: 'POS → Pre-orders → walk through a sample pre-order with the owner' },
    { task: 'Configure deposit percentage (typical: 50% on order, 50% on pickup)' },
    { task: 'Confirm lead time (typical: 3-7 days for custom cakes)' },
    { task: 'Test the lifecycle: DRAFT → DEPOSIT_PAID → READY → PICKED_UP' },
  ]),

  h2('4.6 Wholesale price lists (if applicable)'),
  checklistTable([
    { task: 'POS → Price Lists → create a wholesale list', detail: 'Set discount or different prices for each product the wholesale customer buys.' },
    { task: 'POS → Customers → create the wholesale customer (coffee shop, hotel, etc.)' },
    { task: 'Assign the price list to the wholesale customer' },
    { task: 'Test: ring a sale with the wholesale customer selected, verify wholesale price applies' },
  ]),

  h2('4.7 Discount setup'),
  checklistTable([
    { task: 'Confirm Senior Citizen 20% (RA 9994) is configured — should be automatic' },
    { task: 'Confirm PWD 20% (RA 10754) is configured — should be automatic' },
    { task: 'Configure End-of-day Markdown discount (typical: 30% or 50% off near-expiry bread)' },
    { task: 'Test: apply Senior — capture name + OSCA ID — verify cart math is right' },
    { task: 'Test: apply PWD — capture name + PWD ID — verify cart math is right' },
  ]),

  para('Catalog sign-off:'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 5: SMOKE TESTING ──
children.push(
  h1('5. Smoke testing scenarios (Day 3-4)'),
  para('Walk through every scenario below with the owner watching. Each scenario is a realistic real-world flow. If anything fails or surprises the owner, stop and fix.'),

  h2('5.1 Sign in and shift open'),
  checklistTable([
    { task: 'Sign in as the owner from the tablet' },
    { task: 'Sign in as a cashier from the tablet' },
    { task: 'Verify cashier sees correct UI for BAKERY (no laundry/pharmacy nav)' },
    { task: 'Cashier opens shift with ₱500 starting float' },
    { task: 'Confirm shift appears as "open" on the cashier dashboard' },
    { task: 'Force-quit Counter and reopen — shift still shows as open', detail: 'Verifies the shift persistence fix from this sprint.' },
    { task: 'Owner can see same shift open on their phone' },
  ]),

  h2('5.2 Walk-in sale: bread + coffee'),
  checklistTable([
    { task: 'Cashier rings: 2× pandesal, 1× cappuccino, customer pays with ₱100 cash' },
    { task: 'Cart shows: subtotal, VAT line, total, change' },
    { task: 'Charge → Tendering → Cash → enter ₱100' },
    { task: 'Receipt prints with: TIN, OR number, line items, VAT, total, change' },
    { task: 'OR number on screen matches OR number on the paper receipt' },
    { task: 'Cash drawer opens (if connected)' },
  ]),

  h2('5.3 Walk-in sale with modifier'),
  checklistTable([
    { task: 'Cashier rings: 1× cappuccino, selects "Grande" modifier' },
    { task: 'Price reflects modifier surcharge (if any)' },
    { task: 'Receipt shows "Cappuccino + Grande" or similar' },
    { task: 'Behind the scenes, the recipe multiplier 1.25 drains 1.25× the base ingredients (verify via Inventory log)' },
  ]),

  h2('5.4 Senior Citizen discount sale'),
  checklistTable([
    { task: 'Customer presents Senior Citizen ID — cashier rings 3× ensaymada, 1× cappuccino' },
    { task: 'Cashier taps Apply discount → Senior Citizen 20%' },
    { task: 'Capture sheet pops up — cashier enters cardholder name + OSCA ID' },
    { task: 'Cart math: VAT-exempt strip → 20% off net → no VAT collected' },
    { task: 'Charge → Cash → enter exact amount' },
    { task: 'Receipt prints with: cardholder name, OSCA ID, VAT_EXEMPT line, RA 9994 reference' },
  ]),

  h2('5.5 PWD discount sale'),
  checklistTable([
    { task: 'Repeat same flow with PWD ID' },
    { task: 'Capture sheet asks for PWD ID and name' },
    { task: 'Receipt shows: cardholder name, PWD ID, RA 10754 reference' },
  ]),

  h2('5.6 GCash sale'),
  checklistTable([
    { task: 'Cashier rings 5× pandesal (₱50 total)' },
    { task: 'Charge → GCash' },
    { task: 'Cashier enters customer\'s GCash reference number' },
    { task: 'Receipt prints with: GCash as tender, reference number, total' },
  ]),

  h2('5.7 QR PH sale'),
  checklistTable([
    { task: 'Same as GCash but use QR PH tender option' },
    { task: 'Cashier enters InstaPay reference + optional sender name' },
    { task: 'Receipt shows: QR PH as tender, InstaPay reference' },
  ]),

  h2('5.8 Card sale (if they have a terminal)'),
  checklistTable([
    { task: 'Customer swipes/taps on bank EDC terminal' },
    { task: 'Cashier confirms approval, enters slip reference + optional last 4 of card' },
    { task: 'Receipt prints with: Card as tender, slip reference' },
  ]),

  h2('5.9 Split tender sale'),
  checklistTable([
    { task: 'Customer pays partly cash, partly GCash' },
    { task: 'Cashier selects Split, splits between tenders' },
    { task: 'Receipt shows all tenders separately with amounts' },
  ]),

  h2('5.10 Add customer to sale'),
  checklistTable([
    { task: 'Cashier creates a sale, then taps Add customer → search by name' },
    { task: 'Customer found — applied to cart' },
    { task: 'If customer has a wholesale price list, line prices update to wholesale' },
    { task: 'Receipt shows customer name in header' },
  ]),

  h2('5.11 Custom cake pre-order (full lifecycle)'),
  checklistTable([
    { task: 'Web admin → Pre-orders → Create new pre-order' },
    { task: 'Customer name, contact, cake design notes, pickup date 3 days out' },
    { task: 'Total ₱2000, deposit 50% = ₱1000' },
    { task: 'Save → status = DRAFT' },
    { task: 'Mark deposit paid (Cash ₱1000) → status = DEPOSIT_PAID' },
    { task: 'Counter phone dashboard shows pending pickup card', detail: 'Self-hiding card only renders when there are pickups today.' },
    { task: 'On pickup day, owner uses Counter to settle the balance (₱1000)' },
    { task: 'Mark picked up → status = PICKED_UP' },
    { task: 'Receipt prints with: pre-order reference, deposit applied, balance, total' },
  ]),

  h2('5.12 Void / refund'),
  checklistTable([
    { task: 'Cashier rings a sale, then immediately voids it' },
    { task: 'For void: supervisor PIN required (have Sales Lead enter theirs)' },
    { task: 'Voided OR is preserved in the system, marked VOIDED' },
    { task: 'Inventory is restored (raw materials and product stock both go back)' },
    { task: 'GL posting is reversed' },
  ]),

  h2('5.13 Close shift and Z-read'),
  checklistTable([
    { task: 'Cashier closes shift → Z-Read screen' },
    { task: 'Z-Read shows: gross sales, VAT breakdown, tender totals by method, voids, discounts' },
    { task: 'Cashier counts the drawer, enters counted cash' },
    { task: 'Variance line shows ₱0.00 (if drawer balances) or the discrepancy' },
    { task: 'Tap Print Z-Read — receipt prints with full breakdown' },
    { task: 'Shift status changes to CLOSED' },
    { task: 'Owner can see closed shift from their phone' },
  ]),

  para('Smoke test sign-off:'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 6: OWNER TRAINING ──
children.push(
  h1('6. Owner training (Day 5)'),
  para('Sit with the owner for 90 minutes. Walk through every section below. Have them do each action themselves — do not just demo.'),

  h2('6.1 Reading the dashboard'),
  checklistTable([
    { task: 'Show gross sales today on owner phone' },
    { task: 'Show today\'s pickups card (when pre-orders exist)' },
    { task: 'Show pending alerts (low stock, expiring soon)' },
    { task: 'Show how to drill into a specific Z-Read by date' },
  ]),

  h2('6.2 Managing products'),
  checklistTable([
    { task: 'Show how to add a new product' },
    { task: 'Show how to update a product\'s price' },
    { task: 'Show how to mark a product as inactive (hide from cashier)' },
    { task: 'Show how to update a recipe' },
    { task: 'Show how to receive new inventory (purchase order or quick stock-in)' },
  ]),

  h2('6.3 Managing staff'),
  checklistTable([
    { task: 'Show how to add a new cashier' },
    { task: 'Show how to deactivate a cashier (when they leave)' },
    { task: 'Show how to reset a cashier\'s PIN' },
    { task: 'Show how to assign Sales Lead' },
    { task: 'Explain Separation of Duties: who can void, who can approve discounts' },
  ]),

  h2('6.4 Reports'),
  checklistTable([
    { task: 'Show daily sales report' },
    { task: 'Show top-selling products report' },
    { task: 'Show staff performance report' },
    { task: 'Show profit margin per product (uses WAC)' },
    { task: 'Show BIR-ready exports (sales book, purchase book)' },
    { task: 'Show how to export any report to XLSX for their accountant' },
  ]),

  h2('6.5 Audit log'),
  checklistTable([
    { task: 'Show audit log: who voided what, when, why' },
    { task: 'Explain: audit log is INSERT-only, tamper-proof at the DB level' },
    { task: 'Show how to spot suspicious patterns (multiple voids by one cashier, etc.)' },
  ]),

  h2('6.6 Their rights as a data subject'),
  checklistTable([
    { task: 'Show /legal/privacy — what we collect and why' },
    { task: 'Show /legal/account-deletion — their RA 10173 deletion rights' },
    { task: 'Explain what is retained per BIR (10 years for receipts, even after deletion)' },
    { task: 'Give them the DPO email and phone' },
  ]),

  h2('6.7 What to do when things go wrong'),
  checklistTable([
    { task: 'Show how to file a support ticket' },
    { task: 'Show how to escalate to the founder phone' },
    { task: 'Walk through the fall-back: handwritten OR booklet if Clerque is down (BIR requirement)' },
    { task: 'Explain: in offline mode, sales survive — Z-Read totals will catch up when reconnect' },
  ]),

  para('Training sign-off (owner signature):'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 7: BIR COMPLIANCE ──
children.push(
  h1('7. BIR compliance verification (Day 5)'),
  para('Run through every BIR touchpoint before going live. A single missing item is a real exam risk.'),

  checklistTable([
    { task: 'TIN on receipt matches BIR registration', bold: true },
    { task: 'Business name on receipt matches DTI/SEC registration' },
    { task: 'Business address on receipt matches BIR registration' },
    { task: 'OR number sequence matches BIR-printed booklet (if applicable)', bold: true },
    { task: 'OR series prefix matches BIR-assigned series' },
    { task: 'VAT line correctly shown for VAT-registered tenant' },
    { task: 'For VAT: VATable sales, VAT-exempt sales, VAT amount lines all present' },
    { task: 'For Non-VAT: header reads "Official Receipt" with VAT-exempt total' },
    { task: 'For Unregistered: header reads "Acknowledgement Receipt / Resibo ng Pagtanggap"' },
    { task: 'Senior Citizen receipt: RA 9994 reference printed' },
    { task: 'PWD receipt: RA 10754 reference printed' },
    { task: 'Z-Read includes VAT breakdown by category' },
    { task: 'Z-Read includes voids count and value' },
    { task: 'Z-Read includes OR range issued during the shift' },
    { task: 'Z-Read is printable on paper (not just on screen)' },
    { task: 'BIR-printed OR booklet kept on premises as fallback (BIR requirement)', detail: 'If Clerque is offline beyond outbox capacity, cashier MUST be able to issue manual OR.' },
    { task: 'Sales Detail Report exportable in BIR format (CSV/XLSX)' },
    { task: 'Purchase Book exportable in BIR format' },
    { task: 'Forms 2550M / 2550Q exportable' },
    { task: 'Alphalists exportable in BIR-required format' },
  ]),

  callout(
    'Annual BIR books',
    'BIR-registered businesses must file annual books of accounts. Clerque exports the sales journal in their required format. Make sure the bakery owner knows where to find this in the admin — under /ledger/reports.',
  ),

  para('BIR compliance sign-off:'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 8: SOFT LAUNCH ──
children.push(
  h1('8. Soft launch (Day 6)'),
  para('Cashier rings real sales for the first time, with you present. One full day. No real customers should be lost or charged wrong.'),

  checklistTable([
    { task: 'Be onsite from 30 minutes before opening to 30 minutes after closing' },
    { task: 'First sale of the day: owner rings it themselves — do not delegate' },
    { task: 'Watch first 5 transactions closely — any error, stop and document' },
    { task: 'Confirm cashier is comfortable with cart, modifiers, discounts' },
    { task: 'Verify printer continues to print reliably (no jamming, no missed prints)' },
    { task: 'Track every minor issue in a notes column (will become Day 7 fixes)' },
    { task: 'If WiFi flakes, observe the offline experience — note any UI confusion' },
    { task: 'At end of day, do Z-Read together with cashier, then reconcile' },
    { task: 'Variance under ₱100? Acceptable for day 1. Above? Investigate.' },
    { task: 'Owner reviews the day\'s sales report — does the total feel right vs typical Saturday?' },
  ]),

  para('Soft launch sign-off:'),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 9: GO-LIVE MONITORING ──
children.push(
  h1('9. Go-live monitoring (Day 7+)'),
  para('First full week of production use. You don\'t need to be onsite — but check in daily.'),

  checklistTable([
    { task: 'Daily check-in call (5 min) at end of business day for the first week' },
    { task: 'Review crash reports (if any) on Play Console' },
    { task: 'Review Z-Read variance trend — if consistently > ₱100, investigate cashier error patterns' },
    { task: 'Review printer reliability — any failed prints?' },
    { task: 'Review network reliability — any outbox-drain spikes after WiFi outage?' },
    { task: 'Owner feedback: what do they wish Clerque did?' },
    { task: 'Cashier feedback: what is slow / confusing?' },
    { task: 'Update this checklist with anything you learned for the next pilot' },
  ]),

  para('Week 1 retrospective:'),
  para(' '),
  para(' '),
  para(' '),
  lineBreak(),
);

// ── SECTION 10: ROLLBACK PLAN ──
children.push(
  h1('10. Rollback plan if things go sideways'),
  para('If Clerque becomes unusable during pilot, here is the fall-back. Have this written down BEFORE day 1.'),

  h2('10.1 Soft fall-back (1-2 hour outage)'),
  para('Cashier reverts to BIR-printed OR booklet. Records sales on paper. At end of day, owner enters them into Clerque retroactively for record-keeping.'),

  h2('10.2 Hard fall-back (1+ day outage)'),
  para('Same as 10.1 plus: post a service-disruption notice to the bakery customers. Contact Clerque founder immediately. Daily reconciliation continues in BIR booklet until Clerque restored.'),

  h2('10.3 Data loss recovery'),
  para('Railway runs daily backups (after we enable Railway native backups). RPO 24h. In the worst case, the last 24h of sales would need to be re-entered from the OR booklet.'),

  h2('10.4 Communication tree'),
  checklistTable([
    { task: 'Bakery owner phone: ___________________' },
    { task: 'Lead cashier phone: ___________________' },
    { task: 'Clerque founder phone: ___________________' },
    { task: 'Clerque founder email: ___________________' },
    { task: 'Bank / acquirer support (for card issues): ___________________' },
    { task: 'GCash merchant support: 2882 (from any phone in PH)' },
    { task: 'BIR hotline (for regulatory questions): 8538-3200' },
  ]),

  para('Rollback plan sign-off:'),
  para(' '),
  para(' '),
);

// ── APPENDIX: SIGN-OFF SHEET ──
children.push(
  h1('Appendix A — Final sign-off'),
  para('When every section above has been completed and ticked, sign here. By signing, both parties confirm that the bakery is ready to operate on Clerque for live customer transactions.'),
  para(' '),
  para(' '),

  infoTable([
    { label: 'Bakery owner signature',                value: '' },
    { label: 'Bakery owner printed name',             value: '' },
    { label: 'Date',                                  value: '' },
    { label: ' ',                                     value: ' ' },
    { label: 'Clerque project lead signature',        value: '' },
    { label: 'Clerque project lead printed name',     value: '' },
    { label: 'Date',                                  value: '' },
  ]),

  para(' '),
  para(' '),
  callout(
    'Reminder',
    'Both parties keep a signed copy of this checklist. This document is the audit trail of pilot readiness and protects both sides if a dispute ever arises about whether something was demonstrated, tested, or trained on before go-live.',
  ),
);

// ─── Build the document ─────────────────────────────────────────────
const doc = new Document({
  creator: 'Clerque',
  title: 'Bakery Pilot — Pre-Launch Checklist',
  description: 'Working checklist for onboarding a Clerque bakery pilot.',

  styles: {
    default: {
      document: { run: { font: 'Arial', size: 22 } },
    },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 36, bold: true, font: 'Arial', color: BROWN_DK },
        paragraph: { spacing: { before: 280, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 28, bold: true, font: 'Arial', color: INK },
        paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run:       { size: 24, bold: true, font: 'Arial', color: BROWN },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ],
  },

  numbering: {
    config: [
      { reference: 'bullets',
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] },
    ],
  },

  sections: [{
    properties: {
      page: {
        size:   { width: 12240, height: 15840 },     // US Letter portrait
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }, // 0.75"
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Clerque — Bakery Pilot Pre-Launch Checklist', font: 'Arial', size: 18, color: MUTED, italics: true })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          tabStops: [
            { type: TabStopType.CENTER, position: 4320 },
            { type: TabStopType.RIGHT,  position: 9000 },
          ],
          children: [
            new TextRun({ text: '© 2026 HNS Corporation Philippines', font: 'Arial', size: 18, color: MUTED }),
            new TextRun({ text: '\t', font: 'Arial' }),
            new TextRun({ text: 'CLERQUE_BAKERY_PILOT_CHECKLIST.docx', font: 'Arial', size: 18, color: MUTED }),
            new TextRun({ text: '\t', font: 'Arial' }),
            new TextRun({ text: 'Page ', font: 'Arial', size: 18, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: 18, color: MUTED }),
            new TextRun({ text: ' of ', font: 'Arial', size: 18, color: MUTED }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: 18, color: MUTED }),
          ],
        })],
      }),
    },
    children,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'CLERQUE_BAKERY_PILOT_CHECKLIST.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outPath, buf);
  console.log('✓ Wrote', outPath);
  console.log('  Size:', (buf.length / 1024).toFixed(1), 'KB');
}).catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
