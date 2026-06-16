/**
 * Generates the plain-English Clerque Counter user guide (.docx).
 * Audience: a non-technical bakery owner or a brand-new cashier.
 * Run with the globally-installed `docx` package on NODE_PATH.
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  LevelFormat, BorderStyle, PageBreak, TableOfContents,
} = require('docx');

// ── Brand theme (matches the pilot checklist + pricing collateral) ──────────
const BROWN = '8B5E3C';
const BROWN_DARK = '5C3D26';
const CREAM_TEXT = '7A6A55';

// ── Content. Each section = one POS page (or cross-cutting topic). ──────────
// answer kinds: {steps:[...]}, {bullets:[...]}, {text:'...'}
const SECTIONS = [
  {
    title: 'Before you start',
    what: 'What Clerque Counter is, and how to read this guide.',
    when: 'Read this page once, then keep the booklet near the till.',
    items: [
      { q: 'What is Clerque Counter?', a: { text: 'It is your cash register on a tablet or computer. You tap what the customer buys, take their payment, and print a receipt. It also keeps track of your stock, your sales, and your money — automatically.' } },
      { q: 'How do I read this guide?', a: { bullets: [
        'Each page of the app has its own short section here.',
        'Look for "What it is" and "When you use it" at the top of each section.',
        'Steps are numbered. Just follow them one by one.',
        'You do NOT need to read this front to back. Jump to the part you need.',
      ] } },
      { q: 'What if something looks different on my screen?', a: { text: 'Your bakery may have some pages turned off, or named slightly differently. That is normal. The steps still work the same way.' } },
    ],
  },
  {
    title: 'Logging in & opening your day',
    what: 'How to sign in and start your sales for the day.',
    when: 'Every morning, or whenever a new cashier takes over the till.',
    items: [
      { q: 'How do I sign in?', a: { steps: [
        'Open the website given to you (clerque.cc).',
        'Type your Tenant ID (your shop name code), your email, and your password.',
        'Tap "Sign in".',
      ] } },
      { q: 'What is "opening a shift"?', a: { steps: [
        'A box appears asking for your starting cash.',
        'Count the coins and bills already in the drawer (your money for giving change).',
        'Type that amount and tap "Open Shift".',
        'The till is now ready. Only one shift can be open per cashier at a time.',
      ] } },
      { q: 'How do I close my day?', a: { steps: [
        'Tap "Close Shift" at the top-right.',
        'The app shows how much cash it expects in the drawer.',
        'Count the real cash and type it in.',
        'The app records any difference (over or short) with your name. Do not change the count to match — just enter the truth.',
      ] } },
    ],
  },
  {
    title: 'Terminal — making a sale',
    what: 'The button grid and cart where every sale happens.',
    when: 'All day long, every time a customer buys something.',
    items: [
      { q: 'How do I add items to the cart?', a: { bullets: [
        'Tap the picture/button of the item (e.g. Pandesal).',
        'Or scan its barcode with a scanner.',
        'Or type its name in the search bar.',
        'Tip: type "5x" before tapping an item to add five at once.',
      ] } },
      { q: 'How do I take payment?', a: { steps: [
        'Tap "Checkout".',
        'Choose how they are paying: Cash, GCash, Maya, QR Ph, or Card.',
        'For cash, type how much they handed you — the change is shown automatically.',
        'Tap "Confirm". The receipt appears.',
      ] } },
      { q: 'Can I split one bill across two payments?', a: { steps: [
        'On the payment screen, tap a method and enter part of the amount.',
        'Tap "Add another payment".',
        'Choose the second method and enter the rest.',
        'When the remaining amount reaches zero, tap "Confirm".',
      ] } },
      { q: 'How do I give a Senior Citizen or PWD discount?', a: { steps: [
        'Before checkout, tap "PWD / SC discount".',
        'Pick which items qualify (by law: food and medicine).',
        'Type the customer ID number, name, and birthdate (required for records).',
        'The 20% discount is computed for you. Confirm.',
      ] } },
      { q: 'A customer wants to pay later / come back. What do I do?', a: { steps: [
        'Tap "Park" in the cart.',
        'Give it a label like "Table 4" or the customer name.',
        'Serve the next customer. To return, tap "Open Parked Sales" and pick it.',
      ] } },
    ],
  },
  {
    title: 'Cash out (money leaving the drawer)',
    what: 'Recording cash that legitimately leaves the till during the day.',
    when: 'When you pay a small expense in cash, or hand cash to the owner for safekeeping.',
    items: [
      { q: 'What is the difference between "Paid-Out" and "Cash Drop"?', a: { bullets: [
        'Paid-Out — a real expense paid from the drawer (e.g. tip for a delivery rider, buying ice). It is recorded as an expense.',
        'Cash Drop — moving cash to the safe for safekeeping. Not an expense, just moving money to a safer place.',
        'Both lower the cash the app expects at closing, so your count still matches.',
      ] } },
      { q: 'How do I record a paid-out?', a: { steps: [
        'Tap "Cash Out" at the top.',
        'Choose "Paid-Out".',
        'Type the amount and the reason.',
        'Optional: snap a photo of the receipt. Confirm.',
      ] } },
    ],
  },
  {
    title: 'Products',
    what: 'The list of everything you sell.',
    when: 'When you add a new item, change a price, or fix a cost.',
    items: [
      { q: 'How do I add a new product?', a: { steps: [
        'Go to Products, then tap "+ New Product".',
        'Type the Name, Category, Selling Price, and Cost Price (what it costs YOU to make).',
        'If it is genuinely free to make, type 0 — but never leave Cost blank.',
        'Tap Save. It shows up on the till right away.',
      ] } },
      { q: 'Why is "Cost Price" required?', a: { text: 'So the app can tell you your real profit. Selling price minus cost price is your profit. Without the cost, the app thinks everything is pure profit, which is not true.' } },
      { q: 'What is "Unit-Based" vs "Recipe-Based"?', a: { bullets: [
        'Unit-Based — each sale removes one finished item from stock (e.g. a bottled drink).',
        'Recipe-Based — each sale removes the ingredients used (e.g. one ensaymada removes flour, butter, sugar, cheese). Best for things you bake yourself.',
      ] } },
    ],
  },
  {
    title: 'Ingredients (your supplies)',
    what: 'Track raw materials and supplies — flour, butter, milk, boxes.',
    when: 'When stock arrives, when you set up your shop, or to check what is running low.',
    items: [
      { q: 'How do I add an ingredient?', a: { steps: [
        'Go to Ingredients, then tap "+ New Ingredient".',
        'Type its name, unit (grams, ml, pieces), cost, and how much you have now.',
        'Optional: set a "Low stock alert" number so the app warns you to reorder.',
      ] } },
      { q: 'New stock arrived. How do I add it?', a: { steps: [
        'Find the ingredient in the list.',
        'Tap "Receive stock".',
        'Type how much arrived and the price you paid. Save.',
      ] } },
      { q: 'What do "LOW" and "OUT" mean?', a: { bullets: [
        'OUT — you have zero. The item cannot be sold until you restock.',
        'LOW — you are at or below your alert number. You can still sell, but reorder soon.',
      ] } },
    ],
  },
  {
    title: 'Modifier recipes (sizes & add-ons)',
    what: 'Tell the app what each option (size or add-on) uses in ingredients.',
    when: 'Once, when you set up choices like sizes or "extra cheese". After that it works by itself.',
    items: [
      { q: 'What are the two parts of this page?', a: { bullets: [
        'Recipe x (the multiplier) — for sizes. It says how much of the normal recipe a size uses. Normal = 1. A Large that uses one-and-a-quarter = 1.25. A small using half = 0.5.',
        'Adds on top of base recipe — for add-ons. Extra ingredients an option puts in. Example: "Oat milk" adds 240 ml of oat milk.',
      ] } },
      { q: 'My Large uses more dough. How do I set it?', a: { steps: [
        'Open the size group and find the "Large" option.',
        'In the box next to "Recipe x", type how much more it uses (e.g. 1.25).',
        'Tap "Save changes".',
      ] } },
      { q: 'A customer can add extra cheese. How do I track it?', a: { steps: [
        'Open the group with "Extra cheese".',
        'Under "Adds on top of base recipe", tap "Add ingredient".',
        'Pick Cheese, type how much it adds (e.g. 20), tap "Save changes".',
      ] } },
      { q: 'What is "Est. COGS"?', a: { text: 'It means "what the ingredients cost you". It is a quick estimate so you can check your add-on price is fair. The app works it out for you.' } },
    ],
  },
  {
    title: 'Price lists (special/wholesale prices)',
    what: 'Give certain customers their own lower prices.',
    when: 'When you sell to a coffee shop, hotel, or reseller in bulk at a deal price.',
    items: [
      { q: 'How do I set a wholesale price?', a: { steps: [
        'Type a name like "Wholesale (cafes)" and tap "Create list".',
        'Tap "Edit prices", then "Add product" and pick the item.',
        'In the "Override" box, type their special price. Your normal price shows as "Default".',
        'Tap "Save price list".',
      ] } },
      { q: 'How does the customer get these prices?', a: { text: 'Making the list is step one. You must link the list to the customer on their profile. After that, ringing up that customer uses their special prices automatically.' } },
      { q: 'What is "Min qty"?', a: { text: 'The smallest amount they must buy to get the deal price (e.g. 50 pieces). Leave it blank and the price always applies.' } },
    ],
  },
  {
    title: 'Units (grams, ml, pieces)',
    what: 'The measuring words your shop uses.',
    when: 'Set up early, and when you buy in one unit but bake in another.',
    items: [
      { q: 'How do I add a unit?', a: { steps: [
        'Tap "Add Unit".',
        'Type the full name (e.g. "Piece") and short form (e.g. "PC").',
        'Tap "Add Unit" to save.',
      ] } },
      { q: 'I buy flour by the sack but bake in grams. How do I link them?', a: { steps: [
        'Add or edit the "Sack" unit.',
        'Under Conversion, set Base Unit to "G" (grams).',
        'In Factor, type how many grams are in one sack (e.g. 25000).',
        'Save. Now the app understands 1 sack = 25,000 g.',
      ] } },
    ],
  },
  {
    title: 'Close & Plan (evening routine)',
    what: 'Your night-time routine: wrap up today and prepare tomorrow, on one screen.',
    when: 'At closing time, before going home. Takes 5-15 minutes.',
    items: [
      { q: 'What do I do each night?', a: { steps: [
        'Look at "Today recap" for your sales and order count.',
        'Add any supplies that were delivered today under "Today’s deliveries".',
        'Check "Tomorrow’s plan" to see what to bake and who is picking up.',
        'Tap "Print morning briefing" and stick the sheet on the kitchen wall.',
      ] } },
      { q: 'A "Possible duplicate" warning appeared. What is it?', a: { text: 'The app thinks you may have already entered this delivery. If it is the same one, tap "Skip". If it is truly a separate delivery, tap "It’s real — save anyway".' } },
      { q: 'What is the "Use first" list?', a: { text: 'Perishable supplies that should be used soon so nothing is wasted. Use items marked "Use first" before newer stock. "Expired" means do not use.' } },
    ],
  },
  {
    title: 'Bake list',
    what: 'A daily list telling the baker how many of each item to make.',
    when: 'In the morning before baking, or the night before.',
    items: [
      { q: 'How does the app decide the numbers?', a: { text: 'It takes the bigger of two things: your average daily sales over the last 7 days, and any pre-orders for that day. So you never run short and never forget a promised cake.' } },
      { q: 'How do I print it for the kitchen?', a: { steps: [
        'Pick the date (Today / Tomorrow / pick a day).',
        'Tap the purple "Print" button at the top right.',
      ] } },
      { q: 'It says "Nothing to bake yet". Why?', a: { text: 'Normal for a new shop. The app needs a few days of sales (or pre-orders) before it can suggest amounts. Keep selling and the numbers will appear.' } },
    ],
  },
  {
    title: 'Pre-orders (custom cakes & advance orders)',
    what: 'Your logbook for custom cakes and advance orders.',
    when: 'When a customer reserves ahead, and again when they pick up.',
    items: [
      { q: 'How do I write down a custom cake order?', a: { steps: [
        'Tap "New pre-order".',
        'Choose the customer (or "Walk-in / unknown").',
        'Set the pickup date and time, and the cake message ("Inscription").',
        'Add the items and quantities.',
        'Type the deposit paid, then tap "Create pre-order".',
      ] } },
      { q: 'The cake is ready. How do I mark it?', a: { text: 'Find the order and tap the green check-circle on its row. The tag changes to "Ready".' } },
      { q: 'How do deposits and balances work?', a: { text: 'The deposit is money already received. The leftover is the "Balance due on pickup", which the customer pays at the counter when they collect.' } },
    ],
  },
  {
    title: 'Orders',
    what: 'A list of past sales — to look up, reprint, or cancel.',
    when: 'When a customer needs another receipt, or a sale must be voided.',
    items: [
      { q: 'How do I reprint a receipt?', a: { steps: [
        'Go to Orders and open the order.',
        'Tap "Reprint Receipt".',
      ] } },
      { q: 'How do I cancel (void) a completed order?', a: { steps: [
        'Go to Orders, find it, tap "Void".',
        'Type the reason.',
        'If you are a cashier, hand the device to a supervisor to enter their PIN.',
        'Confirm. The sale is reversed and stock is returned.',
      ] } },
    ],
  },
  {
    title: 'Staff (your workers)',
    what: 'Add your workers and choose what each is allowed to do.',
    when: 'When you hire, change a role, or someone leaves.',
    items: [
      { q: 'How do I add a cashier?', a: { steps: [
        'Tap "Add Staff".',
        'Type their name, email, and a starting password (8+ characters).',
        'Pick the role "Cashier".',
        'Tap "Create Staff".',
      ] } },
      { q: 'My cook only needs to clock in/out. What do I do?', a: { steps: [
        'Tap "Add Staff", type name and email.',
        'Type a Kiosk PIN (e.g. 1234).',
        'Tick "Clock-only employee", then "Create Staff".',
      ] } },
      { q: 'A worker left. How do I block their login?', a: { steps: [
        'Find their name.',
        'Tap the on/off toggle on the far right. Their status becomes "INACTIVE".',
      ] } },
    ],
  },
  {
    title: 'Promotions (sales & discounts)',
    what: 'Set up deals so the register lowers the price by itself.',
    when: 'When you run a sale, like "20% off day-old bread".',
    items: [
      { q: 'How do I make a "20% off" deal?', a: { steps: [
        'Tap "New Promotion" and name it.',
        'Leave Discount Type on "Percentage", type 20.',
        'Under "Applies To", choose "Specific products" and tick the item.',
        'Tap "Create Promotion".',
      ] } },
      { q: 'How do I end a sale?', a: { text: 'You turn it off, you do not delete it. Find the promotion, tap the trash-can icon, then "Deactivate". You can switch it back on later.' } },
    ],
  },
  {
    title: 'Pending Sync (offline sales)',
    what: 'Sales you made while the internet was down, waiting to upload.',
    when: 'When your internet drops, and when it comes back.',
    items: [
      { q: 'The internet went out. Did I lose my sales?', a: { text: 'No. Every sale is saved safely here. You will see an orange "Offline" tag. Keep selling normally.' } },
      { q: 'The internet is back. How do I upload?', a: { steps: [
        'Open the Pending Sync page.',
        'Tap "Sync Now" at the top right.',
        'Wait a moment; the list empties as sales upload.',
      ] } },
      { q: 'One sale says "FAILED". What do I do?', a: { text: 'Tap "Sync Now" again — it often works the second time. If it keeps failing, tell your manager. Do not delete it.' } },
    ],
  },
  {
    title: 'Sales Report',
    what: 'A summary of how much you sold and earned.',
    when: 'At the end of the day, week, or month.',
    items: [
      { q: 'How do I see this week’s sales?', a: { steps: [
        'Open Sales Report.',
        'Tap "Last 7d" (or 30d / 90d, or pick exact dates).',
      ] } },
      { q: 'What do the top boxes mean?', a: { bullets: [
        'Total Revenue — all the money that came in.',
        'Gross Profit — what is left after what items cost you.',
        'Avg Order Value — the typical spend per customer.',
        'Voids — cancelled orders (not counted as earnings).',
      ] } },
      { q: 'How do I send this to my bookkeeper?', a: { steps: [
        'Pick your dates.',
        'Tap "Export CSV". A file downloads that opens in Excel.',
      ] } },
    ],
  },
  {
    title: 'Displays (extra screens)',
    what: 'Connect a customer-facing TV or a kitchen monitor.',
    when: 'When you want a screen showing orders to customers or bakers.',
    items: [
      { q: 'How do I connect a customer-facing TV?', a: { steps: [
        'Find the "Customer-facing display" card.',
        'Tap "Generate pairing code". A 4-digit number and QR code appear.',
        'On the TV, open the address shown (or scan the QR) and type the 4-digit number.',
      ] } },
      { q: 'The code disappeared. What happened?', a: { text: 'For safety the code only lasts a short time. Just tap "Generate pairing code" again for a fresh number.' } },
    ],
  },
  {
    title: 'If something goes wrong',
    what: 'Quick fixes for the most common problems.',
    when: 'Whenever the app misbehaves.',
    items: [
      { q: 'A page won’t load or looks broken.', a: { text: 'Hold Ctrl + Shift + R to refresh fully. If it still fails, sign out and sign back in.' } },
      { q: 'The thermal printer is not printing.', a: { steps: [
        'Tap the Printer icon at the top. If it says "Disconnected", tap to pair.',
        'Check the printer is on and has paper.',
        'As a fallback, tap "Browser Print" for a normal print dialog.',
      ] } },
      { q: 'My closing cash does not match.', a: { text: 'Enter the real count anyway — never change it to match. Write a note about the possible cause. Your manager reviews it later.' } },
      { q: 'I still need help.', a: { text: 'Open Help & Guide inside the app (search any topic), or email support@hnscorpph.com.' } },
    ],
  },
];

// ── Rendering helpers ───────────────────────────────────────────────────────
const children = [];

// Cover page
children.push(
  new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Clerque Counter', bold: true, size: 72, color: BROWN, font: 'Arial' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120 },
    children: [new TextRun({ text: 'The Plain-English Guide', size: 40, color: BROWN_DARK, font: 'Arial' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240 },
    children: [new TextRun({ text: 'Everything you need to run the till — explained simply.', italics: true, size: 24, color: CREAM_TEXT, font: 'Arial' })] }),
  new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 2400 },
    children: [new TextRun({ text: 'For cashiers, bakers, and owners', size: 22, color: CREAM_TEXT, font: 'Arial' })] }),
  new Paragraph({ children: [new PageBreak()] }),
);

// Table of contents
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: 'What’s inside', bold: true })] }),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-1' }),
  new Paragraph({ children: [new PageBreak()] }),
);

// Sections
SECTIONS.forEach((sec, i) => {
  children.push(
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: i === 0 ? 0 : 360, after: 60 },
      children: [new TextRun({ text: sec.title })] }),
    new Paragraph({ spacing: { after: 40 },
      children: [
        new TextRun({ text: 'What it is: ', bold: true, color: BROWN, size: 20 }),
        new TextRun({ text: sec.what, size: 20 }),
      ] }),
    new Paragraph({ spacing: { after: 160 },
      children: [
        new TextRun({ text: 'When you use it: ', bold: true, color: BROWN, size: 20 }),
        new TextRun({ text: sec.when, size: 20 }),
      ] }),
  );

  sec.items.forEach((it) => {
    children.push(new Paragraph({ spacing: { before: 120, after: 40 },
      children: [new TextRun({ text: it.q, bold: true, size: 22, color: BROWN_DARK })] }));

    const a = it.a;
    if (a.text) {
      children.push(new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: a.text, size: 21 })] }));
    } else if (a.steps) {
      a.steps.forEach((s) => children.push(new Paragraph({
        numbering: { reference: 'steps', level: 0 },
        spacing: { after: 20 }, children: [new TextRun({ text: s, size: 21 })] })));
    } else if (a.bullets) {
      a.bullets.forEach((b) => children.push(new Paragraph({
        numbering: { reference: 'bullets', level: 0 },
        spacing: { after: 20 }, children: [new TextRun({ text: b, size: 21 })] })));
    }
  });
});

// Footer note
children.push(
  new Paragraph({ spacing: { before: 480 }, alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: BROWN, space: 8 } },
    children: [new TextRun({ text: 'Clerque · Made for Philippine small businesses', italics: true, size: 18, color: CREAM_TEXT })] }),
);

const doc = new Document({
  creator: 'Clerque',
  title: 'Clerque Counter — Plain-English Guide',
  styles: {
    default: { document: { run: { font: 'Arial', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 30, bold: true, font: 'Arial', color: BROWN },
        paragraph: { spacing: { before: 320, after: 120 }, outlineLevel: 0 } },
    ],
  },
  numbering: {
    config: [
      { reference: 'steps', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 560, hanging: 300 } } } }] },
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 560, hanging: 300 } } } }] },
    ],
  },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
    children,
  }],
});

const outPath = path.join(__dirname, '..', 'docs', 'CLERQUE_COUNTER_USER_GUIDE.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(outPath, buf);
  console.log('Wrote', outPath, '(' + buf.length + ' bytes)');
});
