import {
  CAPTION_LIMIT, MESSAGE_LIMIT, SaleForAlert, boughtMessage, buyListSentMessage, escapeHtml, photoCaption, postedMessage, saleMessage,
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
    expect(text).toContain('<b>Sale ORD-2026-000123</b>  ₱365.00');
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
    expect(text.match(/<b>/g)).toHaveLength(1);   // only our own bold
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

  it('posted lists only what went on the shelf', () => {
    const text = postedMessage(req, 'Anne', at);
    expect(text).toContain('<b>In stock: PR-2026-0012</b>  ₱380.00');
    expect(text).toContain('• Whole milk: 4 packs × 1000 ml');
    expect(text).not.toContain('Espresso');
  });

  it('escapeHtml leaves nothing Telegram would read as markup', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href="x"&gt;&amp;&lt;/a&gt;');
  });
});
