import { Logger } from '@nestjs/common';
import {
  CATCH_UP_MS, EndOfDayScheduler, SEND_AFTER_CLOSE_MS, reportDue, usageBellBody, usageReportLink,
} from './end-of-day.scheduler';
import { DAY_MS } from './daily-usage';
import type { UsageDay, UsageRow } from './daily-usage';

/**
 * The end-of-day ingredient sheet: when it goes, which hours it covers, to
 * whom, and that it goes once.
 *
 * The fakes behave like the database where it matters: the branch query
 * honours its filters, the notifications table is shared by every run and
 * every scheduler instance (a restart keeps the table, not the memory), the
 * advisory lock really makes a second transaction wait for the first, and
 * usage and sales exist only from the moment they reached Clerque -- so a
 * till that syncs late is late here too.
 */
describe('EndOfDayScheduler -- the ingredients-used sheet after closing', () => {
  /** An instant written in Manila wall-clock time. */
  const manila = (at: string) => new Date(`${at}+08:00`);

  const TENANTS: Record<string, { status: string; isDemoTenant: boolean }> = {
    t1:     { status: 'ACTIVE',    isDemoTenant: false },
    tGrace: { status: 'GRACE',     isDemoTenant: false },
    tDemo:  { status: 'ACTIVE',    isDemoTenant: true },
    tSusp:  { status: 'SUSPENDED', isDemoTenant: false },
  };
  type Branch = { id: string; tenantId: string; name: string; closesAt: string | null; isActive: boolean };
  const MAIN: Branch = { id: 'b-main', tenantId: 't1', name: 'Main', closesAt: '21:00', isActive: true };
  const NAGA: Branch = { id: 'b-naga', tenantId: 't1', name: 'Naga', closesAt: null, isActive: true };
  const LATE: Branch = { id: 'b-late', tenantId: 't1', name: 'Night Bar', closesAt: '01:00', isActive: true };
  const SHUT: Branch = { id: 'b-shut', tenantId: 't1', name: 'Old Kiosk', closesAt: '21:00', isActive: false };
  const GRACE: Branch = { id: 'b-grace', tenantId: 'tGrace', name: 'Grace Cafe', closesAt: '21:00', isActive: true };
  const DEMO: Branch = { id: 'b-demo', tenantId: 'tDemo', name: 'Demo Cafe', closesAt: '21:00', isActive: true };
  const SUSP: Branch = { id: 'b-susp', tenantId: 'tSusp', name: 'Unpaid Cafe', closesAt: '21:00', isActive: true };

  const PEOPLE = [
    { id: 'owner',       tenantId: 't1',     role: 'BUSINESS_OWNER', branchId: null,     isActive: true },
    { id: 'old-owner',   tenantId: 't1',     role: 'BUSINESS_OWNER', branchId: null,     isActive: false },
    { id: 'mgr-main',    tenantId: 't1',     role: 'BRANCH_MANAGER', branchId: 'b-main', isActive: true },
    { id: 'mgr-all',     tenantId: 't1',     role: 'BRANCH_MANAGER', branchId: null,     isActive: true },
    { id: 'mgr-naga',    tenantId: 't1',     role: 'BRANCH_MANAGER', branchId: 'b-naga', isActive: true },
    { id: 'cashier',     tenantId: 't1',     role: 'CASHIER',        branchId: 'b-main', isActive: true },
    { id: 'grace-owner', tenantId: 'tGrace', role: 'BUSINESS_OWNER', branchId: null,     isActive: true },
    { id: 'demo-owner',  tenantId: 'tDemo',  role: 'BUSINESS_OWNER', branchId: null,     isActive: true },
    { id: 'susp-owner',  tenantId: 'tSusp',  role: 'BUSINESS_OWNER', branchId: null,     isActive: true },
  ];

  const usageRow = (name: string, unit: string, total: number, costPrice: number, over: Partial<UsageRow> = {}): UsageRow => ({
    rawMaterialId: `rm-${name}`, name, unit, costPrice,
    sold: total, wasted: 0, intoPreps: 0, writtenOff: 0, total, value: Math.round(total * costPrice * 100) / 100,
    ...over,
  });
  const usageDay = (day: string, rows: UsageRow[], stillBeingMade = 0): UsageDay => ({
    day,
    rows,
    totals: {
      soldValue:       rows.reduce((t, r) => t + r.sold * r.costPrice, 0),
      wastedValue:     rows.reduce((t, r) => t + r.wasted * r.costPrice, 0),
      intoPrepsValue:  0,
      writtenOffValue: rows.reduce((t, r) => t + r.writtenOff * r.costPrice, 0),
      value:           rows.reduce((t, r) => t + r.value, 0),
    },
    stillBeingMade,
  });
  const MILK = () => [usageRow('Fresh Milk', 'ml', 8100, 0.1), usageRow('Espresso Beans', 'g', 1250, 0.85)];

  /** Ingredients used at `at`, which reached Clerque at `reachedAt` (a till that was offline syncs later). */
  type Used = { branchId: string; at: Date; reachedAt: Date; rows: UsageRow[]; stillBeingMade: number };
  const used = (branchId: string, at: string, rows: UsageRow[], opts: { reachedAt?: string; stillBeingMade?: number } = {}): Used => ({
    branchId, at: manila(at), reachedAt: manila(opts.reachedAt ?? at), rows, stillBeingMade: opts.stillBeingMade ?? 0,
  });
  /** A sale rung up at `paidAt` whose order row was written at `createdAt` (later when synced from an offline till). */
  type Sale = { tenantId: string; branchId: string; status: string; paidAt: Date | null; createdAt: Date; deletedAt: null };
  const sale = (branchId: string, paidAt: string, over: { createdAt?: string; status?: string; tenantId?: string } = {}): Sale => ({
    tenantId: over.tenantId ?? 't1', branchId, status: over.status ?? 'COMPLETED',
    paidAt: manila(paidAt), createdAt: manila(over.createdAt ?? paidAt), deletedAt: null,
  });

  /** A Prisma date filter ({ gte, gt, lt }, or null for "is null") applied to one value. */
  const dateMatches = (v: Date | null, f: any) => {
    if (f === undefined) return true;
    if (f === null) return v === null;
    if (v === null) return false;
    return (f.gte === undefined || v >= f.gte) && (f.gt === undefined || v > f.gt) && (f.lt === undefined || v < f.lt);
  };
  const saleMatches = (s: Sale, w: any): boolean =>
    dateMatches(s.paidAt, w.paidAt) && dateMatches(s.createdAt, w.createdAt)
    && (!w.OR || w.OR.some((o: any) => saleMatches(s, o)));

  function build(opts: {
    branches?: Branch[];
    recorded?: Used[];
    sales?: Sale[];
    people?: typeof PEOPLE;
    telegram?: boolean;
  } = {}) {
    const branches = opts.branches ?? [MAIN];
    const people = opts.people ?? PEOPLE;
    const recorded: Used[] = [...(opts.recorded ?? [])];
    const sales: Sale[] = [...(opts.sales ?? [])];
    const table: any[] = [];
    let clock = new Date(0);
    const locks = new Map<string, Promise<void>>();

    const notification = {
      findFirst: jest.fn(async ({ where }: any) => table.find((n) =>
        n.tenantId === where.tenantId && n.link === where.link && n.createdAt >= where.createdAt.gte) ?? null),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) table.push({ id: `n${table.length + 1}`, readAt: null, createdAt: clock, ...d });
        return { count: data.length };
      }),
    };
    const prisma: any = {
      branch: {
        // The filters the database would apply, read from the query itself.
        findMany: jest.fn(async ({ where }: any) => branches
          .filter((b) => b.isActive === where.isActive)
          .filter((b) => (where.closesAt.not === null ? b.closesAt !== null : true))
          .filter((b) => TENANTS[b.tenantId].isDemoTenant === where.tenant.isDemoTenant && TENANTS[b.tenantId].status !== where.tenant.status.not)
          .map(({ id, tenantId, name, closesAt }) => ({ id, tenantId, name, closesAt }))),
      },
      user: {
        findMany: jest.fn(async ({ where }: any) => people
          .filter((p) => p.tenantId === where.tenantId && p.isActive === where.isActive)
          .filter((p) => where.OR.some((w: any) => p.role === w.role && (!w.OR || w.OR.some((o: any) => p.branchId === o.branchId))))
          .map((p) => ({ id: p.id }))),
      },
      order: {
        count: jest.fn(async ({ where }: any) => sales.filter((s) =>
          s.createdAt <= clock
          && s.tenantId === where.tenantId && s.branchId === where.branchId && s.deletedAt === where.deletedAt
          && where.status.in.includes(s.status)
          && saleMatches(s, where)).length),
      },
      notification,
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
        const held: { release?: () => void } = {};
        const tx = {
          notification,
          // pg_advisory_xact_lock: wait for whoever holds the key, then hold it until this transaction ends.
          $executeRaw: jest.fn(async (_sql: TemplateStringsArray, key: string) => {
            while (locks.has(key)) await locks.get(key);
            let done!: () => void;
            locks.set(key, new Promise<void>((r) => { done = r; }));
            held.release = () => { locks.delete(key); done(); };
            return 1;
          }),
        };
        try {
          return await fn(tx);
        } finally {
          held.release?.();
        }
      }),
    };
    const reports: any = {
      // What had reached Clerque by now, used inside the window.
      usageForWindow: jest.fn(async (_tenantId: string, branchId: string, label: string, from: Date, to: Date) => {
        const seen = recorded.filter((u) => u.branchId === branchId && u.reachedAt <= clock && u.at >= from && u.at < to);
        return usageDay(label, seen.flatMap((u) => u.rows), seen.reduce((t, u) => t + u.stillBeingMade, 0));
      }),
    };
    const telegram: any = { dailyUsage: jest.fn(async () => undefined) };
    const make = () => new EndOfDayScheduler(prisma, reports, opts.telegram === false ? undefined : telegram);
    const scheduler = make();
    /** Runs the job at a Manila wall-clock time. */
    const runAt = (at: string, s = scheduler) => {
      clock = manila(at);
      return s.run(clock);
    };
    /** The ingredient names on the sheet Telegram was handed last. */
    const lastSentNames = () => {
      const calls = telegram.dailyUsage.mock.calls;
      return (calls[calls.length - 1]?.[2] as UsageDay | undefined)?.rows.map((r) => r.name);
    };
    return { scheduler, make, runAt, prisma, reports, telegram, table, recorded, sales, lastSentNames };
  }
  /** The order counts that ask whether anything sold in the window (the late-sales count has no OR). */
  const soldQueries = (prisma: any) => prisma.order.count.mock.calls.map((c: any[]) => c[0].where).filter((w: any) => w.OR);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('nothing until half an hour after closing; then one bell per owner and manager of the branch, and Telegram gets that same reading', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });

    expect(await h.runAt('2026-09-16T20:55:00')).toBe(0);
    expect(await h.runAt('2026-09-16T21:00:02')).toBe(0);
    // Closing + 10: staff are still closing up.
    expect(await h.runAt('2026-09-16T21:10:00')).toBe(0);
    expect(await h.runAt('2026-09-16T21:25:00')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
    expect(h.table).toHaveLength(0);

    expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
    // The 24 hours up to the send, not the calendar day.
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-15T21:30:00'), manila('2026-09-16T21:30:00'));
    // Not the manager of another branch, not the till, not a deactivated owner.
    expect(h.table.map((n) => n.userId).sort()).toEqual(['mgr-all', 'mgr-main', 'owner']);
    const bell = h.table[0];
    expect(bell).toMatchObject({
      tenantId: 't1',
      kind:     'INFO',
      title:    'Ingredients used today — Main',
      link:     '/pos/inventory/reports?from=2026-09-16&to=2026-09-16&branchId=b-main',
    });
    expect(bell.body).toBe('Fresh Milk 8.1 L · Espresso Beans 1.25 kg. Value at cost ₱1,872.50.');
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    const [tenantId, branchId, sheet, lateSales] = h.telegram.dailyUsage.mock.calls[0];
    expect([tenantId, branchId, lateSales]).toEqual(['t1', 'b-main', 0]);
    // The very object the bell was built from: Telegram does not read the usage again, so the two can never disagree.
    expect(sheet).toBe(await h.reports.usageForWindow.mock.results[0].value);
    expect(h.reports.usageForWindow).toHaveBeenCalledTimes(1);
  });

  it('closing up: a write-off at closing + 15 is on the sheet, and one after the send is on the next sheet, not lost', async () => {
    const h = build({
      recorded: [
        used('b-main', '2026-09-16T14:00:00', MILK()),
        used('b-main', '2026-09-16T21:15:00', [usageRow('Oat Milk', 'ml', 1000, 0.2, { sold: 0, writtenOff: 1000 })]),
        used('b-main', '2026-09-16T21:40:00', [usageRow('Croissant Dough', 'g', 500, 0.3, { sold: 0, writtenOff: 500 })]),
      ],
    });
    expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
    expect(h.table[0].body).toBe('Fresh Milk 8.1 L · Espresso Beans 1.25 kg · Oat Milk 1 L. Value at cost ₱2,072.50. Wasted or written off: ₱200.00.');
    expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans', 'Oat Milk']);

    expect(await h.runAt('2026-09-17T21:30:00')).toBe(1);
    expect(h.lastSentNames()).toEqual(['Croissant Dough']);
  });

  it('once per day: later runs, and a restarted scheduler, send nothing more', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK()), used('b-main', '2026-09-17T14:00:00', MILK())] });
    await h.runAt('2026-09-16T21:30:02');
    const usageReads = h.reports.usageForWindow.mock.calls.length;

    expect(await h.runAt('2026-09-16T21:35:00')).toBe(0);
    expect(await h.runAt('2026-09-16T23:55:00', h.make())).toBe(0);
    expect(await h.runAt('2026-09-17T00:00:00', h.make())).toBe(0);
    expect(h.table).toHaveLength(3);
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    // Already sent: the cheap look stops the run before the day is read again.
    expect(h.reports.usageForWindow).toHaveBeenCalledTimes(usageReads);

    // The next day is a new day.
    expect(await h.runAt('2026-09-17T21:30:01')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-17' }), 0);
    expect(h.table).toHaveLength(6);
  });

  it('two runs at once (a slow run overlapping the next, or two servers) send it once', async () => {
    const h = build();
    // Both runs get past the cheap look before either claims the day: only the lock can stop the second.
    let bothIn!: () => void;
    const gate = new Promise<void>((r) => { bothIn = r; });
    let arrived = 0;
    h.reports.usageForWindow.mockImplementation(async (_t: string, _b: string, label: string) => {
      if (++arrived === 2) bothIn();
      await gate;
      return usageDay(label, MILK());
    });

    const [a, b] = await Promise.all([h.runAt('2026-09-16T21:30:02'), h.runAt('2026-09-16T21:30:02', h.make())]);
    expect(arrived).toBe(2);
    expect(a + b).toBe(1);
    expect(h.table).toHaveLength(3);
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
  });

  it('a 01:00 closing: the sheet runs from one send to the next, so the lattes sold after midnight are on it', async () => {
    const h = build({
      branches: [LATE],
      recorded: [
        // After midnight on the 16th: the 15th's trade, on the sheet sent at 01:30 on the 16th.
        used('b-late', '2026-09-16T01:15:00', [usageRow('Cold Brew', 'ml', 300, 0.3)]),
        used('b-late', '2026-09-16T18:00:00', MILK()),
        used('b-late', '2026-09-17T00:30:00', [usageRow('Oat Milk', 'ml', 500, 0.2)]),
        used('b-late', '2026-09-17T01:40:00', [usageRow('Syrup', 'ml', 100, 0.05)]),
      ],
    });

    // The 16th's trade is still going at 23:00 and at 01:25 on the 17th.
    expect(await h.runAt('2026-09-16T23:00:00')).toBe(0);
    expect(await h.runAt('2026-09-17T01:00:00')).toBe(0);
    expect(await h.runAt('2026-09-17T01:25:00')).toBe(0);

    expect(await h.runAt('2026-09-17T01:30:03')).toBe(1);
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-late', '2026-09-16', manila('2026-09-16T01:30:00'), manila('2026-09-17T01:30:00'));
    expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans', 'Oat Milk']);
    expect(h.table[0].link).toBe('/pos/inventory/reports?from=2026-09-16&to=2026-09-16&branchId=b-late');

    // Later on the 17th, nothing: the 17th's own sheet goes at 01:30 on the 18th, starting where this one ended.
    expect(await h.runAt('2026-09-17T21:30:00')).toBe(0);
    expect(await h.runAt('2026-09-18T01:30:00')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-late', expect.objectContaining({ day: '2026-09-17' }), 0);
    expect(h.lastSentNames()).toEqual(['Syrup']);
  });

  it('a 04:30 closing: the evening before is on the sheet, named for that evening', async () => {
    const h = build({ branches: [{ ...MAIN, closesAt: '04:30' }], recorded: [used('b-main', '2026-09-16T20:00:00', MILK())] });
    expect(await h.runAt('2026-09-17T05:00:01')).toBe(1);
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-16T05:00:00'), manila('2026-09-17T05:00:00'));
    expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans']);
    expect(h.table[0].link).toBe('/pos/inventory/reports?from=2026-09-16&to=2026-09-16&branchId=b-main');
  });

  it('skips branches with no closing time, closed branches, demo shops and suspended shops -- but not a shop in grace', async () => {
    const all = [MAIN, NAGA, SHUT, GRACE, DEMO, SUSP];
    const h = build({ branches: all, recorded: all.map((b) => used(b.id, '2026-09-16T14:00:00', MILK())) });

    expect(await h.runAt('2026-09-16T21:30:02')).toBe(2);
    expect(h.reports.usageForWindow.mock.calls.map((c: any[]) => c[1]).sort()).toEqual(['b-grace', 'b-main']);
    expect(h.telegram.dailyUsage.mock.calls.map((c: any[]) => c[1]).sort()).toEqual(['b-grace', 'b-main']);
    expect(h.table.map((n) => n.userId).sort()).toEqual(['grace-owner', 'mgr-all', 'mgr-main', 'owner']);
    expect(h.prisma.branch.findMany.mock.calls[0][0].where).toEqual({
      isActive: true,
      closesAt: { not: null },
      tenant:   { isDemoTenant: false, status: { not: 'SUSPENDED' } },
    });
  });

  it('a day with nothing used and nothing sold sends nothing; a sale that syncs later that evening sends it then', async () => {
    const h = build({
      recorded: [used('b-main', '2026-09-16T21:20:00', MILK(), { reachedAt: '2026-09-16T21:50:00' })],
      sales: [sale('b-main', '2026-09-16T21:20:00', { createdAt: '2026-09-16T21:50:00' })],
    });
    expect(await h.runAt('2026-09-16T21:30:02')).toBe(0);
    const sold = soldQueries(h.prisma);
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ tenantId: 't1', branchId: 'b-main', deletedAt: null, status: { in: ['PAID', 'COMPLETED', 'RETURNED'] } });
    // The sheet's own hours.
    expect(sold[0].OR[0].paidAt).toEqual({ gte: manila('2026-09-15T21:30:00'), lt: manila('2026-09-16T21:30:00') });
    expect(h.table).toHaveLength(0);
    expect(h.telegram.dailyUsage).not.toHaveBeenCalled();

    expect(await h.runAt('2026-09-16T21:55:00')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    expect(h.table[0].body).not.toContain('reached Clerque');
  });

  it('a day with sales but nothing counted still goes, saying why', async () => {
    const h = build({ sales: [sale('b-main', '2026-09-16T15:00:00')] });
    expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
    expect(h.table[0].body).toBe('Items were sold but no ingredients were counted. They may have no recipe yet.');
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
  });

  it('items still waiting at a screen count as a day to report, without asking about sales', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T20:45:00', [], { stillBeingMade: 2 })] });
    expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
    expect(soldQueries(h.prisma)).toHaveLength(0);
    expect(h.table[0].body).toBe('No ingredients were counted yet. 2 items still at the kitchen or bar screen are not counted yet.');
  });

  describe('sales rung up offline that reach Clerque after their sheet', () => {
    const OAT = () => [usageRow('Oat Milk', 'ml', 400, 0.2)];

    it('are on no sheet, so the next sheet says how many -- once', async () => {
      const h = build({
        recorded: [
          used('b-main', '2026-09-16T14:00:00', MILK()),
          // Rung up at 20:30 while the till was offline; it reached Clerque at 21:45, after the 21:30 sheet.
          used('b-main', '2026-09-16T20:30:00', OAT(), { reachedAt: '2026-09-16T21:45:00' }),
          used('b-main', '2026-09-17T14:00:00', MILK()),
          used('b-main', '2026-09-18T14:00:00', MILK()),
        ],
        sales: [
          sale('b-main', '2026-09-16T14:00:00'),
          sale('b-main', '2026-09-16T20:30:00', { createdAt: '2026-09-16T21:45:00' }),
          sale('b-main', '2026-09-17T14:00:00'),
          // Another branch's late sale is that branch's business.
          sale('b-naga', '2026-09-16T20:30:00', { createdAt: '2026-09-16T21:45:00' }),
        ],
      });
      expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
      expect(h.table[0].body).not.toContain('reached Clerque');
      expect(h.lastSentNames()).not.toContain('Oat Milk');

      expect(await h.runAt('2026-09-17T21:30:02')).toBe(1);
      expect(h.table[3].body).toBe(
        'Fresh Milk 8.1 L · Espresso Beans 1.25 kg. Value at cost ₱1,872.50. '
        + "1 sale rung up offline reached Clerque after its day's sheet went out. No sheet counts it; the report page does.",
      );
      // Its ingredients stay on the day it was sold: this sheet's hours start after it.
      expect(h.lastSentNames()).not.toContain('Oat Milk');
      expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-17' }), 1);

      // Said once: the next sheet only looks at what arrived after this one went out.
      expect(await h.runAt('2026-09-18T21:30:02')).toBe(1);
      expect(h.table[6].body).not.toContain('reached Clerque');
      expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-18' }), 0);
    });

    it('a sale that syncs before the send is on that sheet, and is not called late on the next', async () => {
      const h = build({
        recorded: [
          used('b-main', '2026-09-16T20:30:00', OAT(), { reachedAt: '2026-09-16T21:20:00' }),
          used('b-main', '2026-09-17T14:00:00', MILK()),
        ],
        sales: [sale('b-main', '2026-09-16T20:30:00', { createdAt: '2026-09-16T21:20:00' })],
      });
      expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
      expect(h.lastSentNames()).toEqual(['Oat Milk']);
      expect(await h.runAt('2026-09-17T21:30:02')).toBe(1);
      expect(h.table[3].body).not.toContain('reached Clerque');
    });

    it('a sheet sent late (after a restart) already counted what synced before it went out: not called late', async () => {
      const h = build({
        recorded: [
          used('b-main', '2026-09-16T20:30:00', OAT(), { reachedAt: '2026-09-16T22:00:00' }),
          used('b-main', '2026-09-17T14:00:00', MILK()),
        ],
        sales: [sale('b-main', '2026-09-16T20:30:00', { createdAt: '2026-09-16T22:00:00' })],
      });
      // The server was down from 21:30 to 23:00; the catch-up sends the 16th then, with the 22:00 sync on it.
      expect(await h.runAt('2026-09-16T23:00:00')).toBe(1);
      expect(h.lastSentNames()).toEqual(['Oat Milk']);
      expect(await h.runAt('2026-09-17T21:30:02')).toBe(1);
      expect(h.table[3].body).not.toContain('reached Clerque');
      expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.anything(), 0);
    });

    it('a till offline for days, with no sheet sent meanwhile: the next sheet still goes, for the note alone', async () => {
      const h = build({
        recorded: [
          used('b-main', '2026-09-15T12:00:00', OAT(), { reachedAt: '2026-09-17T09:00:00' }),
          used('b-main', '2026-09-16T10:00:00', OAT(), { reachedAt: '2026-09-17T09:00:00' }),
        ],
        sales: [
          sale('b-main', '2026-09-15T12:00:00', { createdAt: '2026-09-17T09:00:00' }),
          sale('b-main', '2026-09-16T10:00:00', { createdAt: '2026-09-17T09:00:00' }),
          // Made, then voided: its drink still left the shelf, and it was on no sheet either.
          sale('b-main', '2026-09-16T11:00:00', { createdAt: '2026-09-17T09:00:00', status: 'VOIDED' }),
        ],
      });
      // Nothing had reached Clerque by either night's send.
      expect(await h.runAt('2026-09-15T21:30:02')).toBe(0);
      expect(await h.runAt('2026-09-16T21:30:02')).toBe(0);

      // The 17th: the shop was closed, nothing used or sold in the sheet's hours -- only the three late sales.
      expect(await h.runAt('2026-09-17T21:30:02')).toBe(1);
      expect(h.table[0].body).toBe(
        "No ingredients were counted. 3 sales rung up offline reached Clerque after their day's sheet went out. No sheet counts them; the report page does.",
      );
      expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-17', rows: [] }), 3);
    });
  });

  it('closing at 23:50: due at 00:20, so the 00:00 and 00:10 runs wait and the 00:20 run sends the day that just ended', async () => {
    const h = build({ branches: [{ ...MAIN, closesAt: '23:50' }], recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
    expect(await h.runAt('2026-09-16T23:55:00')).toBe(0);
    expect(await h.runAt('2026-09-17T00:00:01')).toBe(0);
    expect(await h.runAt('2026-09-17T00:10:00')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
    expect(await h.runAt('2026-09-17T00:20:01')).toBe(1);
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-16T00:20:00'), manila('2026-09-17T00:20:00'));
  });

  it('a closing time set the next morning does not send last night\'s sheet out of the blue', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
    expect(await h.runAt('2026-09-17T10:00:00')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
  });

  it('a shop with no active owner or manager for the branch: nobody to tell, nothing sent', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], people: PEOPLE.filter((p) => p.role === 'CASHIER') });
    expect(await h.runAt('2026-09-16T21:30:02')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
    expect(h.telegram.dailyUsage).not.toHaveBeenCalled();
  });

  it('never throws: one branch failing is logged and the others still get their sheet', async () => {
    const h = build({ branches: [MAIN, GRACE] });
    h.reports.usageForWindow.mockImplementation(async (_t: string, branchId: string, label: string) => {
      if (branchId === 'b-main') throw new Error('database hiccup');
      return usageDay(label, MILK());
    });
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(h.runAt('2026-09-16T21:30:02')).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('b-main'));
    expect(h.telegram.dailyUsage).toHaveBeenCalledWith('tGrace', 'b-grace', expect.objectContaining({ day: '2026-09-16' }), 0);

    // Nothing was claimed for Main, so the next run tries it again.
    h.reports.usageForWindow.mockImplementation(async (_t: string, _b: string, label: string) => usageDay(label, MILK()));
    expect(await h.runAt('2026-09-16T21:35:00')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-16' }), 0);
  });

  it('never throws when the branch list cannot be read', async () => {
    const h = build();
    h.prisma.branch.findMany.mockRejectedValueOnce(new Error('database down'));
    await expect(h.runAt('2026-09-16T21:30:02')).resolves.toBe(0);
  });

  it('a closing time Clerque cannot read is skipped, and said once', async () => {
    const h = build({ branches: [{ ...MAIN, closesAt: '9pm' }] });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await h.runAt('2026-09-16T21:30:02');
    await h.runAt('2026-09-16T21:35:00');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
  });

  it('without Telegram wired in, the bell still goes', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], telegram: false });
    expect(await h.runAt('2026-09-16T21:30:02')).toBe(1);
    expect(h.table).toHaveLength(3);
  });

  describe('reportDue -- which hours, which name, and when', () => {
    it('is due half an hour after closing, covering the 24 hours up to then', () => {
      expect(SEND_AFTER_CLOSE_MS).toBe(30 * 60 * 1000);
      expect(reportDue('21:00', manila('2026-09-16T21:00:00'))).toBeNull();
      expect(reportDue('21:00', manila('2026-09-16T21:10:00'))).toBeNull();
      expect(reportDue('21:00', manila('2026-09-16T21:29:59'))).toBeNull();
      expect(reportDue('21:00', manila('2026-09-16T21:30:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-15T21:30:00'), to: manila('2026-09-16T21:30:00'),
      });
      // Read a few minutes late, the window still ends at the moment it was due.
      expect(reportDue('21:00', manila('2026-09-16T21:34:00'))?.to).toEqual(manila('2026-09-16T21:30:00'));
      expect(reportDue('12:30', manila('2026-09-16T13:05:00'))?.day).toBe('2026-09-16');
    });

    it('names the sheet for the day most of its hours fall in', () => {
      expect(reportDue('00:00', manila('2026-09-17T00:30:00'))?.day).toBe('2026-09-16');
      expect(reportDue('01:00', manila('2026-09-17T01:34:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-16T01:30:00'), to: manila('2026-09-17T01:30:00'),
      });
      expect(reportDue('03:59', manila('2026-09-17T04:29:00'))?.day).toBe('2026-09-16');
      // From 04:00 on too: the sheet at 04:30 on the 17th is the 16th's evening, not a day just begun.
      expect(reportDue('04:00', manila('2026-09-17T04:30:00'))?.day).toBe('2026-09-16');
      expect(reportDue('04:30', manila('2026-09-17T05:00:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-16T05:00:00'), to: manila('2026-09-17T05:00:00'),
      });
      // A morning closing: 12.5 of the 24 hours are the day before.
      expect(reportDue('11:00', manila('2026-09-16T11:30:00'))?.day).toBe('2026-09-15');
      // Across a month and a year end.
      expect(reportDue('02:00', manila('2026-10-01T02:30:00'))?.day).toBe('2026-09-30');
      expect(reportDue('02:00', manila('2027-01-01T02:35:00'))?.day).toBe('2026-12-31');
    });

    it('back to back: each sheet starts exactly where the one before ended, one day apart', () => {
      for (const closesAt of ['21:00', '12:30', '23:50', '00:00', '01:00', '04:30']) {
        const dueOn = (day: string) => new Date(manila(`${day}T${closesAt}:00`).getTime() + SEND_AFTER_CLOSE_MS);
        const first = reportDue(closesAt, dueOn('2026-09-16'))!;
        const second = reportDue(closesAt, dueOn('2026-09-17'))!;
        expect({ closesAt, from: second.from }).toEqual({ closesAt, from: first.to });
        expect(first.to.getTime() - first.from.getTime()).toBe(DAY_MS);
        expect(new Date(`${second.day}T00:00:00Z`).getTime() - new Date(`${first.day}T00:00:00Z`).getTime()).toBe(DAY_MS);
      }
    });

    it('a missed sheet is still sent within the catch-up window, and not after', () => {
      const closed = manila('2026-09-16T21:00:00');
      expect(reportDue('21:00', new Date(closed.getTime() + CATCH_UP_MS))?.day).toBe('2026-09-16');
      expect(reportDue('21:00', new Date(closed.getTime() + CATCH_UP_MS + 1))).toBeNull();
      // Just after midnight a 23:50 closing is not due yet -- not today's, not yesterday's.
      expect(reportDue('23:50', manila('2026-09-17T00:10:00'))).toBeNull();
      expect(reportDue('23:50', manila('2026-09-17T00:20:00'))?.to).toEqual(manila('2026-09-17T00:20:00'));
      expect(reportDue('23:50', manila('2026-09-17T00:20:00'))?.day).toBe('2026-09-16');
    });

    it('runs on Manila time whatever the server clock says', () => {
      // 13:30 UTC is 21:30 in Manila.
      expect(reportDue('21:00', new Date('2026-09-16T13:30:00Z'))?.day).toBe('2026-09-16');
    });

    it('refuses a closing time not written HH:mm', () => {
      expect(reportDue('9:00', manila('2026-09-16T21:30:00'))).toBeNull();
      expect(reportDue('24:00', manila('2026-09-16T21:30:00'))).toBeNull();
    });
  });

  describe('usageBellBody', () => {
    it('names the top five by value, counts the rest, and gives the value and what was lost', () => {
      // Most valuable first, as the report sorts them.
      const rows = [
        usageRow('Espresso Beans', 'g', 1250, 0.85, { sold: 950, writtenOff: 300 }),
        usageRow('Fresh Milk', 'ml', 8100, 0.1, { sold: 6900, wasted: 1200 }),
        usageRow('Cups', 'pcs', 64, 4),
        usageRow('Ice', 'kg', 3.5, 20),
        usageRow('Sugar', 'g', 650, 0.07),
        usageRow('Cinnamon', 'g', 12, 0.5),
        usageRow('Straws', 'pcs', 40, 0),
      ];
      expect(usageBellBody(usageDay('2026-09-16', rows, 1))).toBe(
        'Espresso Beans 1.25 kg · Fresh Milk 8.1 L · Cups 64 pcs · Ice 3.5 kg · Sugar 650 g · +2 more. '
        + 'Value at cost ₱2,250.00. Wasted or written off: ₱375.00. '
        + '1 item still at the kitchen or bar screen is not counted yet.',
      );
    });

    it('leaves out the value when nothing has a cost', () => {
      expect(usageBellBody(usageDay('2026-09-16', [usageRow('Straws', 'pcs', 40, 0)]))).toBe('Straws 40 pcs.');
    });

    it('ends with the late sales, and a sheet sent only for them does not blame missing recipes', () => {
      expect(usageBellBody(usageDay('2026-09-16', [usageRow('Straws', 'pcs', 40, 0)]), 2)).toBe(
        "Straws 40 pcs. 2 sales rung up offline reached Clerque after their day's sheet went out. No sheet counts them; the report page does.",
      );
      expect(usageBellBody(usageDay('2026-09-16', []), 1)).toBe(
        "No ingredients were counted. 1 sale rung up offline reached Clerque after its day's sheet went out. No sheet counts it; the report page does.",
      );
    });
  });

  it('the report link carries the day and the branch', () => {
    expect(usageReportLink('b-main', '2026-09-16')).toBe('/pos/inventory/reports?from=2026-09-16&to=2026-09-16&branchId=b-main');
  });
});
