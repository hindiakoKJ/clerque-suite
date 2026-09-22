import { Prisma } from '@prisma/client';
import { WarehouseService } from './warehouse.service';
import { leftAloneMessage, leftAloneNotes, newerCounts, wasLeftAlone } from './newer-count';
import { lineNotes, weeklyCountNotes } from '../procure/weekly-count';

/**
 * Newest count wins, for every count post.
 *
 * A buy list's "how much is left?" is a line on an open count, measured
 * against the book when it was counted. The owner can adjust the same item
 * from a newer weekly count first; posting the buy list's count afterwards
 * applied its older difference to the corrected stock again, and the loss was
 * booked twice. Posting now leaves that line alone and says why.
 *
 * Against a small in-memory shop: counts, their lines, the shelf and the books.
 */
describe('Posting a count: newest count wins', () => {
  const T = 't1';
  const B = 'b1';
  // Manila wall time.
  const at = (s: string) => new Date(`${s}+08:00`);
  // Only the clock is faked: the service's promises run as they do in the shop.
  const clock = (d: Date) => jest.useFakeTimers({
    now: d,
    doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  afterEach(() => jest.useRealTimers());

  const MATERIALS: Record<string, { id: string; name: string; unit: string; costPrice: string; category: string }> = {
    salt:  { id: 'salt',  name: 'Salt',        unit: 'g',  costPrice: '0.05', category: 'INGREDIENT' },
    sugar: { id: 'sugar', name: 'White Sugar', unit: 'g',  costPrice: '0.07', category: 'INGREDIENT' },
    milk:  { id: 'milk',  name: 'Fresh Milk',  unit: 'ml', costPrice: '0.08', category: 'INGREDIENT' },
  };
  const KITCHEN = { id: 's-kitchen', name: 'Kitchen' };
  const BAR = { id: 's-bar', name: 'Bar' };

  type Count = {
    id: string; tenantId: string; branchId: string; countNumber: string; status: string; notes: string | null;
    createdAt: Date; postedAt: Date | null; postedById: string | null;
  };
  type Line = { id: string; countId: string; rawMaterialId: string; expectedQty: number; countedQty: number; varianceQty: number; notes: string | null };
  type NewLine = { rawMaterialId: string; expected: number; counted: number; notes?: string | null };

  function shop(stock: Record<string, number>) {
    const counts: Count[] = [];
    const lines: Line[] = [];
    const events: any[] = [];
    const locks: string[] = [];
    const live = new Map<string, number>(Object.entries(stock));

    const shape = (c: Count) => ({
      ...c,
      lines: lines.filter((l) => l.countId === c.id).map((l) => ({
        ...l,
        expectedQty: new Prisma.Decimal(l.expectedQty), countedQty: new Prisma.Decimal(l.countedQty), varianceQty: new Prisma.Decimal(l.varianceQty),
        rawMaterial: MATERIALS[l.rawMaterialId]
          ?? { id: l.rawMaterialId, name: l.rawMaterialId, unit: 'g', costPrice: '0.05', category: 'INGREDIENT' },
      })),
    });
    const matches = (c: Count, w: any): boolean => {
      if (w.tenantId && c.tenantId !== w.tenantId) return false;
      if (w.branchId && c.branchId !== w.branchId) return false;
      if (w.id?.not && c.id === w.id.not) return false;
      if (typeof w.status === 'string' && c.status !== w.status) return false;
      if (w.status?.not && c.status === w.status.not) return false;
      if (w.postedAt?.gt && !(c.postedAt && c.postedAt > w.postedAt.gt)) return false;
      if (w.postedAt?.lte && !(c.postedAt && c.postedAt <= w.postedAt.lte)) return false;
      if (w.notes?.startsWith != null && !(c.notes ?? '').startsWith(w.notes.startsWith)) return false;
      if (w.OR && !w.OR.some((o: any) => matches(c, o))) return false;
      return true;
    };
    const num = (data: any) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Prisma.Decimal ? Number(v) : v]));

    const tx: any = {
      $queryRaw:   jest.fn(async () => []),
      $executeRaw: jest.fn(async (_sql: TemplateStringsArray, key: string) => { locks.push(key); return 1; }),
      cycleCount: {
        findFirst: jest.fn(async ({ where }: any) => {
          const c = counts.find((x) => x.id === where.id && x.tenantId === where.tenantId);
          return c ? shape(c) : null;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const c = counts.find((x) => x.id === where.id)!;
          Object.assign(c, data);
          return shape(c);
        }),
      },
      cycleCountLine: {
        findMany: jest.fn(async ({ where }: any) => lines
          .filter((l) => where.rawMaterialId.in.includes(l.rawMaterialId))
          .map((l) => ({ l, c: counts.find((x) => x.id === l.countId)! }))
          .filter(({ c }) => matches(c, where.count))
          .map(({ l, c }) => ({
            rawMaterialId: l.rawMaterialId, notes: l.notes, varianceQty: new Prisma.Decimal(l.varianceQty),
            count: { countNumber: c.countNumber, status: c.status, notes: c.notes, postedAt: c.postedAt, createdAt: c.createdAt },
          }))),
        update: jest.fn(async ({ where, data }: any) => { Object.assign(lines.find((l) => l.id === where.id)!, num(data)); return {}; }),
      },
      rawMaterialInventory: {
        findUnique: jest.fn(async ({ where }: any) => {
          const rm = where.branchId_rawMaterialId.rawMaterialId;
          return live.has(rm) ? { quantity: new Prisma.Decimal(live.get(rm)!) } : null;
        }),
        upsert: jest.fn(async ({ where, update, create }: any) => {
          const rm = where.branchId_rawMaterialId.rawMaterialId;
          if (!live.has(rm)) live.set(rm, Number(create.quantity));
          else {
            const q = update.quantity;
            live.set(rm, q.increment != null ? live.get(rm)! + Number(q.increment) : live.get(rm)! - Number(q.decrement));
          }
          return {};
        }),
        updateMany: jest.fn(async () => ({ count: 0 })),
      },
      // No ticket is waiting at a screen: nothing to give back.
      orderItem: { findMany: jest.fn(async () => []) },
      accountingEvent: { create: jest.fn(async ({ data }: any) => { events.push(data); return {}; }) },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const svc = new WarehouseService(prisma);

    let lineSeq = 0;
    const add = (c: { id: string; countNumber: string; status: string; notes: string | null; createdAt: Date }, ls: NewLine[]) => {
      counts.push({ tenantId: T, branchId: B, postedAt: null, postedById: null, ...c });
      for (const l of ls) {
        lines.push({
          id: `l${++lineSeq}`, countId: c.id, rawMaterialId: l.rawMaterialId,
          expectedQty: l.expected, countedQty: l.counted, varianceQty: l.counted - l.expected, notes: l.notes ?? null,
        });
      }
    };
    /** The owner posts a count at this moment. */
    const post = (id: string, when: Date, opts: { opening?: boolean; skip?: string[] } = {}) => {
      clock(when);
      return svc.postCycleCount(T, id, 'owner', opts.opening ?? false, opts.skip);
    };
    const lineOf = (countId: string, rm: string) => lines.find((l) => l.countId === countId && l.rawMaterialId === rm)!;
    const countOf = (id: string) => counts.find((c) => c.id === id)!;
    return { svc, tx, prisma, counts, lines, events, locks, live, add, post, lineOf, countOf };
  }

  // A buy list's count, as recordCount writes it: the line number, and when it was counted.
  const BUY_LIST = '[REQ:REQ-20260922-001] Counted while building the buy list';
  const buyListLine = (rawMaterialId: string, counted: Date, expected: number, qty: number, n = 1): NewLine => ({
    rawMaterialId, expected, counted: qty, notes: `[AT:${counted.toISOString()}] REQ-20260922-001-0${n}`,
  });
  // The Kitchen's weekly count sent last night: salt 300 g short of the 1 kg on the book.
  const addWeekly = (h: ReturnType<typeof shop>) => h.add(
    { id: 'weekly', countNumber: 'CC-2026-000009', status: 'RECORDED', notes: weeklyCountNotes('2026-09-21', KITCHEN), createdAt: at('2026-09-21T20:55:00') },
    [{ rawMaterialId: 'salt', expected: 1000, counted: 700, notes: lineNotes({ by: 'Joy', at: at('2026-09-21T21:00:00'), stationId: KITCHEN.id }) }],
  );

  it('a buy list\'s count posted after the owner adjusted from a newer weekly count leaves that item alone', async () => {
    const h = shop({ salt: 1000, sugar: 5000 });
    addWeekly(h);
    // The cook builds the morning buy list: salt 650 g left (50 g sold since last night), sugar 4 kg.
    h.add({ id: 'list', countNumber: 'CC-2026-000010', status: 'OPEN', notes: BUY_LIST, createdAt: at('2026-09-22T07:30:00') }, [
      buyListLine('salt', at('2026-09-22T07:30:00'), 950, 650, 1),
      buyListLine('sugar', at('2026-09-22T07:35:00'), 5000, 4000, 2),
    ]);
    h.live.set('salt', 950);

    // 9:00 the owner adjusts the books from the weekly count: salt comes down by the 300 it found missing.
    await h.post('weekly', at('2026-09-22T09:00:00'), { skip: [] });
    expect(h.live.get('salt')).toBe(650);

    // 10:00 the owner posts the buy list's count. The 300 g is already booked; its own -300 would book it twice.
    const res = await h.post('list', at('2026-09-22T10:00:00'));
    expect(h.live.get('salt')).toBe(650);
    // Said as it is: the weekly count was counted before this list, and posted after it.
    expect(res.leftAlone).toEqual([{
      rawMaterialId: 'salt', name: 'Salt', message: 'Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22).',
    }]);
    // The line's figures as they were; no entry for salt from this count.
    expect(h.lineOf('list', 'salt')).toMatchObject({ expectedQty: 950, countedQty: 650, varianceQty: -300 });
    expect(h.events.filter((e) => e.payload.referenceNumber === 'CC-2026-000010').map((e) => e.payload.rawMaterialId)).toEqual(['sugar']);
    // Unrelated items still post.
    expect(h.live.get('sugar')).toBe(4000);
    expect(res).toMatchObject({ status: 'POSTED', message: null });
    // Remembered on the line itself, its other notes untouched; the count's notes as they were.
    expect(h.lineOf('list', 'salt').notes).toBe('[AT:2026-09-21T23:30:00.000Z] [LEFT:2026-09-22T02:00:00.000Z] REQ-20260922-001-01');
    expect(h.lineOf('list', 'sugar').notes).toBe('[AT:2026-09-21T23:35:00.000Z] REQ-20260922-001-02');
    expect(h.countOf('list').notes).toBe(BUY_LIST);
  });

  it('a buy list\'s line counted after the owner adjusted still posts: it saw the corrected book', async () => {
    const h = shop({ salt: 1000 });
    addWeekly(h);
    await h.post('weekly', at('2026-09-22T09:00:00'), { skip: [] });
    expect(h.live.get('salt')).toBe(700);
    // 9:30 the cook counts salt against the corrected 700: 650 left.
    h.add({ id: 'list', countNumber: 'CC-2026-000010', status: 'OPEN', notes: BUY_LIST, createdAt: at('2026-09-22T09:30:00') }, [
      buyListLine('salt', at('2026-09-22T09:30:00'), 700, 650),
    ]);
    const res = await h.post('list', at('2026-09-22T10:00:00'));
    expect(res.leftAlone).toEqual([]);
    expect(h.live.get('salt')).toBe(650);
    expect(wasLeftAlone(h.lineOf('list', 'salt').notes)).toBe(false);
  });

  it('a count with every line left alone says so and still closes as POSTED', async () => {
    const h = shop({ salt: 1000 });
    addWeekly(h);
    h.add({ id: 'list', countNumber: 'CC-2026-000010', status: 'OPEN', notes: BUY_LIST, createdAt: at('2026-09-22T07:30:00') }, [
      buyListLine('salt', at('2026-09-22T07:30:00'), 1000, 650),
    ]);
    await h.post('weekly', at('2026-09-22T09:00:00'), { skip: [] });
    const eventsBefore = h.events.length;

    const res = await h.post('list', at('2026-09-22T10:00:00'));
    expect(res.status).toBe('POSTED');
    expect(res.message).toBe('Nothing moved: every item on this count was already adjusted or counted again by another count.');
    expect(res.leftAlone.map((l) => l.message)).toEqual(['Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22).']);
    expect(h.live.get('salt')).toBe(700);
    expect(h.events).toHaveLength(eventsBefore);
    expect(h.tx.orderItem.findMany).toHaveBeenCalledTimes(1);   // the weekly count's post only
  });

  it('an item a count left alone does not knock out the newest count of it, posted after', async () => {
    // Oldest first: Monday's list, then the weekly adjust, then Tuesday's list counted after it.
    const h = shop({ salt: 1000 });
    h.add({ id: 'mon', countNumber: 'CC-2026-000008', status: 'OPEN', notes: '[REQ:REQ-20260921-001] Counted while building the buy list', createdAt: at('2026-09-21T08:00:00') }, [
      buyListLine('salt', at('2026-09-21T08:00:00'), 1000, 800),
    ]);
    addWeekly(h);
    await h.post('weekly', at('2026-09-22T07:00:00'), { skip: [] });                // salt 1000 -> 700
    h.add({ id: 'tue', countNumber: 'CC-2026-000010', status: 'OPEN', notes: BUY_LIST, createdAt: at('2026-09-22T08:00:00') }, [
      buyListLine('salt', at('2026-09-22T08:00:00'), 700, 600),
    ]);
    const mon = await h.post('mon', at('2026-09-22T09:00:00'));
    expect(mon.leftAlone.map((l) => l.rawMaterialId)).toEqual(['salt']);
    expect(h.live.get('salt')).toBe(700);
    // Monday's post moved nothing for salt, so Tuesday's count -- the newest -- still posts.
    const tue = await h.post('tue', at('2026-09-22T10:00:00'));
    expect(tue.leftAlone).toEqual([]);
    expect(h.live.get('salt')).toBe(600);
  });

  it('a one-item fix on the counts screen leaves the other items to the counts that really counted them', async () => {
    // Monday 08:00 the cook's buy list: salt 700 g left against a book of 1 kg.
    const h = shop({ salt: 1000, milk: 3000, sugar: 5000 });
    h.add({ id: 'list', countNumber: 'CC-2026-000010', status: 'OPEN', notes: BUY_LIST, createdAt: at('2026-09-22T08:00:00') }, [
      buyListLine('salt', at('2026-09-22T08:00:00'), 1000, 700),
    ]);
    // Last night's Kitchen count, still a record: sugar 300 g short.
    h.add({ id: 'weekly', countNumber: 'CC-2026-000009', status: 'RECORDED', notes: weeklyCountNotes('2026-09-21', KITCHEN), createdAt: at('2026-09-21T20:55:00') }, [
      { rawMaterialId: 'sugar', expected: 5000, counted: 4700, notes: lineNotes({ by: 'Joy', at: at('2026-09-21T21:00:00'), stationId: KITCHEN.id }) },
    ]);
    // 10:00 the owner opens New count to fix milk. Every item is on it, filled in with the book; only milk is changed.
    h.add({ id: 'screen', countNumber: 'CC-2026-000011', status: 'OPEN', notes: null, createdAt: at('2026-09-22T10:00:00') }, [
      { rawMaterialId: 'salt', expected: 1000, counted: 1000 },
      { rawMaterialId: 'milk', expected: 3000, counted: 2600 },
      { rawMaterialId: 'sugar', expected: 5000, counted: 5000 },
    ]);
    const screen = await h.post('screen', at('2026-09-22T10:05:00'));
    expect(screen.leftAlone).toEqual([]);
    expect([h.live.get('salt'), h.live.get('milk'), h.live.get('sugar')]).toEqual([1000, 2600, 5000]);

    // 11:00 the buy list's count: salt still comes down to the 700 g on the shelf.
    const list = await h.post('list', at('2026-09-22T11:00:00'));
    expect(list.leftAlone).toEqual([]);
    expect(h.live.get('salt')).toBe(700);

    // And last night's record can still be adjusted: the counts screen never looked at sugar.
    const weekly = { ...h.countOf('weekly'), lines: h.lines.filter((l) => l.countId === 'weekly') };
    expect((await newerCounts(h.tx, weekly as any, at('2026-09-22T12:00:00'))).size).toBe(0);
    await h.post('weekly', at('2026-09-22T12:00:00'), { skip: [] });
    expect(h.live.get('sugar')).toBe(4700);
  });

  it('an older buy list posted before the newer weekly count is adjusted leaves the item for it', async () => {
    const h = shop({ salt: 1000 });
    // Monday Sep 15: the buy list finds salt 100 g short. It stays open.
    h.add({ id: 'old', countNumber: 'CC-2026-000005', status: 'OPEN', notes: '[REQ:REQ-20260915-001] Counted while building the buy list', createdAt: at('2026-09-15T08:00:00') }, [
      buyListLine('salt', at('2026-09-15T08:00:00'), 1000, 900),
    ]);
    // Sunday Sep 21: the Kitchen's weekly count finds 400 g short of the same book.
    h.add({ id: 'weekly', countNumber: 'CC-2026-000009', status: 'RECORDED', notes: weeklyCountNotes('2026-09-21', KITCHEN), createdAt: at('2026-09-21T20:55:00') }, [
      { rawMaterialId: 'salt', expected: 1000, counted: 600, notes: lineNotes({ by: 'Joy', at: at('2026-09-21T21:00:00'), stationId: KITCHEN.id }) },
    ]);
    // Monday Sep 22 the owner clears the old buy list first: the week-newer count of salt is waiting.
    const old = await h.post('old', at('2026-09-22T09:00:00'));
    expect(old.leftAlone.map((l) => l.message)).toEqual(['Left alone: Salt was counted again later (CC-2026-000009, Sep 21).']);
    expect(h.live.get('salt')).toBe(1000);
    // Then adjusts from the weekly count: salt comes down to the 600 g it found.
    const weekly = await h.post('weekly', at('2026-09-22T09:30:00'), { skip: [] });
    expect(weekly.leftAlone).toEqual([]);
    expect(h.live.get('salt')).toBe(600);
  });

  it('every item a big count left alone is remembered, however many there are', async () => {
    // A full count opened on the counts screen at 20:00, every one of 100 items counted 5 short.
    const items = Array.from({ length: 100 }, (_, i) => `item-${String(i).padStart(3, '0')}-${'x'.repeat(16)}`);
    const h = shop(Object.fromEntries(items.map((id) => [id, 1000])));
    h.add({ id: 'screen', countNumber: 'CC-2026-000011', status: 'OPEN', notes: 'Monthly', createdAt: at('2026-09-21T20:00:00') },
      items.map((id) => ({ rawMaterialId: id, expected: 1000, counted: 995 })));
    // At 21:00 the Kitchen counts every item again, 10 short, and sends it as a record.
    h.add({ id: 'weekly', countNumber: 'CC-2026-000012', status: 'RECORDED', notes: weeklyCountNotes('2026-09-21', KITCHEN), createdAt: at('2026-09-21T20:55:00') },
      items.map((id) => ({ rawMaterialId: id, expected: 1000, counted: 990, notes: lineNotes({ by: 'Joy', at: at('2026-09-21T21:00:00'), stationId: KITCHEN.id }) })));

    // Posting the older full count leaves all 100 for the newer record, and marks each line.
    const screen = await h.post('screen', at('2026-09-22T08:00:00'));
    expect(screen.leftAlone).toHaveLength(100);
    expect(h.lines.filter((l) => l.countId === 'screen').every((l) => wasLeftAlone(l.notes))).toBe(true);
    expect(h.countOf('screen').notes).toBe('Monthly');
    expect(items.every((id) => h.live.get(id) === 1000)).toBe(true);

    // So the record, adjusted after, still moves every item: the full count moved none of them.
    const weekly = await h.post('weekly', at('2026-09-22T09:00:00'), { skip: [] });
    expect(weekly.leftAlone).toEqual([]);
    expect(items.every((id) => h.live.get(id) === 990)).toBe(true);
  });

  it('an opening count posts every line to Owner\'s Capital, as before', async () => {
    const h = shop({});
    h.add({ id: 'opening', countNumber: 'CC-2026-000001', status: 'OPEN', notes: 'Opening stock', createdAt: at('2026-09-16T10:00:00') }, [
      { rawMaterialId: 'salt', expected: 0, counted: 2000 },
      { rawMaterialId: 'milk', expected: 0, counted: 9000 },
    ]);
    const res = await h.post('opening', at('2026-09-16T18:00:00'), { opening: true });
    expect(res).toMatchObject({ status: 'POSTED', leftAlone: [], message: null, notes: 'Opening stock' });
    expect([...h.live]).toEqual([['salt', 2000], ['milk', 9000]]);
    expect(h.events.map((e) => [e.payload.rawMaterialId, e.payload.reasonCode])).toEqual([['salt', 'OPENING_BALANCE'], ['milk', 'OPENING_BALANCE']]);
    expect(h.tx.cycleCount.update.mock.calls[0][0].data).not.toHaveProperty('notes');
    expect(h.lines.map((l) => l.notes)).toEqual([null, null]);
  });

  it('two counts posted at once wait on the branch: the second reads the first as posted', async () => {
    const h = shop({ salt: 1000 });
    addWeekly(h);
    await h.post('weekly', at('2026-09-22T09:00:00'), { skip: [] });
    expect(h.locks).toEqual(['cycle-count-post:t1:b1']);
    // The lock is taken before the other counts are read.
    expect(h.tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(h.tx.cycleCountLine.findMany.mock.invocationCallOrder[0]);
    // After the count's own row lock.
    expect(h.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(h.tx.$executeRaw.mock.invocationCallOrder[0]);
  });

  it('the plain post route still refuses a recorded weekly count', async () => {
    const h = shop({ salt: 1000 });
    addWeekly(h);
    clock(at('2026-09-22T09:00:00'));
    await expect(h.svc.postCycleCount(T, 'weekly', 'owner')).rejects.toThrow('A weekly count is adjusted from its Review under Procure > Counts.');
    expect(h.live.get('salt')).toBe(1000);
  });

  // ── the rule itself, as the weekly review reads it too ─────────────────────

  describe('which lines a newer count replaced', () => {
    it('a weekly count\'s line is counted again by a newer weekly count, sent or not; an older one does not replace it', async () => {
      const h = shop({});
      addWeekly(h);
      h.add({ id: 'bar-new', countNumber: 'CC-2026-000011', status: 'OPEN', notes: weeklyCountNotes('2026-09-22', BAR), createdAt: at('2026-09-22T08:00:00') }, [
        { rawMaterialId: 'salt', expected: 1000, counted: 690, notes: lineNotes({ by: 'Ben', at: at('2026-09-22T08:00:00'), stationId: BAR.id }) },
      ]);
      h.add({ id: 'bar-old', countNumber: 'CC-2026-000007', status: 'POSTED', notes: weeklyCountNotes('2026-09-20', BAR), createdAt: at('2026-09-20T08:00:00') }, [
        { rawMaterialId: 'salt', expected: 1000, counted: 900, notes: lineNotes({ by: 'Ben', at: at('2026-09-20T08:00:00'), stationId: BAR.id }) },
      ]);
      // Posted after the Kitchen counted, but its line is older: that post left salt alone for the Kitchen's.
      h.countOf('bar-old').postedAt = at('2026-09-22T07:00:00');
      const weekly = { ...h.countOf('weekly'), lines: h.lines.filter((l) => l.countId === 'weekly') };
      const found = await newerCounts(h.tx, weekly as any, at('2026-09-22T12:00:00'));
      expect([...found.values()]).toEqual([{ reason: 'COUNTED_AGAIN', countNumber: 'CC-2026-000011', stationId: BAR.id, when: at('2026-09-22T08:00:00') }]);
      // Read as it stood before the bar counted: nothing replaced it yet.
      expect((await newerCounts(h.tx, weekly as any, at('2026-09-22T07:59:00'))).size).toBe(0);
    });

    it('a count posted since replaces a line when it moved the item, or matched it on a buy list counted later; a counts-screen match does not', async () => {
      const h = shop({});
      h.add({ id: 'list', countNumber: 'CC-2026-000010', status: 'OPEN', notes: BUY_LIST, createdAt: at('2026-09-22T07:30:00') }, [
        buyListLine('salt', at('2026-09-22T07:30:00'), 1000, 650, 1),
        buyListLine('sugar', at('2026-09-22T07:30:00'), 5000, 4000, 2),
        buyListLine('milk', at('2026-09-22T07:30:00'), 3000, 2500, 3),
      ]);
      // A full count from the counts screen, started before the list and posted after it: salt moved, sugar matched.
      h.add({ id: 'full', countNumber: 'CC-2026-000012', status: 'POSTED', notes: null, createdAt: at('2026-09-22T07:00:00') }, [
        { rawMaterialId: 'salt', expected: 1000, counted: 900 },
        { rawMaterialId: 'sugar', expected: 5000, counted: 5000 },
      ]);
      h.countOf('full').postedAt = at('2026-09-22T09:00:00');
      // Another started after the list and posted: milk matched, the book figure the screen filled in. Nobody may have looked.
      h.add({ id: 'late', countNumber: 'CC-2026-000013', status: 'POSTED', notes: null, createdAt: at('2026-09-22T08:00:00') }, [
        { rawMaterialId: 'milk', expected: 2500, counted: 2500 },
      ]);
      h.countOf('late').postedAt = at('2026-09-22T09:30:00');
      const list = { ...h.countOf('list'), lines: h.lines.filter((l) => l.countId === 'list') };
      const found = await newerCounts(h.tx, list as any, at('2026-09-22T10:00:00'));
      const byItem = Object.fromEntries(list.lines.map((l) => [l.rawMaterialId, found.get(l.id)?.countNumber ?? null]));
      expect(byItem).toEqual({ salt: 'CC-2026-000012', sugar: null, milk: null });
      // Any count but a weekly one reads what was posted since its earliest line, and the weekly counts.
      expect(h.tx.cycleCountLine.findMany.mock.calls[0][0].where.count).toEqual({
        tenantId: T, branchId: B, id: { not: 'list' },
        OR: [
          { status: 'POSTED', postedAt: { gt: at('2026-09-22T07:30:00'), lte: at('2026-09-22T10:00:00') } },
          { status: { not: 'CANCELLED' }, notes: { startsWith: '[WEEKLY:' } },
        ],
      });

      // A buy list that counted milk after this one, found it matching and was posted: that is a count of milk.
      h.add({ id: 'next', countNumber: 'CC-2026-000014', status: 'POSTED', notes: BUY_LIST, createdAt: at('2026-09-22T08:30:00') }, [
        buyListLine('milk', at('2026-09-22T08:30:00'), 2500, 2500),
      ]);
      h.countOf('next').postedAt = at('2026-09-22T09:45:00');
      const again = await newerCounts(h.tx, list as any, at('2026-09-22T10:00:00'));
      expect(again.get(h.lineOf('list', 'milk').id)).toEqual({ reason: 'COUNTED_AGAIN', countNumber: 'CC-2026-000014', stationId: null, when: at('2026-09-22T08:30:00') });
      // Left alone by its own post, it replaces nothing.
      h.lineOf('next', 'milk').notes = leftAloneNotes(h.lineOf('next', 'milk').notes, at('2026-09-22T09:45:00'));
      expect((await newerCounts(h.tx, list as any, at('2026-09-22T10:00:00'))).get(h.lineOf('list', 'milk').id)).toBeUndefined();
    });

    it('a line with no time of its own was counted when its count was started', async () => {
      const h = shop({});
      h.add({ id: 'screen', countNumber: 'CC-2026-000014', status: 'OPEN', notes: 'Monthly', createdAt: at('2026-09-22T08:00:00') }, [
        { rawMaterialId: 'salt', expected: 1000, counted: 950 },
      ]);
      addWeekly(h);
      h.countOf('weekly').status = 'POSTED';
      h.countOf('weekly').postedAt = at('2026-09-22T08:30:00');
      const screen = { ...h.countOf('screen'), lines: h.lines.filter((l) => l.countId === 'screen') };
      expect([...(await newerCounts(h.tx, screen as any, at('2026-09-22T10:00:00'))).values()].map((n) => n.countNumber)).toEqual(['CC-2026-000009']);
      h.countOf('weekly').postedAt = at('2026-09-22T07:30:00');
      expect((await newerCounts(h.tx, screen as any, at('2026-09-22T10:00:00'))).size).toBe(0);
    });

    it('marks a line its post left alone, and says why in plain words', () => {
      const when = at('2026-09-22T09:00:00');
      expect(leftAloneNotes(null, when)).toBe('[LEFT:2026-09-22T01:00:00.000Z]');
      expect(leftAloneNotes('[AT:2026-09-21T23:30:00.000Z] REQ-20260922-001-01', when))
        .toBe('[AT:2026-09-21T23:30:00.000Z] [LEFT:2026-09-22T01:00:00.000Z] REQ-20260922-001-01');
      expect(wasLeftAlone(leftAloneNotes(null, when))).toBe(true);
      expect(wasLeftAlone('[AT:2026-09-21T23:30:00.000Z] REQ-20260922-001-01')).toBe(false);
      // A bracket further along is somebody's words, not a mark.
      expect(wasLeftAlone('Count again [LEFT:x]')).toBe(false);
      expect(leftAloneMessage('Salt', { reason: 'ADJUSTED', countNumber: 'CC-2026-000009', stationId: null, when }))
        .toBe('Left alone: Salt was already adjusted by count CC-2026-000009 (posted Sep 22).');
      expect(leftAloneMessage('Milk', { reason: 'COUNTED_AGAIN', countNumber: 'CC-2026-000011', stationId: 's-bar', when }))
        .toBe('Left alone: Milk was counted again later (CC-2026-000011, Sep 22).');
      expect(leftAloneMessage('Milk', null)).toBe('Left alone: Milk was counted again later.');
    });
  });
});
