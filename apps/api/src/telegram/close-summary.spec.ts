import { CloseSummaryForAlert, MESSAGE_LIMIT, closeSummaryMessage, ownerNoticeMessage } from './messages';
import { CloseSummaryScheduler, DAY_CLOSE_ENTITY, closeSummaryDay, loadCloseSummary } from './close-summary.scheduler';

/** The day's close at 21:30 Manila, and the owner notice: what the owner reads, and what is read to write it. */
describe('day close summary', () => {
  const FULL: CloseSummaryForAlert = {
    shopName: 'Moto <Parts> & Co', branchName: 'Naga', day: '2026-10-13', asOf: new Date('2026-10-13T21:30:00+08:00'),
    sales: {
      count: 12, total: 18350,
      byMethod: [
        { method: 'GCASH_PERSONAL', amount: 1000 }, { method: 'CASH', amount: 10000 },
        { method: 'GCASH_BUSINESS', amount: 5000 }, { method: 'CHARGE', amount: 2350 },
      ],
    },
    tagged: [
      { number: '000457', name: 'Headlamp', sold: 3500, cost: 1800, refunded: false },
      { number: '000458', name: 'Muffler', sold: 1000, cost: 1200, refunded: false },
      { number: '000459', name: 'Seat', sold: 900, cost: null, refunded: true },
    ],
    discounts: { total: 560, byApprover: [{ name: 'Anne', count: 3, amount: 400 }, { name: null, count: 2, amount: 160 }], seniorPwd: 2 },
    voids: { count: 1, total: 150, byPerson: [{ name: 'Maria, approved by Anne', count: 1, amount: 150 }] },
    refunds: { count: 1, total: 95, byPerson: [{ name: 'Anne', count: 1, amount: 95 }] },
    drawers: [
      { cashier: 'Maria', expected: 5000, counted: 4950, variance: -50 },
      { cashier: 'Joy', expected: 3000, counted: 3020, variance: 20 },
      { cashier: 'Lea', expected: null, counted: null, variance: null },
    ],
    belowMenu: 2,
    soldTwice: [{ tags: ['000457'], orderNumber: 'ORD-2026-000123' }],
    rollCalls: [{ at: new Date('2026-10-13T18:05:00+08:00'), missing: 3 }],
  };
  const EMPTY: CloseSummaryForAlert = {
    ...FULL,
    sales: { count: 0, total: 0, byMethod: [] }, tagged: [],
    discounts: { total: 0, byApprover: [], seniorPwd: 0 },
    voids: { count: 0, total: 0, byPerson: [] }, refunds: { count: 0, total: 0, byPerson: [] },
    drawers: [], belowMenu: 0, soldTwice: [], rollCalls: [],
  };

  describe('closeSummaryMessage', () => {
    it('a full day: every section, in plain words, with money as pesos', () => {
      const text = closeSummaryMessage(FULL);
      const lines = text.split('\n');
      expect(lines[0]).toBe('📊 <b>Day close: Tue, Oct 13</b>');
      expect(lines[1]).toBe('Moto &lt;Parts&gt; &amp; Co · Naga');
      expect(lines[2]).toBe('Up to Oct 13, 9:30 PM');

      // Sales, then each way of paying in the owner's order, GCash personal and business as one.
      const sales = lines.indexOf('<b>Sales</b>: 12, total ₱18,350.00');
      expect(sales).toBeGreaterThan(0);
      expect(lines.slice(sales + 1, sales + 4)).toEqual(['• Cash ₱10,000.00', '• GCash ₱6,000.00', '• Charge ₱2,350.00']);

      expect(lines).toContain('<b>Tagged parts sold</b>');
      expect(lines).toContain('• Tag 000457 Headlamp: sold ₱3,500.00 · cost ₱1,800.00 · margin ₱1,700.00');
      expect(lines).toContain('• Tag 000458 Muffler: sold ₱1,000.00 · cost ₱1,200.00 · loss ₱200.00');
      expect(lines).toContain('• Tag 000459 Seat: sold ₱900.00 · no cost recorded · refunded');

      expect(lines).toContain('<b>Discounts</b>: ₱560.00');
      expect(lines).toContain('• Approved by Anne: 3, ₱400.00');
      expect(lines).toContain('• No approver recorded: 2, ₱160.00');
      expect(lines).toContain('• Senior/PWD: 2');

      expect(lines).toContain('<b>Voids</b>: 1, total ₱150.00');
      expect(lines).toContain('• Maria, approved by Anne: 1, ₱150.00');
      expect(lines).toContain('<b>Refunds</b>: 1, total ₱95.00');
      expect(lines).toContain('• Anne: 1, ₱95.00');

      expect(lines).toContain('<b>Cash drawers closed</b>');
      expect(lines).toContain('• Maria: expected ₱5,000.00, counted ₱4,950.00, short ₱50.00');
      expect(lines).toContain('• Joy: expected ₱3,000.00, counted ₱3,020.00, over ₱20.00');
      expect(lines).toContain('• Lea: closed without a count');

      expect(lines).toContain('⚠️ Sold below menu: 2 sales');
      expect(lines).toContain('⚠️ <b>Tags sold twice</b>');
      expect(lines).toContain('• Tag 000457 on ORD-2026-000123');
      expect(lines).toContain('<b>Roll call</b>');
      expect(lines).toContain('• Oct 13, 6:05 PM, missing: 3');
      expect(text).not.toContain('Nothing was recorded');
      expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
    });

    it("the managers' copy: tagged parts with what they sold for, never their cost or margin", () => {
      const text = closeSummaryMessage(FULL, { showCosts: false });
      const lines = text.split('\n');
      expect(lines).toContain('• Tag 000457 Headlamp: sold ₱3,500.00');
      expect(lines).toContain('• Tag 000459 Seat: sold ₱900.00 · refunded');
      expect(text).not.toMatch(/cost|margin|loss/);
    });

    it('an empty day says so in one line, with no empty sections', () => {
      const text = closeSummaryMessage(EMPTY);
      expect(text).toContain('<b>Day close: Tue, Oct 13</b>');
      expect(text).toContain('Nothing was recorded today: no sales, voids, refunds or drawers closed.');
      for (const section of ['Sales', 'Tagged parts sold', 'Discounts', 'Voids', 'Refunds', 'Cash drawers closed', 'Tags sold twice', 'Roll call']) {
        expect(text).not.toContain(`<b>${section}</b>`);
      }
      expect(text).not.toContain('Sold below menu');
    });

    it('leaves out only the empty sections', () => {
      const text = closeSummaryMessage({ ...EMPTY, drawers: FULL.drawers, rollCalls: [{ at: FULL.rollCalls[0].at, missing: 0 }] });
      expect(text).toContain('<b>Cash drawers closed</b>');
      expect(text).toContain('missing: 0');
      expect(text).not.toContain('<b>Sales</b>');
      expect(text).not.toContain('Nothing was recorded');
    });

    it('escapes every name, so no product or person can break the message', () => {
      const text = closeSummaryMessage({
        ...FULL,
        tagged: [{ number: '000001', name: '<b>Exhaust</b> & "pipe"', sold: 10, cost: 5, refunded: false }],
        drawers: [{ cashier: 'Jo <3', expected: 1, counted: 1, variance: 0 }],
      });
      expect(text).toContain('• Tag 000001 &lt;b&gt;Exhaust&lt;/b&gt; &amp; "pipe": sold ₱10.00 · cost ₱5.00 · margin ₱5.00');
      expect(text).toContain('• Jo &lt;3: expected ₱1.00, counted ₱1.00, exact');
      // Only the tags the message itself writes.
      expect(text.replace(/<\/?(b|pre|i)>/g, '')).not.toMatch(/[<>]/);
    });

    it('a huge day still fits one message, counting what was left out', () => {
      const many = Array.from({ length: 400 }, (_, i) => ({
        number: String(i).padStart(6, '0'), name: `Part number ${i} with a long description of the piece`, sold: 1000 + i, cost: 500, refunded: false,
      }));
      const people = Array.from({ length: 200 }, (_, i) => ({ name: `Person with a long name ${i}`, count: 1, amount: 10 }));
      const text = closeSummaryMessage({
        ...FULL, tagged: many,
        discounts: { total: 2000, byApprover: people, seniorPwd: 0 },
        voids: { count: 200, total: 2000, byPerson: people },
        refunds: { count: 200, total: 2000, byPerson: people },
      });
      expect(text.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
      expect(text).toMatch(/…and \d+ more/);
      // The headline numbers are never what gets cut.
      expect(text).toContain('<b>Sales</b>: 12, total ₱18,350.00');
      expect(text).toContain('<b>Voids</b>: 200, total ₱2,000.00');
    });
  });

  describe('ownerNoticeMessage', () => {
    it('a bold title, the shop, the time and the lines in a monospace block, all escaped', () => {
      const text = ownerNoticeMessage({
        shopName: 'Moto & Co', branchName: 'Naga', title: 'Parts missing <at> roll call',
        lines: ['Tag 000457 Headlamp <left>', 'Tag 000458 Muffler & bracket'], at: new Date('2026-10-13T18:05:00+08:00'),
      });
      expect(text).toBe([
        '⚠️ <b>Parts missing &lt;at&gt; roll call</b>',
        'Moto &amp; Co · Naga',
        'Oct 13, 6:05 PM',
        '<pre>Tag 000457 Headlamp &lt;left&gt;\nTag 000458 Muffler &amp; bracket</pre>',
      ].join('\n'));
    });

    it('no lines: no empty block; too many lines: cut with a count', () => {
      const none = ownerNoticeMessage({ shopName: 'Shop', branchName: null, title: '', lines: [], at: new Date() });
      expect(none).not.toContain('<pre>');
      expect(none.split('\n')[0]).toBe('⚠️ <b>Notice</b>');
      const lots = ownerNoticeMessage({
        shopName: 'Shop', branchName: null, title: 'Returned but never sold',
        lines: Array.from({ length: 500 }, (_, i) => `Tag ${String(i).padStart(6, '0')} a part with a fairly long name`), at: new Date(),
      });
      expect(lots.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
      expect(lots).toMatch(/…and \d+ more<\/pre>$/);
    });
  });

  describe('closeSummaryDay -- the Manila day the run falls in', () => {
    it('21:30 Manila is 13:30 UTC: the day runs midnight to midnight Manila', () => {
      const d = closeSummaryDay(new Date('2026-10-13T13:30:00Z'));
      expect(d.day).toBe('2026-10-13');
      expect(d.from.toISOString()).toBe('2026-10-12T16:00:00.000Z');
      expect(d.to.toISOString()).toBe('2026-10-13T16:00:00.000Z');
    });

    it('the UTC date is not the Manila date: 00:10 Manila is still the day before in UTC', () => {
      expect(closeSummaryDay(new Date('2026-10-13T16:10:00Z')).day).toBe('2026-10-14');
      expect(closeSummaryDay(new Date('2026-10-13T15:59:59.999Z')).day).toBe('2026-10-13');
      // A month and a year turning over.
      const nye = closeSummaryDay(new Date('2026-12-31T13:30:00Z'));
      expect([nye.day, nye.from.toISOString(), nye.to.toISOString()]).toEqual(['2026-12-31', '2026-12-30T16:00:00.000Z', '2026-12-31T16:00:00.000Z']);
    });
  });

  // ── what is read ──────────────────────────────────────────────────────────

  const D = (n: number) => n; // Prisma Decimals arrive as objects; Number() reads both.

  function fakeDb(opts: { sales?: any[]; voids?: any[]; refunds?: any[]; shifts?: any[]; audits?: any[]; branchOrders?: any[]; users?: any[]; branches?: any[] } = {}): any {
    return {
      order: {
        findMany: jest.fn(async ({ where }: any) => {
          if (where.id) return (opts.branchOrders ?? []).filter((o) => where.id.in.includes(o.id));
          if (where.status === 'VOIDED') return opts.voids ?? [];
          return opts.sales ?? [];
        }),
      },
      orderItemRefund: { findMany: jest.fn(async () => opts.refunds ?? []) },
      shift:           { findMany: jest.fn(async () => opts.shifts ?? []) },
      auditLog:        { findMany: jest.fn(async () => opts.audits ?? []) },
      user:            { findMany: jest.fn(async ({ where }: any) => (opts.users ?? []).filter((u) => where.id.in.includes(u.id))) },
      branch:          { findMany: jest.fn(async () => opts.branches ?? []) },
    };
  }
  const DAY = closeSummaryDay(new Date('2026-10-13T13:30:00Z'));

  describe('loadCloseSummary', () => {
    it('reads every source inside the shop, the branch and the Manila day', async () => {
      const db = fakeDb();
      await loadCloseSummary(db as any, 't1', 'b1', DAY);
      const range = { gte: DAY.from, lt: DAY.to };
      const [salesQ, voidsQ] = db.order.findMany.mock.calls.map((c: any[]) => c[0].where);
      expect(salesQ).toEqual({ tenantId: 't1', branchId: 'b1', paidAt: range, status: { in: ['PAID', 'COMPLETED'] } });
      expect(voidsQ).toEqual({ tenantId: 't1', branchId: 'b1', status: 'VOIDED', voidedAt: range });
      expect(db.orderItemRefund.findMany.mock.calls[0][0].where).toEqual({
        createdAt: range, orderItem: { order: { tenantId: 't1', branchId: 'b1', status: { not: 'VOIDED' } } },
      });
      expect(db.shift.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', branchId: 'b1', closedAt: range });
      expect(db.auditLog.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: 't1', createdAt: range });
      // Tagged parts are the lines whose note starts "Tag ".
      expect(db.order.findMany.mock.calls[0][0].select.items.where).toEqual({ notes: { startsWith: 'Tag ' } });
    });

    it('adds up the day: ways of paying, tagged parts, discounts, voids, refunds, drawers and flags', async () => {
      const db = fakeDb({
        sales: [
          {
            totalAmount: D(3600), invoiceType: 'CASH_SALE',
            payments: [{ method: 'CASH', amount: D(3000) }, { method: 'GCASH_BUSINESS', amount: D(600) }],
            discounts: [{ discountType: 'MANAGER_OVERRIDE', discountAmount: D(100), authorizedById: 'u-anne' }],
            items: [{ productName: 'Headlamp', notes: 'Tag 000457 · Engine No. X1', quantity: D(1), lineTotal: D(3500), costPrice: D(1800), refundedQty: D(0) }],
          },
          {
            totalAmount: D(2350), invoiceType: 'CHARGE', payments: [],
            discounts: [{ discountType: 'SENIOR_CITIZEN', discountAmount: D(80), authorizedById: null }],
            items: [],
          },
        ],
        voids: [{ totalAmount: D(150), voidedById: 'u-anne', voidInitiatedById: 'u-maria' }],
        refunds: [{ refundAmount: D(95), refundedById: 'u-anne' }],
        shifts: [{ cashierId: 'u-maria', closingCashExpected: D(5000), closingCashDeclared: D(4950), variance: D(-50) }],
        audits: [
          { action: 'PRICE_ADJUSTED', entityType: 'Order', entityId: 'o-here', after: {}, createdAt: new Date() },
          { action: 'PRICE_ADJUSTED', entityType: 'Order', entityId: 'o-other-branch', after: {}, createdAt: new Date() },
          { action: 'SETTING_CHANGED', entityType: 'TAG_SOLD_TWICE', entityId: 'o-here', after: { tags: ['000457'] }, createdAt: new Date() },
          // As tags/tag-checks writes it: entityId "<branchId>:<when>", the branch and the missing parts in `after`.
          {
            action: 'SETTING_CHANGED', entityType: 'TAG_ROLL_CALL', entityId: 'b1:1760349600000',
            after: { branchId: 'b1', missing: [{ number: '000001', productName: 'Headlamp' }, { number: '000002', productName: 'Muffler' }] },
            createdAt: new Date('2026-10-13T18:00:00+08:00'),
          },
          { action: 'SETTING_CHANGED', entityType: 'TAG_ROLL_CALL', entityId: 'b2:1760349600000', after: { branchId: 'b2', missing: [{ number: '000003' }] }, createdAt: new Date() },
          { action: 'SETTING_CHANGED', entityType: 'TAG_ROLL_CALL', entityId: 'b2:1760349700000', after: { missing: ['000004'] }, createdAt: new Date() },
          { action: 'SETTING_CHANGED', entityType: 'TAG_ROLL_CALL', entityId: 'rc3', after: { missing: [] }, createdAt: new Date('2026-10-13T19:00:00+08:00') },
        ],
        branchOrders: [{ id: 'o-here', orderNumber: 'ORD-2026-000123' }],
        users: [{ id: 'u-anne', name: 'Anne' }, { id: 'u-maria', name: 'Maria' }],
        branches: [{ id: 'b2' }],
      });
      const s = await loadCloseSummary(db as any, 't1', 'b1', DAY);
      expect(s.sales).toEqual({
        count: 2, total: 5950,
        byMethod: expect.arrayContaining([{ method: 'CASH', amount: 3000 }, { method: 'GCASH_BUSINESS', amount: 600 }, { method: 'CHARGE', amount: 2350 }]),
      });
      expect(s.tagged).toEqual([{ number: '000457', name: 'Headlamp', sold: 3500, cost: 1800, refunded: false }]);
      expect(s.discounts).toEqual({ total: 180, byApprover: [{ name: 'Anne', count: 1, amount: 100 }, { name: null, count: 1, amount: 80 }], seniorPwd: 1 });
      expect(s.voids).toEqual({ count: 1, total: 150, byPerson: [{ name: 'Maria, approved by Anne', count: 1, amount: 150 }] });
      expect(s.refunds).toEqual({ count: 1, total: 95, byPerson: [{ name: 'Anne', count: 1, amount: 95 }] });
      expect(s.drawers).toEqual([{ cashier: 'Maria', expected: 5000, counted: 4950, variance: -50 }]);
      // Only this branch's orders' flags; names looked up inside the shop.
      expect(db.order.findMany.mock.calls[2][0].where).toEqual({ tenantId: 't1', branchId: 'b1', id: { in: ['o-here', 'o-other-branch'] } });
      expect(db.user.findMany.mock.calls[0][0].where.tenantId).toBe('t1');
      expect(s.belowMenu).toBe(1);
      expect(s.soldTwice).toEqual([{ tags: ['000457'], orderNumber: 'ORD-2026-000123' }]);
      // This branch's roll call and the one naming no branch; not b2's, by after.branchId or by entityId.
      expect(s.rollCalls).toEqual([
        { at: new Date('2026-10-13T18:00:00+08:00'), missing: 2 },
        { at: new Date('2026-10-13T19:00:00+08:00'), missing: 0 },
      ]);
    });

    it('a quiet day reads as empty, and looks up no one', async () => {
      const db = fakeDb();
      const s = await loadCloseSummary(db as any, 't1', 'b1', DAY);
      expect(s.sales).toEqual({ count: 0, total: 0, byMethod: [] });
      expect(s.rollCalls).toEqual([]);
      expect(db.user.findMany).not.toHaveBeenCalled();
      expect(db.branch.findMany).not.toHaveBeenCalled();
      expect(closeSummaryMessage({ ...s, shopName: 'Shop', branchName: 'Main', day: DAY.day, asOf: new Date() })).toContain('Nothing was recorded today');
    });
  });

  describe('CloseSummaryScheduler', () => {
    function build(opts: { enabled?: boolean; listening?: string[]; chats?: Record<string, string[]>; owners?: string[]; claimed?: Set<string>; failBranch?: string } = {}) {
      const db: any = fakeDb();
      const marks = opts.claimed ?? new Set<string>();
      db.telegramLink = { findMany: jest.fn(async () => (opts.listening ?? ['t1']).map((tenantId) => ({ tenantId }))) };
      db.branch.findMany = jest.fn(async ({ where }: any) => {
        if (where.isActive) {
          return [
            { id: 'b1', tenantId: 't1', name: 'Main', tenant: { name: 'Moto Shop' } },
            { id: 'b2', tenantId: 't1', name: 'Mall', tenant: { name: 'Moto Shop' } },
          ].filter((b) => where.tenantId.in.includes(b.tenantId));
        }
        return [];
      });
      if (opts.failBranch) {
        const salesFor = db.order.findMany;
        db.order.findMany = jest.fn(async (args: any) => {
          if (args.where.branchId === opts.failBranch) throw new Error('database down');
          return salesFor(args);
        });
      }
      const tx = {
        $executeRaw: jest.fn(async () => 0),
        auditLog: {
          findFirst: jest.fn(async ({ where }: any) => (marks.has(where.entityId) ? { id: 'a1' } : null)),
          create:    jest.fn(async ({ data }: any) => { marks.add(data.entityId); return data; }),
        },
      };
      db.$transaction = jest.fn(async (fn: any) => fn(tx));
      const client: any = { enabled: opts.enabled ?? true, sendMessage: jest.fn() };
      const chatsOf = (branchId: string) => (opts.chats ?? { b1: ['101'], b2: [] })[branchId] ?? [];
      const links: any = {
        recipients: jest.fn(async (_t: string, branchId: string, _topic: string, ownersOnly = false) =>
          ownersOnly ? chatsOf(branchId).filter((c) => !opts.owners || opts.owners.includes(c)) : chatsOf(branchId)),
      };
      return { svc: new CloseSummaryScheduler(db, client, links), db, client, links, tx, marks };
    }
    const NOW = new Date('2026-10-13T13:30:00Z');

    it('runs at 21:30 Manila on the Manila day, and sends each listening branch its day once', async () => {
      const { svc, db, client, tx } = build();
      expect(await svc.run(NOW)).toBe(1);
      // Only shops with someone on the sales switch, never demo or suspended ones.
      expect(db.telegramLink.findMany.mock.calls[0][0].where).toEqual({
        chatId: { not: null }, alertSales: true, tenant: { isDemoTenant: false, status: { not: 'SUSPENDED' } },
      });
      // b2 has no one listening: nothing of it was read.
      expect(db.shift.findMany).toHaveBeenCalledTimes(1);
      expect(db.shift.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', branchId: 'b1', closedAt: { gte: new Date('2026-10-12T16:00:00Z'), lt: new Date('2026-10-13T16:00:00Z') } });
      expect(client.sendMessage).toHaveBeenCalledTimes(1);
      expect(client.sendMessage.mock.calls[0][0]).toBe('101');
      expect(client.sendMessage.mock.calls[0][1]).toContain('<b>Day close: Tue, Oct 13</b>');
      expect(client.sendMessage.mock.calls[0][1]).toContain('Moto Shop · Main');
      // The claim: under a lock, an audit row naming the branch and the day.
      expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
      expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({
        tenantId: 't1', action: 'DATA_EXPORTED', entityType: DAY_CLOSE_ENTITY, entityId: 'b1:2026-10-13', after: { day: '2026-10-13', branchId: 'b1', chats: 1 },
      });
    });

    it("the owner and a manager each get their own copy: the owner's with costs", async () => {
      const { svc, client, links } = build({ chats: { b1: ['101', '102'], b2: [] }, owners: ['101'] });
      expect(await svc.run(NOW)).toBe(1);
      expect(links.recipients).toHaveBeenCalledWith('t1', 'b1', 'sales', true);
      expect(client.sendMessage.mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['101', '102']);
    });

    it('a second run the same day (another API instance during a deploy) sends nothing', async () => {
      const claimed = new Set<string>();
      const first = build({ claimed });
      const second = build({ claimed });
      expect(await first.svc.run(NOW)).toBe(1);
      expect(await second.svc.run(new Date(NOW.getTime() + 2_000))).toBe(0);
      expect(second.client.sendMessage).not.toHaveBeenCalled();
      // The next day is a new day.
      expect(await second.svc.run(new Date(NOW.getTime() + 24 * 3600_000))).toBe(1);
      expect(second.tx.auditLog.create.mock.calls[0][0].data.entityId).toBe('b1:2026-10-14');
    });

    it('with Telegram off, or nobody listening anywhere, nothing is read', async () => {
      const off = build({ enabled: false });
      expect(await off.svc.run(NOW)).toBe(0);
      expect(off.db.telegramLink.findMany).not.toHaveBeenCalled();
      const quiet = build({ listening: [] });
      expect(await quiet.svc.run(NOW)).toBe(0);
      expect(quiet.db.branch.findMany).not.toHaveBeenCalled();
    });

    it('one branch failing costs only that branch, and the run never throws', async () => {
      const { svc, client } = build({ chats: { b1: ['101'], b2: ['202'] }, failBranch: 'b1' });
      await expect(svc.run(NOW)).resolves.toBe(1);
      expect(client.sendMessage.mock.calls.map((c: any[]) => c[0])).toEqual(['202']);
      const broken = build();
      broken.db.telegramLink.findMany.mockRejectedValueOnce(new Error('database down'));
      await expect(broken.svc.run(NOW)).resolves.toBe(0);
    });
  });
});
