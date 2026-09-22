import { buildSheet, sheetAmount, sheetDayLabel, sheetNotes, sheetRow, stationSheet } from './stock-sheet';
import type { SheetWindow } from './stock-day-balances';
import { movementsInWindow } from './sheet-movements';
import { stationItems, UNROUTED } from './station-items';

// The column readers and the catalogue have their own specs; here they are fixed, so the sheet's own rules are what is tested.
jest.mock('./sheet-movements', () => ({ movementsInWindow: jest.fn() }));
jest.mock('./station-items', () => ({ ...jest.requireActual('./station-items'), stationItems: jest.fn() }));

/**
 * The daily inventory sheet as the kitchen reads it and signs it: the row
 * arithmetic, the way each cell is written, the notes over the table, and the
 * whole response -- which must never carry a cost.
 */
describe('stock-sheet', () => {
  const ph = (wall: string) => new Date(`${wall}+08:00`);
  const moved = (inQty = 0, waste = 0, used = 0) => ({ in: inQty, waste, used });

  describe('sheetRow', () => {
    it('Adjust is what the movements do not explain', () => {
      expect(sheetRow(1200, moved(2000, 0, 1650), 1520)).toEqual({ beginning: 1200, in: 2000, waste: 0, used: 1650, ending: 1520, adjust: -30 });
      expect(sheetRow(500, moved(0, 100, 200), 250)).toMatchObject({ adjust: 50 });
      expect(sheetRow(500, moved(0, 100, 200), 200)).toMatchObject({ adjust: 0 });
    });

    it('a difference too small to be a real count is not an Adjust', () => {
      // Recipe multiples leave a thousandth here and there.
      expect(sheetRow(10, moved(0, 0, 3.3333), 6.6676).adjust).toBe(0);
      expect(sheetRow(1, moved(0, 0, 0), 1.0011).adjust).toBe(0.0011);
      // Relative to the balance: half a thousandth of 40 kg is 20 g.
      expect(sheetRow(40_000, moved(0, 0, 0), 40_019).adjust).toBe(0);
      expect(sheetRow(40_000, moved(0, 0, 0), 40_021).adjust).toBe(21);
    });

    it('with no saved Beginning, Beginning is worked back and nothing is adjusted', () => {
      expect(sheetRow(null, moved(2000, 50, 1650), 1520)).toEqual({ beginning: 1220, in: 2000, waste: 50, used: 1650, ending: 1520, adjust: 0 });
    });
  });

  describe('sheetAmount', () => {
    it('by the pack when the item was bought by the pack', () => {
      expect(sheetAmount(12_815, 'g', 1000, 'balance')).toBe('12 pk + 815 g');
      expect(sheetAmount(3000, 'ml', 1000, 'movement')).toBe('3 pk');
      expect(sheetAmount(999.99995, 'ml', 1000, 'balance')).toBe('1 pk');
      expect(sheetAmount(815, 'g', 1000, 'balance')).toBe('815 g');
    });

    it('in its unit otherwise, scaled up as the messages do', () => {
      expect(sheetAmount(1250, 'g', null, 'balance')).toBe('1.25 kg');
      expect(sheetAmount(58, 'serving', null, 'movement')).toBe('58 serving');
      expect(sheetAmount(2400, 'ml', 0, 'movement')).toBe('2.4 L');
    });

    it('a zero movement or Adjust is left blank; a zero balance still reads', () => {
      expect(sheetAmount(0, 'g', null, 'movement')).toBe('');
      expect(sheetAmount(0, 'g', 1000, 'adjust')).toBe('');
      expect(sheetAmount(-0, 'ml', 1000, 'adjust')).toBe('');
      expect(sheetAmount(0.00001, 'g', null, 'adjust')).toBe('');
      expect(sheetAmount(0, 'g', null, 'balance')).toBe('0 g');
      expect(sheetAmount(0, 'g', 1000, 'balance')).toBe('0 g');
    });

    /*
      "−8 pk + 586 g" read as minus 8 packs, plus 586 g. Adjust (and the
      owner's Difference) says which way in words, after the whole amount.
    */
    it('Adjust says short or extra after the whole amount, never a sign in front', () => {
      expect(sheetAmount(-8586, 'g', 1000, 'adjust')).toBe('8 pk + 586 g short');
      expect(sheetAmount(1200, 'ml', 1000, 'adjust')).toBe('1 pk + 200 ml extra');
      expect(sheetAmount(-2000, 'ml', 1000, 'adjust')).toBe('2 pk short');
      // Less than one pack, and no pack size: the unit alone, scaled up as the messages do.
      expect(sheetAmount(-586, 'g', 1000, 'adjust')).toBe('586 g short');
      expect(sheetAmount(999, 'ml', 1000, 'adjust')).toBe('999 ml extra');
      expect(sheetAmount(-30, 'g', null, 'adjust')).toBe('30 g short');
      expect(sheetAmount(30, 'g', null, 'adjust')).toBe('30 g extra');
      expect(sheetAmount(-1250, 'g', 0, 'adjust')).toBe('1.25 kg short');
      expect(sheetAmount(2, 'pc', null, 'adjust')).toBe('2 pc extra');
      for (const q of [-8586, 1200, -586, 30]) expect(sheetAmount(q, 'g', 1000, 'adjust')).not.toMatch(/^[−+-]/);
    });

    it('a balance below zero keeps its minus, over the packs and the rest together', () => {
      expect(sheetAmount(-2500, 'g', 1000, 'balance')).toBe('−(2 pk + 500 g)');
      expect(sheetAmount(-2000, 'g', 1000, 'balance')).toBe('−2 pk');
      expect(sheetAmount(-5, 'g', null, 'balance')).toBe('−5 g');
      expect(sheetAmount(-500, 'g', 1000, 'balance')).toBe('−500 g');
      // Above zero nothing carries a sign.
      expect(sheetAmount(30, 'g', null, 'movement')).toBe('30 g');
      expect(sheetAmount(2500, 'g', 1000, 'balance')).toBe('2 pk + 500 g');
    });
  });

  describe('sheetNotes', () => {
    const base: SheetWindow = {
      day: '2026-09-17', today: '2026-09-17', previousDay: '2026-09-16', nextDay: null, status: 'LIVE',
      from: ph('2026-09-16T21:30:05'), to: ph('2026-09-17T14:00:00'), begin: { day: '2026-09-16', takenAt: ph('2026-09-16T21:30:05') },
      end: null, closedBy: null, workedBack: null, missingSaveDay: null, closesAt: ph('2026-09-17T21:30:00'),
    };
    const notes = (over: Partial<SheetWindow>, extra: Partial<{ stillWaiting: number; anyAdjust: boolean; now: Date }> = {}) =>
      sheetNotes({ ...base, ...over }, { stillWaiting: 0, anyAdjust: false, now: ph('2026-09-17T14:00:00'), ...extra });

    it('LIVE says it closes with the last shift of the day, or that the closing is being saved', () => {
      // No clock time: the day closes when its last shift is closed, and only falls back to the job's clock.
      expect(notes({})).toEqual(['Running totals so far. This sheet closes when the last shift of the day is closed.']);
      expect(notes({}, { now: ph('2026-09-17T21:31:00') })).toEqual(["Running totals so far. Clerque is saving this sheet's closing balance now."]);
      expect(notes({ closesAt: null })).toEqual(['Running totals so far.']);
    });

    it('CLOSED says when, and who closed it: the last shift, or Clerque on the clock', () => {
      // A day its last shift closed before the fallback clock says so: closed at 10:19 AM with no word why read as a bug.
      expect(notes({ status: 'CLOSED', to: ph('2026-09-17T10:19:00'), closesAt: null, closedBy: 'SHIFT' }))
        .toEqual(["Closed at 10:19 AM, when the day's last shift was closed. Waste and batches since then go on the next sheet."]);
      expect(notes({ status: 'CLOSED', to: ph('2026-09-17T23:00:02'), closesAt: null, closedBy: 'CLOCK' }))
        .toEqual(["Closed at 11:00 PM by Clerque: the day's last shift was not closed by then, so it closed on the clock."]);
      // A past day with no save of its own (it runs to the next save) has nobody to name.
      expect(notes({ status: 'CLOSED', to: ph('2026-09-17T21:30:02'), closesAt: null })).toEqual(['Closed at 9:30 PM.']);
    });

    it('says why Beginning is worked back', () => {
      expect(notes({ workedBack: 'NO_SAVE', begin: null })[1]).toBe("No saved balance yet. Beginning is worked back from today's numbers.");
      expect(notes({ workedBack: 'TOO_OLD', begin: null, day: '2026-09-16' })[1])
        .toBe("The last saved balance is more than a week old. Beginning is worked back from this day's numbers.");
    });

    it('names a closing Clerque did not save, and the hours the sheet runs over instead', () => {
      expect(notes({ missingSaveDay: '2026-09-16', from: ph('2026-09-15T21:30:00') })[1])
        .toBe('Clerque did not save a closing balance on Sep 16. This sheet runs from Sep 15, 9:30 PM.');
      expect(notes({ day: '2026-09-16', missingSaveDay: '2026-09-16', status: 'CLOSED', from: ph('2026-09-15T21:30:00'), to: ph('2026-09-17T21:30:03'), closesAt: null })[1])
        .toBe('Clerque did not save a closing balance on Sep 16. This sheet runs from Sep 15, 9:30 PM to Sep 17, 9:30 PM.');
    });

    it('counts tickets still waiting (LIVE only), and explains Adjust when there is one', () => {
      expect(notes({}, { stillWaiting: 3 })[1]).toBe('3 items still at the kitchen or bar screen are not in Used yet.');
      expect(notes({}, { stillWaiting: 1 })[1]).toBe('1 item still at the kitchen or bar screen is not in Used yet.');
      expect(notes({ status: 'CLOSED', closesAt: null }, { stillWaiting: 3 })).toHaveLength(1);
      expect(notes({}, { anyAdjust: true })[1]).toBe(
        "Adjust is what the other columns don't explain: counts, corrections, transfers to another branch, or anything not recorded in Clerque.",
      );
    });
  });

  it('labels a day the way the sheet header does', () => {
    expect(sheetDayLabel('2026-09-17')).toBe('Thu, Sep 17, 2026');
  });

  describe('the whole sheet', () => {
    const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
    const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
    const item = (name: string, unit: string, category: string, isPrep: boolean, on: string[]) => ({ name, unit, category, isPrep, on: new Set(on) });

    function build(opts: { saves?: Array<{ day: string; takenAt: Date; rows: Record<string, number> }>; live?: Record<string, number>; now: Date }) {
      const saves = opts.saves ?? [];
      (movementsInWindow as jest.Mock).mockResolvedValue(new Map([
        ['rm-sauce', moved(2000, 0, 1650)],
        ['rm-milk', moved(3000, 250, 2100)],
        ['rm-tomato', moved(0, 0, 900)],
      ]));
      (stationItems as jest.Mock).mockResolvedValue({
        stations: [KITCHEN, BAR],
        items: new Map([
          ['rm-sauce', item('Tomato Sauce (ready)', 'g', 'INGREDIENT', true, ['s-kitchen'])],
          ['rm-milk', item('Fresh Milk', 'ml', 'INGREDIENT', false, ['s-kitchen', 's-bar'])],
          ['rm-tomato', item('Tomatoes', 'g', 'INGREDIENT', false, ['s-kitchen'])],
          ['rm-beans', item('Espresso Beans', 'g', 'INGREDIENT', false, ['s-bar'])],
          ['rm-foil', item('Foil', 'roll', 'KITCHEN_SUPPLY', false, ['s-kitchen'])],
          ['rm-flour', item('Flour', 'g', 'INGREDIENT', false, [UNROUTED])],
          ['rm-paper', item('Receipt paper', 'roll', 'OFFICE_SUPPLY', false, [])],
        ]),
      });
      const dayMatches = (day: string, cond: any) => cond === undefined
        || (typeof cond === 'string' ? day === cond : (cond.lt === undefined || day < cond.lt) && (cond.gt === undefined || day > cond.gt));
      const prisma: any = {
        branch: { findFirst: jest.fn(async () => ({ closesAt: '21:00', tenant: { name: 'Carolina Cafe' } })) },
        stockDayBalance: {
          findFirst: jest.fn(async ({ where, orderBy }: any) => {
            const found = saves.filter((s) => dayMatches(s.day, where.day)).sort((a, b) => (orderBy?.day === 'desc' ? b.day.localeCompare(a.day) : a.day.localeCompare(b.day)));
            return found[0] ? { day: found[0].day, takenAt: found[0].takenAt } : null;
          }),
          findMany: jest.fn(async ({ where }: any) => Object.entries(saves.find((s) => s.day === where.day)?.rows ?? {})
            // As Prisma returns a Decimal column: an object, turned into a number by the sheet.
            .map(([rawMaterialId, q]) => ({ rawMaterialId, endingQty: { toString: () => String(q), valueOf: () => q } }))),
        },
        rawMaterialInventory: {
          findMany: jest.fn(async () => Object.entries(opts.live ?? {}).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity }))),
        },
        orderItem: { count: jest.fn(async () => 3) },
        purchaseRequestLine: {
          findMany: jest.fn(async ({ where }: any) => [{ rawMaterialId: 'rm-milk', packSize: 1000 }].filter((p) => where.rawMaterialId.in.includes(p.rawMaterialId))),
        },
      };
      return prisma;
    }
    const ctx = { tenantId: 't1', station: KITCHEN, branch: { id: 'b1', name: 'Main' }, actorId: 'u1', actorLabel: 'Kitchen screen', isDevice: true };

    /** Every key anywhere in a JSON value. */
    const keysOf = (v: unknown): string[] => (Array.isArray(v)
      ? v.flatMap(keysOf)
      : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);

    it('a kitchen screen\'s LIVE sheet: its rows by section, shared items marked, numbers that foot, and never a cost', async () => {
      const prisma = build({
        saves: [{ day: '2026-09-16', takenAt: ph('2026-09-16T21:30:05'), rows: { 'rm-sauce': 1200, 'rm-milk': 4000, 'rm-foil': 3 } }],
        live: { 'rm-sauce': 1520, 'rm-milk': 4650, 'rm-tomato': 100, 'rm-foil': 3 },
        now: ph('2026-09-17T14:00:00'),
      });
      const sheet = await stationSheet(prisma, ctx, null, ph('2026-09-17T14:00:00'));

      expect(sheet).toMatchObject({
        shop: { name: 'Carolina Cafe' }, station: KITCHEN, branch: { id: 'b1', name: 'Main' }, title: 'KITCHEN INVENTORY',
        day: '2026-09-17', dayLabel: 'Thu, Sep 17, 2026', today: '2026-09-17', previousDay: '2026-09-16', previousDayLabel: 'Wed, Sep 16',
        nextDay: null, nextDayLabel: null, status: 'LIVE', stillWaiting: 3, showAdjust: true,
        window: { from: ph('2026-09-16T21:30:05').toISOString(), to: ph('2026-09-17T14:00:00').toISOString(), fromLabel: 'Sep 16, 9:30 PM', toLabel: 'Sep 17, 2:00 PM' },
      });
      expect(sheet.notes).toEqual([
        'Running totals so far. This sheet closes when the last shift of the day is closed.',
        '3 items still at the kitchen or bar screen are not in Used yet.',
        "Adjust is what the other columns don't explain: counts, corrections, transfers to another branch, or anything not recorded in Clerque.",
      ]);
      expect(sheet.sections.map((s) => [s.key, s.title, s.rows.map((r) => r.name)])).toEqual([
        ['PREMADE', 'Pre-made', ['Tomato Sauce (ready)']],
        ['INGREDIENTS', 'Ingredients', ['Fresh Milk', 'Tomatoes']],
        ['SUPPLIES', 'Supplies', ['Foil']],
        ['UNROUTED', 'No station set yet', ['Flour']],
      ]);
      const rows = sheet.sections.flatMap((s) => s.rows);
      const sauce = rows.find((r) => r.name === 'Tomato Sauce (ready)')!;
      expect(sauce).toMatchObject({
        beginning: 1200, in: 2000, waste: 0, used: 1650, ending: 1520, adjust: -30, packSize: null, alsoOn: [],
        cells: { beginning: '1.2 kg', in: '2 kg', waste: '', used: '1.65 kg', ending: '1.52 kg', adjust: '30 g short' },
      });
      const milk = rows.find((r) => r.name === 'Fresh Milk')!;
      expect(milk).toMatchObject({ alsoOn: ['Bar'], packSize: 1000, adjust: 0, cells: { beginning: '4 pk', in: '3 pk', waste: '250 ml', used: '2 pk + 100 ml', ending: '4 pk + 650 ml', adjust: '' } });
      // An item missing from the saved closing had none; one never stocked here reads 0.
      expect(rows.find((r) => r.name === 'Tomatoes')).toMatchObject({ beginning: 0, used: 900, ending: 100, adjust: 1000, cells: { adjust: '1 kg extra' } });
      expect(rows.find((r) => r.name === 'Flour')).toMatchObject({ beginning: 0, ending: 0, cells: { beginning: '0 g', in: '', ending: '0 g' } });
      for (const r of rows) expect(Math.abs(r.beginning + r.in - r.waste - r.used + r.adjust - r.ending)).toBeLessThan(0.0001);
      // Bar-only and office items are not on the kitchen's sheet.
      expect(rows.some((r) => r.name === 'Espresso Beans' || r.name === 'Receipt paper')).toBe(false);

      expect(keysOf(JSON.parse(JSON.stringify(sheet))).filter((k) => /cost|price|value/i.test(k))).toEqual([]);
      // The pack sizes are read without the pack's cost.
      expect(prisma.purchaseRequestLine.findMany.mock.calls[0][0].select).toEqual({ rawMaterialId: true, packSize: true });
      // The live Ending is the stock row, and the movements are read over exactly the window.
      expect(movementsInWindow).toHaveBeenCalledWith(prisma, 't1', 'b1', ph('2026-09-16T21:30:05'), ph('2026-09-17T14:00:00'));
    });

    it('a CLOSED day reads Ending from its own save, not the stock now, and counts no waiting tickets', async () => {
      const prisma = build({
        saves: [
          { day: '2026-09-16', takenAt: ph('2026-09-16T21:30:05'), rows: { 'rm-sauce': 1200 } },
          { day: '2026-09-17', takenAt: ph('2026-09-17T21:30:02'), rows: { 'rm-sauce': 1550 } },
        ],
        live: { 'rm-sauce': 1 },
        now: ph('2026-09-18T09:00:00'),
      });
      const sheet = await stationSheet(prisma, ctx, '2026-09-17', ph('2026-09-18T09:00:00'));
      expect(sheet).toMatchObject({ status: 'CLOSED', nextDay: '2026-09-18', nextDayLabel: 'Fri, Sep 18', stillWaiting: 0 });
      // Saved at 9:30 PM, before the 11:00 PM fallback: its last shift closed it, and the sheet says so.
      expect(sheet.notes[0]).toBe("Closed at 9:30 PM, when the day's last shift was closed. Waste and batches since then go on the next sheet.");
      expect(sheet.sections[0].rows[0]).toMatchObject({ beginning: 1200, ending: 1550, adjust: 0 });
      expect(prisma.rawMaterialInventory.findMany).not.toHaveBeenCalled();
      expect(prisma.orderItem.count).not.toHaveBeenCalled();
    });

    it('the owner\'s copy of every item: grouped by kind, with no station split and nothing called unrouted', async () => {
      const prisma = build({ live: {}, now: ph('2026-09-17T14:00:00') });
      const sheet = await buildSheet(prisma, { tenantId: 't1', branch: { id: 'b1', name: 'Main' }, station: null }, null, ph('2026-09-17T14:00:00'));
      expect(sheet.title).toBe('DAILY INVENTORY');
      expect(sheet.station).toBeNull();
      expect(sheet.showAdjust).toBe(false);
      expect(sheet.notes[1]).toBe("No saved balance yet. Beginning is worked back from today's numbers.");
      expect(sheet.sections.map((s) => [s.key, s.rows.map((r) => r.name)])).toEqual([
        ['PREMADE', ['Tomato Sauce (ready)']],
        ['INGREDIENTS', ['Espresso Beans', 'Flour', 'Fresh Milk', 'Tomatoes']],
        ['SUPPLIES', ['Foil', 'Receipt paper']],
      ]);
      expect(sheet.sections.flatMap((s) => s.rows).every((r) => r.alsoOn.length === 0)).toBe(true);
    });
  });
});
