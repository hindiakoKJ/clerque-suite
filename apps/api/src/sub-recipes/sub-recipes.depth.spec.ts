import { SubRecipesService } from './sub-recipes.service';

/**
 * How far each prep sits from a dish, and which dishes reach it.
 *
 * A dish reaches a prep three ways: its own recipe, a size's recipe, and an
 * add-on. Only the first was read, so a sauce that only "Extra sauce" or the
 * Large size used had no level, no station and no servings, and the station
 * screen never showed it as something plates are served from. And the levels
 * stopped at 2, so a base two steps from any dish could not be ordered in a
 * chain of three.
 */
describe('SubRecipesService.list — depth, and every way a dish uses a prep', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
  const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };

  const prepRow = (id: string, name: string, lines: Array<{ id: string; name: string; qty: number }>) => ({
    id, name, unit: 'g', costPrice: 0.1, batchYield: 1000, lowStockAlert: null,
    inventory: [{ quantity: 3000 }],
    subRecipeItems: lines.map((l) => ({ quantity: l.qty, rawMaterial: { id: l.id, name: l.name, unit: 'g', costPrice: 0.1 } })),
  });

  function build(opts: { rows: any[]; bom?: any[]; sizes?: any[]; addOns?: any[] }) {
    const prisma: any = {
      rawMaterial: { findMany: jest.fn().mockResolvedValue(opts.rows) },
      bomItem: { findMany: jest.fn().mockResolvedValue(opts.bom ?? []) },
      variantBomItem: { findMany: jest.fn().mockResolvedValue(opts.sizes ?? []) },
      modifierOptionIngredient: { findMany: jest.fn().mockResolvedValue(opts.addOns ?? []) },
      // No ticket is waiting at a kitchen or bar screen, so nothing is held.
      orderItem: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterialInventory: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(where.rawMaterialId.in.map((rawMaterialId: string) => ({ rawMaterialId, quantity: 3000 })))),
      },
    };
    return { svc: new SubRecipesService(prisma) as any, prisma };
  }
  const of = (rows: any[], id: string) => rows.find((r: any) => r.id === id);

  it('a prep only a SIZE uses is Level 1, with that size\'s station and servings', async () => {
    const { svc, prisma } = build({
      rows: [prepRow('syrup', 'Vanilla Syrup', [{ id: 'sugar', name: 'Sugar', qty: 500 }])],
      sizes: [{ rawMaterialId: 'syrup', quantity: 30, variant: { id: 'v-large', name: 'Large', product: { id: 'p-latte', name: 'Latte', category: { station: BAR } } } }],
    });
    const syrup = of(await svc.list(TENANT, BRANCH, null), 'syrup');
    expect(syrup).toMatchObject({ level: 1, depth: 1, station: BAR });
    expect(syrup.serves).toEqual([{ productId: 'v-large', productName: 'Latte (Large)', perServing: 30, servingsLeft: 100 }]);
    // Only live sizes of live dishes in this shop.
    expect(prisma.variantBomItem.findMany.mock.calls[0][0].where).toEqual({
      rawMaterialId: { in: ['syrup'] }, variant: { isActive: true, product: { tenantId: TENANT, isActive: true } },
    });
  });

  it('a prep only an ADD-ON uses is Level 1, routed by the dishes the add-on is attached to', async () => {
    const { svc, prisma } = build({
      rows: [prepRow('sauce', 'Garlic Sauce', [{ id: 'garlic', name: 'Garlic', qty: 200 }])],
      addOns: [{
        rawMaterialId: 'sauce', quantity: 50,
        option: { id: 'o-extra', name: 'Extra garlic sauce', group: {
          category: null,
          products: [
            { product: { isActive: true, category: { station: KITCHEN } } },
            // A retired dish on another station does not make the sauce shared.
            { product: { isActive: false, category: { station: BAR } } },
          ],
        } },
      }],
    });
    const sauce = of(await svc.list(TENANT, BRANCH, null), 'sauce');
    expect(sauce).toMatchObject({ level: 1, depth: 1, station: KITCHEN });
    expect(sauce.serves).toEqual([{ productId: 'o-extra', productName: 'Extra garlic sauce (add-on)', perServing: 50, servingsLeft: 60 }]);
    expect(prisma.modifierOptionIngredient.findMany.mock.calls[0][0].where).toEqual({
      rawMaterialId: { in: ['sauce'] }, quantity: { gt: 0 }, option: { isActive: true, group: { tenantId: TENANT, isActive: true } },
    });
  });

  it('an add-on group bound to a category takes that category\'s station', async () => {
    const { svc } = build({
      rows: [prepRow('foam', 'Cold Foam', [{ id: 'cream', name: 'Cream', qty: 300 }])],
      addOns: [{
        rawMaterialId: 'foam', quantity: 40,
        option: { id: 'o-foam', name: 'Cold foam', group: { category: { station: BAR }, products: [] } },
      }],
    });
    const foam = of(await svc.list(TENANT, BRANCH, null), 'foam');
    expect(foam).toMatchObject({ level: 1, station: BAR });
    expect(foam.serves[0].productName).toBe('Cold foam (add-on)');
  });

  /*
    Dishes and sizes pick the station; an add-on only when they name none.
    Before, an add-on's stations were merged with the dish's, so a sauce the
    kitchen makes for Wings came back as "both" the moment a bar-side add-on
    used it -- and showed on the bar screen with a Made button and bar alerts.
  */
  it('a dish recipe decides the station over an add-on on another station, and both still count as serves', async () => {
    const { svc } = build({
      rows: [prepRow('sauce', 'Garlic Sauce', [{ id: 'garlic', name: 'Garlic', qty: 200 }])],
      bom: [{ rawMaterialId: 'sauce', quantity: 40, product: { id: 'p-wings', name: 'Wings', category: { id: 'c', name: 'Food', station: KITCHEN } } }],
      addOns: [{ rawMaterialId: 'sauce', quantity: 50, option: { id: 'o', name: 'Dip', group: { category: { station: BAR }, products: [] } } }],
    });
    const sauce = of(await svc.list(TENANT, BRANCH, null), 'sauce');
    expect(sauce).toMatchObject({ level: 1, depth: 1, station: KITCHEN });
    expect(sauce.serves.map((s: any) => s.productName).sort()).toEqual(['Dip (add-on)', 'Wings']);
  });

  it('one catch-all "Add-ons" group on kitchen dishes AND bar drinks leaves the kitchen\'s sauce, and the tub behind it, with the kitchen', async () => {
    const { svc } = build({
      rows: [
        prepRow('ready', 'Sauce ready', [{ id: 'frozen', name: 'Sauce frozen', qty: 1000 }]),
        prepRow('frozen', 'Sauce frozen', [{ id: 'tom', name: 'Tomato', qty: 1000 }]),
      ],
      bom: [{ rawMaterialId: 'ready', quantity: 150, product: { id: 'p-spag', name: 'Spaghetti', category: { id: 'c', name: 'Pasta', station: KITCHEN } } }],
      addOns: [{
        rawMaterialId: 'ready', quantity: 50,
        option: { id: 'o-sauce', name: 'Extra sauce', group: {
          category: null,
          products: [
            { product: { isActive: true, category: { station: KITCHEN } } },
            { product: { isActive: true, category: { station: BAR } } },
          ],
        } },
      }],
    });
    const rows = await svc.list(TENANT, BRANCH, null);
    expect(of(rows, 'ready')).toMatchObject({ level: 1, depth: 1, station: KITCHEN });
    expect(of(rows, 'frozen')).toMatchObject({ depth: 2, station: KITCHEN });
    expect(of(rows, 'ready').serves.map((s: any) => s.productName).sort()).toEqual(['Extra sauce (add-on)', 'Spaghetti']);
  });

  it('a prep only a catch-all add-on uses, offered at both counters, has no single station', async () => {
    const { svc } = build({
      rows: [prepRow('sauce', 'Garlic Sauce', [{ id: 'garlic', name: 'Garlic', qty: 200 }])],
      addOns: [{
        rawMaterialId: 'sauce', quantity: 50,
        option: { id: 'o', name: 'Extra garlic', group: {
          category: null,
          products: [
            { product: { isActive: true, category: { station: KITCHEN } } },
            { product: { isActive: true, category: { station: BAR } } },
          ],
        } },
      }],
    });
    expect(of(await svc.list(TENANT, BRANCH, null), 'sauce')).toMatchObject({ level: 1, station: null });
  });

  it('two dishes on different stations still share the prep: no single station, whatever the add-ons say', async () => {
    const { svc } = build({
      rows: [prepRow('sauce', 'Garlic Sauce', [{ id: 'garlic', name: 'Garlic', qty: 200 }])],
      bom: [
        { rawMaterialId: 'sauce', quantity: 40, product: { id: 'p-wings', name: 'Wings', category: { id: 'c', name: 'Food', station: KITCHEN } } },
        { rawMaterialId: 'sauce', quantity: 20, product: { id: 'p-toast', name: 'Garlic toast', category: { id: 'c2', name: 'Bar bites', station: BAR } } },
      ],
      addOns: [{ rawMaterialId: 'sauce', quantity: 50, option: { id: 'o', name: 'Dip', group: { category: { station: KITCHEN }, products: [] } } }],
    });
    expect(of(await svc.list(TENANT, BRANCH, null), 'sauce').station).toBeNull();
  });

  it('counts depth three steps down, the nearest path winning, and null where no dish reaches', async () => {
    const { svc } = build({
      rows: [
        prepRow('ready', 'Sauce ready', [{ id: 'frozen', name: 'Sauce frozen', qty: 1000 }]),
        prepRow('frozen', 'Sauce frozen', [{ id: 'base', name: 'Tomato base', qty: 1000 }]),
        prepRow('base', 'Tomato base', [{ id: 'tom', name: 'Tomato', qty: 1000 }]),
        prepRow('orphan', 'Old Stock', [{ id: 'tom', name: 'Tomato', qty: 100 }]),
      ],
      bom: [{ rawMaterialId: 'ready', quantity: 150, product: { id: 'p', name: 'Spaghetti', category: { id: 'c', name: 'Pasta', station: KITCHEN } } }],
    });
    const rows = await svc.list(TENANT, BRANCH, null);
    expect(rows.map((r: any) => [r.id, r.depth])).toEqual(expect.arrayContaining([
      ['ready', 1], ['frozen', 2], ['base', 3], ['orphan', null],
    ]));
    // The old two-value level is unchanged: the base still reads as "feeds another prep".
    expect(of(rows, 'base').level).toBe(2);
  });

  it('a Level 3 base inherits the kitchen whatever the items are called', async () => {
    const chain = (names: [string, string, string]) => build({
      rows: [
        prepRow('ready', names[0], [{ id: 'frozen', name: names[1], qty: 1000 }]),
        prepRow('frozen', names[1], [{ id: 'base', name: names[2], qty: 1000 }]),
        prepRow('base', names[2], [{ id: 'tom', name: 'Tomato', qty: 1000 }]),
      // The database returns them by name.
      ].sort((a, b) => a.name.localeCompare(b.name)),
      bom: [{ rawMaterialId: 'ready', quantity: 150, product: { id: 'p', name: 'Spaghetti', category: { id: 'c', name: 'Pasta', station: KITCHEN } } }],
    });
    // Named so the base sorts first, then last.
    for (const names of [['Zz ready', 'Mm frozen', 'Aa base'], ['Aa ready', 'Mm frozen', 'Zz base']] as Array<[string, string, string]>) {
      const rows = await chain(names).svc.list(TENANT, BRANCH, null);
      expect(rows.map((r: any) => [r.id, r.station?.id ?? null]).sort()).toEqual([['base', 's-kitchen'], ['frozen', 's-kitchen'], ['ready', 's-kitchen']]);
    }
  });
});

