import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { StationContext } from '../kds/station-access';
import { stationItems } from '../ingredient-reports/station-items';
import { heldUsage } from '../orders/held-usage';
import { StationCountService } from './station-count.service';
import { StationCountController } from './station-count.controller';
import { doneEntries, readLineTags, recountIds, recountedIds, readWeekly } from './weekly-count';

// Which items are on which station has its own spec; here only that the count asks it and obeys.
jest.mock('../ingredient-reports/station-items', () => ({
  ...jest.requireActual('../ingredient-reports/station-items'),
  stationItems: jest.fn(),
}));
// What waiting tickets hold has its own spec; here only that the snapshot takes it off.
jest.mock('../orders/held-usage', () => ({
  ...jest.requireActual('../orders/held-usage'),
  heldUsage: jest.fn(),
}));

/**
 * The weekly count on a kitchen or bar screen, against a small in-memory shop:
 * one count per station, a fresh snapshot on every save, Send freezing it as a
 * record that moves nothing, recounts that never delete a line, and the
 * owner's reconciliation that leaves out what was counted again later.
 */
describe('StationCountService', () => {
  const T = 't1';
  const B = 'b1';
  const NOW = new Date('2026-09-21T21:05:00+08:00');
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;

  const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
  const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
  const MATERIALS: Record<string, { name: string; unit: string; category: string; on: string[] }> = {
    milk:    { name: 'Fresh Milk',    unit: 'ml', category: 'INGREDIENT',     on: ['s-kitchen', 's-bar'] },
    eggs:    { name: 'Eggs',          unit: 'pc', category: 'INGREDIENT',     on: ['s-kitchen'] },
    sugar:   { name: 'White Sugar',   unit: 'g',  category: 'INGREDIENT',     on: ['s-kitchen'] },
    syrup:   { name: 'Vanilla Syrup', unit: 'ml', category: 'INGREDIENT',     on: ['s-bar'] },
    // Used only by a product routed nowhere: on every station's sheet.
    napkins: { name: 'Napkins',       unit: 'pc', category: 'KITCHEN_SUPPLY', on: ['UNROUTED'] },
    // On no sheet at all.
    bleach:  { name: 'Bleach',        unit: 'ml', category: 'OFFICE_SUPPLY',  on: [] },
  };

  const ctxOf = (station: typeof KITCHEN, over: Partial<StationContext> = {}): StationContext => ({
    tenantId: T, station, branch: { id: B, name: 'Main' }, actorId: 'pairer', actorLabel: `${station.name} screen`, isDevice: true, ...over,
  });
  const KITCHEN_CTX = ctxOf(KITCHEN);
  const BAR_CTX = ctxOf(BAR);

  type Count = {
    id: string; tenantId: string; branchId: string; countNumber: string; status: string; notes: string | null; startedById: string;
    postedAt: Date | null; postedById: string | null; createdAt: Date; updatedAt: Date;
  };
  type Line = { id: string; countId: string; rawMaterialId: string; expectedQty: number; countedQty: number; varianceQty: number; notes: string | null };

  const PEOPLE = [
    { id: 'owner', tenantId: T, name: 'Anne', role: 'BUSINESS_OWNER', branchId: null, isActive: true },
    { id: 'mgr', tenantId: T, name: 'Mia', role: 'BRANCH_MANAGER', branchId: B, isActive: true },
    { id: 'mgr-other', tenantId: T, name: 'Olga', role: 'BRANCH_MANAGER', branchId: 'b2', isActive: true },
    { id: 'cashier', tenantId: T, name: 'Carl', role: 'CASHIER', branchId: B, isActive: true },
    { id: 'gone', tenantId: T, name: 'Gina', role: 'BUSINESS_OWNER', branchId: null, isActive: false },
    { id: 'pairer', tenantId: T, name: 'Paolo', role: 'BRANCH_MANAGER', branchId: B, isActive: true },
  ];

  function build(opts: { stock?: Record<string, number>; held?: Record<string, number>; clashes?: number; counts?: Count[]; lines?: Line[] } = {}) {
    const stock: Record<string, number> = { milk: 3137, eggs: 30, sugar: 5000, syrup: 700, napkins: 200, ...opts.stock };
    const held: Record<string, number> = { ...opts.held };
    const counts: Count[] = [...(opts.counts ?? [])];
    const lines: Line[] = [...(opts.lines ?? [])];
    const locks: string[] = [];
    let clashes = opts.clashes ?? 0;
    let seq = 100;
    let lineSeq = 0;
    let clock = NOW;

    const text = (v: string | null, f: any): boolean => {
      if (f == null) return true;
      if (typeof f === 'string') return v === f;
      const s = v ?? '';
      if (f.startsWith != null && !s.startsWith(f.startsWith)) return false;
      if (f.contains != null && !s.includes(f.contains)) return false;
      return true;
    };
    const matches = (c: Count, where: any): boolean => {
      if (!where) return true;
      if (typeof where.id === 'string' && c.id !== where.id) return false;
      if (where.id?.not && c.id === where.id.not) return false;
      if (where.tenantId && c.tenantId !== where.tenantId) return false;
      if (where.branchId && c.branchId !== where.branchId) return false;
      if (typeof where.status === 'string' && c.status !== where.status) return false;
      if (where.status?.not && c.status === where.status.not) return false;
      if (where.status?.in && !where.status.in.includes(c.status)) return false;
      if (where.notes && !text(c.notes, where.notes)) return false;
      if (where.createdAt?.lte && !(c.createdAt <= where.createdAt.lte)) return false;
      if (where.createdAt?.gte && !(c.createdAt >= where.createdAt.gte)) return false;
      if (where.updatedAt?.gte && !(c.updatedAt >= where.updatedAt.gte)) return false;
      if (where.AND && !where.AND.every((w: any) => matches(c, w))) return false;
      if (where.OR && !where.OR.some((w: any) => matches(c, w))) return false;
      if (where.NOT && matches(c, where.NOT)) return false;
      return true;
    };
    const linesOf = (c: Count) => lines.filter((l) => l.countId === c.id)
      .map((l) => ({ ...l, rawMaterial: { name: MATERIALS[l.rawMaterialId].name, unit: MATERIALS[l.rawMaterialId].unit } }));
    const shape = (c: Count) => ({ ...c, lines: linesOf(c), _count: { lines: linesOf(c).length }, branch: { id: c.branchId, name: 'Main' } });
    const newest = (rows: Count[]) => [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const num = (data: any) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Prisma.Decimal ? Number(v) : v]));

    const prisma: any = {
      $executeRaw: jest.fn(async (_sql: TemplateStringsArray, key: string) => { locks.push(key); return 1; }),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      cycleCount: {
        findFirst: jest.fn(async ({ where }: any) => {
          const c = newest(counts.filter((x) => matches(x, where)))[0];
          return c ? shape(c) : null;
        }),
        findMany: jest.fn(async ({ where, take }: any) => newest(counts.filter((x) => matches(x, where))).slice(0, take ?? 1000).map(shape)),
        create: jest.fn(async ({ data }: any) => {
          if (clashes > 0) {
            clashes--;
            throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
          }
          const c: Count = { id: `cc${counts.length + 1}`, postedAt: null, postedById: null, createdAt: clock, updatedAt: clock, ...data };
          counts.push(c);
          return shape(c);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const c = counts.find((x) => x.id === where.id)!;
          Object.assign(c, data, { updatedAt: clock });
          return shape(c);
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const hit = counts.filter((c) => matches(c, where));
          for (const c of hit) Object.assign(c, data, { updatedAt: clock });
          return { count: hit.length };
        }),
      },
      cycleCountLine: {
        findFirst: jest.fn(async ({ where }: any) => lines.find((l) => l.countId === where.countId && l.rawMaterialId === where.rawMaterialId) ?? null),
        findMany: jest.fn(async ({ where }: any) => lines
          .filter((l) => !where.rawMaterialId?.in || where.rawMaterialId.in.includes(l.rawMaterialId))
          .map((l) => ({ l, c: counts.find((c) => c.id === l.countId)! }))
          .filter(({ c }) => matches(c, where.count))
          .map(({ l, c }) => ({ ...l, count: { ...c } }))),
        create: jest.fn(async ({ data }: any) => { lines.push({ id: `l${++lineSeq}`, notes: null, ...num(data) } as Line); return {}; }),
        update: jest.fn(async ({ where, data }: any) => { Object.assign(lines.find((l) => l.id === where.id)!, num(data)); return {}; }),
      },
      rawMaterialInventory: {
        findUnique: jest.fn(async ({ where }: any) => {
          const id = where.branchId_rawMaterialId.rawMaterialId;
          return id in stock ? { quantity: new Prisma.Decimal(stock[id]) } : null;
        }),
      },
      orderItem: { count: jest.fn(async () => 2) },
      purchaseRequestLine: {
        findMany: jest.fn(async ({ where }: any) => [{ rawMaterialId: 'milk', packSize: 1000 }].filter((p) => where.rawMaterialId.in.includes(p.rawMaterialId))),
      },
      station: {
        findFirst: jest.fn(async ({ where }: any) => {
          const s = [KITCHEN, BAR].find((x) => x.id === where.id && where.tenantId === T);
          return s ? { ...s, branchId: B } : null;
        }),
        findMany: jest.fn(async ({ where }: any) => [KITCHEN, BAR].filter((s) => where.id.in.includes(s.id)).map(({ id, name }) => ({ id, name }))),
      },
      user: {
        findFirst: jest.fn(async ({ where }: any) => {
          const p = PEOPLE.find((x) => x.id === where.id && x.tenantId === where.tenantId);
          return p ? { id: p.id, name: p.name, branchId: p.branchId, isActive: p.isActive } : null;
        }),
        findMany: jest.fn(async ({ where }: any) => PEOPLE
          .filter((p) => p.tenantId === where.tenantId && p.isActive === where.isActive)
          .filter((p) => where.OR.some((w: any) => p.role === w.role && (!w.OR || w.OR.some((o: any) => p.branchId === o.branchId))))
          .map((p) => ({ id: p.id, name: p.name }))),
      },
      branch: { findFirst: jest.fn(async () => ({ id: B, name: 'Main' })) },
    };

    (stationItems as jest.Mock).mockResolvedValue({
      stations: [KITCHEN, BAR],
      items: new Map(Object.entries(MATERIALS).map(([id, m]) => [id, { name: m.name, unit: m.unit, category: m.category, isPrep: false, on: new Set(m.on) }])),
    });
    (heldUsage as jest.Mock).mockImplementation(async () => new Map([[B, new Map(Object.entries(held))]]));

    const warehouse: any = {
      nextCountNumber: jest.fn(async () => `CC-2026-${String(++seq).padStart(6, '0')}`),
      postCycleCount: jest.fn(async (_t: string, id: string, userId: string, _opening: boolean, skip: string[] = []) => {
        const c = counts.find((x) => x.id === id)!;
        Object.assign(c, { status: 'POSTED', postedAt: clock, postedById: userId, updatedAt: clock });
        return { ...shape(c), warnings: [], leftAlone: skip.map((id) => ({ rawMaterialId: id, name: MATERIALS[id].name, message: '' })), message: null };
      }),
    };
    const notifications: any = { create: jest.fn(async () => ({ id: 'n1' })) };
    const telegram: any = { weeklyCountSent: jest.fn(async () => undefined) };
    const svc = new StationCountService(prisma, warehouse, notifications, telegram);
    const at = (d: Date) => { clock = d; };
    return { svc, prisma, warehouse, notifications, telegram, counts, lines, locks, stock, held, at };
  }

  const save = (h: ReturnType<typeof build>, ctx: StationContext, rawMaterialId: string, qty: unknown, now = NOW, by: unknown = 'Joy') => {
    h.at(now);
    return h.svc.save(ctx, { rawMaterialId, qty, by }, now);
  };
  const send = (h: ReturnType<typeof build>, ctx: StationContext, now = NOW, by: unknown = 'Joy') => {
    h.at(now);
    return h.svc.send(ctx, { by }, now);
  };
  const lineFor = (h: ReturnType<typeof build>, countId: string, rawMaterialId: string) =>
    h.lines.find((l) => l.countId === countId && l.rawMaterialId === rawMaterialId)!;
  const OWNER = { tenantId: T, ownBranchId: null };

  /** Every key anywhere in a response, however deep. */
  const keysOf = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap(keysOf);
    if (v && typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keysOf(x)]);
    return [];
  };
  const FORBIDDEN = /expected|variance|book|cost|price|value/i;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => (Logger.prototype.warn as jest.Mock).mockRestore?.());

  // ── saving ────────────────────────────────────────────────────────────────

  describe('saving a line', () => {
    it('the first save creates exactly one count for the station; the next saves write into it', async () => {
      const h = build();
      const first = await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await save(h, KITCHEN_CTX, 'sugar', 4000);
      expect(h.counts).toHaveLength(1);
      expect(h.counts[0]).toMatchObject({ status: 'OPEN', branchId: B, startedById: 'pairer', countNumber: 'CC-2026-000101' });
      expect(readWeekly(h.counts[0].notes)).toEqual({ day: '2026-09-21', stationId: 's-kitchen' });
      expect(h.lines.map((l) => l.rawMaterialId)).toEqual(['milk', 'eggs', 'sugar']);
      expect(first).toEqual({
        rawMaterialId: 'milk', name: 'Fresh Milk', unit: 'ml', counted: 2800, countedWords: '2 pk + 800 ml', countedBy: 'Joy',
        countedAt: NOW.toISOString(), countNumber: 'CC-2026-000101', progress: { counted: 1, total: 4 },
        message: 'Saved: Fresh Milk 2 pk + 800 ml.',
      });
    });

    it('the kitchen and the bar counting at once write to two different counts, each under its own lock', async () => {
      const h = build();
      await Promise.all([save(h, KITCHEN_CTX, 'eggs', 24), save(h, BAR_CTX, 'syrup', 650)]);
      expect(h.counts).toHaveLength(2);
      expect(h.counts.map((c) => readWeekly(c.notes)?.stationId).sort()).toEqual(['s-bar', 's-kitchen']);
      expect(new Set(h.lines.map((l) => l.countId)).size).toBe(2);
      expect(h.locks.sort()).toEqual(['weekly-count:t1:b1:s-bar', 'weekly-count:t1:b1:s-kitchen']);
    });

    it('takes the book less what waiting tickets hold, never below zero, and writes who and when on the line', async () => {
      const h = build({ held: { milk: 137, eggs: 40 } });
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 0);
      expect(lineFor(h, 'cc1', 'milk')).toMatchObject({ expectedQty: 3000, countedQty: 2800, varianceQty: -200 });
      // 30 on the book, 40 held: floored at zero, not -10.
      expect(lineFor(h, 'cc1', 'eggs')).toMatchObject({ expectedQty: 0, countedQty: 0, varianceQty: 0 });
      expect(readLineTags(lineFor(h, 'cc1', 'milk').notes)).toEqual({ by: 'Joy', at: NOW, stationId: 's-kitchen' });
    });

    it('an overwrite takes a fresh snapshot: the sales in between are not booked as missing', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      h.stock.milk = 2637;   // 500 ml sold since
      await save(h, KITCHEN_CTX, 'milk', 2300, new Date(NOW.getTime() + HOUR));
      expect(h.lines).toHaveLength(1);
      expect(lineFor(h, 'cc1', 'milk')).toMatchObject({ expectedQty: 2637, countedQty: 2300, varianceQty: -337 });
      expect(readLineTags(lineFor(h, 'cc1', 'milk').notes).at).toEqual(new Date(NOW.getTime() + HOUR));
    });

    it('accepts zero, rounds to 3 places, and refuses a negative, NaN or a number past a million', async () => {
      const h = build();
      await expect(save(h, KITCHEN_CTX, 'sugar', 0)).resolves.toMatchObject({ counted: 0, message: 'Saved: White Sugar, none left.' });
      await save(h, KITCHEN_CTX, 'sugar', 1234.56789);
      expect(lineFor(h, 'cc1', 'sugar').countedQty).toBe(1234.568);
      for (const bad of [-1, Number.NaN, Infinity, 1_000_001, '5', null]) {
        await expect(save(h, KITCHEN_CTX, 'sugar', bad)).rejects.toThrow('Enter how much is there. Zero is fine when none is left.');
      }
      await expect(h.svc.save(KITCHEN_CTX, { qty: 1, by: 'Joy' })).rejects.toThrow('Pick the item you counted.');
    });

    it('refuses an item that is not on this station\'s sheet with 403', async () => {
      const h = build();
      await expect(save(h, KITCHEN_CTX, 'syrup', 1)).rejects.toThrow(new ForbiddenException('That item is not on the Kitchen sheet.'));
      await expect(save(h, KITCHEN_CTX, 'bleach', 1)).rejects.toThrow(ForbiddenException);
      // Used only by an unrouted product: on every sheet.
      await expect(save(h, KITCHEN_CTX, 'napkins', 150)).resolves.toBeDefined();
      expect(h.counts).toHaveLength(1);
    });

    it('a paired tablet has to say who is counting; a logged-in person is named from their account', async () => {
      const h = build();
      await expect(h.svc.save(KITCHEN_CTX, { rawMaterialId: 'eggs', qty: 24 }, NOW)).rejects.toThrow(new BadRequestException('Type your name so the owner knows who counted.'));
      await expect(save(h, KITCHEN_CTX, 'eggs', 24, NOW, ' [ ] ')).rejects.toThrow(BadRequestException);
      const typed = await save(h, KITCHEN_CTX, 'eggs', 24, NOW, '  [Joy]   the   cook, with a name far longer than forty characters  ');
      expect(typed.countedBy).toBe('Joy the cook, with a name far longer tha');
      const person = await save(h, ctxOf(KITCHEN, { isDevice: false, actorId: 'cook', actorLabel: 'Jo' }), 'sugar', 10, NOW, 'Someone else');
      expect(person.countedBy).toBe('Jo');
      expect(h.counts).toHaveLength(1);
    });

    it('a count-number clash is retried, and still makes one count', async () => {
      const h = build({ clashes: 1 });
      await save(h, KITCHEN_CTX, 'eggs', 24);
      expect(h.counts).toHaveLength(1);
      expect(h.warehouse.nextCountNumber).toHaveBeenCalledTimes(2);
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('a clash that keeps happening is given up after three retries', async () => {
      const h = build({ clashes: 10 });
      await expect(save(h, KITCHEN_CTX, 'eggs', 24)).rejects.toThrow('Unique constraint failed');
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(4);
    });

    it('an open count left for more than 3 days is kept as a record on the next save, which starts a new count', async () => {
      const h = build();
      const monday = new Date('2026-09-14T20:00:00+08:00');
      await save(h, KITCHEN_CTX, 'eggs', 24, monday);
      // Three days on, still the same count.
      await save(h, KITCHEN_CTX, 'sugar', 4000, new Date('2026-09-17T20:00:00+08:00'));
      expect(h.counts).toHaveLength(1);
      await save(h, KITCHEN_CTX, 'milk', 2800);
      expect(h.counts).toHaveLength(2);
      expect(h.counts[0].status).toBe('RECORDED');
      expect(h.counts[0].notes).toContain('Never sent; kept as a record.');
      // The record keeps its lines; the new count has only the new one.
      expect(h.lines.filter((l) => l.countId === 'cc1').map((l) => l.rawMaterialId)).toEqual(['eggs', 'sugar']);
      expect(h.lines.filter((l) => l.countId === 'cc2').map((l) => l.rawMaterialId)).toEqual(['milk']);
      expect(h.counts[1].status).toBe('OPEN');
    });
  });

  // ── sending ───────────────────────────────────────────────────────────────

  describe('sending', () => {
    it('freezes the count as RECORDED with who and when, and moves nothing', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      const res = await send(h, KITCHEN_CTX);
      expect(res).toMatchObject({ outcome: 'SENT', countNumber: 'CC-2026-000101', sentTo: ['Anne', 'Mia', 'Paolo'], progress: { counted: 2, total: 4 } });
      expect(res.notCounted).toEqual(['Napkins', 'White Sugar']);
      expect(res.message).toBe('Sent to Anne, Mia and Paolo. Stock does not change until the owner adjusts it.');
      expect(h.counts[0].status).toBe('RECORDED');
      expect(doneEntries(h.counts[0].notes)).toEqual([{ stationId: 's-kitchen', at: NOW, by: 'Joy' }]);
      expect(h.counts[0].notes).toContain('Kitchen sent by Joy, Sep 21 9:05 PM');
      // Nothing posted: the warehouse was never asked, and no stock row was written.
      expect(h.warehouse.postCycleCount).not.toHaveBeenCalled();
      expect(h.prisma.rawMaterialInventory.upsert).toBeUndefined();
    });

    it('reaches the owner and this branch\'s managers only: a bell each, and Telegram in the same words', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      const where = h.prisma.user.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ role: 'BUSINESS_OWNER' }, { role: 'BRANCH_MANAGER', OR: [{ branchId: B }, { branchId: null }] }]);
      expect(h.notifications.create.mock.calls.map((c: any[]) => c[0].userId)).toEqual(['owner', 'mgr', 'pairer']);
      expect(h.notifications.create.mock.calls[0][0]).toEqual({
        tenantId: T, userId: 'owner', kind: 'INFO',
        title: 'Weekly count sent — Kitchen (Main)',
        body: 'Recorded. Nothing has moved. 2 of 4 counted, 2 differ. Eggs short 6 pc · Fresh Milk short 337 ml. Not counted: Napkins, White Sugar.',
        link: '/procure/cycle-counts?review=cc1',
        dedupeKey: 'weekly-count-CC-2026-000101-owner',
      });
      expect(h.telegram.weeklyCountSent).toHaveBeenCalledWith(T, B, expect.objectContaining({
        stationName: 'Kitchen', countNumber: 'CC-2026-000101', countedBy: 'Joy', recount: false, counted: 2, total: 4,
        notCounted: ['Napkins', 'White Sugar'],
      }));
    });

    it('a second Send finds nothing new: ALREADY_SENT, and nobody is told again', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      h.notifications.create.mockClear();
      h.telegram.weeklyCountSent.mockClear();
      const again = await send(h, KITCHEN_CTX, new Date(NOW.getTime() + 60_000));
      expect(again).toMatchObject({ outcome: 'ALREADY_SENT', sentTo: [], message: 'Already sent today. Counting again starts a new count.' });
      expect(h.notifications.create).not.toHaveBeenCalled();
      expect(h.telegram.weeklyCountSent).not.toHaveBeenCalled();
    });

    it('refuses to send before anything is counted', async () => {
      const h = build();
      await expect(send(h, KITCHEN_CTX)).rejects.toThrow(new BadRequestException('Count at least one item first.'));
      expect(h.notifications.create).not.toHaveBeenCalled();
    });

    it('a save after Send opens a new count, and the record\'s lines are never written again', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      const recorded = { ...lineFor(h, 'cc1', 'eggs') };
      await save(h, KITCHEN_CTX, 'eggs', 20, new Date(NOW.getTime() + HOUR));
      expect(h.counts.map((c) => c.status)).toEqual(['RECORDED', 'OPEN']);
      expect(lineFor(h, 'cc1', 'eggs')).toEqual(recorded);
      expect(lineFor(h, 'cc2', 'eggs').countedQty).toBe(20);
      // Every line write went to an OPEN count.
      for (const call of h.prisma.cycleCountLine.update.mock.calls) {
        const line = h.lines.find((l) => l.id === call[0].where.id)!;
        expect(line.countId).toBe('cc2');
      }
    });

    it('Send takes the station\'s lock too', async () => {
      const h = build();
      await save(h, BAR_CTX, 'syrup', 650);
      h.locks.length = 0;
      await send(h, BAR_CTX);
      expect(h.locks).toEqual(['weekly-count:t1:b1:s-bar']);
    });
  });

  // ── the panel ─────────────────────────────────────────────────────────────

  describe('the panel', () => {
    it('lists the station\'s items by section with what is counted, and says a count is due when none was ever sent', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      const view = await h.svc.view(KITCHEN_CTX, NOW);
      expect(view).toMatchObject({
        station: { id: 's-kitchen', name: 'Kitchen' }, branch: { id: B, name: 'Main' }, state: 'COUNTING',
        count: { countNumber: 'CC-2026-000101', startedOn: '2026-09-21' },
        due: { isDue: true, lastSentOn: null, daysSince: null, message: 'Weekly count is due. Nothing has been sent yet.' },
        sentAt: null, changedSinceSent: false, message: null, stillWaiting: 2, recount: null, progress: { counted: 1, total: 4 },
      });
      expect(view.sections.map((s) => [s.key, s.rows.map((r) => r.name)])).toEqual([
        ['INGREDIENTS', ['Eggs', 'Fresh Milk', 'White Sugar']],
        ['UNROUTED', ['Napkins']],
      ]);
      const milk = view.sections[0].rows[1];
      expect(milk).toEqual({
        rawMaterialId: 'milk', name: 'Fresh Milk', unit: 'ml', packSize: 1000, alsoOn: ['Bar'], counted: 2800, countedWords: '2 pk + 800 ml',
        countedBy: 'Joy', countedAt: NOW.toISOString(), recount: false, countedElsewhere: null, done: true,
      });
    });

    it('after Send it shows what was sent, read-only, and is not due for 7 days', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      const view = await h.svc.view(KITCHEN_CTX, new Date(NOW.getTime() + HOUR));
      expect(view).toMatchObject({
        state: 'SENT', message: 'Sent. Counting again starts a new count.', sentAt: NOW.toISOString(), sentBy: 'Joy',
        due: { isDue: false, lastSentOn: '2026-09-21', daysSince: 0, message: null }, progress: { counted: 1, total: 4 },
      });
      // The next day the panel starts fresh; a week on, it is due again.
      expect((await h.svc.view(KITCHEN_CTX, new Date(NOW.getTime() + DAY))).state).toBe('NEW');
      expect((await h.svc.view(KITCHEN_CTX, new Date('2026-09-28T08:00:00+08:00'))).due)
        .toEqual({ isDue: true, lastSentOn: '2026-09-21', daysSince: 7, message: 'Weekly count is due. Last sent Mon, Sep 21.' });
    });

    it('a shared item another station counted shows as done, with who counted it', async () => {
      const h = build();
      await save(h, BAR_CTX, 'milk', 2800, new Date(NOW.getTime() - HOUR), 'Ben');
      const view = await h.svc.view(KITCHEN_CTX, NOW);
      const milk = view.sections.flatMap((s) => s.rows).find((r) => r.rawMaterialId === 'milk')!;
      expect(milk).toMatchObject({
        counted: null, done: true,
        countedElsewhere: { station: 'Bar', words: '2 pk + 800 ml', on: 'Sep 21', label: 'Bar counted: 2 pk + 800 ml (Sep 21)' },
      });
      expect(view.progress).toEqual({ counted: 1, total: 4 });
      // Four days later it no longer stands for this station.
      const later = await h.svc.view(KITCHEN_CTX, new Date(NOW.getTime() + 4 * DAY));
      expect(later.progress.counted).toBe(0);
    });

    it('never carries an expected figure, a difference, the book, a cost or a price -- through the controller too', async () => {
      const h = build({ stock: { milk: 3137 } });
      const ctl = new StationCountController(h.prisma, h.svc);
      const device = { sub: 'pairer', tenantId: T, branchId: null, isDevice: true, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen', role: 'KIOSK_DISPLAY' } as any;
      const saved = await ctl.save(device, 's-kitchen', { rawMaterialId: 'milk', qty: 2800, by: 'Joy' });
      const panel = await ctl.panel(device, 's-kitchen');
      const sent = await ctl.send(device, 's-kitchen', { by: 'Joy' });
      for (const res of [saved, panel, sent]) {
        expect(keysOf(res).filter((k) => FORBIDDEN.test(k))).toEqual([]);
        const json = JSON.stringify(res);
        expect(json).not.toMatch(/book|expected|₱/i);
        // The book figure itself, in any form.
        expect(json).not.toMatch(/3137|3,137|3\.137/);
      }
    });
  });

  // ── recounts ──────────────────────────────────────────────────────────────

  describe('recounts', () => {
    async function sentKitchen(h: ReturnType<typeof build>) {
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
    }

    it('asking only writes the list on the record: no line is deleted, and the station sees the banner', async () => {
      const h = build();
      await sentKitchen(h);
      const later = new Date(NOW.getTime() + 12 * HOUR);
      h.at(later);
      const view = await h.svc.recount(OWNER, 'cc1', 'owner', { rawMaterialIds: ['milk'], note: ' check the [back] fridge ' }, later);
      expect(h.lines.filter((l) => l.countId === 'cc1')).toHaveLength(2);
      expect(recountIds(h.counts[0].notes)).toEqual(['milk']);
      expect(h.counts[0].notes).toContain('Recount asked by Anne, Sep 22: Fresh Milk (check the back fridge)');
      expect(view.recountAsked).toEqual(['milk']);
      expect(view.recountAskedBy).toBe('Anne');
      expect(view.lines.find((l) => l.rawMaterialId === 'milk')!.recount).toBe(true);

      const panel = await h.svc.view(KITCHEN_CTX, later);
      expect(panel.recount).toEqual({ askedFor: ['milk'], message: 'Anne asked you to count these again: Fresh Milk.' });
      // The next day the panel starts a new count; milk is waiting to be counted again.
      expect(panel.state).toBe('NEW');
      expect(panel.sections.flatMap((s) => s.rows).find((r) => r.rawMaterialId === 'milk')).toMatchObject({ recount: true, done: false });
    });

    it('the recount lands on a new count with a fresh snapshot: the sales in between do not change the difference', async () => {
      const h = build();
      await sentKitchen(h);                                    // milk: book 3137, counted 2800 -> short 337
      const later = new Date(NOW.getTime() + 12 * HOUR);
      h.at(later);
      await h.svc.recount(OWNER, 'cc1', 'owner', { rawMaterialIds: ['milk'] }, later);
      h.stock.milk = 2637;                                    // 500 ml sold overnight
      await save(h, KITCHEN_CTX, 'milk', 2300, later);
      // The record is untouched; the new count measured against the book as it is now.
      expect(lineFor(h, 'cc1', 'milk')).toMatchObject({ expectedQty: 3137, countedQty: 2800, varianceQty: -337 });
      expect(lineFor(h, 'cc2', 'milk')).toMatchObject({ expectedQty: 2637, countedQty: 2300, varianceQty: -337 });
      // The id came off the record's list, and the new count remembers it answered a recount.
      expect(recountIds(h.counts[0].notes)).toEqual([]);
      expect(h.counts[0].notes).not.toContain('[RECOUNT:');
      expect(recountedIds(h.counts[1].notes)).toEqual(['milk']);
      expect((await h.svc.view(KITCHEN_CTX, later)).recount).toBeNull();
    });

    it('a Send holding only what was asked for is titled "Recount sent", and nothing else reads as missing', async () => {
      const h = build();
      await sentKitchen(h);
      const later = new Date(NOW.getTime() + 12 * HOUR);
      h.at(later);
      await h.svc.recount(OWNER, 'cc1', 'owner', { rawMaterialIds: ['milk'] }, later);
      await save(h, KITCHEN_CTX, 'milk', 3137, later);
      // The panel knows the count holds only the recount, so it does not ask "1 of 4 counted. Send anyway?".
      expect((await h.svc.view(KITCHEN_CTX, later)).recounted).toEqual(['milk']);
      h.notifications.create.mockClear();
      const res = await send(h, KITCHEN_CTX, later);
      expect(res.notCounted).toEqual([]);
      const bell = h.notifications.create.mock.calls[0][0];
      expect(bell.title).toBe('Recount sent — Kitchen (Main)');
      expect(bell.body).toBe('Recorded. Nothing has moved. Counted again: Fresh Milk. All match the book.');
      expect(h.telegram.weeklyCountSent.mock.calls.at(-1)[2]).toMatchObject({
        recount: true, recounted: [], notCounted: [], lines: [expect.objectContaining({ name: 'Fresh Milk' })],
      });
    });

    it('a full count that also answers a recount is a weekly count: every difference told, the recount named', async () => {
      const h = build();
      await sentKitchen(h);
      const later = new Date(NOW.getTime() + 12 * HOUR);
      h.at(later);
      await h.svc.recount(OWNER, 'cc1', 'owner', { rawMaterialIds: ['milk'] }, later);
      await save(h, KITCHEN_CTX, 'milk', 3137, later);
      await save(h, KITCHEN_CTX, 'sugar', 4000, later);
      h.notifications.create.mockClear();
      const res = await send(h, KITCHEN_CTX, later);
      expect(res.notCounted).toEqual(['Eggs', 'Napkins']);
      const bell = h.notifications.create.mock.calls[0][0];
      expect(bell.title).toBe('Weekly count sent — Kitchen (Main)');
      expect(bell.body).toBe('Recorded. Nothing has moved. 2 of 4 counted, 1 differs. White Sugar short 1 kg. Recounted: Fresh Milk. Not counted: Eggs, Napkins.');
      expect(h.telegram.weeklyCountSent.mock.calls.at(-1)[2]).toMatchObject({
        recount: false, recounted: ['Fresh Milk'], notCounted: ['Eggs', 'Napkins'],
        lines: [expect.objectContaining({ name: 'Fresh Milk' }), expect.objectContaining({ name: 'White Sugar' })],
      });
    });

    it('is refused on a count still open, one already adjusted, one that is not weekly, and for items not on it', async () => {
      const h = build({
        counts: [{
          id: 'req-count', tenantId: T, branchId: B, countNumber: 'CC-2026-000050', status: 'OPEN', notes: '[REQ:REQ-20260921-001] Counted while building the buy list',
          startedById: 'owner', postedAt: null, postedById: null, createdAt: NOW, updatedAt: NOW,
        }],
      });
      await save(h, KITCHEN_CTX, 'eggs', 24);
      const openId = h.counts[1].id;
      await expect(h.svc.recount(OWNER, openId, 'owner', { rawMaterialIds: ['eggs'] }, NOW)).rejects.toThrow('still open');
      await send(h, KITCHEN_CTX);
      await expect(h.svc.recount(OWNER, openId, 'owner', { rawMaterialIds: ['milk'] }, NOW)).rejects.toThrow('Pick items that are on this count.');
      await expect(h.svc.recount(OWNER, openId, 'owner', { rawMaterialIds: [] }, NOW)).rejects.toThrow('Pick 1 to 40 items to count again.');
      await expect(h.svc.recount(OWNER, openId, 'owner', { rawMaterialIds: Array.from({ length: 41 }, (_, i) => `x${i}`) }, NOW)).rejects.toThrow(BadRequestException);
      await expect(h.svc.recount(OWNER, openId, 'owner', { rawMaterialIds: ['eggs'], note: 'x'.repeat(201) }, NOW)).rejects.toThrow('Keep the note to 200 characters.');
      await expect(h.svc.recount(OWNER, 'req-count', 'owner', { rawMaterialIds: ['eggs'] }, NOW)).rejects.toThrow('not a weekly count');
      h.counts[1].status = 'POSTED';
      await expect(h.svc.recount(OWNER, openId, 'owner', { rawMaterialIds: ['eggs'] }, NOW)).rejects.toThrow('already adjusted');
      expect(h.lines).toHaveLength(1);
    });

    it('a second ask adds to the list and keeps it to 40', async () => {
      const h = build();
      await sentKitchen(h);
      await h.svc.recount(OWNER, 'cc1', 'owner', { rawMaterialIds: ['milk'] }, NOW);
      await h.svc.recount(OWNER, 'cc1', 'mgr', { rawMaterialIds: ['eggs', 'milk'] }, NOW);
      expect(recountIds(h.counts[0].notes)).toEqual(['milk', 'eggs']);
      expect(h.counts[0].notes).toContain('[RECOUNTBY:Mia]');
    });
  });

  // ── the owner's review and adjusting ──────────────────────────────────────

  describe('the reconciliation', () => {
    it('says counted, book and difference per line in words, with the status in plain English', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'sugar', 5200);
      await save(h, KITCHEN_CTX, 'eggs', 30);
      await send(h, KITCHEN_CTX);
      const view = await h.svc.review(OWNER, 'cc1', NOW);
      expect(view).toMatchObject({
        countNumber: 'CC-2026-000101', status: 'RECORDED', badge: 'Recorded - books not changed',
        statusLine: 'Recorded Sep 21 9:05 PM by Joy (Kitchen). Stock and the books have not changed.',
        station: { id: 's-kitchen', name: 'Kitchen' }, startedOn: '2026-09-21', recordedBy: 'Joy',
        summary: { lines: 3, differ: 2, short: 1, over: 1, superseded: 0 },
        actions: { canAdjust: true, canAskRecount: true },
      });
      expect(view.stations).toEqual([{
        id: 's-kitchen', name: 'Kitchen', sentAt: NOW.toISOString(), countedBy: 'Joy', counted: 3, total: 4,
        notCounted: [{ rawMaterialId: 'napkins', name: 'Napkins' }],
      }]);
      expect(view.lines.map((l) => l.words)).toEqual([
        'Eggs: counted 30 pc, book 30 pc, matches',
        'Fresh Milk: counted 2.8 L, book 3.14 L, short 337 ml',
        'White Sugar: counted 5.2 kg, book 5 kg, over 200 g',
      ]);
      expect(view.lines[1]).toMatchObject({
        counted: 2800, book: 3137, difference: -337, kind: 'SHORT', inPacks: '2 pk + 800 ml', countedBy: 'Joy', stationName: 'Kitchen',
        detail: '2 pk + 800 ml · Kitchen screen (Joy) · Sep 21 9:05 PM', superseded: null, alsoOpenIn: [],
      });
    });

    it('the station strip counts a shared item the other station counted, as the tablet and the bell do', async () => {
      const h = build();
      await save(h, BAR_CTX, 'milk', 2800, new Date(NOW.getTime() - HOUR), 'Ben');
      await save(h, KITCHEN_CTX, 'eggs', 24);
      const sent = await send(h, KITCHEN_CTX);
      const view = await h.svc.review(OWNER, h.counts[1].id, NOW);
      expect(view.stations[0]).toMatchObject({ counted: 2, total: 4, notCounted: [{ rawMaterialId: 'napkins', name: 'Napkins' }, { rawMaterialId: 'sugar', name: 'White Sugar' }] });
      expect(view.stations[0].counted).toBe(sent.progress.counted);
    });

    it('a line counted again later at another station is superseded, and adjusting leaves it out', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      const next = new Date(NOW.getTime() + DAY);
      await save(h, BAR_CTX, 'milk', 2900, next, 'Ben');
      const view = await h.svc.review(OWNER, 'cc1', next);
      const milk = view.lines.find((l) => l.rawMaterialId === 'milk')!;
      expect(milk.superseded).toEqual({
        reason: 'COUNTED_AGAIN', countNumber: 'CC-2026-000102', stationName: 'Bar', on: 'Sep 22', at: next.toISOString(),
        message: 'Counted again later (Bar, Sep 22). Not adjusted from this record.',
      });
      expect(view.lines.find((l) => l.rawMaterialId === 'eggs')!.superseded).toBeNull();
      expect(view.summary).toEqual({ lines: 2, differ: 1, short: 1, over: 0, superseded: 1 });
      // The bar's open count holds milk too.
      expect(milk.alsoOpenIn).toEqual(['CC-2026-000102']);

      h.at(next);
      const res = await h.svc.adjust(OWNER, 'cc1', 'owner', {}, next);
      expect(h.warehouse.postCycleCount).toHaveBeenCalledWith(T, 'cc1', 'owner', false, ['milk']);
      expect(res).toMatchObject({ status: 'POSTED', badge: 'Books adjusted', adjusted: 1, skipped: ['Fresh Milk'], warnings: [] });
      expect(res.statusLine).toBe('Books adjusted Sep 22 9:05 PM by Anne.');
      // Read as it stood when it was posted: still superseded, still left out.
      expect(res.lines.find((l) => l.rawMaterialId === 'milk')!.superseded?.reason).toBe('COUNTED_AGAIN');
    });

    it('names an item the post itself left out too: another count of it posted a moment before', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      // Between the review and the tap, a buy list's count of eggs was posted; the post checks again and leaves eggs alone.
      const post = h.warehouse.postCycleCount.getMockImplementation();
      h.warehouse.postCycleCount.mockImplementationOnce(async (...args: any[]) => {
        const r = await post(...args);
        return { ...r, leftAlone: [{ rawMaterialId: 'eggs', name: 'Eggs', message: 'Left alone: Eggs was already adjusted by count CC-2026-000050 (posted Sep 21).' }] };
      });
      const res = await h.svc.adjust(OWNER, 'cc1', 'owner', {}, NOW);
      expect(h.warehouse.postCycleCount).toHaveBeenCalledWith(T, 'cc1', 'owner', false, []);
      expect(res).toMatchObject({ adjusted: 1, skipped: ['Eggs'] });
    });

    it('a line is superseded by a later count posted from the counts screen that moved it; not by one posted before it was counted, nor by a line nobody changed', async () => {
      const posted = (id: string, postedAt: Date) => ({
        id, tenantId: T, branchId: B, countNumber: `CC-2026-0000${id.slice(-2)}`, status: 'POSTED', notes: null,
        startedById: 'owner', postedAt, postedById: 'owner', createdAt: postedAt, updatedAt: postedAt,
      });
      const h = build({
        counts: [posted('full01', new Date(NOW.getTime() - DAY)), posted('full02', new Date(NOW.getTime() + DAY))],
        lines: [
          { id: 'x1', countId: 'full01', rawMaterialId: 'eggs', expectedQty: 30, countedQty: 24, varianceQty: -6, notes: null },
          { id: 'x2', countId: 'full02', rawMaterialId: 'milk', expectedQty: 3000, countedQty: 2900, varianceQty: -100, notes: null },
          // The book figure the counts screen filled in, left as it was: nobody counted eggs there.
          { id: 'x3', countId: 'full02', rawMaterialId: 'eggs', expectedQty: 30, countedQty: 30, varianceQty: 0, notes: null },
        ],
      });
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      const view = await h.svc.review(OWNER, h.counts[2].id, new Date(NOW.getTime() + 2 * DAY));
      expect(view.lines.find((l) => l.rawMaterialId === 'milk')!.superseded).toMatchObject({
        reason: 'ADJUSTED', countNumber: 'CC-2026-000002', message: 'Adjusted by count CC-2026-000002 on Sep 22. Not adjusted from this record.',
      });
      expect(view.lines.find((l) => l.rawMaterialId === 'eggs')!.superseded).toBeNull();
    });

    it('refuses to adjust when every line matches or was counted again later', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'eggs', 30);
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await send(h, KITCHEN_CTX);
      await save(h, BAR_CTX, 'milk', 2900, new Date(NOW.getTime() + HOUR), 'Ben');
      await expect(h.svc.adjust(OWNER, 'cc1', 'owner', {}, new Date(NOW.getTime() + 2 * HOUR)))
        .rejects.toThrow(new BadRequestException('Nothing to adjust: every item matches or was counted again later.'));
      expect(h.warehouse.postCycleCount).not.toHaveBeenCalled();
    });

    it('refuses to adjust a count already adjusted, and passes an opening count through', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await send(h, KITCHEN_CTX);
      await h.svc.adjust(OWNER, 'cc1', 'owner', { isOpeningBalance: true }, NOW);
      expect(h.warehouse.postCycleCount).toHaveBeenCalledWith(T, 'cc1', 'owner', true, []);
      await expect(h.svc.adjust(OWNER, 'cc1', 'owner', {}, NOW)).rejects.toThrow('Only open or recorded counts can be posted.');
    });

    it('a manager tied to one branch cannot open another branch\'s count', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'eggs', 24);
      await expect(h.svc.review({ tenantId: T, ownBranchId: 'b2' }, 'cc1', NOW)).rejects.toThrow(ForbiddenException);
      await expect(h.svc.adjust({ tenantId: T, ownBranchId: 'b2' }, 'cc1', 'mgr-other', {}, NOW)).rejects.toThrow(ForbiddenException);
      await expect(h.svc.review({ tenantId: T, ownBranchId: B }, 'cc1', NOW)).resolves.toBeDefined();
      await expect(h.svc.review({ tenantId: 't2', ownBranchId: null }, 'cc1', NOW)).rejects.toThrow('Count not found.');
    });

    it('lists the weekly counts with their badges, and only the manager\'s own branch', async () => {
      const h = build();
      await save(h, KITCHEN_CTX, 'milk', 2800);
      await send(h, KITCHEN_CTX);
      await save(h, BAR_CTX, 'syrup', 700, new Date(NOW.getTime() + HOUR), 'Ben');
      const rows = await h.svc.list(OWNER, {});
      expect(rows.map((r) => [r.countNumber, r.badge, r.station?.name, r.lines, r.differ])).toEqual([
        ['CC-2026-000102', 'Counting now', 'Bar', 1, 0],
        ['CC-2026-000101', 'Recorded - books not changed', 'Kitchen', 1, 1],
      ]);
      expect(rows[1]).toMatchObject({ sentBy: 'Joy', sentAt: NOW.toISOString(), startedOn: '2026-09-21', notes: 'Weekly count, Kitchen · Kitchen sent by Joy, Sep 21 9:05 PM' });
      await expect(h.svc.list(OWNER, { status: 'toString' })).rejects.toThrow('Unknown status.');
      await expect(h.svc.list({ tenantId: T, ownBranchId: B }, { branchId: 'b2' })).rejects.toThrow(ForbiddenException);
      expect(h.prisma.cycleCount.findMany).toHaveBeenLastCalledWith(expect.anything());
      await h.svc.list({ tenantId: T, ownBranchId: B }, {});
      expect(h.prisma.cycleCount.findMany.mock.calls.at(-1)[0].where).toMatchObject({ tenantId: T, branchId: B, notes: { startsWith: '[WEEKLY:' } });
    });
  });
});
