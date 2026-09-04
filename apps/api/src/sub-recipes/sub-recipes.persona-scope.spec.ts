import { SubRecipesService } from './sub-recipes.service';
import { prepStationKindsFor, canPrepAtStation } from '@repo/shared-types';

/**
 * A barista preps the bar; a line cook preps the kitchen.
 *
 * Both jobs ran on the same account type, so every prep board showed every
 * prep and each person had to find their own among the other's. On a phone,
 * mid-service, that is how the wrong batch gets recorded — and a wrongly
 * attributed batch is worse than an unattributed one, because it reads as
 * fact: the kitchen's tomatoes booked against the bar's running cost look
 * exactly as authoritative as the truth.
 *
 * Two things this must NOT do, and both are tested below:
 *
 *   1. It must not narrow anything for the people who already work here. Every
 *      account today has either no persona or one of the twelve original ones,
 *      none of which name a station — so all of them keep seeing everything.
 *
 *   2. It must not hide a prep whose station is UNKNOWN. Null means the menu
 *      was never routed to stations, or the prep genuinely feeds both sides.
 *      Neither is a permission boundary, and a shop mid-setup would otherwise
 *      hand its cook a blank board and conclude the whole thing is broken.
 */
describe('Prep station scope — barista and line cook', () => {
  // ── the rule itself ───────────────────────────────────────────────────────

  it('scopes a barista to every station where drinks are made', () => {
    // COUNTER is in here because CS-1 and CS-2 create ONLY a counter — at
    // those shops the counter IS the bar. HOT_BAR / COLD_BAR are the
    // documented CS-5 split.
    expect(prepStationKindsFor('BARISTA')).toEqual(['COUNTER', 'BAR', 'HOT_BAR', 'COLD_BAR']);
  });

  it('scopes a line cook to the food stations', () => {
    // PASTRY_PASS is a real station — CS-5 creates one — and leaving it out
    // refused a bakery's pastry preps to the people who make them.
    expect(prepStationKindsFor('LINE_COOK')).toEqual(['KITCHEN', 'PASTRY_PASS']);
  });

  it('leaves every existing persona unscoped', () => {
    // The guarantee that makes this safe to ship: nothing narrows for anyone
    // until an owner deliberately hires someone as a barista or a cook.
    for (const key of ['OWNER_OPERATOR', 'CASHIER_BASIC', 'CASHIER_COOK',
                       'GENERAL_EMPLOYEE_DEFAULT', 'INVENTORY_MANAGER']) {
      expect(prepStationKindsFor(key)).toBeNull();
    }
  });

  it('leaves an account with no persona at all unscoped', () => {
    expect(prepStationKindsFor(null)).toBeNull();
    expect(prepStationKindsFor(undefined)).toBeNull();
  });

  it('treats an unknown persona as unscoped rather than as forbidden', () => {
    // Fail open, not closed. A persona key this build does not recognise —
    // a rollback, a newer tenant — must not lock the kitchen out of its work.
    expect(prepStationKindsFor('SOMETHING_NEWER')).toBeNull();
  });

  it('lets a barista prep the bar and refuses the kitchen', () => {
    expect(canPrepAtStation('BARISTA', 'BAR')).toBe(true);
    expect(canPrepAtStation('BARISTA', 'COLD_BAR')).toBe(true);
    expect(canPrepAtStation('BARISTA', 'KITCHEN')).toBe(false);
  });

  it('lets a cook prep the kitchen and refuses the bar', () => {
    expect(canPrepAtStation('LINE_COOK', 'KITCHEN')).toBe(true);
    expect(canPrepAtStation('LINE_COOK', 'BAR')).toBe(false);
  });

  it('covers the stations the layouts ACTUALLY create', () => {
    /*
      The first version read the station enum's comments instead of the floor
      plans, and got it wrong in both directions: no coffee-shop tier creates
      HOT_BAR or COLD_BAR, while CS-1 and CS-2 -- the smallest shops, the ones
      most likely to have exactly one barista -- create only a COUNTER, and
      CS-5 creates a PASTRY_PASS. A barista at a one-counter shop would have
      opened a blank board and been refused every batch.
    */
    expect(prepStationKindsFor('BARISTA')).toContain('COUNTER');
    expect(prepStationKindsFor('LINE_COOK')).toContain('PASTRY_PASS');
  });

  it('does not apply a scope written for a floor plan this shop does not have', () => {
    /*
      The backstop. Widening the lists fixed the shapes that exist today, but
      the lists are still a guess about how a shop is laid out — and a wrong
      guess hands somebody an empty screen and a refusal on every tap, which
      reads as "the feature is broken" rather than "you are not allowed".

      A shop with only a KITCHEN: a barista's stations do not overlap it at
      all, so the scope is meaningless here and is not applied.
    */
    expect(canPrepAtStation('BARISTA', 'KITCHEN', ['KITCHEN'])).toBe(true);
  });

  it('still enforces the scope when the shop HAS both sides', () => {
    // The backstop must not become a hole: where the persona's stations do
    // overlap the shop's, the rule applies exactly as before.
    expect(canPrepAtStation('BARISTA', 'KITCHEN', ['KITCHEN', 'BAR'])).toBe(false);
    expect(canPrepAtStation('LINE_COOK', 'BAR', ['KITCHEN', 'BAR'])).toBe(false);
  });

  it('ignores the backstop when the caller does not know the shop', () => {
    // Omitted or empty means "no information", which must not widen anything.
    expect(canPrepAtStation('BARISTA', 'KITCHEN')).toBe(false);
    expect(canPrepAtStation('BARISTA', 'KITCHEN', [])).toBe(false);
  });

  it('lets ANYONE prep something with no station', () => {
    // The setup-gap case. Refusing here would block a whole shop's prep on a
    // menu-routing task nobody has been asked to do.
    expect(canPrepAtStation('BARISTA', null)).toBe(true);
    expect(canPrepAtStation('LINE_COOK', null)).toBe(true);
  });

  // ── the board ─────────────────────────────────────────────────────────────

  const SAUCE = { id: 'sauce', name: 'Spaghetti Sauce' };
  const SYRUP = { id: 'syrup', name: 'White Sugar Syrup' };
  const HOUSE = { id: 'house', name: 'House Blend' };   // feeds nothing routed

  function buildList() {
    const st = (id: string, name: string, kind: string) => ({ id, name, kind });
    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([SAUCE, SYRUP, HOUSE].map((r) => ({
          id: r.id, name: r.name, unit: 'g', costPrice: 0.1, batchYield: 1000,
          lowStockAlert: null,
          inventory: [{ quantity: 1000 }],
          subRecipeItems: [{ quantity: 100,
            rawMaterial: { id: 'raw', name: 'Raw', unit: 'g', costPrice: 0.05 } }],
        }))),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'raw', quantity: 99999 }]),
      },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: SAUCE.id, quantity: 50, product: { id: 'p1', name: 'Spaghetti',
            category: { id: 'c1', name: 'Pasta', station: st('s-k', 'Kitchen', 'KITCHEN') } } },
          { rawMaterialId: SYRUP.id, quantity: 20, product: { id: 'p2', name: 'Latte',
            category: { id: 'c2', name: 'Drinks', station: st('s-b', 'Bar', 'BAR') } } },
          // Routed to nothing — the mid-setup case.
          { rawMaterialId: HOUSE.id, quantity: 10, product: { id: 'p3', name: 'Brew',
            category: { id: 'c3', name: 'Uncategorised', station: null } } },
        ]),
      },
    };
    return new SubRecipesService(prisma) as any;
  }

  const names = (rows: any[]) => rows.map((r) => r.name).sort();

  it('shows a barista the bar prep, not the kitchen prep', async () => {
    const rows = await buildList().list('t1', 'b1', 'BARISTA');
    expect(names(rows)).toEqual(['House Blend', 'White Sugar Syrup']);
  });

  it('shows a line cook the kitchen prep, not the bar prep', async () => {
    const rows = await buildList().list('t1', 'b1', 'LINE_COOK');
    expect(names(rows)).toEqual(['House Blend', 'Spaghetti Sauce']);
  });

  it('shows an unscoped account everything, exactly as before', async () => {
    const rows = await buildList().list('t1', 'b1', null);
    expect(names(rows)).toEqual(['House Blend', 'Spaghetti Sauce', 'White Sugar Syrup']);
  });

  it('never hides the unrouted prep from anyone', async () => {
    // Said separately because it is the failure that would look like a bug in
    // the feature rather than a gap in the setup.
    for (const persona of ['BARISTA', 'LINE_COOK', null]) {
      const rows = await buildList().list('t1', 'b1', persona);
      expect(names(rows)).toContain('House Blend');
    }
  });

  // ── the levels ────────────────────────────────────────────────────────────

  it('calls a prep that a DISH uses Level 1 — ready to use', async () => {
    const rows = await buildList().list('t1', 'b1', null);
    expect(rows.find((r: any) => r.name === 'Spaghetti Sauce').level).toBe(1);
  });
});

