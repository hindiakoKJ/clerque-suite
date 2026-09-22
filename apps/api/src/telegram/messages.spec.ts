import {
  CAPTION_LIMIT, MESSAGE_LIMIT, SaleForAlert, USAGE_ROWS_SHOWN, UsageForAlert, boughtMessage, buyListSentMessage, buyListUpdatedMessage, dailyUsageMessage, escapeHtml,
  lateSalesNote, manilaDayLabel, paidWith, photoCaption, postedMessage, saleMessage, usageQty, WeeklyCountForAlert, weeklyCountMessage,
} from './messages';

/** What the owner reads on their phone. */
describe('Telegram alert messages', () => {
  const sale = (over: Partial<SaleForAlert> = {}): SaleForAlert => ({
    shopName: 'Cafe Carolina', branchName: 'Main', orderNumber: 'ORD-2026-000123', cashierName: 'Maria',
    channel: 'POS', paidAt: new Date('2026-09-15T10:42:00+08:00'), createdAt: new Date('2026-09-15T10:42:03+08:00'),
    subtotal: 365, discountAmount: 0, vatAmount: 39.11, totalAmount: 365,
    items: [
      { name: 'Café Latte ( Hot )', quantity: 2, unitPrice: 135, lineTotal: 270, modifiers: [{ name: 'Oat milk', price: 15 }] },
      { name: 'Croissant', quantity: 1, unitPrice: 95, lineTotal: 95, modifiers: [] },
    ],
    payments: [{ method: 'GCASH_BUSINESS', amount: 365 }],
    discountTypes: [],
    ...over,
  });

  /** The text inside <pre>, unescaped, as the phone shows it. */
  const receipt = (html: string) => html.split('<pre>')[1].split('</pre>')[0]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

  it('a sale reads like a receipt, 32 characters wide, in Manila time', () => {
    const text = saleMessage(sale());
    // The first line is the phone's notification preview: the sale, the amount and how it was paid.
    expect(text.split('\n')[0]).toBe('🧾 <b>Sale ORD-2026-000123</b>  ₱365.00 - <b>GCash</b>');
    expect(text).toContain('Cafe Carolina · Main');
    const lines = receipt(text).split('\n');
    expect(lines.every((l) => [...l].length <= 32)).toBe(true);
    expect(lines[0]).toBe('Sep 15, 10:42 AM  Maria');
    expect(lines).toContain('Café Latte ( Hot )');
    expect(lines.find((l) => l.startsWith('  2 × 135.00'))).toMatch(/270\.00$/);
    expect(lines).toContain('  + Oat milk (+15.00)');
    expect(lines.find((l) => l.startsWith('TOTAL'))).toMatch(/₱365\.00$/);
    expect(lines.find((l) => l.startsWith('VAT included'))).toMatch(/39\.11$/);
    expect(lines.find((l) => l.startsWith('GCash'))).toMatch(/365\.00$/);
    expect(text).toContain('not an official receipt');
  });

  it('names the discount but never carries an ID, a customer or a TIN', () => {
    const text = saleMessage(sale({ discountAmount: 73, totalAmount: 292, discountTypes: ['SENIOR_CITIZEN'] }));
    expect(receipt(text).split('\n').find((l) => l.startsWith('Senior discount'))).toMatch(/-73\.00$/);
    // SaleForAlert has no field for them, so nothing can leak by accident.
    expect(Object.keys(sale())).not.toEqual(expect.arrayContaining(['pwdScIdRef']));
  });

  it('escapes what the shop typed, so a product name cannot break the message', () => {
    const text = saleMessage(sale({ items: [{ name: 'Tea <b>&</b> "Milk"', quantity: 1, unitPrice: 50, lineTotal: 50, modifiers: [] }] }));
    expect(text).toContain('Tea &lt;b&gt;&amp;&lt;/b&gt; "Milk"');
    expect(text.match(/<b>/g)).toHaveLength(2);   // only our own bold: the sale and how it was paid
  });

  describe('how the sale was paid', () => {
    it('a cash sale says Cash in the headline and shows no reference, even if one was saved', () => {
      const text = saleMessage(sale({ orderNumber: 'ORD-2026-000086', totalAmount: 216, payments: [{ method: 'CASH', amount: 216, reference: 'till 2' }] }));
      expect(text.split('\n')[0]).toBe('🧾 <b>Sale ORD-2026-000086</b>  ₱216.00 - <b>Cash</b>');
      expect(receipt(text).split('\n').find((l) => l.startsWith('Cash'))).toMatch(/^Cash +216\.00$/);
      expect(text).not.toContain('till 2');
    });

    it('a split payment names each way once, in the order taken', () => {
      const text = saleMessage(sale({ payments: [
        { method: 'CASH', amount: 100 },
        { method: 'GCASH_PERSONAL', amount: 165, reference: '1234567' },
        { method: 'GCASH_BUSINESS', amount: 100, reference: '7654321' },
      ] }));
      expect(text.split('\n')[0]).toBe('🧾 <b>Sale ORD-2026-000123</b>  ₱365.00 - <b>Cash + GCash</b>');
      expect(paidWith([{ method: 'MAYA_BUSINESS' }, { method: 'CARD' }, { method: 'QR_PH' }])).toBe('Maya + Card + QR Ph');
    });

    it('shows the reference the cashier typed next to a non-cash payment', () => {
      const lines = receipt(saleMessage(sale({ payments: [
        { method: 'CASH', amount: 100 },
        { method: 'GCASH_BUSINESS', amount: 265, reference: ' 1234567 ' },
      ] }))).split('\n');
      expect(lines.find((l) => l.startsWith('GCash'))).toMatch(/^GCash #1234567 +265\.00$/);
      expect(lines.find((l) => l.startsWith('Cash'))).toMatch(/^Cash +100\.00$/);
      expect(lines.every((l) => [...l].length <= 32)).toBe(true);
    });

    it('a non-cash payment with no reference typed shows just the method', () => {
      for (const reference of [undefined, null, '', '   ']) {
        const lines = receipt(saleMessage(sale({ payments: [{ method: 'MAYA_PERSONAL', amount: 365, reference }] }))).split('\n');
        expect(lines.find((l) => l.startsWith('Maya'))).toMatch(/^Maya +365\.00$/);
        expect(lines.some((l) => l.includes('#'))).toBe(false);
      }
    });

    it('a long reference goes whole on its own line, never cut short beside the amount', () => {
      const ref = '9021345678123456789012';   // 22 digits: too long to share a 32-character line with the amount
      const lines = receipt(saleMessage(sale({ totalAmount: 12365, payments: [{ method: 'QR_PH', amount: 12365, reference: ref }] }))).split('\n');
      const at = lines.findIndex((l) => l.startsWith('QR Ph'));
      expect(lines[at]).toMatch(/^QR Ph +12,365\.00$/);
      expect(lines[at + 1]).toBe(`  #${ref}`);
      expect(lines.every((l) => [...l].length <= 32)).toBe(true);
    });

    it('a reference cannot break the message or the layout', () => {
      const text = saleMessage(sale({ payments: [{ method: 'CARD', amount: 365, reference: '<b>12\n34</b>' }] }));
      expect(text).toContain('Card #&lt;b&gt;12 34&lt;/b&gt;');
      expect(text.match(/<b>/g)).toHaveLength(2);
    });

    it('a sale with no payment rows keeps the plain headline', () => {
      expect(saleMessage(sale({ payments: [] })).split('\n')[0]).toBe('🧾 <b>Sale ORD-2026-000123</b>  ₱365.00');
    });
  });

  it('an offline sale says so, with when it reached Clerque', () => {
    const text = saleMessage(sale({ paidAt: new Date('2026-09-15T10:02:00+08:00'), createdAt: new Date('2026-09-15T10:40:00+08:00') }));
    expect(text).toContain('Rung up offline · reached Clerque Sep 15, 10:40 AM');
    expect(receipt(text).split('\n')[0]).toMatch(/^Sep 15, 10:02 AM/);
  });

  it('a huge order still fits Telegram\'s limit and says how many items are not shown', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ name: `Item number ${i} with a longer name & more`, quantity: 1, unitPrice: 10, lineTotal: 10, modifiers: [{ name: 'Extra shot', price: 20 }] }));
    const text = saleMessage(sale({ items }));
    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(text).toMatch(/…and \d+ more items/);
    expect(text).toContain('</pre>');
  });

  const req = {
    shopName: 'Cafe Carolina', branchName: 'Main', requestNumber: 'PR-2026-0012',
    lines: [
      { name: 'Whole milk', unit: 'ml', packsBought: 4, packSize: 1000, packCost: 95, received: true },
      { name: 'Espresso beans', unit: 'g', packsBought: 2, packSize: 1000, packCost: 850, received: false },
      { name: 'Ice', unit: 'kg', packsBought: null, packSize: null, packCost: null, received: false },
    ],
  };
  const at = new Date('2026-09-15T15:10:00+08:00');

  it('a sent buy list lists what to buy, in the email\'s words', () => {
    const text = buyListSentMessage(req, [{ name: 'Whole milk', amount: '4 packs (4,000 ml)' }], 'Anne', at);
    expect(text).toContain('<b>Buy list PR-2026-0012 sent</b>');
    expect(text).toContain('Sent by Anne · Sep 15, 3:10 PM');
    expect(text).toContain('• Whole milk: 4 packs (4,000 ml)');
    expect(buyListSentMessage(req, [], null, at)).toContain('All clear');
  });

  it('an updated buy list names only the changed lines, with what a raised one was', () => {
    const text = buyListUpdatedMessage(req, [
      { name: 'Whole milk', amount: '3 packs (3,000 ml) (was 2 packs (2,000 ml))' },
      { name: 'Tissue roll (new item from the Kitchen screen)', amount: '4 roll' },
    ], 'Kitchen screen', at);
    const lines = text.split('\n');
    expect(lines[0]).toBe('🛒 <b>Buy list PR-2026-0012 updated</b>');
    expect(lines[1]).toBe('Cafe Carolina · Main');
    expect(lines[2]).toBe('Added by Kitchen screen · Sep 15, 3:10 PM');
    expect(text).toContain('• Whole milk: 3 packs (3,000 ml) (was 2 packs (2,000 ml))');
    expect(text).toContain('• Tissue roll (new item from the Kitchen screen): 4 roll');
  });

  it('an updated buy list escapes what the shop typed', () => {
    const text = buyListUpdatedMessage({ ...req, shopName: 'Tom & Jerry <Cafe>' }, [{ name: 'Syrup <b>&</b>', amount: '2 > 1' }], 'A<b>', at);
    expect(text).toContain('Tom &amp; Jerry &lt;Cafe&gt;');
    expect(text).toContain('• Syrup &lt;b&gt;&amp;&lt;/b&gt;: 2 &gt; 1');
    expect(text).toContain('Added by A&lt;b&gt;');
    expect(text).not.toContain('<b>&</b>');
  });

  it('an updated buy list with hundreds of lines fits Telegram and says how many are left out', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ name: `Ingredient number ${i} with a long name`, amount: '12 packs (12,000 ml) (was 10 packs (10,000 ml))' }));
    const text = buyListUpdatedMessage(req, many, null, at);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(text).toMatch(/…and \d+ more$/);
    expect(text.split('\n')[2]).toBe('Sep 15, 3:10 PM');
  });

  it('bought shows each line and the total paid', () => {
    const text = boughtMessage(req, 'Maria', at);
    expect(text).toContain('<b>Bought: PR-2026-0012</b>  ₱2,080.00');
    const lines = receipt(text).split('\n');
    expect(lines.find((l) => l.startsWith('  4 packs × 1000 ml'))).toMatch(/380\.00$/);
    expect(lines.find((l) => l.startsWith('TOTAL'))).toMatch(/₱2,080\.00$/);
    expect(text).not.toContain('Ice');   // not bought yet
  });

  it('a later trip onto a bought request says what it added and the new total', () => {
    const text = boughtMessage(req, 'Maria', at, { items: 1, value: 1700 });
    expect(text).toContain('<b>Bought more: PR-2026-0012</b>  +₱1,700.00');
    expect(text).toContain('Added now: 1 item, ₱1,700.00. Request total ₱2,080.00.');
  });

  it('a photo caption stays under Telegram\'s 1024 characters', () => {
    const cap = photoCaption({ ...req, shopName: 'X'.repeat(2000) }, 'Receipt', 'Maria', at);
    expect(cap.length).toBeLessThanOrEqual(CAPTION_LIMIT);
    expect(photoCaption(req, 'Receipt', 'Maria', at)).toContain('Bought on this request: ₱2,080.00 (2 items)');
  });

  /*
    A staff buy on a shop that hides purchase costs: packs only. The price is
    last time's, or none at all the first time. The owner is the one person
    who must see both -- the unpriced line was dropped ("Bought: ₱0.00" over
    an empty list) and last time's price read as the receipt's.
  */
  const staffBuy = {
    ...req,
    lines: [
      { name: 'Ice', unit: 'kg', packsBought: 2, packSize: 5, packCost: null, received: false },
      { name: 'Whole milk', unit: 'ml', packsBought: 4, packSize: 1000, packCost: 95, received: false, lastPrice: true },
      { name: 'Espresso beans', unit: 'g', packsBought: null, packSize: null, packCost: null, received: false },
    ],
  };

  it('a staff buy lists the line with no price as "price to add", and says the total is so far', () => {
    const text = boughtMessage(staffBuy, 'Barista', at);
    expect(text).toContain('<b>Bought: PR-2026-0012</b>  ₱380.00 so far');
    const lines = receipt(text).split('\n');
    expect(lines).toContain('Ice');
    expect(lines.find((l) => l.startsWith('  2 packs × 5 kg'))).toMatch(/price to add$/);
    expect(lines.find((l) => l.startsWith('TOTAL so far'))).toMatch(/₱380\.00$/);
    expect(text).toContain('1 item still needs the price from the receipt.');
    expect(text).not.toContain('Espresso');   // not bought
  });

  it("marks last time's price for the owner to check against the receipt", () => {
    const text = boughtMessage(staffBuy, 'Barista', at);
    expect(receipt(text).split('\n').find((l) => l.startsWith('  4 packs × 1000 ml'))).toMatch(/380\.00\*$/);
    expect(text).toContain("* Last time's price. Check it against the receipt.");
  });

  it('a first staff buy with nothing priced is still listed, not "₱0.00" over nothing', () => {
    const first = { ...req, lines: [{ name: 'Ice', unit: 'kg', packsBought: 2, packSize: 5, packCost: null, received: false }] };
    const text = boughtMessage(first, 'Barista', at);
    expect(receipt(text)).toContain('Ice');
    expect(text).toContain('1 item still needs the price from the receipt.');
    expect(photoCaption(first, 'Receipt', 'Barista', at)).toContain('Bought on this request: ₱0.00 so far (1 item)');
    expect(photoCaption(first, 'Receipt', 'Barista', at)).not.toContain('Nothing recorded as bought');
  });

  it('a photo caption counts the lines still to price and those at last time\'s price', () => {
    const cap = photoCaption(staffBuy, 'Receipt', 'Barista', at);
    expect(cap).toContain('Bought on this request: ₱380.00 so far (2 items)');
    expect(cap).toContain('1 item still needs the price from the receipt.');
    expect(cap).toContain("1 item at last time's price. Check against the receipt.");
  });

  it('a fully priced buy reads exactly as before: no "so far", no notes', () => {
    const text = boughtMessage(req, 'Maria', at);
    expect(text).not.toMatch(/so far|still need|Last time/);
    expect(photoCaption(req, 'Receipt', 'Maria', at)).not.toMatch(/so far|still need|last time/);
  });

  it('posted lists only what went on the shelf', () => {
    const text = postedMessage(req, 'Anne', at);
    expect(text).toContain('<b>In stock: PR-2026-0012</b>  ₱380.00');
    expect(text).toContain('• Whole milk: 4 packs × 1000 ml');
    expect(text).not.toContain('Espresso');
  });

  // ── end of day ──────────────────────────────────────────────────────────

  const usage = (over: Partial<UsageForAlert> = {}): UsageForAlert => ({
    shopName: 'Cafe Carolina', branchName: 'Main', day: '2026-09-16',
    rows: [
      { name: 'Fresh Milk', unit: 'ml', costPrice: 0.095, total: 8100, wasted: 1200, writtenOff: 0 },
      { name: 'Espresso Beans', unit: 'g', costPrice: 0.85, total: 1250, wasted: 0, writtenOff: 300 },
      { name: 'Paper Cups 12oz', unit: 'pcs', costPrice: 4, total: 64, wasted: 0, writtenOff: 0 },
    ],
    totalValue: 2081.75,
    stillBeingMade: 0,
    lateSales: 0,
    ...over,
  });

  it("the day's usage reads like the handwritten sheet: branch, date, each ingredient in kg and L", () => {
    const text = dailyUsageMessage(usage());
    const [title, place, date] = text.split('\n');
    expect(title).toBe('📋 <b>Ingredients used today</b>');
    expect(place).toBe('Cafe Carolina · Main');
    expect(date).toBe('Wed, Sep 16');
    const lines = receipt(text).split('\n');
    expect(lines.every((l) => [...l].length <= 32)).toBe(true);
    expect(lines[0]).toMatch(/^Fresh Milk +8\.1 L$/);
    expect(lines[1]).toMatch(/^ {2}of it wasted +1\.2 L$/);
    expect(lines[2]).toMatch(/^Espresso Beans +1\.25 kg$/);
    expect(lines[3]).toMatch(/^ {2}of it written off +300 g$/);
    expect(lines[4]).toMatch(/^Paper Cups 12oz +64 pcs$/);
    expect(lines.find((l) => l.startsWith('VALUE AT COST'))).toMatch(/₱2,081\.75$/);
    // The escaped ">" is what Telegram shows as ">".
    expect(text.endsWith('Full list: Inventory &gt; Ingredients &gt; Reports')).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
  });

  it('humanises only grams and millilitres, and only from 1,000 up', () => {
    expect(usageQty(8100, 'ml')).toBe('8.1 L');
    expect(usageQty(1000, 'g')).toBe('1 kg');
    expect(usageQty(999, 'ml')).toBe('999 ml');
    // Rounded as it would show: never "1,000 g".
    expect(usageQty(999.996, 'g')).toBe('1 kg');
    expect(usageQty(1500, 'G')).toBe('1.5 kg');
    expect(usageQty(12345.678, 'ml')).toBe('12.35 L');
    expect(usageQty(2500, 'pcs')).toBe('2,500 pcs');
    expect(usageQty(0.0125, 'L')).toBe('0.0125 L');
    expect(usageQty(3, '')).toBe('3');
  });

  it('says nothing about value when no ingredient has a cost, and says which are left out when some have none', () => {
    const none = dailyUsageMessage(usage({ rows: usage().rows.map((r) => ({ ...r, costPrice: 0 })), totalValue: 0 }));
    expect(none).not.toContain('VALUE');
    expect(none).not.toContain('₱');
    const some = receipt(dailyUsageMessage(usage({ rows: usage().rows.map((r, i) => ({ ...r, costPrice: i === 2 ? 0 : r.costPrice })) })));
    expect(some).toContain('  1 has no cost, not counted');
  });

  it('no split line for an ingredient nothing was wasted or written off of', () => {
    const lines = receipt(dailyUsageMessage(usage({ rows: [{ name: 'Sugar', unit: 'g', costPrice: 0.07, total: 650, wasted: 0, writtenOff: 0 }] }))).split('\n');
    expect(lines[0]).toMatch(/^Sugar +650 g$/);
    expect(lines[1]).toBe('-'.repeat(32));
  });

  it('shows the top 25 by value and counts the rest as "+N more"', () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ name: `Ingredient ${i}`, unit: 'g', costPrice: 1, total: 1000 - i, wasted: 0, writtenOff: 0 }));
    const lines = receipt(dailyUsageMessage(usage({ rows }))).split('\n');
    expect(USAGE_ROWS_SHOWN).toBe(25);
    expect(lines.filter((l) => l.startsWith('Ingredient '))).toHaveLength(25);
    expect(lines[24]).toMatch(/^Ingredient 24 /);
    expect(lines).toContain('+35 more');
  });

  it('a list that would pass the 4096-character limit drops rows from the end and counts them in "+N more"', () => {
    // Every character escapes to five: 25 rows of these do not fit.
    const rows = Array.from({ length: 40 }, (_, i) => ({ name: `${'&'.repeat(40)}${i}`, unit: 'ml', costPrice: 1, total: 2000, wasted: 500, writtenOff: 250 }));
    const text = dailyUsageMessage(usage({ rows, totalValue: 80000 }));
    expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    expect(text).toContain('</pre>');
    expect(text.endsWith('Reports')).toBe(true);
    const shown = receipt(text).split('\n').filter((l) => l.startsWith('&')).length;
    expect(shown).toBeLessThan(25);
    expect(receipt(text)).toContain(`+${40 - shown} more`);
  });

  it('escapes ingredient, shop and branch names', () => {
    const text = dailyUsageMessage(usage({
      shopName: 'Kape <i>&</i> Co', branchName: 'SM <Naga>',
      rows: [{ name: 'Tea <b>&</b>', unit: 'g', costPrice: 1, total: 5, wasted: 0, writtenOff: 0 }],
    }));
    expect(text).toContain('Kape &lt;i&gt;&amp;&lt;/i&gt; Co · SM &lt;Naga&gt;');
    expect(text).toContain('Tea &lt;b&gt;&amp;&lt;/b&gt;');
    expect(text.match(/<b>/g)).toHaveLength(1);
    expect(text.match(/<i>/g)).toBeNull();
  });

  it('a day with sales but nothing counted says why, and items still at a screen are called out', () => {
    expect(dailyUsageMessage(usage({ rows: [], totalValue: 0 }))).toContain('The items sold may have no recipe yet.');
    const waiting = dailyUsageMessage(usage({ rows: [], totalValue: 0, stillBeingMade: 3 }));
    expect(waiting).toContain('No ingredients were counted yet.');
    expect(waiting).toContain('3 items still at the kitchen or bar screen are not counted yet.');
    expect(waiting).not.toContain('<pre>');
    expect(dailyUsageMessage(usage({ stillBeingMade: 1 }))).toContain('1 item still at the kitchen or bar screen is not counted yet.');
  });

  it('says how many sales rung up offline reached Clerque after their sheet, before the pointer to the full list', () => {
    const lines = dailyUsageMessage(usage({ lateSales: 3 })).split('\n');
    expect(lines[lines.length - 2]).toBe("3 sales rung up offline reached Clerque after their day's sheet went out. No sheet counts them; the report page does.");
    expect(dailyUsageMessage(usage({ lateSales: 1 }))).toContain("1 sale rung up offline reached Clerque after its day's sheet went out. No sheet counts it; the report page does.");
    expect(dailyUsageMessage(usage())).not.toContain('reached Clerque');
    expect(lateSalesNote(2)).toBe("2 sales rung up offline reached Clerque after their day's sheet went out. No sheet counts them; the report page does.");
  });

  it('a sheet sent only for late sales does not blame missing recipes', () => {
    const text = dailyUsageMessage(usage({ rows: [], totalValue: 0, lateSales: 2 }));
    expect(text).toContain('No ingredients were counted.');
    expect(text).not.toContain('recipe');
    expect(text).toContain('2 sales rung up offline');
  });

  it("labels the business day in Manila, whatever the server's timezone", () => {
    expect(manilaDayLabel('2026-09-16')).toBe('Wed, Sep 16');
    expect(manilaDayLabel('2027-01-01')).toBe('Fri, Jan 1');
  });

  it('escapeHtml leaves nothing Telegram would read as markup', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });

  it('puts the weekly count\'s sentence before the pointer to the full list, only when there is one', () => {
    const lines = dailyUsageMessage(usage({ countNote: 'Weekly count from Sep 21 is recorded. 5 items differ from the book.' })).split('\n');
    expect(lines[lines.length - 2]).toBe('Weekly count from Sep 21 is recorded. 5 items differ from the book.');
    expect(dailyUsageMessage(usage({ countNote: null }))).not.toContain('Weekly count');
  });

  describe('a weekly count sent from a kitchen or bar screen', () => {
    const count = (over: Partial<WeeklyCountForAlert> = {}): WeeklyCountForAlert => ({
      shopName: 'Cafe Carolina', branchName: 'Main', stationName: 'Kitchen', countNumber: 'CC-2026-000012', countedBy: 'Joy',
      sentAt: new Date('2026-09-21T21:12:00+08:00'), recount: false, counted: 23, total: 25,
      lines: [
        { name: 'Eggs', unit: 'pc', counted: 22, book: 24 },
        { name: 'Milk', unit: 'ml', counted: 2100, book: 3400 },
        { name: 'Sugar', unit: 'g', counted: 5200, book: 5000 },
        { name: 'Rice', unit: 'g', counted: 800, book: 800 },
      ],
      notCounted: ['Salt', 'Cooking oil'],
      ...over,
    });

    it('says who counted, how many differ, the furthest off first, and that nothing has moved', () => {
      const lines = weeklyCountMessage(count()).split('\n');
      expect(lines[0]).toBe('📝 <b>Weekly count sent: Kitchen</b>');
      expect(lines[1]).toBe('Cafe Carolina · Main');
      expect(lines[2]).toMatch(/^Counted by Joy \(Kitchen screen\) · Sep 21, 9:12\sPM$/);
      expect(lines[3]).toBe('23 of 25 items counted. 3 differ from the book.');
      expect(lines.slice(5, 8)).toEqual([
        '• Milk: counted 2.1 L, book 3.4 L, short 1.3 L',
        '• Eggs: counted 22 pc, book 24 pc, short 2 pc',
        '• Sugar: counted 5.2 kg, book 5 kg, over 200 g',
      ]);
      expect(lines).toContain('Not counted: Salt, Cooking oil');
      // KJ's words: a record, not a posting, and where to make the book match.
      expect(lines[lines.length - 1]).toBe(
        'Recorded. Nothing has moved. To make the book match the shelf, open Procure &gt; Counts (CC-2026-000012) and tap Adjust the books to match.',
      );
      expect(lines.join('\n')).not.toContain('Rice');
    });

    it('when everything matches, says so and lists nothing', () => {
      const text = weeklyCountMessage(count({ lines: [{ name: 'Rice', unit: 'g', counted: 800, book: 800 }], counted: 1, total: 1, notCounted: [] }));
      expect(text).toContain('1 of 1 items counted. All 1 match the book.');
      expect(text).not.toContain('•');
      expect(text).not.toContain('Not counted');
    });

    it('a recount is titled so and lists every recounted line, matches too', () => {
      const text = weeklyCountMessage(count({ recount: true, lines: [{ name: 'Milk', unit: 'ml', counted: 3400, book: 3400 }], notCounted: [] }));
      expect(text.split('\n')[0]).toBe('📝 <b>Recount sent: Kitchen</b>');
      // How many were counted again, not "1 of 25": the rest of the sheet was never asked for.
      expect(text.split('\n')[3]).toBe('1 item counted again. All 1 match the book.');
      expect(text).toContain('• Milk: counted 3.4 L, book 3.4 L, matches');
      expect(text).not.toContain('Not counted');
    });

    it('a full count that also answered a recount is a weekly count, every difference listed, and names what was recounted', () => {
      const lines = weeklyCountMessage(count({ recounted: ['Milk', 'Eggs'] })).split('\n');
      expect(lines[0]).toBe('📝 <b>Weekly count sent: Kitchen</b>');
      expect(lines[3]).toBe('23 of 25 items counted. 3 differ from the book.');
      expect(lines).toContain('• Sugar: counted 5.2 kg, book 5 kg, over 200 g');
      expect(lines).toContain('Recounted: Milk, Eggs');
      expect(lines).toContain('Not counted: Salt, Cooking oil');
    });

    it('escapes every name, typed or not', () => {
      const text = weeklyCountMessage(count({
        shopName: 'A&B <Cafe>', stationName: 'Bar <1>', countedBy: '<b>Joy</b>',
        lines: [{ name: 'Milk & <cream>', unit: 'ml', counted: 1, book: 2 }], notCounted: ['<Salt>'],
      }));
      expect(text).toContain('A&amp;B &lt;Cafe&gt;');
      expect(text).toContain('Weekly count sent: Bar &lt;1&gt;');
      expect(text).toContain('Counted by &lt;b&gt;Joy&lt;/b&gt;');
      expect(text).toContain('• Milk &amp; &lt;cream&gt;: counted');
      expect(text).toContain('Not counted: &lt;Salt&gt;');
      expect(text.replace(/<\/?b>/g, '')).not.toMatch(/[<>]/);
    });

    it('a 200-line count with 200 items not counted still fits one message, and says how many were left off', () => {
      const lines = Array.from({ length: 200 }, (_, i) => ({ name: `Ingredient number ${i} with a long name`, unit: 'g', counted: i, book: 1000 + i }));
      const text = weeklyCountMessage(count({ lines, counted: 200, total: 400, notCounted: lines.map((l) => `Not ${l.name}`) }));
      expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
      expect(text).toMatch(/…and \d+ more/);
      expect(text).toMatch(/and 185 more$/m);
      expect(text).toContain('Adjust the books to match.');
    });
  });
});
