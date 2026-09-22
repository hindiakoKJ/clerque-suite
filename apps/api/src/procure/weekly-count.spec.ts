import {
  cleanCounterName, countLineWords, countedOnSheet, decodeTagText, differenceWords, doneEntries, dueMessage, dueState, encodeTagText, isDue,
  lastWeeklySend, lineNotes, readLineTags, readWeekly, recountAskedBy, recountIds, weeklyCountBellBody, weeklyCountNote, weeklyCountNotes,
  whenLabel, withDone, withRecount, withRecountAskedBy,
} from './weekly-count';
import { appendNote, plainNotes } from './procure-notes';

/**
 * The weekly count's plain code: the tags it keeps in the notes columns, the
 * owner's words, when a count is due, and what the end-of-day message and
 * the owner's daily sheet say about it.
 */
describe('weekly count', () => {
  const KITCHEN = { id: 'ckitchen01', name: 'Kitchen' };
  const AT = new Date('2026-09-21T21:12:00+08:00');

  describe('tags', () => {
    it('a new count starts with its day and station, and reads back', () => {
      const notes = weeklyCountNotes('2026-09-21', KITCHEN);
      expect(notes).toBe('[WEEKLY:2026-09-21] [ST:ckitchen01] Weekly count, Kitchen');
      expect(readWeekly(notes)).toEqual({ day: '2026-09-21', stationId: 'ckitchen01' });
      // Only the front of the notes counts: a buy list's count, or a sentence mentioning a tag, is not a weekly count.
      expect(readWeekly('[REQ:REQ-20260921-001] Counted while building the buy list')).toBeNull();
      expect(readWeekly('Kitchen said [WEEKLY:2026-09-21]')).toBeNull();
      expect(readWeekly(null)).toBeNull();
    });

    it('a name with the characters the tags use survives the round trip; brackets are dropped on the way in', () => {
      for (const name of ['Joy', 'Ma|ry', 'A=B', 'Tess, Jo', '100% Ana', 'Ñoño Dela Cruz']) {
        expect(decodeTagText(encodeTagText(name))).toBe(name);
        const notes = withDone(weeklyCountNotes('2026-09-21', KITCHEN), { stationId: KITCHEN.id, at: AT, by: name });
        expect(doneEntries(notes)).toEqual([{ stationId: KITCHEN.id, at: AT, by: name }]);
        expect(readLineTags(lineNotes({ by: name, at: AT, stationId: KITCHEN.id }))).toEqual({ by: name, at: AT, stationId: KITCHEN.id });
        expect(recountAskedBy(withRecountAskedBy(notes, name))).toBe(name);
      }
      expect(cleanCounterName('  [Joy]  ')).toBe('Joy');
      expect(cleanCounterName('a,b|c=d')).toBe('a,b|c=d');
      expect(decodeTagText(encodeTagText(cleanCounterName('[x]|=,y')))).toBe('x|=,y');
      expect(cleanCounterName(42)).toBe('');
      expect([...cleanCounterName('x'.repeat(60))]).toHaveLength(40);
    });

    it('DONE keeps one entry per station, and the human history stays readable', () => {
      let notes = weeklyCountNotes('2026-09-21', KITCHEN);
      notes = withDone(notes, { stationId: 's-bar', at: AT, by: 'Ben' });
      notes = withDone(notes, { stationId: KITCHEN.id, at: AT, by: 'Joy' });
      notes = withDone(notes, { stationId: KITCHEN.id, at: new Date(AT.getTime() + 60_000), by: 'Jo' });
      notes = appendNote(notes, 'Kitchen sent by Jo, Sep 21 9:13 PM');
      expect(doneEntries(notes).map((d) => [d.stationId, d.by])).toEqual([['s-bar', 'Ben'], [KITCHEN.id, 'Jo']]);
      expect(notes.startsWith('[WEEKLY:')).toBe(true);
      expect(plainNotes(notes)).toBe('Weekly count, Kitchen · Kitchen sent by Jo, Sep 21 9:13 PM');
    });

    it('RECOUNT keeps at most 40 ids, the newest, and goes away when empty', () => {
      const ids = Array.from({ length: 45 }, (_, i) => `rm${i}`);
      const notes = withRecount(weeklyCountNotes('2026-09-21', KITCHEN), ids)!;
      expect(recountIds(notes)).toEqual(ids.slice(5));
      expect(recountIds(withRecount(notes, ['rm1', 'rm1', 'rm2']))).toEqual(['rm1', 'rm2']);
      const cleared = withRecount(notes, []);
      expect(cleared).not.toContain('[RECOUNT:');
      expect(readWeekly(cleared)).toEqual({ day: '2026-09-21', stationId: KITCHEN.id });
    });
  });

  describe('countLineWords', () => {
    it('says short, over and matches, scaling grams and millilitres', () => {
      expect(countLineWords('Milk', 'ml', 2100, 3400)).toBe('Milk: counted 2.1 L, book 3.4 L, short 1.3 L');
      expect(countLineWords('Sugar', 'g', 5200, 5000)).toBe('Sugar: counted 5.2 kg, book 5 kg, over 200 g');
      expect(countLineWords('Eggs', 'pc', 24, 24)).toBe('Eggs: counted 24 pc, book 24 pc, matches');
      // Under a gram is a match: the precision posting uses.
      expect(countLineWords('Salt', 'g', 100.0004, 100)).toBe('Salt: counted 100 g, book 100 g, matches');
      expect(countLineWords('Cream', 'ml', 0, 450)).toBe('Cream: counted 0 ml, book 450 ml, short 450 ml');
      expect(differenceWords('Milk', 'ml', 2100, 3400)).toBe('Milk short 1.3 L');
      expect(differenceWords('Eggs', 'pc', 2, 2)).toBe('Eggs matches');
    });
  });

  describe('isDue', () => {
    const at = (s: string) => new Date(`${s}+08:00`);

    it('never counted is due', () => {
      expect(isDue(null, at('2026-09-21T09:00:00'))).toBe(true);
      expect(dueState(null, at('2026-09-21T09:00:00'))).toEqual({ isDue: true, lastSentOn: null, daysSince: null });
      expect(dueMessage(null, true)).toBe('Weekly count is due. Nothing has been sent yet.');
    });

    it('six days is not due; seven is', () => {
      expect(dueState(at('2026-09-14T21:00:00'), at('2026-09-20T23:59:00'))).toEqual({ isDue: false, lastSentOn: '2026-09-14', daysSince: 6 });
      expect(dueState(at('2026-09-14T21:00:00'), at('2026-09-21T06:00:00'))).toEqual({ isDue: true, lastSentOn: '2026-09-14', daysSince: 7 });
      expect(dueMessage('2026-09-14', true)).toBe('Weekly count is due. Last sent Mon, Sep 14.');
      expect(dueMessage('2026-09-14', false)).toBeNull();
    });

    it('goes by the shop\'s calendar: a minute past Manila midnight is the next day, whatever UTC says', () => {
      // 23:59 Monday Manila is 15:59 UTC; 00:01 the next Monday Manila is 16:01 UTC the Sunday before.
      expect(dueState(at('2026-09-14T23:59:00'), at('2026-09-21T00:01:00'))).toMatchObject({ isDue: true, daysSince: 7 });
      expect(dueState(at('2026-09-14T23:59:00'), at('2026-09-20T23:59:00'))).toMatchObject({ isDue: false, daysSince: 6 });
      // Sent at 00:30 Tuesday Manila (Monday in UTC): Tuesday is its day.
      expect(dueState(at('2026-09-15T00:30:00'), at('2026-09-21T23:00:00'))).toMatchObject({ isDue: false, lastSentOn: '2026-09-15', daysSince: 6 });
    });
  });

  describe('the owner\'s bell', () => {
    const lines = [
      { name: 'Milk', unit: 'ml', counted: 2100, book: 3400 },
      { name: 'Eggs', unit: 'pc', counted: 22, book: 24 },
      { name: 'Sugar', unit: 'g', counted: 5200, book: 5000 },
      { name: 'Salt', unit: 'g', counted: 900, book: 1000 },
      { name: 'Oil', unit: 'ml', counted: 1990, book: 2000 },
      { name: 'Rice', unit: 'g', counted: 800, book: 800 },
    ];

    it('says first that nothing moved, then how many differ, the furthest off first, and what was not counted', () => {
      const body = weeklyCountBellBody({ counted: 23, total: 25, lines, notCounted: ['Cooking oil', 'Salt'], recount: false });
      expect(body).toBe(
        'Recorded. Nothing has moved. 23 of 25 counted, 5 differ. Milk short 1.3 L · Salt short 100 g · Eggs short 2 pc · +2 more. '
        + 'Not counted: Cooking oil, Salt.',
      );
      // The bell shows two lines of about 85 characters: "Nothing has moved" is always inside them.
      expect(body.indexOf('Nothing has moved.')).toBeLessThan(85);
    });

    it('says so when everything matches', () => {
      expect(weeklyCountBellBody({ counted: 2, total: 2, lines: [lines[5]], notCounted: [], recount: false }))
        .toBe('Recorded. Nothing has moved. 2 of 2 counted. All match the book.');
    });

    it('a full count that also answered a recount is told in full, and names what was recounted', () => {
      expect(weeklyCountBellBody({ counted: 25, total: 25, lines, notCounted: [], recount: false, recounted: ['Milk', 'Eggs'] })).toBe(
        'Recorded. Nothing has moved. 25 of 25 counted, 5 differ. Milk short 1.3 L · Salt short 100 g · Eggs short 2 pc · +2 more. '
        + 'Recounted: Milk, Eggs.',
      );
    });

    it('a recount names what was counted again, not how much of the sheet', () => {
      expect(weeklyCountBellBody({ counted: 2, total: 25, lines: [lines[0], lines[5]], notCounted: [], recount: true }))
        .toBe('Recorded. Nothing has moved. Counted again: Milk, Rice. 1 differs. Milk short 1.3 L.');
      expect(weeklyCountBellBody({ counted: 1, total: 25, lines: [lines[5]], notCounted: [], recount: true }))
        .toBe('Recorded. Nothing has moved. Counted again: Rice. All match the book.');
    });
  });

  it('whenLabel reads like the rest of the shop\'s messages', () => {
    expect(whenLabel(AT)).toBe('Sep 21 9:12 PM');
  });

  // ── reading counts ────────────────────────────────────────────────────────

  /** A count table that applies the filters these readers use. */
  function db(counts: any[], stations = 2) {
    const ok = (c: any, where: any) =>
      c.tenantId === where.tenantId && c.branchId === where.branchId
      && (!where.status?.in || where.status.in.includes(c.status))
      && (!where.notes?.startsWith || (c.notes ?? '').startsWith(where.notes.startsWith))
      && (!where.notes?.contains || (c.notes ?? '').includes(where.notes.contains))
      && (!where.createdAt?.lte || c.createdAt <= where.createdAt.lte)
      && (!where.updatedAt?.gte || c.updatedAt >= where.updatedAt.gte);
    return {
      station: { count: jest.fn(async () => stations) },
      cycleCount: { findMany: jest.fn(async ({ where }: any) => counts.filter((c) => ok(c, where))) },
    } as any;
  }
  const count = (over: any) => ({
    tenantId: 't1', branchId: 'b1', status: 'RECORDED', createdAt: new Date('2026-09-21T20:00:00+08:00'),
    updatedAt: new Date('2026-09-21T21:12:00+08:00'), lines: [], ...over,
  });
  const sentNotes = (station: string, at: Date, by = 'Joy') => withDone(weeklyCountNotes('2026-09-21', { id: station, name: station }), { stationId: station, at, by });
  const line = (rawMaterialId: string, counted: number, expected: number, at: Date) => ({
    rawMaterialId, countedQty: counted, expectedQty: expected, notes: lineNotes({ by: 'Joy', at, stationId: 's' }),
  });

  describe('lastWeeklySend', () => {
    it('finds the newest Send, of one station or of any', async () => {
      const d = db([
        count({ notes: sentNotes('s-kitchen', new Date('2026-09-14T21:00:00+08:00')) }),
        count({ notes: sentNotes('s-bar', new Date('2026-09-18T21:00:00+08:00'), 'Ben') }),
        count({ status: 'OPEN', notes: weeklyCountNotes('2026-09-21', KITCHEN) }),
      ]);
      expect(await lastWeeklySend(d, 't1', 'b1', 's-kitchen')).toMatchObject({ stationId: 's-kitchen', by: 'Joy' });
      expect(await lastWeeklySend(d, 't1', 'b1')).toMatchObject({ stationId: 's-bar', by: 'Ben' });
      expect(await lastWeeklySend(d, 't1', 'b1', 's-pastry')).toBeNull();
    });
  });

  describe('weeklyCountNote (the end-of-day sentence)', () => {
    const window = { from: new Date('2026-09-20T23:00:00+08:00'), to: new Date('2026-09-21T23:00:00+08:00'), day: '2026-09-21' };
    const sentAt = new Date('2026-09-21T21:12:00+08:00');

    it('on the day a count was sent: recorded, and how many items differ (an item both stations counted once, the newer)', async () => {
      const d = db([
        count({ notes: sentNotes('s-kitchen', sentAt), lines: [
          line('milk', 2100, 3400, new Date('2026-09-21T21:00:00+08:00')),
          line('eggs', 24, 24, new Date('2026-09-21T21:01:00+08:00')),
          line('sugar', 5200, 5000, new Date('2026-09-21T21:02:00+08:00')),
        ] }),
        count({ notes: sentNotes('s-bar', new Date('2026-09-21T22:00:00+08:00'), 'Ben'), lines: [
          // The bar counted the milk again later and found it matching.
          line('milk', 3400, 3400, new Date('2026-09-21T21:50:00+08:00')),
        ] }),
      ]);
      expect(await weeklyCountNote(d, 't1', 'b1', window)).toBe('Weekly count from Sep 21 is recorded. 1 item differs from the book.');
    });

    it('when everything matched', async () => {
      const d = db([count({ notes: sentNotes('s-kitchen', sentAt), lines: [line('eggs', 24, 24, sentAt)] })]);
      expect(await weeklyCountNote(d, 't1', 'b1', window)).toBe('Weekly count from Sep 21 is recorded. Every item matches the book.');
    });

    it('a week or more since the last Send, and never', async () => {
      const old = db([count({ notes: sentNotes('s-kitchen', new Date('2026-09-13T21:00:00+08:00')) })]);
      expect(await weeklyCountNote(old, 't1', 'b1', window)).toBe('No weekly count has been sent for 8 days.');
      const recent = db([count({ notes: sentNotes('s-kitchen', new Date('2026-09-15T21:00:00+08:00')) })]);
      expect(await weeklyCountNote(recent, 't1', 'b1', window)).toBeNull();
      expect(await weeklyCountNote(db([]), 't1', 'b1', window)).toBe('No weekly count has been sent yet.');
    });

    it('says nothing in a shop with no kitchen or bar screen', async () => {
      expect(await weeklyCountNote(db([], 0), 't1', 'b1', window)).toBeNull();
    });
  });

  describe('countedOnSheet (the owner\'s daily sheet)', () => {
    it('what a sent count found within the sheet\'s hours, the newer count of an item winning', async () => {
      const d = db([
        count({ notes: sentNotes('s-kitchen', AT), lines: [
          line('milk', 2100, 3400, new Date('2026-09-21T21:00:00+08:00')),
          line('eggs', 22, 24, new Date('2026-09-21T21:01:00+08:00')),
          // Counted before the sheet's hours began.
          line('rice', 800, 900, new Date('2026-09-20T22:00:00+08:00')),
        ] }),
        count({ notes: sentNotes('s-bar', AT, 'Ben'), lines: [line('milk', 3300, 3400, new Date('2026-09-21T21:30:00+08:00'))] }),
        // Still being counted: not on the sheet yet.
        count({ status: 'OPEN', notes: weeklyCountNotes('2026-09-21', KITCHEN), lines: [line('sugar', 1, 5, AT)] }),
      ]);
      const out = await countedOnSheet(d, 't1', 'b1', new Date('2026-09-20T23:00:00+08:00'), new Date('2026-09-21T23:00:00+08:00'));
      expect(Object.fromEntries([...out].map(([id, v]) => [id, [v.counted, v.difference]]))).toEqual({ milk: [3300, -100], eggs: [22, -2] });
    });
  });
});
