import { Logger } from '@nestjs/common';
import {
  CATCH_UP_MS, EndOfDayScheduler, FALLBACK_AFTER_CLOSE_MS, closingDueAt, lastShiftCloseDue, reportDue, saveDue, usageBellBody, usageReportLink,
} from './end-of-day.scheduler';
import { DAY_MS } from './daily-usage';
import type { UsageDay, UsageRow } from './daily-usage';

/**
 * The end-of-day ingredient sheet: when it goes, which hours it covers, to
 * whom, and that it goes once. The day closes when its last shift is closed
 * (closeDayAtLastShift), or 2 hours after closing when nobody closes it.
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

  /** A stock row: what the branch's book says it has of one item. */
  type Stock = { tenantId: string; branchId: string; rawMaterialId: string; quantity: number };

  function build(opts: {
    branches?: Branch[];
    recorded?: Used[];
    sales?: Sale[];
    people?: typeof PEOPLE;
    telegram?: boolean;
    /** Stock rows. None by default, so no closing balance is saved and the message keeps its 24 hours. */
    stock?: Stock[];
    /** false: the closing-time buy list is not wired in. */
    closingList?: boolean;
    /** Z-Reads already written, e.g. by a last shift close earlier that evening. */
    zReads?: Array<{ tenantId: string; branchId: string; day: string }>;
    /** true: generating a Z-Read fails. */
    zReadFails?: boolean;
  } = {}) {
    const branches = opts.branches ?? [MAIN];
    const people = opts.people ?? PEOPLE;
    const recorded: Used[] = [...(opts.recorded ?? [])];
    const sales: Sale[] = [...(opts.sales ?? [])];
    const stock: Stock[] = [...(opts.stock ?? [])];
    const table: any[] = [];
    /** Saved closing balances, shared by every run and every scheduler instance, like the notifications. */
    const balances: any[] = [];
    /** The Z-Read rows: one per branch per day, the same table both ends of the day write. */
    const zReadRows: Array<{ tenantId: string; branchId: string; day: string; date: number }> = [...(opts.zReads ?? []).map((z) => ({
      ...z, date: new Date(`${z.day}T00:00:00Z`).getTime(),
    }))];
    let clock = new Date(0);
    const locks = new Map<string, Promise<void>>();

    const stockDayBalance = {
      findFirst: jest.fn(async ({ where }: any) => balances.find((r) => r.branchId === where.branchId && r.day === where.day) ?? null),
      findMany: jest.fn(async ({ where }: any) => {
        const rows = balances.filter((r) => r.branchId === where.branchId && where.day.in.includes(r.day));
        return rows.filter((r, i) => rows.findIndex((o) => o.day === r.day) === i).map((r) => ({ day: r.day, takenAt: r.takenAt }));
      }),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) balances.push({ id: `sdb${balances.length + 1}`, ...d });
        return { count: data.length };
      }),
    };
    const rawMaterialInventory = {
      findMany: jest.fn(async ({ where }: any) => stock
        .filter((r) => r.tenantId === where.tenantId && r.branchId === where.branchId)
        .map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: r.quantity }))),
    };

    const notification = {
      findFirst: jest.fn(async ({ where }: any) => table.find((n) =>
        n.tenantId === where.tenantId
        && (where.link?.in ? where.link.in.includes(n.link) : n.link === where.link)
        && n.createdAt >= where.createdAt.gte) ?? null),
      createMany: jest.fn(async ({ data }: any) => {
        for (const d of data) table.push({ id: `n${table.length + 1}`, readAt: null, createdAt: clock, ...d });
        return { count: data.length };
      }),
    };
    const prisma: any = {
      branch: {
        // The filters the database would apply, read from the query itself. The closing save asks without closesAt and isDemoTenant.
        findMany: jest.fn(async ({ where }: any) => branches
          .filter((b) => b.isActive === where.isActive)
          .filter((b) => (where.closesAt?.not === null ? b.closesAt !== null : true))
          .filter((b) => where.tenant.isDemoTenant === undefined || TENANTS[b.tenantId].isDemoTenant === where.tenant.isDemoTenant)
          .filter((b) => TENANTS[b.tenantId].status !== where.tenant.status.not)
          .map(({ id, tenantId, name, closesAt }) => ({ id, tenantId, name, closesAt }))),
        // The shift close reads its one branch, with the shop's flags.
        findFirst: jest.fn(async ({ where }: any) => {
          const b = branches.find((x) => x.id === where.id && x.tenantId === where.tenantId);
          return b ? { id: b.id, tenantId: b.tenantId, name: b.name, closesAt: b.closesAt, isActive: b.isActive, tenant: { ...TENANTS[b.tenantId] } } : null;
        }),
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
      stockDayBalance,
      // Date-only column: the row is keyed on UTC midnight of the day as named.
      zReadLog: {
        findFirst: jest.fn(async ({ where }: any) => zReadRows.find((r) =>
          r.branchId === where.branchId && r.date === where.date.getTime()) ?? null),
      },
      $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
        const held: { release?: () => void } = {};
        const tx = {
          notification,
          stockDayBalance,
          rawMaterialInventory,
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
    /*
      ReportsService.generateZRead has its own spec (reports.z-read.spec.ts);
      here only that the day's close asks for it, for which day, and once.
      Like the real one it is update-on-repeat, so a second call on a day that
      already has a row replaces it rather than making a second.
    */
    const zReads: any = {
      generateZRead: jest.fn(async (tenantId: string, branchId: string, day: string) => {
        if (opts.zReadFails) throw new Error('z-read boom');
        const date = new Date(`${day}T00:00:00Z`).getTime();
        const found = zReadRows.find((r) => r.branchId === branchId && r.date === date);
        if (found) return found;
        const row = { tenantId, branchId, day, date };
        zReadRows.push(row);
        return row;
      }),
    };
    // Procure's own spec covers whether a list already went out; here it only matters when and for what it is asked.
    const closingList: any = { sendAtClosingIfNothingSent: jest.fn(async () => 'SENT') };
    const make = () => new EndOfDayScheduler(
      prisma, reports, zReads, opts.telegram === false ? undefined : telegram, opts.closingList === false ? undefined : closingList,
    );
    const scheduler = make();
    /** Runs the job at a Manila wall-clock time. A closing save reads the stock at that same instant. */
    const runAt = (at: string, s = scheduler) => {
      clock = manila(at);
      const readAt = clock;
      return s.run(clock, () => readAt);
    };
    /** The last shift of a branch closed at a Manila wall-clock time; the stock is read at that same instant. */
    const closeShiftAt = (at: string, branch: Branch = branches[0], s = scheduler) => {
      clock = manila(at);
      const readAt = clock;
      return s.closeDayAtLastShift(branch.tenantId, branch.id, clock, () => readAt);
    };
    /** The ingredient names on the sheet Telegram was handed last. */
    const lastSentNames = () => {
      const calls = telegram.dailyUsage.mock.calls;
      return (calls[calls.length - 1]?.[2] as UsageDay | undefined)?.rows.map((r) => r.name);
    };
    return { scheduler, make, runAt, closeShiftAt, prisma, reports, telegram, closingList, table, recorded, sales, lastSentNames, balances, stock, zReads, zReadRows };
  }
  /** The order counts that ask whether anything sold in the window (the late-sales count has no OR). */
  const soldQueries = (prisma: any) => prisma.order.count.mock.calls.map((c: any[]) => c[0].where).filter((w: any) => w.OR);

  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('with no shift closed, nothing until two hours after closing; then one bell per owner and manager of the branch, and Telegram gets that same reading', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });

    expect(await h.runAt('2026-09-16T20:55:00')).toBe(0);
    expect(await h.runAt('2026-09-16T21:00:02')).toBe(0);
    // Closing + 30 used to send it; now the job waits for the last shift to close the day.
    expect(await h.runAt('2026-09-16T21:30:00')).toBe(0);
    expect(await h.runAt('2026-09-16T22:55:00')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
    expect(h.table).toHaveLength(0);

    expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
    // The 24 hours up to the fallback moment, not the calendar day.
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-15T23:00:00'), manila('2026-09-16T23:00:00'));
    // Not the manager of another branch, not the till, not a deactivated owner.
    expect(h.table.map((n) => n.userId).sort()).toEqual(['mgr-all', 'mgr-main', 'owner']);
    const bell = h.table[0];
    expect(bell).toMatchObject({
      tenantId: 't1',
      kind:     'INFO',
      title:    'Ingredients used today — Main',
      link:     '/procure/stock/reports?from=2026-09-16&to=2026-09-16&branchId=b-main',
    });
    expect(bell.body).toBe('Fresh Milk 8.1 L · Espresso Beans 1.25 kg. Value at cost ₱1,872.50.');
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    const [tenantId, branchId, sheet, lateSales] = h.telegram.dailyUsage.mock.calls[0];
    expect([tenantId, branchId, lateSales]).toEqual(['t1', 'b-main', 0]);
    // The very object the bell was built from: Telegram does not read the usage again, so the two can never disagree.
    expect(sheet).toBe(await h.reports.usageForWindow.mock.results[0].value);
    expect(h.reports.usageForWindow).toHaveBeenCalledTimes(1);
  });

  it('closing up: a write-off before the day closes is on the sheet, and one after the send is on the next sheet, not lost', async () => {
    const h = build({
      recorded: [
        used('b-main', '2026-09-16T14:00:00', MILK()),
        used('b-main', '2026-09-16T22:15:00', [usageRow('Oat Milk', 'ml', 1000, 0.2, { sold: 0, writtenOff: 1000 })]),
        used('b-main', '2026-09-16T23:10:00', [usageRow('Croissant Dough', 'g', 500, 0.3, { sold: 0, writtenOff: 500 })]),
      ],
    });
    expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
    expect(h.table[0].body).toBe('Fresh Milk 8.1 L · Espresso Beans 1.25 kg · Oat Milk 1 L. Value at cost ₱2,072.50. Wasted or written off: ₱200.00.');
    expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans', 'Oat Milk']);

    expect(await h.runAt('2026-09-17T23:00:00')).toBe(1);
    expect(h.lastSentNames()).toEqual(['Croissant Dough']);
  });

  it('once per day: later runs, and a restarted scheduler, send nothing more', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK()), used('b-main', '2026-09-17T14:00:00', MILK())] });
    await h.runAt('2026-09-16T23:00:02');
    const usageReads = h.reports.usageForWindow.mock.calls.length;

    expect(await h.runAt('2026-09-16T23:05:00')).toBe(0);
    expect(await h.runAt('2026-09-17T00:00:00', h.make())).toBe(0);
    expect(await h.runAt('2026-09-17T01:55:00', h.make())).toBe(0);
    expect(h.table).toHaveLength(3);
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    // Already sent: the cheap look stops the run before the day is read again.
    expect(h.reports.usageForWindow).toHaveBeenCalledTimes(usageReads);

    // The next day is a new day.
    expect(await h.runAt('2026-09-17T23:00:01')).toBe(1);
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

    const [a, b] = await Promise.all([h.runAt('2026-09-16T23:00:02'), h.runAt('2026-09-16T23:00:02', h.make())]);
    expect(arrived).toBe(2);
    expect(a + b).toBe(1);
    expect(h.table).toHaveLength(3);
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
  });

  it('a 01:00 closing: the sheet runs from one send to the next, so the lattes sold after midnight are on it', async () => {
    const h = build({
      branches: [LATE],
      recorded: [
        // After midnight on the 16th: the 15th's trade, on the sheet sent at 03:00 on the 16th.
        used('b-late', '2026-09-16T01:15:00', [usageRow('Cold Brew', 'ml', 300, 0.3)]),
        used('b-late', '2026-09-16T18:00:00', MILK()),
        used('b-late', '2026-09-17T00:30:00', [usageRow('Oat Milk', 'ml', 500, 0.2)]),
        used('b-late', '2026-09-17T03:10:00', [usageRow('Syrup', 'ml', 100, 0.05)]),
      ],
    });

    // The 16th's trade is still going at 23:00, at closing, and at 02:55 on the 17th.
    expect(await h.runAt('2026-09-16T23:00:00')).toBe(0);
    expect(await h.runAt('2026-09-17T01:00:00')).toBe(0);
    expect(await h.runAt('2026-09-17T02:55:00')).toBe(0);

    expect(await h.runAt('2026-09-17T03:00:03')).toBe(1);
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-late', '2026-09-16', manila('2026-09-16T03:00:00'), manila('2026-09-17T03:00:00'));
    expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans', 'Oat Milk']);
    expect(h.table[0].link).toBe('/procure/stock/reports?from=2026-09-16&to=2026-09-16&branchId=b-late');

    // Later on the 17th, nothing: the 17th's own sheet goes at 03:00 on the 18th, starting where this one ended.
    expect(await h.runAt('2026-09-17T23:00:00')).toBe(0);
    expect(await h.runAt('2026-09-18T03:00:00')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-late', expect.objectContaining({ day: '2026-09-17' }), 0);
    expect(h.lastSentNames()).toEqual(['Syrup']);
  });

  it('a 04:30 closing: the evening before is on the sheet, named for that evening', async () => {
    const h = build({ branches: [{ ...MAIN, closesAt: '04:30' }], recorded: [used('b-main', '2026-09-16T20:00:00', MILK())] });
    expect(await h.runAt('2026-09-17T06:30:01')).toBe(1);
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-16T06:30:00'), manila('2026-09-17T06:30:00'));
    expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans']);
    expect(h.table[0].link).toBe('/procure/stock/reports?from=2026-09-16&to=2026-09-16&branchId=b-main');
  });

  it('skips branches with no closing time, closed branches, demo shops and suspended shops -- but not a shop in grace', async () => {
    const all = [MAIN, NAGA, SHUT, GRACE, DEMO, SUSP];
    const h = build({ branches: all, recorded: all.map((b) => used(b.id, '2026-09-16T14:00:00', MILK())) });

    expect(await h.runAt('2026-09-16T23:00:02')).toBe(2);
    expect(h.reports.usageForWindow.mock.calls.map((c: any[]) => c[1]).sort()).toEqual(['b-grace', 'b-main']);
    expect(h.telegram.dailyUsage.mock.calls.map((c: any[]) => c[1]).sort()).toEqual(['b-grace', 'b-main']);
    expect(h.table.map((n) => n.userId).sort()).toEqual(['grace-owner', 'mgr-all', 'mgr-main', 'owner']);
    // The message's own query, unchanged by the closing save that runs before it.
    const messageQuery = h.prisma.branch.findMany.mock.calls.map((c: any[]) => c[0].where).find((w: any) => 'closesAt' in w);
    expect(messageQuery).toEqual({
      isActive: true,
      closesAt: { not: null },
      tenant:   { isDemoTenant: false, status: { not: 'SUSPENDED' } },
    });
  });

  it('a day with nothing used and nothing sold sends nothing; a sale that syncs later that evening sends it then', async () => {
    const h = build({
      recorded: [used('b-main', '2026-09-16T22:50:00', MILK(), { reachedAt: '2026-09-16T23:20:00' })],
      sales: [sale('b-main', '2026-09-16T22:50:00', { createdAt: '2026-09-16T23:20:00' })],
    });
    expect(await h.runAt('2026-09-16T23:00:02')).toBe(0);
    const sold = soldQueries(h.prisma);
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ tenantId: 't1', branchId: 'b-main', deletedAt: null, status: { in: ['PAID', 'COMPLETED', 'RETURNED'] } });
    // The sheet's own hours.
    expect(sold[0].OR[0].paidAt).toEqual({ gte: manila('2026-09-15T23:00:00'), lt: manila('2026-09-16T23:00:00') });
    expect(h.table).toHaveLength(0);
    expect(h.telegram.dailyUsage).not.toHaveBeenCalled();

    expect(await h.runAt('2026-09-16T23:25:00')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    expect(h.table[0].body).not.toContain('reached Clerque');
  });

  it('a day with sales but nothing counted still goes, saying why', async () => {
    const h = build({ sales: [sale('b-main', '2026-09-16T15:00:00')] });
    expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
    expect(h.table[0].body).toBe('Items were sold but no ingredients were counted. They may have no recipe yet.');
    expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
  });

  it('items still waiting at a screen count as a day to report, without asking about sales', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T20:45:00', [], { stillBeingMade: 2 })] });
    expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
    expect(soldQueries(h.prisma)).toHaveLength(0);
    expect(h.table[0].body).toBe('No ingredients were counted yet. 2 items still at the kitchen or bar screen are not counted yet.');
  });

  describe('sales rung up offline that reach Clerque after their sheet', () => {
    const OAT = () => [usageRow('Oat Milk', 'ml', 400, 0.2)];

    it('are on no sheet, so the next sheet says how many -- once', async () => {
      const h = build({
        recorded: [
          used('b-main', '2026-09-16T14:00:00', MILK()),
          // Rung up at 20:30 while the till was offline; it reached Clerque at 23:15, after the 23:00 sheet.
          used('b-main', '2026-09-16T20:30:00', OAT(), { reachedAt: '2026-09-16T23:15:00' }),
          used('b-main', '2026-09-17T14:00:00', MILK()),
          used('b-main', '2026-09-18T14:00:00', MILK()),
        ],
        sales: [
          sale('b-main', '2026-09-16T14:00:00'),
          sale('b-main', '2026-09-16T20:30:00', { createdAt: '2026-09-16T23:15:00' }),
          sale('b-main', '2026-09-17T14:00:00'),
          // Another branch's late sale is that branch's business.
          sale('b-naga', '2026-09-16T20:30:00', { createdAt: '2026-09-16T23:15:00' }),
        ],
      });
      expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
      expect(h.table[0].body).not.toContain('reached Clerque');
      expect(h.lastSentNames()).not.toContain('Oat Milk');

      expect(await h.runAt('2026-09-17T23:00:02')).toBe(1);
      expect(h.table[3].body).toBe(
        'Fresh Milk 8.1 L · Espresso Beans 1.25 kg. Value at cost ₱1,872.50. '
        + "1 sale rung up offline reached Clerque after its day's sheet went out. No sheet counts it; the report page does.",
      );
      // Its ingredients stay on the day it was sold: this sheet's hours start after it.
      expect(h.lastSentNames()).not.toContain('Oat Milk');
      expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-17' }), 1);

      // Said once: the next sheet only looks at what arrived after this one went out.
      expect(await h.runAt('2026-09-18T23:00:02')).toBe(1);
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
      expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
      expect(h.lastSentNames()).toEqual(['Oat Milk']);
      expect(await h.runAt('2026-09-17T23:00:02')).toBe(1);
      expect(h.table[3].body).not.toContain('reached Clerque');
    });

    it('a sheet sent late (after a restart) already counted what synced before it went out: not called late', async () => {
      const h = build({
        recorded: [
          used('b-main', '2026-09-16T20:30:00', OAT(), { reachedAt: '2026-09-16T23:30:00' }),
          used('b-main', '2026-09-17T14:00:00', MILK()),
        ],
        sales: [sale('b-main', '2026-09-16T20:30:00', { createdAt: '2026-09-16T23:30:00' })],
      });
      // The server was down from 23:00 to 01:00; the catch-up sends the 16th then, with the 23:30 sync on it.
      expect(await h.runAt('2026-09-17T01:00:00')).toBe(1);
      expect(h.lastSentNames()).toEqual(['Oat Milk']);
      expect(await h.runAt('2026-09-17T23:00:02')).toBe(1);
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
      expect(await h.runAt('2026-09-15T23:00:02')).toBe(0);
      expect(await h.runAt('2026-09-16T23:00:02')).toBe(0);

      // The 17th: the shop was closed, nothing used or sold in the sheet's hours -- only the three late sales.
      expect(await h.runAt('2026-09-17T23:00:02')).toBe(1);
      expect(h.table[0].body).toBe(
        "No ingredients were counted. 3 sales rung up offline reached Clerque after their day's sheet went out. No sheet counts them; the report page does.",
      );
      expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-17', rows: [] }), 3);
    });
  });

  it('closing at 23:50: due at 01:50, so the runs after midnight wait and the 01:50 run sends the day that just ended', async () => {
    const h = build({ branches: [{ ...MAIN, closesAt: '23:50' }], recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
    expect(await h.runAt('2026-09-16T23:55:00')).toBe(0);
    expect(await h.runAt('2026-09-17T00:00:01')).toBe(0);
    expect(await h.runAt('2026-09-17T01:45:00')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
    expect(await h.runAt('2026-09-17T01:50:01')).toBe(1);
    expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-16T01:50:00'), manila('2026-09-17T01:50:00'));
  });

  it('a closing time set the next morning does not send last night\'s sheet out of the blue', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
    expect(await h.runAt('2026-09-17T10:00:00')).toBe(0);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
  });

  it('a shop with no active owner or manager for the branch: nobody to tell, nothing sent', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], people: PEOPLE.filter((p) => p.role === 'CASHIER') });
    expect(await h.runAt('2026-09-16T23:00:02')).toBe(0);
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

    await expect(h.runAt('2026-09-16T23:00:02')).resolves.toBe(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('b-main'));
    expect(h.telegram.dailyUsage).toHaveBeenCalledWith('tGrace', 'b-grace', expect.objectContaining({ day: '2026-09-16' }), 0);

    // Nothing was claimed for Main, so the next run tries it again.
    h.reports.usageForWindow.mockImplementation(async (_t: string, _b: string, label: string) => usageDay(label, MILK()));
    expect(await h.runAt('2026-09-16T23:05:00')).toBe(1);
    expect(h.telegram.dailyUsage).toHaveBeenLastCalledWith('t1', 'b-main', expect.objectContaining({ day: '2026-09-16' }), 0);
  });

  it('never throws when the branch list cannot be read', async () => {
    const h = build();
    h.prisma.branch.findMany.mockRejectedValue(new Error('database down'));
    await expect(h.runAt('2026-09-16T23:00:02')).resolves.toBe(0);
  });

  describe('the closing balance, saved by the job when no shift closed the day', () => {
    const stockOf = (branchId: string, tenantId = 't1'): Stock[] => [
      { tenantId, branchId, rawMaterialId: 'rm-milk', quantity: 4200 },
      { tenantId, branchId, rawMaterialId: 'rm-beans', quantity: 950 },
    ];

    it('no shift close: saves every stock row once, all read at one moment, at closing + 2 hours -- before the message is built', async () => {
      const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], stock: stockOf('b-main') });
      expect(await h.runAt('2026-09-16T21:30:00')).toBe(0);
      expect(await h.runAt('2026-09-16T22:55:00')).toBe(0);
      expect(h.balances).toHaveLength(0);

      // The message reads the day only after the save is written.
      h.reports.usageForWindow.mockImplementation(async (_t: string, _b: string, label: string) => {
        expect(h.balances.map((r) => r.day)).toEqual(['2026-09-16', '2026-09-16']);
        return usageDay(label, MILK());
      });
      expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
      expect(h.balances).toEqual([
        expect.objectContaining({ tenantId: 't1', branchId: 'b-main', rawMaterialId: 'rm-milk', day: '2026-09-16', endingQty: 4200, takenAt: manila('2026-09-16T23:00:02') }),
        expect.objectContaining({ tenantId: 't1', branchId: 'b-main', rawMaterialId: 'rm-beans', day: '2026-09-16', endingQty: 950, takenAt: manila('2026-09-16T23:00:02') }),
      ]);

      // Later runs, and a restarted scheduler, never save the day again -- the stock has moved on since.
      h.stock[0].quantity = 100;
      await h.runAt('2026-09-16T23:05:00');
      await h.runAt('2026-09-17T01:55:00', h.make());
      expect(h.balances).toHaveLength(2);
      expect(h.balances[0].endingQty).toBe(4200);
    });

    it('no shift close and no closing time: saved at 03:30 for the day before; a demo shop is saved too -- but neither gets a message', async () => {
      const h = build({
        branches: [MAIN, NAGA, SHUT, DEMO, SUSP],
        stock: [...stockOf('b-main'), ...stockOf('b-naga'), ...stockOf('b-shut'), ...stockOf('b-demo', 'tDemo'), ...stockOf('b-susp', 'tSusp')],
        recorded: ['b-main', 'b-demo', 'b-naga'].map((b) => used(b, '2026-09-16T14:00:00', MILK())),
      });
      await h.runAt('2026-09-16T23:00:02');
      expect([...new Set(h.balances.map((r) => r.branchId))].sort()).toEqual(['b-demo', 'b-main']);

      expect(await h.runAt('2026-09-16T23:55:00')).toBe(0);
      expect(await h.runAt('2026-09-17T03:25:00')).toBe(0);
      expect(h.balances.some((r) => r.branchId === 'b-naga')).toBe(false);
      expect(await h.runAt('2026-09-17T03:30:00')).toBe(0);
      // 03:30 on the 17th is still the 16th's night.
      expect(h.balances.filter((r) => r.branchId === 'b-naga').map((r) => [r.day, r.takenAt])).toEqual([
        ['2026-09-16', manila('2026-09-17T03:30:00')], ['2026-09-16', manila('2026-09-17T03:30:00')],
      ]);
      // A closed branch and a suspended shop get nothing; nor does anyone at the demo shop or Naga get a message.
      expect(h.balances.some((r) => r.branchId === 'b-shut' || r.branchId === 'b-susp')).toBe(false);
      expect(h.telegram.dailyUsage.mock.calls.map((c: any[]) => c[1])).toEqual(['b-main']);
    });

    it('one branch failing to save does not stop the other branches, or its own message', async () => {
      const h = build({ branches: [MAIN, GRACE], stock: [...stockOf('b-main'), ...stockOf('b-grace', 'tGrace')], recorded: ['b-main', 'b-grace'].map((b) => used(b, '2026-09-16T14:00:00', MILK())) });
      const realFind = h.prisma.stockDayBalance.findFirst.getMockImplementation();
      h.prisma.stockDayBalance.findFirst.mockImplementation(async (args: any) => {
        if (args.where.branchId === 'b-main') throw new Error('database hiccup');
        return realFind(args);
      });
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      expect(await h.runAt('2026-09-16T23:00:02')).toBe(2);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('b-main'));
      expect([...new Set(h.balances.map((r) => r.branchId))]).toEqual(['b-grace']);
      expect(h.telegram.dailyUsage.mock.calls.map((c: any[]) => c[1]).sort()).toEqual(['b-grace', 'b-main']);
      // With no save for the day, its message keeps the 24 hours up to the send.
      expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-15T23:00:00'), manila('2026-09-16T23:00:00'));
    });

    it('the message covers the hours between two saved closing balances, the same hours as the daily sheet', async () => {
      const h = build({
        stock: stockOf('b-main'),
        recorded: [
          used('b-main', '2026-09-16T14:00:00', MILK()),
          // In the moment between the 16th falling due and its stock being read: on the 16th's sheet, so on its message.
          used('b-main', '2026-09-16T23:02:00', [usageRow('Oat Milk', 'ml', 500, 0.2)]),
          used('b-main', '2026-09-17T14:00:00', [usageRow('Syrup', 'ml', 100, 0.05)]),
        ],
      });
      // The 23:00 run was missed; the 23:05 run reads the stock at 23:05.
      expect(await h.runAt('2026-09-16T23:05:00')).toBe(1);
      expect(h.reports.usageForWindow).toHaveBeenLastCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-15T23:00:00'), manila('2026-09-16T23:05:00'));
      expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans', 'Oat Milk']);

      expect(await h.runAt('2026-09-17T23:00:02')).toBe(1);
      expect(h.reports.usageForWindow).toHaveBeenLastCalledWith('t1', 'b-main', '2026-09-17', manila('2026-09-16T23:05:00'), manila('2026-09-17T23:00:02'));
      expect(h.lastSentNames()).toEqual(['Syrup']);
      // Still named, and kept from going out twice, by the day.
      expect(h.table[3].link).toBe('/procure/stock/reports?from=2026-09-17&to=2026-09-17&branchId=b-main');
    });
  });

  describe('the closing buy list, asked for when the job closes the day', () => {
    const asked = (h: ReturnType<typeof build>) => h.closingList.sendAtClosingIfNothingSent.mock.calls;

    it('asks at closing + 2 hours for the day the message names, with the closing moment -- even on a day with nothing to report', async () => {
      // Nothing used and nothing sold: no message, but the list (or its all-clear) still goes.
      const h = build();
      expect(await h.runAt('2026-09-16T22:55:00')).toBe(0);
      expect(asked(h)).toHaveLength(0);

      expect(await h.runAt('2026-09-16T23:00:02')).toBe(0);
      expect(asked(h)).toEqual([[
        expect.objectContaining({ id: 'b-main', tenantId: 't1', name: 'Main' }),
        { day: '2026-09-16', from: manila('2026-09-15T23:00:00'), to: manila('2026-09-16T23:00:00'), closedAt: manila('2026-09-16T21:00:00') },
        manila('2026-09-16T23:00:02'),
      ]]);

      // Later runs in the catch-up window ask again; Procure answers that the list already went out.
      await h.runAt('2026-09-16T23:05:00');
      expect(asked(h)).toHaveLength(2);
      expect(asked(h)[1][1].day).toBe('2026-09-16');
      // Past the catch-up window, and before the next closing, nothing is asked.
      await h.runAt('2026-09-17T10:00:00');
      expect(asked(h)).toHaveLength(2);
    });

    it('a 01:00 closing: asked at 03:00 for the evening before, closed at 01:00', async () => {
      const h = build({ branches: [LATE] });
      await h.runAt('2026-09-17T02:55:00');
      expect(asked(h)).toHaveLength(0);
      await h.runAt('2026-09-17T03:00:03');
      expect(asked(h)).toHaveLength(1);
      expect(asked(h)[0][1]).toMatchObject({ day: '2026-09-16', closedAt: manila('2026-09-17T01:00:00'), to: manila('2026-09-17T03:00:00') });
    });

    it('the same branches as the message: none without a closing time, closed, demo or suspended', async () => {
      const h = build({ branches: [MAIN, NAGA, SHUT, GRACE, DEMO, SUSP] });
      await h.runAt('2026-09-16T23:00:02');
      // 03:30 is when a branch with no closing time saves its stock -- it still gets no list.
      await h.runAt('2026-09-17T03:30:00');
      expect([...new Set(asked(h).map((c: any[]) => c[0].id))].sort()).toEqual(['b-grace', 'b-main']);
    });

    it('a message that fails still asks for its list, and a list that fails costs no other branch anything', async () => {
      const h = build({ branches: [MAIN, GRACE], recorded: ['b-main', 'b-grace'].map((b) => used(b, '2026-09-16T14:00:00', MILK())) });
      h.reports.usageForWindow.mockImplementation(async (_t: string, branchId: string, label: string) => {
        if (branchId === 'b-main') throw new Error('database hiccup');
        return usageDay(label, MILK());
      });
      h.closingList.sendAtClosingIfNothingSent.mockImplementation(async (branch: { id: string }) => {
        if (branch.id === 'b-main') throw new Error('not meant to throw');
        return 'SENT';
      });
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      await expect(h.runAt('2026-09-16T23:00:02')).resolves.toBe(1);
      expect(asked(h).map((c: any[]) => c[0].id).sort()).toEqual(['b-grace', 'b-main']);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Closing buy list failed for branch b-main'));
      expect(h.telegram.dailyUsage.mock.calls.map((c: any[]) => c[1])).toEqual(['b-grace']);
    });

    it('without Procure wired in, the message still goes', async () => {
      const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], closingList: false });
      expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
      expect(asked(h)).toHaveLength(0);
    });
  });

  it('a closing time Clerque cannot read is skipped, and said once', async () => {
    const h = build({ branches: [{ ...MAIN, closesAt: '9pm' }] });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    await h.runAt('2026-09-16T23:00:02');
    await h.runAt('2026-09-16T23:05:00');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(h.reports.usageForWindow).not.toHaveBeenCalled();
  });

  it('without Telegram wired in, the bell still goes', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], telegram: false });
    expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
    expect(h.table).toHaveLength(3);
  });

  describe('the day closed by its last shift', () => {
    const stockOf = (branchId: string, tenantId = 't1'): Stock[] => [
      { tenantId, branchId, rawMaterialId: 'rm-milk', quantity: 4200 },
      { tenantId, branchId, rawMaterialId: 'rm-beans', quantity: 950 },
    ];
    const asked = (h: ReturnType<typeof build>) => h.closingList.sendAtClosingIfNothingSent.mock.calls;

    it('the last shift closed in the evening closes the day there and then: the save, the message and the buy list, once', async () => {
      const h = build({
        stock: stockOf('b-main'),
        recorded: [
          used('b-main', '2026-09-16T14:00:00', MILK()),
          // Written off while cleaning up after the last drawer closed: the next day's sheet starts at the close.
          used('b-main', '2026-09-16T21:15:00', [usageRow('Oat Milk', 'ml', 1000, 0.2, { sold: 0, writtenOff: 1000 })]),
        ],
      });
      expect(await h.runAt('2026-09-16T20:35:00')).toBe(0);

      expect(await h.closeShiftAt('2026-09-16T20:40:00')).toBe('CLOSED');
      expect(h.balances.map((r) => [r.day, r.rawMaterialId, r.endingQty, r.takenAt])).toEqual([
        ['2026-09-16', 'rm-milk', 4200, manila('2026-09-16T20:40:00')],
        ['2026-09-16', 'rm-beans', 950, manila('2026-09-16T20:40:00')],
      ]);
      // The message ends at the saved balance, exactly where the next day's sheet begins.
      expect(h.reports.usageForWindow).toHaveBeenCalledTimes(1);
      expect(h.reports.usageForWindow).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-15T20:40:00'), manila('2026-09-16T20:40:00'));
      expect(h.table.map((n) => n.userId).sort()).toEqual(['mgr-all', 'mgr-main', 'owner']);
      expect(h.table[0].link).toBe(usageReportLink('b-main', '2026-09-16'));
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
      expect(h.lastSentNames()).toEqual(['Fresh Milk', 'Espresso Beans']);
      // The buy list is asked for at the close, for the same day, the close being the closing.
      expect(asked(h)).toEqual([[
        expect.objectContaining({ id: 'b-main', tenantId: 't1', name: 'Main' }),
        { day: '2026-09-16', from: manila('2026-09-15T20:40:00'), to: manila('2026-09-16T20:40:00'), closedAt: manila('2026-09-16T20:40:00') },
        manila('2026-09-16T20:40:00'),
      ]]);

      // The job's fallback at 23:00 finds the day closed: no second save and no second message.
      h.stock[0].quantity = 100;
      expect(await h.runAt('2026-09-16T23:00:02')).toBe(0);
      expect(await h.runAt('2026-09-16T23:05:00', h.make())).toBe(0);
      expect(h.balances).toHaveLength(2);
      expect(h.balances[0].endingQty).toBe(4200);
      expect(h.table).toHaveLength(3);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
      // Procure is asked again for the same day, and its own guard answers that the list already went out.
      expect(asked(h).map((c: any[]) => c[1].day)).toEqual(['2026-09-16', '2026-09-16', '2026-09-16']);

      // The next day's message starts at the close, so the write-off after it is on that one.
      expect(await h.runAt('2026-09-17T23:00:02')).toBe(1);
      expect(h.reports.usageForWindow).toHaveBeenLastCalledWith('t1', 'b-main', '2026-09-17', manila('2026-09-16T20:40:00'), manila('2026-09-17T23:00:02'));
      expect(h.lastSentNames()).toEqual(['Oat Milk']);
    });

    it('a 14:00 handover closes nothing: the morning cashier closing before the afternoon one opens', async () => {
      const h = build({ branches: [MAIN, NAGA], stock: [...stockOf('b-main'), ...stockOf('b-naga')], recorded: [used('b-main', '2026-09-16T11:00:00', MILK())] });
      expect(await h.closeShiftAt('2026-09-16T14:00:00', MAIN)).toBe('NOT_END_OF_DAY');
      // Earlier than 2 hours before a 21:00 closing is still a handover.
      expect(await h.closeShiftAt('2026-09-16T18:59:00', MAIN)).toBe('NOT_END_OF_DAY');
      // With no closing time, only a close from 17:00 to 04:00 ends the day.
      expect(await h.closeShiftAt('2026-09-16T14:00:00', NAGA)).toBe('NOT_END_OF_DAY');
      expect(h.balances).toHaveLength(0);
      expect(h.table).toHaveLength(0);
      expect(h.reports.usageForWindow).not.toHaveBeenCalled();
      expect(asked(h)).toHaveLength(0);

      // The afternoon cashier's close at 21:10 is the end of the day.
      expect(await h.closeShiftAt('2026-09-16T21:10:00', MAIN)).toBe('CLOSED');
      expect(h.balances.map((r) => [r.branchId, r.day])).toEqual([['b-main', '2026-09-16'], ['b-main', '2026-09-16']]);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
      expect(asked(h)).toHaveLength(1);
    });

    it('a second shift closed later the same night does not save or send the day twice', async () => {
      const h = build({ stock: stockOf('b-main'), recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
      expect(await h.closeShiftAt('2026-09-16T20:40:00')).toBe('CLOSED');
      // A shift opened again after the close, sold, and was closed at 21:50.
      h.stock[0].quantity = 3000;
      expect(await h.closeShiftAt('2026-09-16T21:50:00')).toBe('CLOSED');
      expect(h.balances.map((r) => [r.day, r.endingQty, r.takenAt])).toEqual([
        ['2026-09-16', 4200, manila('2026-09-16T20:40:00')],
        ['2026-09-16', 950, manila('2026-09-16T20:40:00')],
      ]);
      expect(h.table).toHaveLength(3);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
      // Already sent: the cheap look stops the second close before the day is read again.
      expect(h.reports.usageForWindow).toHaveBeenCalledTimes(1);
      // The list is asked for the same day again; Procure's own guard answers that it already went out.
      expect(asked(h).map((c: any[]) => c[1].day)).toEqual(['2026-09-16', '2026-09-16']);
    });

    it('two last shifts closing at once (two servers) still save and send the day once', async () => {
      const h = build({ stock: stockOf('b-main'), recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
      const [a, b] = await Promise.all([h.closeShiftAt('2026-09-16T21:05:00'), h.closeShiftAt('2026-09-16T21:05:00', MAIN, h.make())]);
      expect([a, b]).toEqual(['CLOSED', 'CLOSED']);
      expect(h.balances).toHaveLength(2);
      expect(h.table).toHaveLength(3);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    });

    it('a close after midnight ends the evening before; with no closing time it saves but sends nothing, like the job', async () => {
      const h = build({ branches: [LATE, NAGA], stock: [...stockOf('b-late'), ...stockOf('b-naga')], recorded: [used('b-late', '2026-09-16T23:30:00', MILK())] });
      // A 01:00 closing, its last shift closed at 00:30 on the 17th.
      expect(await h.closeShiftAt('2026-09-17T00:30:00', LATE)).toBe('CLOSED');
      expect([...new Set(h.balances.filter((r) => r.branchId === 'b-late').map((r) => r.day))]).toEqual(['2026-09-16']);
      expect(h.table[0].link).toBe(usageReportLink('b-late', '2026-09-16'));
      expect(asked(h).map((c: any[]) => [c[0].id, c[1].day])).toEqual([['b-late', '2026-09-16']]);

      // No closing time: a close at 00:45 is still the 16th's night.
      expect(await h.closeShiftAt('2026-09-17T00:45:00', NAGA)).toBe('CLOSED');
      expect(h.balances.filter((r) => r.branchId === 'b-naga').map((r) => [r.day, r.takenAt])).toEqual([
        ['2026-09-16', manila('2026-09-17T00:45:00')], ['2026-09-16', manila('2026-09-17T00:45:00')],
      ]);
      expect(h.telegram.dailyUsage.mock.calls.map((c: any[]) => c[1])).toEqual(['b-late']);
      expect(asked(h).map((c: any[]) => c[0].id)).toEqual(['b-late']);

      // The job's fallbacks (03:00 for the late bar, 03:30 with no closing time) find both days closed.
      await h.runAt('2026-09-17T03:00:00');
      await h.runAt('2026-09-17T03:30:00');
      expect(h.balances).toHaveLength(4);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    });

    it('a demo shop\'s day is saved at the close but nobody is sent anything; an inactive branch, a suspended shop or another shop\'s branch is left alone', async () => {
      const h = build({
        branches: [DEMO, SHUT, SUSP],
        stock: [...stockOf('b-demo', 'tDemo'), ...stockOf('b-shut'), ...stockOf('b-susp', 'tSusp')],
        recorded: [used('b-demo', '2026-09-16T14:00:00', MILK())],
      });
      expect(await h.closeShiftAt('2026-09-16T21:00:00', DEMO)).toBe('CLOSED');
      expect(await h.closeShiftAt('2026-09-16T21:00:00', SHUT)).toBe('SKIPPED');
      expect(await h.closeShiftAt('2026-09-16T21:00:00', SUSP)).toBe('SKIPPED');
      expect(await h.scheduler.closeDayAtLastShift('t1', 'b-demo', manila('2026-09-16T21:00:00'))).toBe('SKIPPED');
      expect([...new Set(h.balances.map((r) => r.branchId))]).toEqual(['b-demo']);
      expect(h.table).toHaveLength(0);
      expect(h.telegram.dailyUsage).not.toHaveBeenCalled();
      expect(asked(h)).toHaveLength(0);
    });

    it('never throws: a branch it cannot read is skipped, and a failed save still sends the message and the list', async () => {
      const h = build({ stock: stockOf('b-main'), recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

      h.prisma.branch.findFirst.mockRejectedValueOnce(new Error('database down'));
      await expect(h.closeShiftAt('2026-09-16T21:10:00')).resolves.toBe('SKIPPED');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not read branch b-main'));

      // The save's transaction fails; the message's claim does not.
      h.prisma.$transaction.mockImplementationOnce(async () => { throw new Error('lock timeout'); });
      await expect(h.closeShiftAt('2026-09-16T21:15:00')).resolves.toBe('CLOSED');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Saving the closing stock failed for branch b-main'));
      expect(h.balances).toHaveLength(0);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
      expect(asked(h)).toHaveLength(1);

      // The job's fallback saves the day it missed, and sends nothing more.
      await h.runAt('2026-09-16T23:00:02');
      expect(h.balances.map((r) => [r.day, r.takenAt])).toEqual([
        ['2026-09-16', manila('2026-09-16T23:00:02')], ['2026-09-16', manila('2026-09-16T23:00:02')],
      ]);
      expect(h.telegram.dailyUsage).toHaveBeenCalledTimes(1);
    });

    it('a message that fails at the close still asks for the list, and the job sends the message at the fallback', async () => {
      const h = build({ stock: stockOf('b-main'), recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
      const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      h.reports.usageForWindow.mockRejectedValueOnce(new Error('database hiccup'));
      await expect(h.closeShiftAt('2026-09-16T21:10:00')).resolves.toBe('CLOSED');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('End-of-day usage failed for branch b-main'));
      expect(h.table).toHaveLength(0);
      expect(asked(h)).toHaveLength(1);

      expect(await h.runAt('2026-09-16T23:00:02')).toBe(1);
      // Still ending at the close's saved balance, not at the fallback moment.
      expect(h.reports.usageForWindow).toHaveBeenLastCalledWith('t1', 'b-main', '2026-09-16', manila('2026-09-15T23:00:00'), manila('2026-09-16T21:10:00'));
    });

    it('without Procure or Telegram wired in, the day still closes', async () => {
      const h = build({ stock: stockOf('b-main'), recorded: [used('b-main', '2026-09-16T14:00:00', MILK())], closingList: false, telegram: false });
      await expect(h.closeShiftAt('2026-09-16T21:10:00')).resolves.toBe('CLOSED');
      expect(h.balances).toHaveLength(2);
      expect(h.table).toHaveLength(3);
      expect(asked(h)).toHaveLength(0);
    });
  });

  describe('lastShiftCloseDue -- when closing the last shift is the end of the day', () => {
    it('with a closing time: from 2 hours before it, until the job\'s catch-up after the fallback is over', () => {
      expect(lastShiftCloseDue('21:00', manila('2026-09-16T14:00:00'))).toBeNull();
      expect(lastShiftCloseDue('21:00', manila('2026-09-16T18:59:59'))).toBeNull();
      expect(lastShiftCloseDue('21:00', manila('2026-09-16T19:00:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-15T19:00:00'), to: manila('2026-09-16T19:00:00'),
      });
      expect(lastShiftCloseDue('21:00', manila('2026-09-16T23:30:00'))?.day).toBe('2026-09-16');
      // After midnight it is still the 16th's night, until the catch-up after 23:00 ends at 02:00.
      expect(lastShiftCloseDue('21:00', manila('2026-09-17T00:30:00'))?.day).toBe('2026-09-16');
      expect(lastShiftCloseDue('21:00', manila('2026-09-17T02:00:00'))?.day).toBe('2026-09-16');
      expect(lastShiftCloseDue('21:00', manila('2026-09-17T02:00:01'))).toBeNull();
    });

    it('a closing after midnight: the evening before, from 2 hours ahead of the closing', () => {
      expect(lastShiftCloseDue('01:00', manila('2026-09-16T22:59:00'))).toBeNull();
      expect(lastShiftCloseDue('01:00', manila('2026-09-16T23:00:00'))?.day).toBe('2026-09-16');
      expect(lastShiftCloseDue('01:00', manila('2026-09-17T00:30:00'))?.day).toBe('2026-09-16');
    });

    it('with no closing time, or one Clerque cannot read: from 17:00 until 04:00 Manila', () => {
      expect(lastShiftCloseDue(null, manila('2026-09-16T16:59:59'))).toBeNull();
      expect(lastShiftCloseDue(null, manila('2026-09-16T17:00:00'))?.day).toBe('2026-09-16');
      expect(lastShiftCloseDue(null, manila('2026-09-17T00:30:00'))?.day).toBe('2026-09-16');
      expect(lastShiftCloseDue(null, manila('2026-09-17T03:45:00'))?.day).toBe('2026-09-16');
      expect(lastShiftCloseDue(null, manila('2026-09-17T04:00:00'))).toBeNull();
      expect(lastShiftCloseDue('9pm', manila('2026-09-16T14:00:00'))).toBeNull();
      expect(lastShiftCloseDue('9pm', manila('2026-09-16T21:00:00'))?.day).toBe('2026-09-16');
      // 16:30 UTC is 00:30 in Manila, whatever the server clock says.
      expect(lastShiftCloseDue(null, new Date('2026-09-16T16:30:00Z'))?.day).toBe('2026-09-16');
    });

    it('names every close the same as the job\'s fallback for that night, so the two can never save two days', () => {
      const HOUR = 60 * 60 * 1000;
      for (const closesAt of ['21:00', '23:50', '01:00', '04:30', '12:30', null]) {
        const fallback = closingDueAt(closesAt, '2026-09-16');
        expect(saveDue(closesAt, fallback)?.day).toBe('2026-09-16');
        // The first moment a close can end the day, to the end of the job's catch-up.
        const first = closesAt ? fallback.getTime() - FALLBACK_AFTER_CLOSE_MS - 2 * HOUR : manila('2026-09-16T17:00:00').getTime();
        const last = closesAt ? fallback.getTime() + CATCH_UP_MS : manila('2026-09-17T03:59:00').getTime();
        for (let t = first; t <= last; t += HOUR / 4) {
          expect({ closesAt, at: new Date(t).toISOString(), day: lastShiftCloseDue(closesAt, new Date(t))?.day })
            .toEqual({ closesAt, at: new Date(t).toISOString(), day: '2026-09-16' });
        }
        expect(lastShiftCloseDue(closesAt, new Date(first - 1000))).toBeNull();
      }
    });
  });

  describe('reportDue -- which hours, which name, and when (no shift closed the day)', () => {
    it('is due two hours after closing, covering the 24 hours up to then', () => {
      expect(FALLBACK_AFTER_CLOSE_MS).toBe(2 * 60 * 60 * 1000);
      expect(reportDue('21:00', manila('2026-09-16T21:00:00'))).toBeNull();
      expect(reportDue('21:00', manila('2026-09-16T21:30:00'))).toBeNull();
      expect(reportDue('21:00', manila('2026-09-16T22:59:59'))).toBeNull();
      expect(reportDue('21:00', manila('2026-09-16T23:00:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-15T23:00:00'), to: manila('2026-09-16T23:00:00'),
      });
      // Read a few minutes late, the window still ends at the moment it was due.
      expect(reportDue('21:00', manila('2026-09-16T23:04:00'))?.to).toEqual(manila('2026-09-16T23:00:00'));
      expect(reportDue('12:30', manila('2026-09-16T14:35:00'))?.day).toBe('2026-09-16');
    });

    it('names the sheet for the day most of its hours fall in', () => {
      expect(reportDue('00:00', manila('2026-09-17T02:00:00'))?.day).toBe('2026-09-16');
      expect(reportDue('01:00', manila('2026-09-17T03:04:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-16T03:00:00'), to: manila('2026-09-17T03:00:00'),
      });
      expect(reportDue('03:59', manila('2026-09-17T05:59:00'))?.day).toBe('2026-09-16');
      // From 04:00 on too: the sheet at 06:00 on the 17th is the 16th's evening, not a day just begun.
      expect(reportDue('04:00', manila('2026-09-17T06:00:00'))?.day).toBe('2026-09-16');
      expect(reportDue('04:30', manila('2026-09-17T06:30:00'))).toEqual({
        day: '2026-09-16', from: manila('2026-09-16T06:30:00'), to: manila('2026-09-17T06:30:00'),
      });
      // A morning closing: 13 of the 24 hours (11:00 to 11:00) are the day before.
      expect(reportDue('09:00', manila('2026-09-16T11:00:00'))?.day).toBe('2026-09-15');
      // Across a month and a year end.
      expect(reportDue('02:00', manila('2026-10-01T04:00:00'))?.day).toBe('2026-09-30');
      expect(reportDue('02:00', manila('2027-01-01T04:05:00'))?.day).toBe('2026-12-31');
    });

    it('back to back: each sheet starts exactly where the one before ended, one day apart', () => {
      for (const closesAt of ['21:00', '12:30', '23:50', '00:00', '01:00', '04:30']) {
        const dueOn = (day: string) => new Date(manila(`${day}T${closesAt}:00`).getTime() + FALLBACK_AFTER_CLOSE_MS);
        const first = reportDue(closesAt, dueOn('2026-09-16'))!;
        const second = reportDue(closesAt, dueOn('2026-09-17'))!;
        expect({ closesAt, from: second.from }).toEqual({ closesAt, from: first.to });
        expect(first.to.getTime() - first.from.getTime()).toBe(DAY_MS);
        expect(new Date(`${second.day}T00:00:00Z`).getTime() - new Date(`${first.day}T00:00:00Z`).getTime()).toBe(DAY_MS);
      }
    });

    it('a missed sheet is still sent within the catch-up window after the fallback moment, and not after', () => {
      const fallback = manila('2026-09-16T23:00:00');
      expect(CATCH_UP_MS).toBe(3 * 60 * 60 * 1000);
      expect(reportDue('21:00', new Date(fallback.getTime() + CATCH_UP_MS))?.day).toBe('2026-09-16');
      expect(reportDue('21:00', new Date(fallback.getTime() + CATCH_UP_MS + 1))).toBeNull();
      // Just after midnight a 23:50 closing is not due yet -- not today's, not yesterday's.
      expect(reportDue('23:50', manila('2026-09-17T00:10:00'))).toBeNull();
      expect(reportDue('23:50', manila('2026-09-17T01:50:00'))?.to).toEqual(manila('2026-09-17T01:50:00'));
      expect(reportDue('23:50', manila('2026-09-17T01:50:00'))?.day).toBe('2026-09-16');
    });

    it('runs on Manila time whatever the server clock says', () => {
      // 15:00 UTC is 23:00 in Manila.
      expect(reportDue('21:00', new Date('2026-09-16T15:00:00Z'))?.day).toBe('2026-09-16');
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


  /*
    The Z-Read is the day's sealed sales total, the daily record a BIR CAS is
    expected to keep. Closing the last shift writes it, but only when that
    close counts as the end of the day -- so a cafe that shut two hours early,
    or one that never filled in a closing time, wrote none, and no screen posts
    /reports/z-read. The fallback clock writes it too, so whichever end of the
    day comes first, the day has its record.
  */
  describe("the day's Z-Read", () => {
    it('writes it at the fallback moment, for the same day the sheet is named', async () => {
      const h = build({ branches: [MAIN] });
      await h.runAt('2026-09-16T22:55:00');
      expect(h.zReads.generateZRead).not.toHaveBeenCalled();

      await h.runAt('2026-09-16T23:00:02');
      expect(h.zReads.generateZRead).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16');
    });

    it('writes one for a branch with no closing time, which no shift close outside the evening ever writes', async () => {
      const h = build({ branches: [NAGA] });
      // Shut at half four: too early to be the end of the day, so the close writes nothing.
      expect(await h.closeShiftAt('2026-09-16T16:30:00', NAGA)).toBe('NOT_END_OF_DAY');
      expect(h.zReads.generateZRead).not.toHaveBeenCalled();

      await h.runAt('2026-09-17T03:30:02');
      expect(h.zReads.generateZRead).toHaveBeenCalledWith('t1', 'b-naga', '2026-09-16');
    });

    it('writes one for a shop that shut two hours before its closing time', async () => {
      const h = build({ branches: [MAIN] });
      expect(await h.closeShiftAt('2026-09-16T17:30:00', MAIN)).toBe('NOT_END_OF_DAY');
      await h.runAt('2026-09-16T23:00:02');
      expect(h.zReads.generateZRead).toHaveBeenCalledWith('t1', 'b-main', '2026-09-16');
    });

    it('writes it once, however many runs fall in the catch-up window', async () => {
      const h = build({ branches: [MAIN] });
      await h.runAt('2026-09-16T23:00:02');
      await h.runAt('2026-09-16T23:05:02');
      await h.runAt('2026-09-17T01:30:00');
      expect(h.zReads.generateZRead).toHaveBeenCalledTimes(1);
      expect(h.zReadRows).toHaveLength(1);
    });

    it('leaves the one the last shift close wrote alone', async () => {
      const h = build({ branches: [MAIN], zReads: [{ tenantId: 't1', branchId: 'b-main', day: '2026-09-16' }] });
      await h.runAt('2026-09-16T23:00:02');
      expect(h.zReads.generateZRead).not.toHaveBeenCalled();
      expect(h.zReadRows).toHaveLength(1);
    });

    it('a Z-Read that cannot be built costs no branch its closing stock', async () => {
      const h = build({
        branches: [MAIN, NAGA], zReadFails: true,
        stock: [{ tenantId: 't1', branchId: 'b-main', rawMaterialId: 'rm-milk', quantity: 4200 }],
      });
      await expect(h.runAt('2026-09-16T23:00:02')).resolves.toBeGreaterThanOrEqual(0);
      expect(h.zReads.generateZRead).toHaveBeenCalledTimes(1);
      expect(h.balances.map((b) => b.branchId)).toEqual(['b-main']);
    });
  });

  it('a day already sent under the old /pos link is not sent again after the link moved to Procure', async () => {
    const h = build({ recorded: [used('b-main', '2026-09-16T14:00:00', MILK())] });
    // What the bell looked like before this change shipped.
    h.table.push({
      id: 'old', tenantId: 't1', userId: 'owner', readAt: null, createdAt: manila('2026-09-16T23:00:01'),
      link: '/pos/inventory/reports?from=2026-09-16&to=2026-09-16&branchId=b-main',
    });
    expect(await h.runAt('2026-09-16T23:05:00')).toBe(0);
    expect(h.table).toHaveLength(1);
    expect(h.telegram.dailyUsage).not.toHaveBeenCalled();
  });

  it('the report link carries the day and the branch', () => {
    expect(usageReportLink('b-main', '2026-09-16')).toBe('/procure/stock/reports?from=2026-09-16&to=2026-09-16&branchId=b-main');
  });
});