/**
 * The station screen's chains: each Level 1 item this station shows, read down
 * its stages, worst first -- and every stage drawn once, inside its card.
 */
describe('SubRecipesService.stationPrep — prep chains', () => {
  const NOW = new Date('2026-09-17T04:00:00Z');
  const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
  const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
  const row = (over: any) => ({
    unit: 'g', kind: 'MAKE', movesFrom: null, batches: 1, limitedBy: null, rootLimitedBy: null, batchesWithPrep: 1,
    serves: [], components: [], level: null, depth: null, parLevel: null, station: KITCHEN, ...over,
  });
  const raw = (id: string, quantity: number) => ({ rawMaterialId: id, name: id, unit: 'g', quantity, onHand: 99999, isPrep: false });
  const BOARD = [
    // Fine: well above par.
    row({ id: 'aioli', name: 'Aioli', level: 1, depth: 1, onHand: 5000, parLevel: 500, components: [raw('egg', 10)] }),
    // Needs doing now: 2 plates left, a full frozen tub behind it.
    row({ id: 'ready', name: 'Tomato Sauce (ready)', level: 1, depth: 1, kind: 'MOVE', onHand: 300, parLevel: 600,
      serves: [{ productId: 'p', productName: 'Spaghetti', perServing: 150, servingsLeft: 2 }],
      components: [{ rawMaterialId: 'frozen', name: 'Tomato Sauce (frozen)', unit: 'g', quantity: 2000, onHand: 2000, isPrep: true }] }),
    row({ id: 'frozen', name: 'Tomato Sauce (frozen)', level: 2, depth: 2, onHand: 2000, components: [raw('tom', 2000)] }),
    // Routed to no station, and needs doing next: its backup is under par.
    row({ id: 'gravy', name: 'Gravy', level: 1, depth: 1, onHand: 4000, parLevel: 500, station: null,
      components: [{ rawMaterialId: 'stock', name: 'Stock', unit: 'g', quantity: 1000, onHand: 100, isPrep: true }] }),
    row({ id: 'stock', name: 'Stock', level: 2, depth: 2, onHand: 100, parLevel: 1000, station: null, components: [raw('bones', 500)] }),
    // The bar's: never on the kitchen screen.
    row({ id: 'breve', name: 'Breve Milk', level: 1, depth: 1, onHand: 10, parLevel: 400, station: BAR, components: [raw('milk', 1000)] }),
    // Made in advance but no dish reaches it: stays a tile.
    row({ id: 'old', name: 'Old Stock', onHand: 50 }),
  ];
  function build() {
    const prisma: any = {
      station: { findFirst: jest.fn(({ where }: any) => Promise.resolve([KITCHEN, BAR].find((s) => s.id === where.id) ? { ...[KITCHEN, BAR].find((s) => s.id === where.id), branchId: 'b1' } : null)) },
      branch: { findFirst: jest.fn(() => Promise.resolve({ id: 'b1', name: 'Main' })) },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new SubRecipesService(prisma);
    jest.spyOn(svc, 'list').mockResolvedValue(BOARD as never);
    return svc;
  }

  it('sends this station\'s chains and the unrouted ones, act-now first, then next, then fine', async () => {
    const res = await build().stationPrep('t1', KITCHEN.id, null, NOW);
    expect(res.chains.map((c) => [c.id, c.severity, c.assigned])).toEqual([
      ['ready', 'NOW', true],
      ['gravy', 'NEXT', false],
      ['aioli', 'OK', true],
    ]);
    expect(res.chains[0].headline).toBe('Level 1: 2 servings left — refill from Level 2 (Tomato Sauce (frozen)).');
    expect(res.chains[0].action).toMatchObject({ rawMaterialId: 'ready', label: 'Refilled Level 1', enabled: true });
  });

  it('marks each stage with the chain it is drawn in, and leaves the rest as tiles with their depth', async () => {
    const res = await build().stationPrep('t1', KITCHEN.id, null, NOW);
    const of = (id: string) => res.rows.find((r) => r.id === id)!;
    expect(of('ready')).toMatchObject({ inChain: 'ready', depth: 1 });
    expect(of('frozen')).toMatchObject({ inChain: 'ready', depth: 2 });
    expect(of('stock')).toMatchObject({ inChain: 'gravy', depth: 2 });
    expect(of('old')).toMatchObject({ inChain: null, depth: null });
    expect(res.rows.some((r) => r.id === 'breve')).toBe(false);
  });

  it('a kitchen chain whose Level 2 the bar makes: no working Made button on the kitchen screen, and the headline names the bar', async () => {
    const glaze = row({ id: 'glaze', name: 'Glaze', level: 1, depth: 1, onHand: 400, parLevel: 500,
      components: [{ rawMaterialId: 'syrup', name: 'Simple syrup', unit: 'ml', quantity: 500, onHand: 300, isPrep: true }, raw('butter', 100)] });
    // Poured straight into drinks, so it is the bar's own Level 1 -- fine by its own par.
    const syrup = row({ id: 'syrup', name: 'Simple syrup', unit: 'ml', level: 1, depth: 1, onHand: 300, parLevel: 200, station: BAR,
      components: [raw('sugar', 500), raw('water', 500)] });
    const svc = build();
    (svc.list as unknown as jest.Mock).mockResolvedValue([glaze, syrup]);

    const kitchen = await svc.stationPrep('t1', KITCHEN.id, null, NOW);
    expect(kitchen.chains.map((c) => c.id)).toEqual(['glaze']);
    expect(kitchen.chains[0].headline).toBe('Level 1: 400 g left. Level 2 (Simple syrup) is low — ask Bar for a batch.');
    expect(kitchen.chains[0].action).toMatchObject({ rawMaterialId: 'syrup', enabled: false, disabledReason: 'Bar makes this' });

    // The bar's own screen: its syrup is fine by its par, and the kitchen's glaze is not drawn there.
    const bar = await svc.stationPrep('t1', BAR.id, null, NOW);
    expect(bar.chains.map((c) => [c.id, c.severity, c.action])).toEqual([['syrup', 'OK', null]]);
  });

  it('says nothing about cost anywhere in what the screen gets', async () => {
    const res = await build().stationPrep('t1', KITCHEN.id, null, NOW);
    const keysOf = (v: unknown): string[] => (v && typeof v === 'object'
      ? Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [k, ...keysOf(x)])
      : []);
    expect(keysOf(res).filter((k) => /cost|price|value/i.test(k))).toEqual([]);
  });
});
