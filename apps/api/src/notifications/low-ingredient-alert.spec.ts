import { NotificationsScheduler } from './notifications.scheduler';

/**
 * The only ingredient warning in the system that goes and finds a person.
 *
 * Every other one is pull — the prep board, the menu ceiling, Check stock, the
 * days-of-cover report. All true, all only visible if someone decides to look.
 * So the milk runs out over a quiet weekend, the tile greys out on Monday, and
 * a customer is told no while the system had been correct the whole time.
 *
 * It had no test at all. That matters most for the part added last: a prepared
 * item is a RawMaterial row like any other, so before it was told apart, this
 * job would have cheerfully reported a sauce as OUT OF STOCK and told the shop
 * to go and buy it. In a rotation where the parked batch is empty by design
 * half the time, it would have said so every single night — which is how a
 * shop learns to ignore an alert.
 */
describe('NotificationsScheduler — the nightly ingredient alert', () => {
  const TENANT = 't1';

  type Row = {
    name: string; unit: string; lowStockAlert: number | null;
    qty: number; isPrep?: boolean;
    /** A dish uses it: the ready-to-use prep of a rotation. */
    usedByDish?: boolean;
    /** The ready-to-use prep it is parked behind, when there is one. */
    behind?: { lowStockAlert: number | null; usedByDish: boolean; isActive?: boolean; otherPreps?: number };
  };

  /** A ticket line waiting at a kitchen or bar screen: `uses` of one ingredient per unit. */
  type Ticket = { branchId: string; status: string; quantity: number; ingredient: string; uses: number };

  function build(rows: Row[], branches = [{ id: 'b1', name: 'Main' }], tickets: Ticket[] = []) {
    const sent: any[] = [];
    const idOf = (name: string) => `rm:${name}`;
    const prisma: any = {
      branch: { findMany: jest.fn().mockResolvedValue(branches) },
      /*
        Waiting lines, filtered the way the database would: by the order's
        status and branch as heldUsage asks for them. Each ticket is its own
        product so its recipe can name one ingredient.
      */
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(tickets
          .map((t, i) => ({ t, productId: `p${i}` }))
          .filter(() => where.usageOnReady === true && where.usagePostedAt === null)
          .filter(({ t }) => where.order.tenantId === TENANT && where.order.status.in.includes(t.status))
          .filter(({ t }) => !where.order.branchId || where.order.branchId.in.includes(t.branchId))
          .map(({ t, productId }) => ({
            productId, variantId: null, quantity: t.quantity, refundedQty: 0,
            modifiers: [], order: { branchId: t.branchId },
          })))),
      },
      bomItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve(tickets
          .map((t, i) => ({ productId: `p${i}`, rawMaterialId: idOf(t.ingredient), quantity: t.uses, rawMaterial: null }))
          .filter((b) => where.productId.in.includes(b.productId)))),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue(rows.map((r) => ({
          id: idOf(r.name), name: r.name, unit: r.unit, lowStockAlert: r.lowStockAlert,
          inventory: [{ quantity: r.qty }],
          subRecipeItems: r.isPrep ? [{ id: 'x' }] : [],
          bomItems: r.usedByDish ? [{ id: 'b' }] : [],
          usedInSubRecipes: r.behind ? [{
            quantity: 2000,
            parent: {
              isActive: r.behind.isActive ?? true,
              lowStockAlert: r.behind.lowStockAlert,
              bomItems: r.behind.usedByDish ? [{ id: 'b' }] : [],
              // This prep, plus any other prep stages the parent is made from.
              subRecipeItems: Array.from({ length: 1 + (r.behind.otherPreps ?? 0) }, () => ({ quantity: 2000, rawMaterial: { subRecipeItems: [{ id: 'p' }] } })),
            },
          }] : [],
        }))),
      },
    };
    const notifications: any = {
      create: jest.fn((d: any) => { sent.push(d); return Promise.resolve({}); }),
    };
    const svc = new NotificationsScheduler(prisma, notifications) as any;
    return { run: () => svc.lowIngredientProducer(TENANT), sent };
  }

  const MILK  = { name: 'Fresh Milk',  unit: 'ml', lowStockAlert: 2000, qty: 1500 };
  const BEANS = { name: 'Beans',       unit: 'g',  lowStockAlert: 1000, qty: 0    };
  const SAUCE = { name: 'Spag Sauce',  unit: 'g',  lowStockAlert: 500,  qty: 200, isPrep: true };

  it('says nothing at all when the shelf is fine', async () => {
    // A job that fires every night is a job nobody reads.
    const { run, sent } = build([{ ...MILK, qty: 9000 }]);
    await run();
    expect(sent).toHaveLength(0);
  });

  it('names what is out, and calls it an error rather than a warning', async () => {
    const { run, sent } = build([BEANS]);
    await run();
    expect(sent[0].kind).toBe('ERROR');
    expect(sent[0].title).toMatch(/1 ingredient out of stock/);
    expect(sent[0].body).toContain('OUT: Beans');
  });

  it('names what is merely low, with how much is left', async () => {
    const { run, sent } = build([MILK]);
    await run();
    expect(sent[0].kind).toBe('WARNING');
    expect(sent[0].body).toContain('Low: Fresh Milk — 1500 ml left');
  });

  // ── the part that would otherwise send someone shopping for their own sauce ─

  it('tells the shop to PREP a low sauce, not to buy it', async () => {
    const { run, sent } = build([SAUCE]);
    await run();
    expect(sent[0].body).toContain('To prep: Spag Sauce — 200 g left');
    expect(sent[0].body).not.toContain('OUT:');
    expect(sent[0].body).not.toContain('Low:');
  });

  it('does not call a low prep an out-of-stock emergency', async () => {
    // It reads as a shortage of something buyable, and it is not.
    const { run, sent } = build([{ ...SAUCE, qty: 0 }]);
    await run();
    expect(sent[0].kind).toBe('WARNING');
    expect(sent[0].title).toMatch(/1 item to prep/);
  });

  it('stays silent about a prep with no par level, however empty', async () => {
    /*
      The rotation case. A shop that keeps a ready tub and a parked one has the
      parked one at zero for half its life BY DESIGN — reporting it nightly
      would be noise that teaches everyone to dismiss the alert. Once someone
      says what low means for it, it is reported.
    */
    const { run, sent } = build([{ ...SAUCE, lowStockAlert: null, qty: 0 }]);
    await run();
    expect(sent).toHaveLength(0);
  });

  it('keeps the three lists apart when all three are true at once', async () => {
    const { run, sent } = build([BEANS, MILK, SAUCE]);
    await run();
    expect(sent[0].kind).toBe('ERROR');           // out of something wins
    expect(sent[0].body).toContain('OUT: Beans');
    expect(sent[0].body).toContain('Low: Fresh Milk');
    expect(sent[0].body).toContain('To prep: Spag Sauce');
  });

  it('counts the ingredients nobody is watching, so "nothing is low" can be read', async () => {
    // 56 of 75 unmonitored is not a shop with nothing to buy.
    const { run, sent } = build([
      BEANS,
      { name: 'Salt',  unit: 'g', lowStockAlert: null, qty: 900 },
      { name: 'Sugar', unit: 'g', lowStockAlert: null, qty: 900 },
    ]);
    await run();
    expect(sent[0].body).toMatch(/2 ingredients have no reorder level/);
  });

  it('keys the dedupe on the prep count too, so a new prep shortage gets through', async () => {
    /*
      Without the prep count in the key, a night where only the sauce changed
      produced the same key as the night before and the alert was swallowed —
      the shop would hear about the shortage on the day it stopped serving.
    */
    const a = build([BEANS]);
    const b = build([BEANS, SAUCE]);
    await a.run(); await b.run();
    expect(a.sent[0].dedupeKey).not.toBe(b.sent[0].dedupeKey);
  });

  // ── the sauce rotation alerts during service; the nightly alert leaves it alone ─

  it('leaves out a ready-to-use sauce with a par level, and the batch parked behind one', async () => {
    const READY  = { name: 'Teriyaki (ready)',  unit: 'ml', lowStockAlert: 400, qty: 100, isPrep: true, usedByDish: true };
    const FROZEN = { name: 'Teriyaki (frozen)', unit: 'ml', lowStockAlert: 2000, qty: 0, isPrep: true, behind: { lowStockAlert: 400, usedByDish: true } };
    const { run, sent } = build([READY, FROZEN]);
    await run();
    expect(sent).toHaveLength(0);
  });

  it('still names a prep behind a parent the rotation does not watch -- whichever condition is missing', async () => {
    const BASE = { name: 'Tomato Base', unit: 'g', lowStockAlert: 500, qty: 100, isPrep: true };
    const cases = [
      { lowStockAlert: 400, usedByDish: false },               // the parent has a par but no dish uses it
      { lowStockAlert: null, usedByDish: true },               // a dish uses the parent but it has no par
      { lowStockAlert: 400, usedByDish: true, isActive: false }, // the parent was switched off
      { lowStockAlert: 400, usedByDish: true, otherPreps: 1 },  // one of two prep stages behind it
    ];
    for (const behind of cases) {
      const { run, sent } = build([{ ...BASE, behind }]);
      await run();
      expect(sent[0]?.body).toContain('To prep: Tomato Base — 100 g left');
      expect(sent[0].link).toBe('/procure/batches');
    }
  });

  it('keeps the buy list as the link when something has to be bought', async () => {
    const { run, sent } = build([BEANS, SAUCE]);
    await run();
    expect(sent[0].link).toBe('/procure/requests');
  });

  // ── tickets still waiting at the kitchen or bar hold their ingredients ───

  it('counts milk promised to a waiting ticket at the branch as gone', async () => {
    // 3000 on the shelf is above the 2000 line; 1200 of it is for six lattes still at the bar.
    const { run, sent } = build(
      [{ ...MILK, qty: 3000 }],
      [{ id: 'b1', name: 'Main' }],
      [{ branchId: 'b1', status: 'PAID', quantity: 6, ingredient: 'Fresh Milk', uses: 200 }],
    );
    await run();
    expect(sent[0].body).toContain('Low: Fresh Milk — 1800 ml left');
  });

  it('calls it out when waiting tickets hold everything on the shelf', async () => {
    const { run, sent } = build(
      [{ ...MILK, qty: 1000 }],
      [{ id: 'b1', name: 'Main' }],
      [{ branchId: 'b1', status: 'COMPLETED', quantity: 6, ingredient: 'Fresh Milk', uses: 200 }],
    );
    await run();
    expect(sent[0].kind).toBe('ERROR');
    expect(sent[0].body).toContain('OUT: Fresh Milk');
  });

  it('holds nothing for a ticket at another branch or on a voided order', async () => {
    const branches = [{ id: 'b1', name: 'Main' }, { id: 'b2', name: 'Annex' }];
    const { run, sent } = build(
      [{ ...MILK, qty: 3000 }],
      branches,
      [
        // Held at the Annex only, so only the Annex reads low.
        { branchId: 'b2', status: 'PAID', quantity: 6, ingredient: 'Fresh Milk', uses: 200 },
        { branchId: 'b1', status: 'VOIDED', quantity: 6, ingredient: 'Fresh Milk', uses: 200 },
      ],
    );
    await run();
    expect(sent[0].body).toContain('Fresh Milk — 1800 ml left (Annex)');
    expect(sent[0].body).not.toContain('(Main)');
  });

  it('with nothing waiting, reads the shelf as before', async () => {
    const { run, sent } = build([{ ...MILK, qty: 3000 }], [{ id: 'b1', name: 'Main' }], []);
    await run();
    expect(sent).toHaveLength(0);
  });

  it('survives a database failure without taking the other nightly jobs down', async () => {
    const prisma: any = { branch: { findMany: jest.fn().mockRejectedValue(new Error('boom')) } };
    const notifications: any = { create: jest.fn() };
    const svc = new NotificationsScheduler(prisma, notifications) as any;
    await expect(svc.lowIngredientProducer(TENANT)).resolves.toBeUndefined();
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
