/**
 * Generates docs/Solo-Books-How-To.docx — the client-facing how-to for the
 * Solo Books tier (full POS + simple bookkeeping). Plain language, grade-6,
 * eatery/bakery examples. Run with the global `docx` package on NODE_PATH.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, BorderStyle, PageBreak, TableOfContents,
} = require('docx');

const BROWN = '8B5E3C';
const BROWN_DARK = '5C3D26';
const MUTED = '7A6A55';

// section content. answer kinds: {steps:[...]}, {bullets:[...]}, {text:'...'}
const SECTIONS = [
  {
    title: 'Welcome to Solo Books',
    what: 'What you can do, in plain words.',
    when: 'Read this first.',
    items: [
      { q: 'What is Solo Books?', a: { text: 'It is your full cash register (POS) plus simple bookkeeping — for ₱399 a month. You ring up sales, take payments, print receipts, and track your stock. And you keep simple books: record your expenses, money coming in, and the owner’s cash — all kept correct automatically.' } },
      { q: 'What do I need to start?', a: { bullets: [
        'A laptop, tablet, or computer with a web browser (Chrome works best).',
        'Your menu/price list and your list of supplies (we’ll import them).',
        'A receipt printer (optional) and a cash drawer.',
      ] } },
      { q: 'How is this guide laid out?', a: { bullets: [
        'Part 1 — Load your menu and stock (one-time setup).',
        'Part 2 — Selling at the till (every day).',
        'Part 3 — Your books (record expenses, owner cash, money owed).',
        'Part 4 — What’s included, and what an upgrade adds.',
      ] } },
    ],
  },
  {
    title: 'Part 1 — Load your menu and stock',
    what: 'A one-time setup using ready-made templates (Excel files).',
    when: 'On your first day, before you start selling.',
    items: [
      { q: 'Where do I get the templates?', a: { text: 'In Clerque, go to Settings → Import Templates and download the ones you need. Your onboarding pack also includes them. Each file has instructions at the top and a few sample rows to copy.' } },
      { q: 'Which templates do I use, and in what order?', a: { steps: [
        'Ingredients — list your raw materials (flour, milk, cups) with their unit and cost.',
        'Products — list everything you sell, with selling price and cost.',
        'Recipes — link each product to its ingredients (so cost is auto-computed).',
        'Inventory — set your opening stock counts.',
        'Customers — only if you let customers buy on account (charge sales). Optional.',
      ] } },
      { q: 'Is there a faster way?', a: { text: 'Yes. The Setup Pack is one file with two sheets — Products and Inventory — so you can stand up your menu and opening stock in a single upload. Use this if you don’t need recipe-based costing yet.' } },
      { q: 'What are the most important rules when filling them?', a: { bullets: [
        'Name must be unique and spelled the same everywhere (Products, Recipes, Inventory all match by Name).',
        'Cost Price is required on Products — it’s what the item costs you. Enter 0 only if it’s genuinely free.',
        'Category — if it doesn’t exist yet, Clerque creates it. Keep spelling consistent.',
        'Remove the sample rows before you upload.',
        'Save as .xlsx (or .csv).',
      ] } },
      { q: 'How do I upload them?', a: { steps: [
        'Products: POS → Products → Import.',
        'Ingredients & Recipes: POS → Inventory → Ingredients / Recipes → Import.',
        'Inventory: pick your branch first (POS → Inventory), then Import.',
        'Re-uploading is safe — matching rows update, new rows are added.',
      ] } },
    ],
  },
  {
    title: 'Part 2 — Selling at the till',
    what: 'Your everyday cash-register flow.',
    when: 'Open of business through close.',
    items: [
      { q: 'How do I start the day?', a: { steps: [
        'Log in at clerque.cc with your account.',
        'A box asks for your starting cash — count the coins/bills in the drawer and type that amount.',
        'Tap Open Shift. The till is ready.',
      ] } },
      { q: 'How do I ring up a sale?', a: { bullets: [
        'Tap the item buttons, or type to search, or scan a barcode.',
        'If an item has choices (size, add-ons), pick them.',
        'Tap Checkout when the customer is ready to pay.',
      ] } },
      { q: 'How do I take payment?', a: { steps: [
        'Choose how they’re paying: Cash, GCash, Maya, QR Ph, or Card.',
        'For cash, type what they handed you — the change shows automatically.',
        'To split (part cash, part GCash), add another payment until the balance is zero.',
        'Confirm. The receipt appears — print it or hand the browser print.',
      ] } },
      { q: 'How do I give a Senior or PWD discount?', a: { steps: [
        'Before checkout, tap PWD / SC discount.',
        'Pick the qualifying items and enter the ID number, name, and birthdate.',
        'The 20% discount is computed for you. Confirm.',
      ] } },
      { q: 'I paid a small cost from the drawer (ice, tip). How do I record it?', a: { steps: [
        'Tap Cash Out → Paid-Out.',
        'Type the amount and reason. Optional: snap the receipt.',
        'Confirm. The cash leaves the drawer and it’s recorded as an expense.',
      ] } },
      { q: 'How do I close the day?', a: { steps: [
        'Tap Close Shift.',
        'Count the actual cash and type it in — the system shows what it expected.',
        'You get the Z-read (end-of-day summary). Print or screenshot it.',
      ] } },
    ],
  },
  {
    title: 'Part 3 — Your books (simple bookkeeping)',
    what: 'Record money that doesn’t go through the till, and see what you’re owed.',
    when: 'As things happen — paying rent, owner cash, etc.',
    items: [
      { q: 'How do I record an expense paid OUTSIDE the till (rent, bills)?', a: { steps: [
        'Go to Ledger → Record Entry.',
        'Tap Expense, pick the category (Rent, Utilities, Supplies…).',
        'Enter the amount and date, choose Paid from: Cash or Bank/GCash/Maya.',
        'Add a note (e.g. “June rent”) and tap Save. It’s in your books, correctly.',
      ] } },
      { q: 'What else can Record Entry do?', a: { bullets: [
        'Other income — money in that isn’t a sale (e.g. selling scrap).',
        'Owner put in — owner adds money to the business.',
        'Owner took out — owner takes money for personal use.',
        'Cash → Bank / Bank → Cash — when you deposit till cash or withdraw.',
      ] } },
      { q: 'When do I use Record Entry vs the till’s Cash Out?', a: { text: 'Use the till’s Paid-Out (Cash Out) for small costs paid from the drawer during a shift. Use Record Entry for anything paid another way — rent by bank, a supplier by GCash, owner’s cash — or when no shift is open.' } },
      { q: 'I made a mistake. How do I undo an entry?', a: { steps: [
        'Go to Ledger → Record Entry and find it in the Recent entries list.',
        'Tap Reverse next to it and confirm.',
        'It posts an opposite entry to cancel it out. The original stays for your records, marked Reversed.',
      ] } },
      { q: 'Where do I see money customers still owe me?', a: { text: 'If you sold on account (charge sale), go to Ledger → POS-derived AR. It lists who owes you and how much. Record their payment there when they pay.' } },
      { q: 'How do I track GCash/Maya money and my cash position?', a: { bullets: [
        'Settlement — match your e-wallet sales to the money that actually landed in your account.',
        'Cash Position — a quick view of cash on hand vs in the bank.',
        'Everything you do here keeps your books correct automatically.',
      ] } },
    ],
  },
  {
    title: 'Part 4 — What’s included, and what an upgrade adds',
    what: 'So you know where the line is.',
    when: 'When you wonder “can I do X here?”',
    items: [
      { q: 'What’s included in Solo Books (₱399)?', a: { bullets: [
        'The complete POS — unlimited products, recipes, inventory, all payment types, receipts, Z-read, up to 5 staff.',
        'Simple bookkeeping — Record Entry (expenses, income, owner cash, transfers), money owed, settlement, cash position.',
        'Everything you record posts to real, correct books.',
      ] } },
      { q: 'What needs the full-accounting upgrade (₱799)?', a: { bullets: [
        'Formal financial statements (Profit & Loss, Balance Sheet, Cash Flow statement).',
        'BIR forms (2550Q, 1701Q, 2551Q) and the journal / chart of accounts.',
        'Supplier accounts payable (bills on terms), formal AR invoicing, bank reconciliation, period close.',
      ] } },
      { q: 'If I upgrade later, do I lose my data?', a: { text: 'No. Everything you recorded on Solo Books is already in your books. Upgrading just unlocks the advanced screens on top of the same data.' } },
    ],
  },
  {
    title: 'Need help?',
    what: 'Quick support.',
    when: 'Anytime you’re stuck.',
    items: [
      { q: 'Where can I get help inside the app?', a: { text: 'Tap Help & Guide in the menu — you can search any topic. Most screens also have a short explainer at the top.' } },
      { q: 'Who do I contact?', a: { text: 'Email support@hnscorpph.com, or message your Clerque contact. For anything about your bill or plan, mention your business name.' } },
    ],
  },
];

// ── Render ──
const children = [];
children.push(
  new Paragraph({ spacing: { before: 2200 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Clerque · Solo Books', bold: true, size: 64, color: BROWN, font: 'Arial' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 },
    children: [new TextRun({ text: 'How-To Guide', size: 40, color: BROWN_DARK, font: 'Arial' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 },
    children: [new TextRun({ text: 'Full point of sale + simple bookkeeping', italics: true, size: 24, color: MUTED, font: 'Arial' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2200 },
    children: [new TextRun({ text: 'For cafés, bakeries, and small eateries', size: 22, color: MUTED, font: 'Arial' })] }),
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'What’s inside' })] }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }),
  new Paragraph({ children: [new PageBreak()] }),
);

SECTIONS.forEach((sec, i) => {
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: i === 0 ? 0 : 360, after: 60 },
      children: [new TextRun({ text: sec.title })] }),
    new Paragraph({ spacing: { after: 40 }, children: [
      new TextRun({ text: 'What it is: ', bold: true, color: BROWN, size: 20 }),
      new TextRun({ text: sec.what, size: 20 }) ] }),
    new Paragraph({ spacing: { after: 160 }, children: [
      new TextRun({ text: 'When you use it: ', bold: true, color: BROWN, size: 20 }),
      new TextRun({ text: sec.when, size: 20 }) ] }),
  );
  sec.items.forEach((it) => {
    children.push(new Paragraph({ spacing: { before: 120, after: 40 },
      children: [new TextRun({ text: it.q, bold: true, size: 22, color: BROWN_DARK })] }));
    const a = it.a;
    if (a.text) children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: a.text, size: 21 })] }));
    else if (a.steps) a.steps.forEach((s) => children.push(new Paragraph({ numbering: { reference: 'steps', level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: s, size: 21 })] })));
    else if (a.bullets) a.bullets.forEach((b) => children.push(new Paragraph({ numbering: { reference: 'bullets', level: 0 }, spacing: { after: 20 }, children: [new TextRun({ text: b, size: 21 })] })));
  });
});

children.push(new Paragraph({ spacing: { before: 480 }, alignment: AlignmentType.CENTER,
  border: { top: { style: BorderStyle.SINGLE, size: 6, color: BROWN, space: 8 } },
  children: [new TextRun({ text: 'Clerque · Built for Philippine small businesses', italics: true, size: 18, color: MUTED })] }));

const doc = new Document({
  creator: 'Clerque', title: 'Clerque Solo Books — How-To Guide',
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: BROWN },
        paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
    ],
  },
  numbering: { config: [
    { reference: 'steps',   levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 300 } } } }] },
    { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 560, hanging: 300 } } } }] },
  ] },
  sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
});

const outPath = path.join(__dirname, '..', 'docs', 'Solo-Books-How-To.docx');
Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(outPath, buf); console.log('Wrote', outPath, '(' + buf.length + ' bytes)'); });