/**
 * The levels, standardised: 1 = ready to use, 2 = parked waiting to be thawed,
 * 3 = the raw ingredients already at the station.
 *
 * Derived from the recipes rather than typed in, so the shop names nothing and
 * the numbers cannot drift out of step with what is actually made from what.
 * Level 3 is not a row on the board on purpose — it is the component list on
 * each card.
 */
describe('Prep levels — derived, not configured', () => {
  const READY  = { id: 'ready',  name: 'Sauce (ready)' };
  const FROZEN = { id: 'frozen', name: 'Sauce (frozen)' };

  const SYRUP = { id: 'syrup', name: 'Bar Syrup' };

  /**
   * @param withBar also give the shop a BAR station and a prep on it.
   *
   * The scope backstop only applies where a persona's stations overlap the
   * shop's, so proving a barista is scoped OUT needs a shop that actually has
   * a bar. A kitchen-only shop deliberately scopes nobody.
   */
  function build(withBar = false) {
    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([
          ...(withBar ? [{
            id: SYRUP.id, name: SYRUP.name, unit: 'ml', costPrice: 0.05, batchYield: 1000,
            lowStockAlert: null, inventory: [{ quantity: 1000 }],
            subRecipeItems: [{ quantity: 100,
              rawMaterial: { id: 'sug', name: 'Sugar', unit: 'g', costPrice: 0.08 } }],
          }] : []),
          {
            id: READY.id, name: READY.name, unit: 'g', costPrice: 0.2, batchYield: 2000,
            lowStockAlert: null, inventory: [{ quantity: 2000 }],
            // The ready tub is thawed FROM the frozen one: same weight in,
            // same weight out, nothing added.
            subRecipeItems: [{ quantity: 2000,
              rawMaterial: { id: FROZEN.id, name: FROZEN.name, unit: 'g', costPrice: 0.2 } }],
          },
          {
            id: FROZEN.id, name: FROZEN.name, unit: 'g', costPrice: 0.2, batchYield: 2000,
            lowStockAlert: null, inventory: [{ quantity: 2000 }],
            subRecipeItems: [{ quantity: 1500,
              rawMaterial: { id: 'tom', name: 'Tomatoes', unit: 'g', costPrice: 0.12 } }],
          },
        ]),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: 'tom', quantity: 50000 },
          { rawMaterialId: 'sug', quantity: 50000 },
          { rawMaterialId: FROZEN.id, quantity: 2000 },
          { rawMaterialId: READY.id, quantity: 2000 },
        ]),
      },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([
          { rawMaterialId: READY.id, quantity: 200, product: { id: 'p1', name: 'Spaghetti',
            category: { id: 'c1', name: 'Pasta', station: { id: 's-k', name: 'Kitchen', kind: 'KITCHEN' } } } },
          ...(withBar ? [{ rawMaterialId: SYRUP.id, quantity: 20, product: { id: 'p2', name: 'Latte',
            category: { id: 'c2', name: 'Drinks', station: { id: 's-b', name: 'Bar', kind: 'BAR' } } } }] : []),
        ]),
      },
    };
    return new SubRecipesService(prisma) as any;
  }

  it('calls the tub a DISH eats from Level 1', async () => {
    const rows = await build().list('t1', 'b1');
    expect(rows.find((r: any) => r.id === READY.id).level).toBe(1);
  });

  it('calls the tub held behind it Level 2', async () => {
    // It feeds no dish — only the Level 1 tub — which is exactly what "parked,
    // waiting to be thawed" means in stock terms.
    const rows = await build().list('t1', 'b1');
    expect(rows.find((r: any) => r.id === FROZEN.id).level).toBe(2);
  });

  it('gives the parked tub the station of the tub it feeds', async () => {
    /*
      Station is derived from the PRODUCTS a prep feeds, and a Level 2 tub feeds
      no product — only the Level 1 tub in front of it. So every backup batch
      came back stationless and was visible to everyone: the kitchen's frozen
      sauce sat on the barista's board, which is exactly the confusion the
      scoping exists to remove. It belongs to whoever thaws it.
    */
    const rows = await build().list('t1', 'b1');
    expect(rows.find((r: any) => r.id === FROZEN.id).station.name).toBe('Kitchen');
  });

  it('so a barista does not see the kitchen’s parked tub', async () => {
    // A shop that HAS a bar: the barista's scope means something here, so both
    // kitchen tubs are hidden and only the bar prep remains.
    const rows = await build(true).list('t1', 'b1', 'BARISTA');
    expect(rows.map((r: any) => r.name)).toEqual(['Bar Syrup']);
  });

  it('but a kitchen-only shop scopes nobody out', async () => {
    /*
      The backstop, on the shape that would otherwise be worst: a shop with no
      bar at all. A barista there has no overlapping station, so applying the
      scope would blank the board and refuse every tap — which reads as a
      broken feature rather than a permission. The rule stands down instead.
    */
    const rows = await build(false).list('t1', 'b1', 'BARISTA');
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Sauce (frozen)', 'Sauce (ready)']);
  });

  it('and a cook sees both levels of their own rotation', async () => {
    const rows = await build().list('t1', 'b1', 'LINE_COOK');
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Sauce (frozen)', 'Sauce (ready)']);
  });

  it('still reads the thaw as a MOVE, so the wording stays honest', async () => {
    const rows = await build().list('t1', 'b1');
    const ready = rows.find((r: any) => r.id === READY.id);
    expect(ready.kind).toBe('MOVE');
    expect(ready.movesFrom).toBe('Sauce (frozen)');
  });
});
