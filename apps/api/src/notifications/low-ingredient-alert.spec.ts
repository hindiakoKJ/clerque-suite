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
  };

  function build(rows: Row[], branches = [{ id: 'b1', name: 'Main' }]) {
    const sent: any[] = [];
    const prisma: any = {
      branch: { findMany: jest.fn().mockResolvedValue(branches) },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue(rows.map((r) => ({
          name: r.name, unit: r.unit, lowStockAlert: r.lowStockAlert,
          inventory: [{ quantity: r.qty }],
          subRecipeItems: r.isPrep ? [{ id: 'x' }] : [],
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

  it('survives a database failure without taking the other nightly jobs down', async () => {
    const prisma: any = { branch: { findMany: jest.fn().mockRejectedValue(new Error('boom')) } };
    const notifications: any = { create: jest.fn() };
    const svc = new NotificationsScheduler(prisma, notifications) as any;
    await expect(svc.lowIngredientProducer(TENANT)).resolves.toBeUndefined();
    expect(notifications.create).not.toHaveBeenCalled();
  });
});
