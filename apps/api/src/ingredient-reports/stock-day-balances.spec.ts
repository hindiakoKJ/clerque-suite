import { BadRequestException } from '@nestjs/common';
import { closingDueAt, saveDue, sheetDays } from './end-of-day.scheduler';
import { closingSaves, dayAfter, dayBefore, saveClosingBalances, sheetWindow } from './stock-day-balances';

/**
 * The closing balance and the hours a daily sheet covers.
 *
 * A save is the Beginning of the next day's sheet, so it has to be written
 * once, read at one moment, and named for the same business day as the usage
 * message. A sheet runs from one save to the next; the cases here are the
 * ones a real shop meets: a normal day, a day closed by its last shift, the
 * hours after closing when nobody closed it, a save the job missed, the very
 * first day, and a long gap.
 */
describe('stock-day-balances', () => {
  /** An instant written as Manila wall-clock time. */
  const manila = (at: string) => new Date(`${at}+08:00`);

  describe('saveClosingBalances', () => {
    function build(stock: Array<{ tenantId: string; branchId: string; rawMaterialId: string; quantity: number }>) {
      const saved: any[] = [];
      const locks: string[] = [];
      const stockDayBalance = {
        findFirst: jest.fn(async ({ where }: any) => saved.find((r) => r.branchId === where.branchId && r.day === where.day) ?? null),
        createMany: jest.fn(async ({ data }: any) => { saved.push(...data); return { count: data.length }; }),
      };
      const tx = {
        stockDayBalance,
        rawMaterialInventory: {
          findMany: jest.fn(async ({ where }: any) => stock
            .filter((r) => r.tenantId === where.tenantId && r.branchId === where.branchId)
            .map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: r.quantity }))),
        },
        $executeRaw: jest.fn(async (_sql: TemplateStringsArray, key: string) => { locks.push(key); return 1; }),
      };
      const prisma: any = { stockDayBalance, $transaction: jest.fn(async (fn: (t: any) => unknown) => fn(tx)) };
      return { prisma, tx, saved, locks };
    }
    const STOCK = [
      { tenantId: 't1', branchId: 'b1', rawMaterialId: 'rm-milk', quantity: 4200 },
      { tenantId: 't1', branchId: 'b1', rawMaterialId: 'rm-beans', quantity: 950.5 },
      { tenantId: 't1', branchId: 'b2', rawMaterialId: 'rm-milk', quantity: 10 },
      { tenantId: 't2', branchId: 'b1', rawMaterialId: 'rm-other', quantity: 1 },
    ];

    it('saves every stock row of the branch, all with the one moment the clock gave when the stock was read', async () => {
      const h = build(STOCK);
      const readAt = manila('2026-09-16T21:30:07');
      const clock = jest.fn(() => readAt);
      expect(await saveClosingBalances(h.prisma, { id: 'b1', tenantId: 't1' }, '2026-09-16', clock)).toBe(2);
      expect(clock).toHaveBeenCalledTimes(1);
      expect(h.saved).toEqual([
        { tenantId: 't1', branchId: 'b1', rawMaterialId: 'rm-milk', day: '2026-09-16', endingQty: 4200, takenAt: readAt },
        { tenantId: 't1', branchId: 'b1', rawMaterialId: 'rm-beans', day: '2026-09-16', endingQty: 950.5, takenAt: readAt },
      ]);
      expect(h.tx.stockDayBalance.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
    });

    it('takes the lock keyed on the branch and the day', async () => {
      const h = build(STOCK);
      await saveClosingBalances(h.prisma, { id: 'b1', tenantId: 't1' }, '2026-09-16', () => new Date());
      expect(h.locks).toEqual(['stock-day-b1-2026-09-16']);
    });

    it('a second call for the same day returns null and writes nothing, even once the stock has moved', async () => {
      const h = build(STOCK);
      await saveClosingBalances(h.prisma, { id: 'b1', tenantId: 't1' }, '2026-09-16', () => manila('2026-09-16T21:30:00'));
      STOCK[0].quantity = 1;
      expect(await saveClosingBalances(h.prisma, { id: 'b1', tenantId: 't1' }, '2026-09-16', () => manila('2026-09-16T21:35:00'))).toBeNull();
      expect(h.tx.stockDayBalance.createMany).toHaveBeenCalledTimes(1);
      expect(h.saved[0].endingQty).toBe(4200);
      STOCK[0].quantity = 4200;
    });

    it('a run that queued behind another on the lock finds its rows and writes nothing', async () => {
      const h = build(STOCK);
      // The cheap look outside the lock saw nothing; by the time the lock was ours, the other run had saved.
      h.prisma.stockDayBalance.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'other-run' });
      expect(await saveClosingBalances(h.prisma, { id: 'b1', tenantId: 't1' }, '2026-09-16', () => new Date())).toBeNull();
      expect(h.tx.rawMaterialInventory.findMany).not.toHaveBeenCalled();
      expect(h.tx.stockDayBalance.createMany).not.toHaveBeenCalled();
    });

    it('a branch with no stock rows saves nothing', async () => {
      const h = build([]);
      expect(await saveClosingBalances(h.prisma, { id: 'b1', tenantId: 't1' }, '2026-09-16', () => new Date())).toBe(0);
      expect(h.tx.stockDayBalance.createMany).not.toHaveBeenCalled();
    });
  });

  describe('which business day an hour belongs to (one rule for the save, the message and the sheet)', () => {
    it('a 21:00 closing nobody closes by shift: the day runs from 23:00 the night before to 23:00, named for its own date', () => {
      expect(sheetDays('21:00', manila('2026-09-17T10:00:00'))).toMatchObject({
        running: '2026-09-17', runningDueAt: manila('2026-09-17T23:00:00'), last: '2026-09-16', lastInCatchUp: false,
      });
      expect(sheetDays('21:00', manila('2026-09-17T22:59:59')).running).toBe('2026-09-17');
      expect(sheetDays('21:00', manila('2026-09-17T23:00:00'))).toMatchObject({ running: '2026-09-18', last: '2026-09-17', lastInCatchUp: true });
      // Three hours after the fallback moment the catch-up is over.
      expect(sheetDays('21:00', manila('2026-09-18T02:00:00')).lastInCatchUp).toBe(true);
      expect(sheetDays('21:00', manila('2026-09-18T02:00:01')).lastInCatchUp).toBe(false);
      expect(saveDue('21:00', manila('2026-09-17T22:59:59'))).toBeNull();
      expect(saveDue('21:00', manila('2026-09-17T23:00:00'))?.day).toBe('2026-09-17');
      expect(saveDue('21:00', manila('2026-09-18T02:00:01'))).toBeNull();
    });

    it('a 01:00 closing names the evening before, whose trade it mostly is', () => {
      expect(sheetDays('01:00', manila('2026-09-18T02:30:00')).running).toBe('2026-09-17');
      expect(sheetDays('01:00', manila('2026-09-18T03:00:00'))).toMatchObject({ last: '2026-09-17', running: '2026-09-18' });
      expect(closingDueAt('01:00', '2026-09-17')).toEqual(manila('2026-09-18T03:00:00'));
      expect(saveDue('01:00', manila('2026-09-18T03:00:00'))?.day).toBe('2026-09-17');
    });

    it('a branch with no closing time is saved at 03:30 for the night before, and one Clerque cannot read is treated the same', () => {
      expect(closingDueAt(null, '2026-09-17')).toEqual(manila('2026-09-18T03:30:00'));
      expect(closingDueAt('9pm', '2026-09-17')).toEqual(manila('2026-09-18T03:30:00'));
      // Nothing is due all day: the last fallback (03:30 this morning) is past its catch-up window.
      expect(saveDue(null, manila('2026-09-17T23:55:00'))).toBeNull();
      expect(saveDue(null, manila('2026-09-18T03:29:59'))).toBeNull();
      expect(saveDue(null, manila('2026-09-18T03:30:00'))?.day).toBe('2026-09-17');
      expect(sheetDays(null, manila('2026-09-18T00:10:00'))).toMatchObject({ running: '2026-09-17', lastInCatchUp: false });
      expect(sheetDays(null, manila('2026-09-18T04:00:00'))).toMatchObject({ last: '2026-09-17', running: '2026-09-18', lastInCatchUp: true });
      expect(closingDueAt('21:00', '2026-09-17')).toEqual(manila('2026-09-17T23:00:00'));
    });

    it('the day before and after, across a month end', () => {
      expect(dayBefore('2026-10-01')).toBe('2026-09-30');
      expect(dayAfter('2026-09-30')).toBe('2026-10-01');
      expect(dayAfter('2026-12-31')).toBe('2027-01-01');
    });
  });

  describe('sheetWindow', () => {
    const BRANCH = 'b1';
    /** Saved closings: one row per day is enough, every row of a save shares takenAt. */
    function db(saves: Array<{ day: string; takenAt: string; branchId?: string }>) {
      const rows = saves.map((s) => ({ branchId: s.branchId ?? BRANCH, day: s.day, takenAt: manila(s.takenAt) }));
      const dayMatches = (day: string, cond: any) => cond === undefined
        || (typeof cond === 'string' ? day === cond : (cond.lt === undefined || day < cond.lt) && (cond.gt === undefined || day > cond.gt));
      return {
        stockDayBalance: {
          findFirst: jest.fn(async ({ where, orderBy }: any) => {
            const found = rows.filter((r) => r.branchId === where.branchId && dayMatches(r.day, where.day));
            if (orderBy?.day === 'asc') found.sort((a, b) => a.day.localeCompare(b.day));
            if (orderBy?.day === 'desc') found.sort((a, b) => b.day.localeCompare(a.day));
            return found[0] ? { day: found[0].day, takenAt: found[0].takenAt } : null;
          }),
        },
      } as any;
    }
    const at = (now: string) => ({ now: manila(now), days: sheetDays('21:00', manila(now)) });
    const window = (saves: Parameters<typeof db>[0], now: string, day: string | null = null) => {
      const t = at(now);
      return sheetWindow(db(saves), BRANCH, day, t.days, t.now);
    };

    it('LIVE: today runs from last night\'s saved closing to now, with when the job would close it', async () => {
      const w = await window([{ day: '2026-09-15', takenAt: '2026-09-15T23:00:04' }, { day: '2026-09-16', takenAt: '2026-09-16T21:10:05' }], '2026-09-17T14:00:00');
      expect(w).toMatchObject({
        day: '2026-09-17', today: '2026-09-17', previousDay: '2026-09-16', nextDay: null, status: 'LIVE',
        from: manila('2026-09-16T21:10:05'), to: manila('2026-09-17T14:00:00'),
        begin: { day: '2026-09-16' }, end: null, workedBack: null, missingSaveDay: null, closesAt: manila('2026-09-17T23:00:00'),
      });
    });

    it('CLOSED: a day with its own save runs between the two saves, and opens by default until the catch-up after its fallback is over', async () => {
      const saves = [{ day: '2026-09-16', takenAt: '2026-09-16T23:00:05' }, { day: '2026-09-17', takenAt: '2026-09-17T23:00:02' }];
      const tonight = await window(saves, '2026-09-17T23:40:00');
      expect(tonight).toMatchObject({
        day: '2026-09-17', today: '2026-09-18', nextDay: '2026-09-18', status: 'CLOSED',
        from: manila('2026-09-16T23:00:05'), to: manila('2026-09-17T23:00:02'), end: { day: '2026-09-17' }, closesAt: null,
      });
      // The next morning the running day opens, starting exactly where the closed one ended.
      const morning = await window(saves, '2026-09-18T08:00:00');
      expect(morning).toMatchObject({ day: '2026-09-18', status: 'LIVE', from: manila('2026-09-17T23:00:02') });
      // And the closed one still opens by its date.
      expect((await window(saves, '2026-09-18T08:00:00', '2026-09-17')).status).toBe('CLOSED');
    });

    it('a day its last shift closed at 20:40 is CLOSED from then, and the next day opens LIVE from that close', async () => {
      const saves = [{ day: '2026-09-16', takenAt: '2026-09-16T23:00:05' }, { day: '2026-09-17', takenAt: '2026-09-17T20:40:00' }];
      // Before the job's fallback moment (23:00), tonight's closed sheet still opens by default.
      const tonight = await window(saves, '2026-09-17T20:45:00');
      expect(tonight).toMatchObject({
        day: '2026-09-17', today: '2026-09-18', nextDay: '2026-09-18', status: 'CLOSED',
        from: manila('2026-09-16T23:00:05'), to: manila('2026-09-17T20:40:00'), end: { day: '2026-09-17' },
      });
      // The next day can be opened already, running from the close.
      const next = await window(saves, '2026-09-17T21:30:00', '2026-09-18');
      expect(next).toMatchObject({
        day: '2026-09-18', today: '2026-09-18', previousDay: '2026-09-17', nextDay: null, status: 'LIVE',
        from: manila('2026-09-17T20:40:00'), to: manila('2026-09-17T21:30:00'), begin: { day: '2026-09-17' }, closesAt: manila('2026-09-18T23:00:00'),
      });
      // Nothing further ahead.
      await expect(window(saves, '2026-09-17T21:30:00', '2026-09-19')).rejects.toThrow(new BadRequestException('That day has not started yet.'));
      // Through the fallback and its catch-up the closed day stays the default; the morning after, the running one.
      expect((await window(saves, '2026-09-17T23:30:00')).day).toBe('2026-09-17');
      expect(await window(saves, '2026-09-18T08:00:00')).toMatchObject({ day: '2026-09-18', status: 'LIVE', from: manila('2026-09-17T20:40:00') });
    });

    it('between the fallback moment and the save being written, the day is still the newest sheet', async () => {
      const w = await window([{ day: '2026-09-16', takenAt: '2026-09-16T23:00:05' }], '2026-09-17T23:02:00');
      expect(w).toMatchObject({ day: '2026-09-17', today: '2026-09-17', status: 'LIVE', nextDay: null, closesAt: manila('2026-09-17T23:00:00') });
    });

    it('a missed save: that day runs on to the next save, and the day after it starts from the one before', async () => {
      const saves = [{ day: '2026-09-15', takenAt: '2026-09-15T23:00:01' }, { day: '2026-09-17', takenAt: '2026-09-17T23:00:03' }];
      const missed = await window(saves, '2026-09-18T10:00:00', '2026-09-16');
      expect(missed).toMatchObject({
        day: '2026-09-16', status: 'CLOSED', from: manila('2026-09-15T23:00:01'), to: manila('2026-09-17T23:00:03'),
        begin: { day: '2026-09-15' }, end: { day: '2026-09-17' }, missingSaveDay: '2026-09-16', previousDay: '2026-09-15', nextDay: '2026-09-17',
      });
      const after = await window(saves, '2026-09-18T10:00:00', '2026-09-17');
      expect(after).toMatchObject({ from: manila('2026-09-15T23:00:01'), to: manila('2026-09-17T23:00:03'), missingSaveDay: '2026-09-16' });
    });

    it('the first day: no save before it, so Beginning is worked back over the hours since the day before closed', async () => {
      const w = await window([], '2026-09-17T14:00:00');
      expect(w).toMatchObject({
        day: '2026-09-17', status: 'LIVE', workedBack: 'NO_SAVE', begin: null, previousDay: null,
        from: manila('2026-09-16T23:00:00'), to: manila('2026-09-17T14:00:00'),
      });
      await expect(window([], '2026-09-17T14:00:00', '2026-09-16')).rejects.toThrow(BadRequestException);
      // The first saved day itself is worked back too, and there is no sheet before it.
      const first = await window([{ day: '2026-09-17', takenAt: '2026-09-17T23:00:00' }], '2026-09-18T09:00:00', '2026-09-17');
      expect(first).toMatchObject({ status: 'CLOSED', workedBack: 'NO_SAVE', previousDay: null, from: manila('2026-09-16T23:00:00') });
      await expect(window([{ day: '2026-09-17', takenAt: '2026-09-17T23:00:00' }], '2026-09-18T09:00:00', '2026-09-16'))
        .rejects.toThrow('There is no sheet before 2026-09-17');
    });

    it('a save over a week old is not used as Beginning', async () => {
      const w = await window([{ day: '2026-09-05', takenAt: '2026-09-05T23:00:00' }], '2026-09-17T14:00:00');
      expect(w).toMatchObject({ workedBack: 'TOO_OLD', begin: null, from: manila('2026-09-16T23:00:00'), missingSaveDay: null });
    });

    it('refuses a day that has not started, and one that is not a real date', async () => {
      await expect(window([], '2026-09-17T14:00:00', '2026-09-18')).rejects.toThrow(new BadRequestException('That day has not started yet.'));
      await expect(window([], '2026-09-17T14:00:00', '2026-02-30')).rejects.toThrow(new BadRequestException('The day has to be a real date (YYYY-MM-DD).'));
      await expect(window([], '2026-09-17T14:00:00', '17/09/2026')).rejects.toThrow(BadRequestException);
    });

    it('only reads its own branch\'s saves', async () => {
      const w = await window([{ day: '2026-09-16', takenAt: '2026-09-16T23:00:05', branchId: 'b2' }], '2026-09-17T14:00:00');
      expect(w.workedBack).toBe('NO_SAVE');
    });
  });

  it('closingSaves maps each saved day to when it was read', async () => {
    const findMany = jest.fn(async () => [{ day: '2026-09-16', takenAt: manila('2026-09-16T21:30:05') }]);
    const saves = await closingSaves({ stockDayBalance: { findMany } } as any, 'b1', ['2026-09-15', '2026-09-16']);
    expect([...saves]).toEqual([['2026-09-16', manila('2026-09-16T21:30:05')]]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { branchId: 'b1', day: { in: ['2026-09-15', '2026-09-16'] } }, distinct: ['day'] }));
  });
});
