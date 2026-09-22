import {
  HistoryDay, PlanInput, PlanItem, STARTING_AMOUNT_WHY, closingSentSince, historyFromUsage, isRaise, planRequest, plannedDayFor, roundQty,
  startingQty,
} from './station-request-plan';

/**
 * What a kitchen or bar tap asks the owner to buy for tomorrow. Thursday
 * 2026-09-17, planning Friday 2026-09-18: the same weekdays behind it are
 * Sep 11, Sep 4, Aug 28 and Aug 21.
 */
describe('station request plan', () => {
  const TODAY = '2026-09-17';
  const FRIDAY = '2026-09-18';

  const item = (over: Partial<PlanItem> & { id: string }): PlanItem => ({
    name: over.id, unit: 'g', category: 'INGREDIENT', isPrep: false, batchYield: null, lowStockAlert: null,
    available: 10_000, packSize: null, inActiveRecipe: true, ...over,
  });
  const day = (d: string, used: Record<string, number>): HistoryDay => ({ day: d, used: new Map(Object.entries(used)) });
  const plan = (over: Partial<PlanInput>) => planRequest({
    now: new Date('2026-09-17T15:00:00+08:00'), plannedDay: FRIDAY, today: TODAY,
    history: [], items: [], recipes: [], onTheWay: new Map(), existing: new Map(), ...over,
  });
  const line = (r: ReturnType<typeof plan>, id: string) => r.lines.find((l) => l.rawMaterialId === id);

  // ── what a day will use ────────────────────────────────────────────────────

  it('uses the mean of the same weekday when two or more of them were open', () => {
    const r = plan({
      items: [item({ id: 'milk', unit: 'ml', available: 0 })],
      // Two Fridays (2,000 and 2,800 ml) and a busy Wednesday that must not count.
      history: [day('2026-09-11', { milk: 2000 }), day('2026-09-04', { milk: 2800 }), day('2026-09-16', { milk: 9000 })],
    });
    // 2,400 x 1.25 = 3,000 ml
    expect(line(r, 'milk')).toMatchObject({ qty: 3000, shortBy: 3000, action: 'ADD' });
    expect(line(r, 'milk')!.why).toContain('Fridays use about 2.4 L');
  });

  it('falls back to the last seven days when fewer than two same weekdays were open', () => {
    const r = plan({
      items: [item({ id: 'milk', unit: 'ml', available: 0 })],
      history: [day('2026-09-11', { milk: 4000 }), day('2026-09-15', { milk: 1000 }), day('2026-09-16', { milk: 1400 })],
    });
    // The Friday is also one of the last seven days: (4,000 + 1,000 + 1,400) / 3 = 2,133.33 x 1.25 = 2,666.67 -> 2,700
    expect(line(r, 'milk')!.qty).toBe(2700);
    expect(line(r, 'milk')!.why[0]).toMatch(/^Lately about 2\.13 L a day$/);
  });

  it('with no history expects nothing', () => {
    const r = plan({ items: [item({ id: 'milk', unit: 'ml', available: 500, inActiveRecipe: false })] });
    expect(r.lines).toEqual([]);
  });

  it('says it is still learning with no sales history or under three recent days, not once the forecast has something', () => {
    const items = [item({ id: 'milk', unit: 'ml', available: 500 })];
    // Go-live: nothing sold yet. An empty list is not an all-clear.
    expect(plan({ items }).learning).toBe(true);
    // Day 2 and day 3: one and two open days lately.
    expect(plan({ items, history: [day('2026-09-16', { milk: 800 })] }).learning).toBe(true);
    expect(plan({ items, history: [day('2026-09-15', { milk: 800 }), day('2026-09-16', { milk: 900 })] }).learning).toBe(true);
    // Day 4: three open days.
    expect(plan({ items, history: [day('2026-09-14', { milk: 700 }), day('2026-09-15', { milk: 800 }), day('2026-09-16', { milk: 900 })] }).learning).toBe(false);
    // Two same weekdays make a pattern, however quiet the last week was.
    expect(plan({ items, history: [day('2026-09-11', { milk: 2000 }), day('2026-09-04', { milk: 2800 })] }).learning).toBe(false);
  });

  it('a weekday the shop was shut is not a day of zero sales', () => {
    // Sep 11 sold nothing: dropped, so only one Friday is left and the last week decides.
    const history = historyFromUsage([
      { day: '2026-09-11', rows: [{ rawMaterialId: 'milk', sold: 0, wasted: 300 }] },
      { day: '2026-09-04', rows: [{ rawMaterialId: 'milk', sold: 2000, wasted: 0 }] },
      { day: '2026-09-16', rows: [{ rawMaterialId: 'milk', sold: 800, wasted: 0 }] },
    ]);
    expect(history.map((h) => h.day)).toEqual(['2026-09-04', '2026-09-16']);
    const r = plan({ items: [item({ id: 'milk', unit: 'ml', available: 0 })], history });
    expect(line(r, 'milk')!.qty).toBe(1000);   // 800 x 1.25 from the one recent open day
  });

  it('counts sold and wasted, never what went into preps or was written off', () => {
    const [d] = historyFromUsage([{
      day: '2026-09-11',
      rows: [{ rawMaterialId: 'sugar', sold: 100, wasted: 20, intoPreps: 5000, writtenOff: 700 } as never],
    }]);
    expect(d.used.get('sugar')).toBe(120);
  });

  // ── preps push their demand down ───────────────────────────────────────────

  it('pushes a prep chain three deep onto its ingredients, summing a shared one', () => {
    const r = plan({
      items: [
        item({ id: 'A', name: 'Caramel Sauce', isPrep: true, batchYield: 10, available: 0 }),
        item({ id: 'B', name: 'Caramel Base', isPrep: true, batchYield: 4, available: 0, inActiveRecipe: true }),
        item({ id: 'C', name: 'Burnt Sugar', isPrep: true, batchYield: 6, available: 0 }),
        item({ id: 'sugar', name: 'White sugar', available: 0 }),
        item({ id: 'water', name: 'Water', unit: 'ml', available: 0 }),
      ],
      recipes: [
        { parentId: 'A', componentId: 'B', qty: 2 }, { parentId: 'A', componentId: 'sugar', qty: 100 },
        { parentId: 'B', componentId: 'C', qty: 3 }, { parentId: 'B', componentId: 'sugar', qty: 50 },
        { parentId: 'C', componentId: 'water', qty: 500 },
      ],
      history: [day('2026-09-11', { A: 20 }), day('2026-09-04', { A: 20 })],
    });
    // A: 20 x 1.25 = 25 -> 3 batches. B: 3 x 2 = 6 -> 2 batches. C: 2 x 3 = 6 -> 1 batch.
    expect(r.toMake).toEqual([
      { rawMaterialId: 'A', name: 'Caramel Sauce', batches: 3 },
      { rawMaterialId: 'B', name: 'Caramel Base', batches: 2 },
      { rawMaterialId: 'C', name: 'Burnt Sugar', batches: 1 },
    ]);
    expect(line(r, 'sugar')).toMatchObject({ qty: 400, shortBy: 400 });           // 3 x 100 + 2 x 50
    expect(line(r, 'sugar')!.why).toEqual(['For 3 batches of Caramel Sauce', 'For 2 batches of Caramel Base']);
    expect(line(r, 'water')).toMatchObject({ qty: 500 });
    expect(line(r, 'water')!.why).toEqual(['For 1 batch of Burnt Sugar']);
  });

  it('a prep with a par is made up to its par even with no sales', () => {
    const r = plan({
      items: [
        item({ id: 'syrup', name: 'White Sugar Syrup', unit: 'ml', isPrep: true, batchYield: 500, lowStockAlert: 1000, available: 200 }),
        item({ id: 'sugar', available: 0 }),
      ],
      recipes: [{ parentId: 'syrup', componentId: 'sugar', qty: 400 }],
    });
    expect(r.toMake).toEqual([{ rawMaterialId: 'syrup', name: 'White Sugar Syrup', batches: 2 }]);
    expect(line(r, 'sugar')!.qty).toBe(800);
  });

  it('preps whose recipes loop are left out and named', () => {
    const r = plan({
      items: [item({ id: 'X', isPrep: true, batchYield: 1, available: 0 }), item({ id: 'Y', isPrep: true, batchYield: 1, available: 0 })],
      recipes: [{ parentId: 'X', componentId: 'Y', qty: 1 }, { parentId: 'Y', componentId: 'X', qty: 1 }],
      history: [day('2026-09-11', { X: 5 }), day('2026-09-04', { X: 5 })],
    });
    expect(r.cycle.sort()).toEqual(['X', 'Y']);
    expect(r.toMake).toEqual([]);
  });

  it('a prep is never a line, even when it is out', () => {
    const r = plan({
      items: [item({ id: 'sauce', isPrep: true, batchYield: null, available: -50, lowStockAlert: 100 })],
      history: [day('2026-09-11', { sauce: 500 }), day('2026-09-04', { sauce: 500 })],
    });
    expect(r.lines).toEqual([]);
  });

  // ── buying ─────────────────────────────────────────────────────────────────

  it('asks for the bigger of the reorder rule and the forecast, not both added together', () => {
    const r = plan({
      items: [item({ id: 'milk', unit: 'ml', lowStockAlert: 1000, available: 800 })],
      history: [day('2026-09-11', { milk: 1000 }), day('2026-09-04', { milk: 1000 })],
    });
    // Low: (1,000 - 800) x 2 = 400. Forecast: 1,250 - 800 = 450. The sum would be 850 (900).
    expect(line(r, 'milk')).toMatchObject({ qty: 500, shortBy: 450 });
    expect(line(r, 'milk')!.why).toEqual(['Low now: 800 ml left, reorder at 1 L', 'Fridays use about 1 L']);
  });

  it('takes off what is already on the way, and says so', () => {
    const r = plan({
      items: [item({ id: 'milk', unit: 'ml', lowStockAlert: 1000, available: 800 })],
      history: [day('2026-09-11', { milk: 1000 }), day('2026-09-04', { milk: 1000 })],
      onTheWay: new Map([['milk', 200]]),
    });
    expect(line(r, 'milk')).toMatchObject({ qty: 300, shortBy: 250 });
    expect(line(r, 'milk')!.why).toContain('200 ml already on the way');
  });

  it('low but already coming in full asks for nothing and reports it', () => {
    const r = plan({
      items: [item({ id: 'eggs', name: 'Eggs', unit: 'pc', lowStockAlert: 30, available: 10, packSize: 30 })],
      onTheWay: new Map([['eggs', 60]]),
    });
    expect(r.lines).toEqual([]);
    expect(r.onTheWay).toEqual([{ rawMaterialId: 'eggs', name: 'Eggs', unit: 'pc', packSize: 30, qty: 60 }]);
  });

  it('an item exactly on its reorder level asks for the level', () => {
    const r = plan({ items: [item({ id: 'lids', unit: 'pc', lowStockAlert: 200, available: 200, inActiveRecipe: false })] });
    expect(line(r, 'lids')).toMatchObject({ qty: 200, shortBy: 200 });
  });

  it('a supply comes on the list only through its reorder level or by hand', () => {
    const quiet = plan({
      items: [item({ id: 'tissue', category: 'KITCHEN_SUPPLY', unit: 'roll', available: 0, inActiveRecipe: false })],
      history: [day('2026-09-11', { tissue: 10 }), day('2026-09-04', { tissue: 10 })],
    });
    expect(quiet.lines).toEqual([]);

    const low = plan({ items: [item({ id: 'tissue', category: 'KITCHEN_SUPPLY', unit: 'roll', available: 2, lowStockAlert: 4, inActiveRecipe: false })] });
    expect(line(low, 'tissue')!.qty).toBe(4);

    const byHand = plan({
      items: [item({ id: 'tissue', category: 'KITCHEN_SUPPLY', unit: 'roll', available: 0, inActiveRecipe: false })],
      extras: new Map([['tissue', 6]]), extraReason: 'Added by hand on the Kitchen screen',
    });
    expect(line(byHand, 'tissue')).toMatchObject({ qty: 6, shortBy: null, why: ['Added by hand on the Kitchen screen'] });
  });

  it('rounds to whole packs with a little slack', () => {
    expect(roundQty(1050, 'ml', 1000)).toBe(1000);   // 1.05 packs is one pack
    expect(roundQty(1150, 'ml', 1000)).toBe(2000);
    expect(roundQty(2100, 'ml', 1000)).toBe(2000);   // exactly the slack, no float drift into a third
    expect(roundQty(10, 'ml', 1000)).toBe(1000);     // never less than one pack
  });

  it('with no pack size, rounds grams to the next 100 (10 under 100) and pieces to whole ones', () => {
    expect(roundQty(450, 'g', null)).toBe(500);
    expect(roundQty(45, 'g', null)).toBe(50);
    expect(roundQty(400, 'g', null)).toBe(400);
    expect(roundQty(2.3, 'pc', null)).toBe(3);
    expect(roundQty(1.23, 'kg', null)).toBe(1.3);
    expect(roundQty(0, 'pc', null)).toBe(0);
  });

  it('an item out with no sales yet asks for one pack', () => {
    const withPack = plan({ items: [item({ id: 'oat', name: 'Oat milk', unit: 'ml', available: 0, packSize: 1000 })] });
    expect(line(withPack, 'oat')).toMatchObject({ qty: 1000, why: ['Out, no sales history yet'] });
  });

  /*
    A new shop: most items have never been bought through Clerque, so there is
    no pack size. These used to go under "Check these" and off the list, and a
    tap with 25 items out sent nothing at all.
  */
  it('out with no pack size either: still asked for, a round starting amount in its own unit, and the line says so', () => {
    const noPack = plan({ items: [
      item({ id: 'flour', name: 'All Purpose Flour', unit: 'g', available: 0 }),
      item({ id: 'oat', name: 'Oat milk', unit: 'ml', available: 0 }),
      item({ id: 'rice', name: 'Rice', unit: 'kg', available: 0 }),
      item({ id: 'egg', name: 'Eggs', unit: 'pc', available: 0 }),
    ] });
    expect(noPack.lines.map((l) => [l.rawMaterialId, l.qty, l.action])).toEqual([
      ['flour', 1000, 'ADD'], ['egg', 1, 'ADD'], ['oat', 1000, 'ADD'], ['rice', 1, 'ADD'],
    ]);
    for (const l of noPack.lines) expect(l.why).toEqual([STARTING_AMOUNT_WHY]);
    // Not a shortfall Clerque worked out: the buy list does not show "short by" for it.
    for (const l of noPack.lines) expect(l.shortBy).toBeNull();
    expect(STARTING_AMOUNT_WHY).toBe('Out. No pack size or sales history yet, so this is a starting amount. Add more with + if you need it.');
    // On the list, so nothing is left to "check".
    expect(noPack.check).toEqual([]);

    expect(startingQty('g')).toBe(1000);
    expect(startingQty(' ML ')).toBe(1000);
    expect(startingQty('kg')).toBe(1);
    expect(startingQty('L')).toBe(1);
    expect(startingQty('pack')).toBe(1);
  });

  it('a starting amount is only for an item that is out, on the menu, with nothing coming and nothing else to go on', () => {
    const one = (over: Partial<PlanItem>, more: Partial<PlanInput> = {}) =>
      plan({ items: [item({ id: 'oat', name: 'Oat milk', unit: 'ml', available: 0, ...over })], ...more });
    // Not on the menu: nothing to say about it.
    expect(one({ inActiveRecipe: false }).lines).toEqual([]);
    // Still some on the shelf.
    expect(one({ available: 50 }).lines).toEqual([]);
    // Already sent for: not asked for twice.
    expect(one({}, { onTheWay: new Map([['oat', 2000]]) }).lines).toEqual([]);
    // The owner's reorder level decides instead, as it always has.
    expect(line(one({ lowStockAlert: 500 }), 'oat')).toMatchObject({ qty: 1000, why: ['Low now: 0 ml left, reorder at 500 ml'] });
    // The cook said how much with +: that amount stands, in the cook's words.
    expect(line(one({}, { extras: new Map([['oat', 3000]]), extraReason: 'Added by hand on the Bar screen' }), 'oat'))
      .toMatchObject({ qty: 3000, why: ['Added by hand on the Bar screen'] });
    // Already on the list at the starting amount: left as it is, so a second tap tells nobody.
    expect(line(one({}, { existing: new Map([['oat', 1000]]) }), 'oat')).toMatchObject({ qty: 1000, action: 'KEEP' });
  });

  it('plans for today until 10:00 Manila, and for tomorrow from then', () => {
    expect(plannedDayFor(new Date('2026-09-17T09:59:00+08:00'))).toEqual({ today: TODAY, plannedDay: TODAY });
    expect(plannedDayFor(new Date('2026-09-17T10:00:00+08:00'))).toEqual({ today: TODAY, plannedDay: FRIDAY });
    expect(plannedDayFor(new Date('2026-09-17T23:30:00+08:00'))).toEqual({ today: TODAY, plannedDay: FRIDAY });
  });

  it('at closing, a list counts as sent from 10:00 the day before the day it plans for', () => {
    const at = (s: string) => new Date(s);
    // A 21:00 closing: tomorrow's list, so anything from 10:00 today asked for it.
    expect(closingSentSince(at('2026-09-17T21:30:00+08:00'), '2026-09-17', at('2026-09-17T21:00:00+08:00'))).toEqual(at('2026-09-17T10:00:00+08:00'));
    // A bar closing at 01:00 names the 17th: last night's own send (01:30 on the 17th) is before this, so tonight's still goes.
    expect(closingSentSince(at('2026-09-18T01:30:00+08:00'), '2026-09-17', at('2026-09-18T01:00:00+08:00'))).toEqual(at('2026-09-17T10:00:00+08:00'));
    // A closing at 08:00 (named the day before) whose catch-up runs past 10:00: its own 08:30 send still counts at 10:05.
    expect(closingSentSince(at('2026-09-17T10:05:00+08:00'), '2026-09-16', at('2026-09-17T08:00:00+08:00'))).toEqual(at('2026-09-17T08:00:00+08:00'));
    expect(closingSentSince(at('2026-09-17T21:30:00+08:00'), '2026-09-17')).toEqual(at('2026-09-17T10:00:00+08:00'));
    // A later day named by the caller is honoured: nothing sent before it counts.
    expect(closingSentSince(at('2026-09-17T21:30:00+08:00'), '2026-09-18')).toEqual(at('2026-09-18T00:00:00+08:00'));
  });

  // ── never lower, only raise with news ──────────────────────────────────────

  it('raises a line only by a pack, or a tenth with no pack known', () => {
    expect(isRaise(3000, 2000, 'ml', 1000)).toBe(true);
    expect(isRaise(2500, 2000, 'ml', 1000)).toBe(false);
    expect(isRaise(1100, 1000, 'g', null)).toBe(true);    // a tenth, and a 100 g step
    expect(isRaise(1050, 1000, 'g', null)).toBe(false);
    expect(isRaise(3, 5, 'pc', null)).toBe(false);         // never lower
    expect(isRaise(5, 5, 'pc', null)).toBe(false);
  });

  it('a line already asking for more is kept; one asking for less is raised', () => {
    const items = [item({ id: 'milk', unit: 'ml', available: 0, packSize: 1000 })];
    const history = [day('2026-09-11', { milk: 2400 }), day('2026-09-04', { milk: 2400 })];   // 3,000 ml -> 3 packs
    expect(line(plan({ items, history, existing: new Map([['milk', 5000]]) }), 'milk')).toMatchObject({ action: 'KEEP', existing: 5000 });
    expect(line(plan({ items, history, existing: new Map([['milk', 2000]]) }), 'milk')).toMatchObject({ action: 'RAISE', qty: 3000, existing: 2000 });
  });

  it('a hand-added amount is at least that much, not that much more', () => {
    const items = [item({ id: 'milk', unit: 'ml', available: 0, packSize: 1000 })];
    const existing = new Map([['milk', 3000]]);
    expect(line(plan({ items, existing, extras: new Map([['milk', 1]]) }), 'milk')!.action).toBe('KEEP');
    expect(line(plan({ items, existing, extras: new Map([['milk', 4000]]) }), 'milk')).toMatchObject({ action: 'RAISE', qty: 4000 });
  });
});
