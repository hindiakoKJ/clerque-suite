import PDFDocument from 'pdfkit';
import {
  buildBuyListModel, renderBuyListPdf, pdfSafe, BuyListSource, BuyListSourceLine, BUY_LIST_PDF_LABEL,
} from './purchase-request-pdf';

/**
 * The buy list as paper. What matters on the page: every line carries the
 * control number posting uses, in order; the copy handed to the kitchen and
 * the group chat never carries a price; and the booked copy shows money only
 * to someone allowed to see it.
 */
describe('buy list PDF', () => {
  const SENT_AT = new Date('2026-09-13T06:05:00Z');   // 2:05 PM in Manila

  function line(n: string, over: Partial<BuyListSourceLine> = {}): BuyListSourceLine {
    return {
      lineNumber: `REQ-20260913-001-${n}`, name: `Item ${n}`, unit: 'ml', qtyRequested: 1000,
      onHand: 250, counted: null, lastPackSize: null,
      packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null,
      ...over,
    };
  }
  function source(lines: BuyListSourceLine[], over: Partial<BuyListSource> = {}): BuyListSource {
    return {
      shopName: 'Cafe Carolina', requestNumber: 'REQ-20260913-001', status: 'SENT', branchName: 'Main',
      sentAt: SENT_AT, sentBy: 'Anne', receivedAt: null, notes: null, lines, ...over,
    };
  }
  const NOW = new Date('2026-09-14T01:00:00Z');

  it('prints each Line No. exactly as stored, in number order, never renumbered', () => {
    // A string sort puts -10 before -02 and -100 before -11; a renumbering
    // would print a number posting never used.
    const numbers = ['07', '12', '01', '100', '10', '02', '11', '03', '09', '04', '06', '05', '08'];
    const m = buildBuyListModel(source(numbers.map((n) => line(n))), { copy: 'sent', showMoney: false, printedAt: NOW, reprint: false });
    expect(m.rows.map((r) => r.lineNumber)).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '100'].map((n) => `REQ-20260913-001-${n}`),
    );
  });

  it('the copy as sent carries no money, even for the owner', () => {
    const priced = [
      line('01', { packsBought: 2, packSize: 750, packCost: 540, brandNote: 'Monin' }),
      line('02', { packsBought: 1, packSize: 1000, packCost: 85.5, receivedAt: new Date() }),
    ];
    const m = buildBuyListModel(source(priced), { copy: 'sent', showMoney: true, printedAt: NOW, reprint: false });
    expect(m.showMoney).toBe(false);
    expect(m.total).toBeNull();
    for (const r of m.rows) {
      expect(r).not.toHaveProperty('pricePerPack');
      expect(r).not.toHaveProperty('amount');
    }
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/540|85\.5|1,080/);
  });

  it('the copy as sent says what is needed, in packs when the last pack divides it, and what is on the shelf', () => {
    const m = buildBuyListModel(source([
      line('01', { name: 'Hazelnut Syrup', qtyRequested: 1500, lastPackSize: 750, onHand: 120, counted: 100 }),
      line('02', { name: 'White Sugar', unit: 'g', qtyRequested: 500, lastPackSize: 1000, onHand: 0 }),
      line('03', { name: 'Cups', unit: 'pcs', qtyRequested: 70, lastPackSize: 3 }),
    ]), { copy: 'sent', showMoney: false, printedAt: NOW, reprint: false });
    // The same packs rule as the owner email and the screen, so all three agree.
    expect(m.rows[0]).toMatchObject({ need: '2 packs (1,500 ml)', onHand: '120 ml · counted 100', unit: 'ml' });
    expect(m.rows[1]).toMatchObject({ need: '0.5 packs (500 g)', onHand: '0 g', unit: 'g' });
    expect(m.rows[2]).toMatchObject({ need: '70 pcs' });
    expect(m.title).toBe(BUY_LIST_PDF_LABEL.sent);
    expect(m.stamp).toBe('Sent Sep 13, 2026, 2:05 PM by Anne');
    expect(m.caveat).toBeNull();
    expect(m.footer).toMatch(/Line No\./);
  });

  it('a copy drawn later for a list that was never filed says its stock is today\'s', () => {
    const m = buildBuyListModel(source([line('01')]), { copy: 'sent', showMoney: false, printedAt: NOW, reprint: true });
    expect(m.caveat).toMatch(/^Reprinted .*stock now, not when the list was sent/);
  });

  it('a list not sent yet is a draft', () => {
    const m = buildBuyListModel(source([line('01')], { status: 'OPEN', sentAt: null, sentBy: null }), { copy: 'sent', showMoney: false, printedAt: NOW, reprint: false });
    expect(m.stamp).toMatch(/^Not sent yet/);
    expect(m.caveat).toMatch(/Draft/);
  });

  const BOOKED = [
    line('01', { name: 'Hazelnut Syrup', packsBought: 2, packSize: 750, packCost: 540, brandNote: 'Monin', receivedAt: new Date('2026-09-13T08:00:00Z') }),
    line('02', { name: 'White Sugar', unit: 'g', packsBought: null }),
    line('03', { name: 'Milk', packsBought: 3, packSize: 1000, packCost: 86 }),
  ];

  it('the copy as booked shows what was bought, the price and what became of each line', () => {
    const m = buildBuyListModel(source(BOOKED, { status: 'RECEIVED', receivedAt: new Date('2026-09-13T09:00:00Z') }),
      { copy: 'booked', showMoney: true, printedAt: NOW, reprint: false });
    expect(m.showMoney).toBe(true);
    expect(m.rows[0]).toMatchObject({ bought: '2 × 750 ml', pricePerPack: '540.00', amount: '1,080.00', brand: 'Monin', result: 'In stock' });
    expect(m.rows[1]).toMatchObject({ bought: '—', pricePerPack: '—', amount: '—', result: 'Back on the list' });
    // Bought but closed without posting: back on the list, never charged, not in the total.
    expect(m.rows[2]).toMatchObject({ bought: '3 × 1,000 ml', pricePerPack: '86.00', amount: '—', result: 'Back on the list' });
    expect(m.total).toBe('1,080.00');
    expect(m.stamp).toBe('Sent Sep 13, 2026, 2:05 PM by Anne  ·  In stock Sep 13, 2026, 5:00 PM');
    expect(m.caveat).toBeNull();
  });

  it('the copy as booked hides every price from someone not shown purchase costs', () => {
    const m = buildBuyListModel(source(BOOKED, { status: 'RECEIVED' }), { copy: 'booked', showMoney: false, printedAt: NOW, reprint: false });
    expect(m.total).toBeNull();
    for (const r of m.rows) {
      expect(r).not.toHaveProperty('pricePerPack');
      expect(r).not.toHaveProperty('amount');
    }
    expect(JSON.stringify(m)).not.toMatch(/540|1,080|258/);
    expect(m.rows[0].bought).toBe('2 × 750 ml');   // quantities are the staff's own work
  });

  it('a request not yet all in stock says so on the booked copy, and counts what is still to be posted', () => {
    const m = buildBuyListModel(source(BOOKED, { status: 'BOUGHT' }), { copy: 'booked', showMoney: true, printedAt: NOW, reprint: false });
    expect(m.caveat).toMatch(/Not everything on this list is in stock yet/);
    expect(m.rows.map((r) => r.result)).toEqual(['In stock', 'Not bought yet', 'Bought, not in stock yet']);
    expect(m.total).toBe('1,338.00');
  });

  it('a line closed with nothing arriving is not called in stock', () => {
    // Posting rewrites packs bought to what arrived: a refunded, lost or never-came order reads 0.
    const m = buildBuyListModel(source([line('01', { packsBought: 0, packSize: 750, packCost: 540, receivedAt: new Date() })], { status: 'RECEIVED' }),
      { copy: 'booked', showMoney: true, printedAt: NOW, reprint: false });
    expect(m.rows[0]).toMatchObject({ result: 'Nothing arrived', bought: '0 × 750 ml', amount: '0.00' });
  });

  it('the booked copy says what was needed in the unit, not in packs this very request just bought', () => {
    // As sent: "2 packs (1,500 ml)" from a 750 ml last pack. Once 1 L bottles are
    // bought and posted, "last pack" is 1,000 ml, and "1.5 packs" was never asked for.
    const l = line('01', { qtyRequested: 1500, lastPackSize: 1000, packsBought: 2, packSize: 1000, packCost: 90, receivedAt: new Date() });
    const m = buildBuyListModel(source([l], { status: 'RECEIVED' }), { copy: 'booked', showMoney: true, printedAt: NOW, reprint: false });
    expect(m.rows[0].need).toBe('1,500 ml');
  });

  it('every printed amount is to the centavo, so the rows add up to the total', () => {
    const odd = [1, 2].map((n) => line(`0${n}`, { packsBought: 2.5, packSize: 1000, packCost: 45.25, receivedAt: new Date() }));
    const m = buildBuyListModel(source(odd, { status: 'RECEIVED' }), { copy: 'booked', showMoney: true, printedAt: NOW, reprint: false });
    expect(m.rows.map((r) => r.amount)).toEqual(['113.13', '113.13']);
    expect(m.total).toBe('226.26');
  });

  it('only prints characters the PDF font has', () => {
    expect(pdfSafe('₱540 — Café “Monin” ×2 · 2:05 PM')).toBe('PHP 540 — Café “Monin” ×2 · 2:05 PM');
    expect(pdfSafe('Syrup 🍯')).toBe('Syrup ?');
  });

  it('renders a real PDF over several pages, and hands the font nothing it cannot draw', async () => {
    const WINANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
    const drawable = (t: string) => [...t].every((ch) => ch.codePointAt(0)! < 0x100 || WINANSI_EXTRA.has(ch));
    const many = Array.from({ length: 60 }, (_, i) => line(String(i + 1).padStart(2, '0'), {
      name: i === 0 ? '₱ Kirkland Organic Blue Agave Syrup, the big bottle from the warehouse club 🍯' : `Item ${i + 1}`,
      unit: i === 1 ? 'sachets' : 'ml',
    }));
    // Watch every string that reaches the font, not the compressed bytes that come out.
    const text = jest.spyOn(PDFDocument.prototype as any, 'text');
    try {
      for (const copy of ['sent', 'booked'] as const) {
        text.mockClear();
        const src = source(many, { shopName: 'Café Ñino — ₱ Juan Dela Cruz Food Services and General Merchandise 🍜', notes: 'Buy at S&R if Monin is out ₱' });
        const buf = await renderBuyListPdf(buildBuyListModel(src, { copy, showMoney: true, printedAt: NOW, reprint: false }));
        expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
        expect((buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
        const drawn = text.mock.calls.map((c) => c[0]).filter((t): t is string => typeof t === 'string');
        expect(drawn.length).toBeGreaterThan(60);
        expect(drawn.filter((t) => !drawable(t))).toEqual([]);
        expect(drawn.some((t) => t.startsWith('Café Ñino — PHP Juan'))).toBe(true);
      }
    } finally {
      text.mockRestore();
    }
  });

  it('a long shop name stays on one line in the header', async () => {
    const text = jest.spyOn(PDFDocument.prototype as any, 'text');
    try {
      const long = 'Juan Dela Cruz Food Services and General Merchandise Corporation of the Philippines, Incorporated';
      await renderBuyListPdf(buildBuyListModel(source([line('01')], { shopName: long }), { copy: 'sent', showMoney: false, printedAt: NOW, reprint: false }));
      const call = text.mock.calls.find((c) => c[0] === long)!;
      // pdfkit wraps anything given a width; only a height makes the ellipsis cut it.
      expect(call[3]).toMatchObject({ ellipsis: true, height: expect.any(Number) });
    } finally {
      text.mockRestore();
    }
  });

  it('draws an empty list without failing', async () => {
    const buf = await renderBuyListPdf(buildBuyListModel(source([]), { copy: 'sent', showMoney: false, printedAt: NOW, reprint: false }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
