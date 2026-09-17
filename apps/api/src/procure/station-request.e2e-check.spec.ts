import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { ProcureService } from './procure.service';
import { RequestContext, StationRequestService } from './station-request.service';

/**
 * "Request what's running low", run against a REAL database.
 *
 * The unit spec proves the rules against a mock; a mock cannot prove the one
 * thing that matters most here: that the kitchen and the bar tapping in the
 * same instant make ONE list, send it ONCE and tell the owner ONCE. Only real
 * Postgres, with its real advisory lock and real transactions, can show that.
 * It also runs the real reads -- the month of usage, the recipe walk, the
 * case-insensitive name match -- so their queries are the ones the shop runs.
 *
 * Guarded on localhost and skipped when DATABASE_URL is anything else, the
 * same guard as prep-pipeline.e2e-check.spec.ts. It creates its own shop (not
 * a demo shop) and deletes it. Never point this at a database that is not
 * local.
 */
const url = process.env.DATABASE_URL ?? '';
const LOCAL = /@localhost[:/]/.test(url) || /@127\.0\.0\.1[:/]/.test(url);
const maybe = LOCAL ? describe : describe.skip;

maybe('Request what is running low — against the real database', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaClient() as any;
  const inventory = new InventoryService(prisma, { assertDateIsOpen: async () => undefined } as any);
  const procure = new ProcureService(prisma, inventory);
  const requests = new StationRequestService(prisma, procure);

  const tag = `station-request-e2e-${Date.now()}`;
  let tenantId = '';
  let branchId = '';
  let ownerId = '';
  let milkId = '';
  const ctx = (kind: 'KITCHEN' | 'BAR'): RequestContext => ({
    tenantId, branchId, branchName: 'Main', stationKind: kind, stationName: kind === 'KITCHEN' ? 'Kitchen' : 'Bar',
    actorId: ownerId, createdById: ownerId, byLabel: kind === 'KITCHEN' ? 'Kitchen screen' : 'Bar screen', source: 'STATION',
  });

  beforeAll(async () => {
    const tenant = await prisma.tenant.create({
      data: { name: tag, slug: tag, taxStatus: 'NON_VAT', businessType: 'COFFEE_SHOP', inventoryMode: 'RECIPE_BASED' },
      select: { id: true },
    });
    tenantId = tenant.id;
    branchId = (await prisma.branch.create({ data: { tenantId, name: 'Main' }, select: { id: true } })).id;
    ownerId = (await prisma.user.create({
      data: { tenantId, branchId: null, email: `${tag}@example.test`, passwordHash: 'x', name: 'Anne', role: 'BUSINESS_OWNER' },
      select: { id: true },
    })).id;
    // Milk well below its reorder level: both screens will want it.
    const milk = await inventory.createRawMaterial(tenantId, { name: 'Fresh Milk', unit: 'ml', costPrice: 0.1, lowStockAlert: 2000 } as any);
    milkId = milk.id;
    await prisma.rawMaterialInventory.create({ data: { tenantId, branchId, rawMaterialId: milkId, quantity: 500 } });
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.purchaseRequestLine.deleteMany({ where: { purchaseRequest: { tenantId } } });
      await prisma.purchaseRequest.deleteMany({ where: { tenantId } });
      await prisma.notification.deleteMany({ where: { tenantId } });
      await prisma.rawMaterialInventory.deleteMany({ where: { tenantId } });
      await prisma.rawMaterial.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.branch.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it('the kitchen and the bar tapping at once make one list, sent once, told once', async () => {
    const told = jest.spyOn(procure, 'tellTheOwners');
    const now = new Date();
    const [kitchen, bar] = await Promise.all([requests.apply(ctx('KITCHEN'), [], now), requests.apply(ctx('BAR'), [], now)]);

    expect([kitchen.outcome, bar.outcome].sort()).toEqual(['NOTHING_NEW', 'SENT']);
    expect(told).toHaveBeenCalledTimes(1);
    expect([...kitchen.sentTo, ...bar.sentTo]).toEqual(['Anne']);

    const rows = await prisma.purchaseRequest.findMany({ where: { tenantId }, include: { lines: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'SENT', branchId, createdById: ownerId, sentById: ownerId });
    expect(rows[0].sentAt).toBeInstanceOf(Date);
    // (2,000 - 500) x 2 = 3,000 ml, on one line.
    expect(rows[0].lines.map((l: any) => [l.rawMaterialId, Number(l.qtyRequested)])).toEqual([[milkId, 3000]]);
    // Both screens asked, whichever got the lock first: the one that found nothing new is still named.
    expect(rows[0].notes).toMatch(/^\[PLAN:\d{4}-\d{2}-\d{2}\] \[ASKED:(KITCHEN BAR|BAR KITCHEN)\]$/);
    told.mockRestore();
  });

  it('a new supply typed twice in different case is one item, with no cost', async () => {
    const first = await requests.apply(ctx('KITCHEN'), [{ newItem: { name: 'LIVE-B Tissue roll', category: 'KITCHEN_SUPPLY', unit: 'pc' }, qty: 10 }]);
    const again = await requests.apply(ctx('BAR'), [{ newItem: { name: 'live-b tissue ROLL', category: 'KITCHEN_SUPPLY', unit: 'pc' }, qty: 10 }]);
    expect(first.outcome).toBe('UPDATED');
    expect(again.outcome).toBe('NOTHING_NEW');
    const made = await prisma.rawMaterial.findMany({ where: { tenantId, name: { equals: 'LIVE-B Tissue roll', mode: 'insensitive' } } });
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ category: 'KITCHEN_SUPPLY', costPrice: null, lowStockAlert: null, unit: 'pc' });
    expect(first.added.map((a) => a.rawMaterialId)).toEqual([made[0].id]);
  });

  it('the closing fail-safe sees today\'s list and sends nothing more', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date());
    expect(await requests.sendAtClosingIfNothingSent({ id: branchId, tenantId, name: 'Main' }, { day: today, closedAt: new Date() }, new Date()))
      .toBe('ALREADY_SENT');
    expect(await prisma.purchaseRequest.count({ where: { tenantId } })).toBe(1);
  });

  it('the closing fail-safe is not fooled by a receipt, a sheet purchase or a short delivery\'s balance, and counts the owner\'s own Send', async () => {
    // Real Postgres: the notes filter is a LIKE, and the tag is read back exactly.
    const now = new Date();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(now);
    const annex = (await prisma.branch.create({ data: { tenantId, name: 'Annex' }, select: { id: true, name: true } }));
    const madeAlreadyBought = [
      '[RCPT:e2e-receipt] Puregold · OR 4471',
      'Recorded from an Excel upload (buy-lists.xlsx · 3f9c0a1b2c3d)',
      '[BALANCEOF:REQ-E2E-000] [ONTHEWAY:2026-09-17] Balance of REQ-E2E-000: still coming',
    ];
    for (const [i, notes] of madeAlreadyBought.entries()) {
      await prisma.purchaseRequest.create({
        data: { tenantId, branchId: annex.id, requestNumber: `REQ-E2E-00${i + 1}`, status: 'BOUGHT', sentAt: now, boughtAt: now, sentById: ownerId, createdById: ownerId, notes },
      });
    }
    const branch = { id: annex.id, tenantId, name: annex.name };
    expect(await requests.sendAtClosingIfNothingSent(branch, { day: today, closedAt: now }, now)).toBe('SENT');
    const sent = await prisma.purchaseRequest.findMany({ where: { tenantId, branchId: annex.id, notes: { contains: '[PLAN:' } } });
    expect(sent).toHaveLength(1);
    expect(sent[0].notes).toMatch(/^\[PLAN:\d{4}-\d{2}-\d{2}\] \[ASKED:CLOSING\]$/);
    // Its next run sees the list it just sent.
    expect(await requests.sendAtClosingIfNothingSent(branch, { day: today, closedAt: now }, new Date())).toBe('ALREADY_SENT');

    // A third branch whose owner pressed Send on the Procure screen: that list counts.
    const back = (await prisma.branch.create({ data: { tenantId, name: 'Back' }, select: { id: true, name: true } }));
    const open = await prisma.purchaseRequest.create({ data: { tenantId, branchId: back.id, requestNumber: 'REQ-E2E-010', createdById: ownerId } });
    const owned = await procure.sendRequest(tenantId, open.id, ownerId);
    expect(owned.notes).toMatch(/^\[PLAN:\d{4}-\d{2}-\d{2}\]$/);
    expect(await requests.sendAtClosingIfNothingSent({ id: back.id, tenantId, name: back.name }, { day: today, closedAt: new Date() }, new Date()))
      .toBe('ALREADY_SENT');
    expect(await prisma.purchaseRequest.count({ where: { tenantId, branchId: back.id } })).toBe(1);
  });
});
