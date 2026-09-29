// Two-factor's library ships as an ES module jest cannot load; nothing here signs anyone in.
jest.mock('otplib', () => { class Stub { constructor(..._a: unknown[]) {} } return { TOTP: Stub, NobleCryptoPlugin: Stub, ScureBase32Plugin: Stub }; });

import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { KdsService } from '../kds/kds.service';
import { ShiftsService } from '../shifts/shifts.service';
import { InventoryService } from './inventory.service';
import { WarehouseService } from '../warehouse/warehouse.service';
import { ProcureService } from '../procure/procure.service';
import { JournalService } from '../accounting/journal.service';
import { AccountsService } from '../accounting/accounts.service';
import { copyShopSetup } from '../admin/copy-setup';
import { usedByDay } from '../ingredient-reports/daily-usage';

/**
 * One shop's stock, through a whole day, with the real services.
 *
 * A new shop is copied from the local Carolina test shop and routed the way
 * the live Cafe Carolina is: drinks made at the counter (no screen), food to
 * the Kitchen screen. Then stock is ADDED (a delivery), USED at the sale (a
 * counter drink) and at the ready tap (a kitchen plate), thrown out, counted
 * and RECONCILED, REPORTED (the day's usage), and REQUESTED (the buy list).
 * After every step the shelf is checked to the gram, and at the end every
 * accounting event must have posted and every journal entry must balance.
 *
 * Runs only against a LOCAL database; skipped in CI and never production.
 */
const url = process.env.DATABASE_URL ?? '';
const LOCAL = /@localhost[:/]/.test(url) || /@127\.0\.0\.1[:/]/.test(url);
const maybe = LOCAL ? describe : describe.skip;

maybe('A shop\'s stock through a whole day — real services, local database', () => {
  jest.setTimeout(300_000);

  let prisma: PrismaService;
  let orders: OrdersService;
  let kds: KdsService;
  let shifts: ShiftsService;
  let inventory: InventoryService;
  let warehouse: WarehouseService;
  let procure: ProcureService;
  let journal: JournalService;
  let close: () => Promise<void>;

  const tag = `cycle-check-${Date.now()}`;
  let tenantId = '';
  let branchId = '';
  let ownerId = '';
  let cashierId = '';
  let shiftId = '';
  let drink: { id: string; name: string; price: number; recipe: Map<string, number> };
  let plate: { id: string; name: string; price: number; recipe: Map<string, number> };
  let orderId = '';
  let kitchenId = '';
  let plateLineId = '';

  /** On the shelf now, per ingredient id. */
  const shelf = async (ids: string[]) => {
    const rows = await prisma.rawMaterialInventory.findMany({ where: { branchId, rawMaterialId: { in: ids } }, select: { rawMaterialId: true, quantity: true } });
    return new Map(rows.map((r) => [r.rawMaterialId, Number(r.quantity)] as const));
  };
  const recipeOf = async (productId: string) => new Map(
    (await prisma.bomItem.findMany({ where: { productId }, select: { rawMaterialId: true, quantity: true } }))
      .map((b) => [b.rawMaterialId, Number(b.quantity)] as const),
  );
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    prisma    = moduleRef.get(PrismaService);
    orders    = moduleRef.get(OrdersService);
    kds       = moduleRef.get(KdsService);
    shifts    = moduleRef.get(ShiftsService);
    inventory = moduleRef.get(InventoryService);
    warehouse = moduleRef.get(WarehouseService);
    procure   = moduleRef.get(ProcureService);
    journal   = moduleRef.get(JournalService);
    const accounts = moduleRef.get(AccountsService);
    close = () => moduleRef.close();

    const source = await prisma.tenant.findUnique({ where: { slug: 'carolina-test' }, select: { id: true } });
    if (!source) throw new Error('This check needs the local carolina-test shop.');

    // A new shop, the way the Console makes one, filled from the test shop.
    const tenant = await prisma.tenant.create({
      data: { name: tag, slug: tag, taxStatus: 'NON_VAT', branches: { create: { name: 'Main' } } },
      select: { id: true, branches: { select: { id: true } } },
    });
    tenantId = tenant.id;
    branchId = tenant.branches[0].id;
    await prisma.$transaction((tx) => copyShopSetup(tx, source.id, tenantId), { timeout: 120_000, maxWait: 10_000 });
    await accounts.seedDefaultAccounts(tenantId);
    ownerId = (await prisma.user.create({ data: { tenantId, branchId, email: `${tag}-owner@example.test`, passwordHash: 'x', name: 'Owner', role: 'BUSINESS_OWNER' }, select: { id: true } })).id;
    cashierId = (await prisma.user.create({ data: { tenantId, branchId, email: `${tag}-cashier@example.test`, passwordHash: 'x', name: 'Cashier', role: 'CASHIER' }, select: { id: true } })).id;

    // Routed like the live Cafe Carolina: drinks at the counter, food to a Kitchen screen.
    // Named apart from any Kitchen the copy brought, so the queue read below is this one.
    const kitchen = await prisma.station.create({ data: { tenantId, branchId, kind: 'KITCHEN', name: 'Kitchen (check)', hasKds: true }, select: { id: true } });
    kitchenId = kitchen.id;
    await prisma.category.updateMany({ where: { tenantId }, data: { stationId: null } });
    const pick = async (name: string) => {
      const p = await prisma.product.findFirst({ where: { tenantId, name, bomItems: { some: {} } }, select: { id: true, name: true, price: true, categoryId: true } });
      if (!p) throw new Error(`No product "${name}" with a recipe in the copy.`);
      return p;
    };
    const d = await pick('Americano ( Hot )');
    const pl = await pick('Garlic Chicken w/ Rice');
    await prisma.category.update({ where: { id: pl.categoryId! }, data: { stationId: kitchen.id } });
    drink = { id: d.id, name: d.name, price: Number(d.price), recipe: await recipeOf(d.id) };
    plate = { id: pl.id, name: pl.name, price: Number(pl.price), recipe: await recipeOf(pl.id) };

    shiftId = (await shifts.open(tenantId, cashierId, branchId, 1000)).id;
  });

  afterAll(async () => {
    await close?.();
  });

  const everything = () => [...new Set([...drink.recipe.keys(), ...plate.recipe.keys()])];

  it('ADDED: a delivery puts each ingredient on the shelf', async () => {
    let i = 0;
    const costs = new Map((await prisma.rawMaterial.findMany({ where: { id: { in: everything() } }, select: { id: true, costPrice: true } }))
      .map((r) => [r.id, r.costPrice != null && Number(r.costPrice) > 0 ? Number(r.costPrice) : 1] as const));
    for (const id of everything()) {
      const need = 10 * ((drink.recipe.get(id) ?? 0) * 2 + (plate.recipe.get(id) ?? 0)) + 100;
      // At the price on file: the receive guard (rightly) refuses a price ten times off it.
      await inventory.receiveRawMaterial(tenantId, id, {
        branchId, quantity: need, costPrice: costs.get(id), paymentMethod: 'CASH', referenceNumber: `${tag}-rcv-${++i}`,
      } as never);
    }
    const on = await shelf(everything());
    for (const id of everything()) {
      expect(on.get(id)).toBeCloseTo(10 * ((drink.recipe.get(id) ?? 0) * 2 + (plate.recipe.get(id) ?? 0)) + 100, 4);
    }
  });

  it('USED at the sale: a counter drink takes its ingredients at once; the kitchen plate waits for its tap', async () => {
    const before = await shelf(everything());
    const lines = [
      { product: drink, qty: 2 },
      { product: plate, qty: 1 },
    ];
    const total = lines.reduce((s, l) => s + l.product.price * l.qty, 0);
    const order = await orders.create(tenantId, cashierId, {
      clientUuid: randomUUID(), branchId, shiftId,
      items: lines.map((l) => ({
        productId: l.product.id, productName: l.product.name, unitPrice: l.product.price, quantity: l.qty,
        discountAmount: 0, vatAmount: 0, lineTotal: l.product.price * l.qty, isVatable: false,
      })),
      payments: [{ method: 'CASH', amount: total }],
      discounts: [], subtotal: total, discountAmount: 0, vatAmount: 0, totalAmount: total,
      isPwdScDiscount: false, createdAt: new Date().toISOString(),
    } as never, { callerRole: 'CASHIER' } as never);
    orderId = (order as { id: string }).id;
    plateLineId = (await prisma.orderItem.findFirstOrThrow({ where: { orderId, productId: plate.id }, select: { id: true } })).id;

    const after = await shelf(everything());
    for (const id of everything()) {
      // Only the drink's share leaves now; the plate's waits for the kitchen.
      expect(near(after.get(id)!, before.get(id)! - (drink.recipe.get(id) ?? 0) * 2)).toBe(true);
    }
    const waiting = await prisma.orderItem.findUniqueOrThrow({ where: { id: plateLineId }, select: { usageOnReady: true, usagePostedAt: true } });
    expect(waiting).toMatchObject({ usageOnReady: true, usagePostedAt: null });
  });

  it('the plate is on the Kitchen screen, and the drink is on no screen', async () => {
    const queue = await kds.listStationQueue(tenantId, kitchenId) as unknown as Array<{ id?: string; productId?: string; product?: { id: string } }>;
    const ids = JSON.stringify(queue);
    expect(ids).toContain(plateLineId);
    expect(ids).not.toContain(drink.id);
  });

  it('USED at the ready tap: the plate takes its ingredients when the kitchen taps it', async () => {
    const before = await shelf(everything());
    await kds.bumpReady(tenantId, plateLineId, { userId: ownerId });
    const after = await shelf(everything());
    for (const id of everything()) {
      expect(near(after.get(id)!, before.get(id)! - (plate.recipe.get(id) ?? 0))).toBe(true);
    }
    const done = await prisma.orderItem.findUniqueOrThrow({ where: { id: plateLineId }, select: { usagePostedAt: true } });
    expect(done.usagePostedAt).not.toBeNull();
  });

  it('WASTED: a write-off takes it off the shelf', async () => {
    const id = [...drink.recipe.keys()][0];
    const before = (await shelf([id])).get(id)!;
    await inventory.writeOffRawMaterial(tenantId, id, ownerId, { branchId, quantity: 5, reasonCode: 'DAMAGE' } as never);
    expect((await shelf([id])).get(id)).toBeCloseTo(before - 5, 4);
  });

  it('RECONCILED: the weekly count sets the shelf to what was counted', async () => {
    const id = [...drink.recipe.keys()][0];
    const count = await warehouse.startCycleCount(tenantId, branchId, ownerId) as unknown as { id: string; lines: Array<{ id: string; rawMaterialId: string; expectedQty: unknown }> };
    const line = count.lines.find((l) => l.rawMaterialId === id)!;
    const counted = Number(line.expectedQty) - 3;
    await warehouse.setLineCount(tenantId, line.id, counted);
    await warehouse.postCycleCount(tenantId, count.id, ownerId);
    expect((await shelf([id])).get(id)).toBeCloseTo(counted, 4);
  });

  it('REPORTED: the day\'s usage shows what was sold and what was thrown out', async () => {
    const from = new Date(Date.now() - 24 * 3600_000);
    const usage = await usedByDay(prisma, tenantId, branchId, from, new Date(Date.now() + 60_000));
    const id = [...drink.recipe.keys()][0];
    const row = usage.rows.find((r) => r.rawMaterialId === id)!;
    const expectedSold = (drink.recipe.get(id) ?? 0) * 2 + (plate.recipe.get(id) ?? 0);
    expect(row.sold).toBeCloseTo(expectedSold, 4);
    expect(row.writtenOff + row.wasted).toBeCloseTo(5, 4);
  });

  it('REQUESTED: an ingredient under its reorder level goes on the buy list', async () => {
    const id = [...plate.recipe.keys()][0];
    const now = (await shelf([id])).get(id)!;
    await prisma.rawMaterial.update({ where: { id }, data: { lowStockAlert: now + 50 } });
    const res = await procure.pullLowStock(tenantId, branchId, ownerId);
    const req = await prisma.purchaseRequest.findUniqueOrThrow({ where: { id: res.requestId }, select: { lines: { select: { rawMaterialId: true, qtyRequested: true } } } });
    const line = req.lines.find((l) => l.rawMaterialId === id);
    expect(line).toBeDefined();
    expect(Number(line!.qtyRequested)).toBeGreaterThan(0);
  });

  it('BOOKED: every stock movement posted to the books, and every entry balances', async () => {
    await journal.processAllPending(tenantId);
    const events = await prisma.accountingEvent.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } });
    const byStatus = Object.fromEntries(events.map((e) => [e.status, e._count._all]));
    expect(byStatus.FAILED ?? 0).toBe(0);
    expect(byStatus.PENDING ?? 0).toBe(0);

    const entries = await prisma.journalEntry.findMany({ where: { tenantId }, select: { entryNumber: true, lines: { select: { debit: true, credit: true } } } });
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      const dr = e.lines.reduce((s, l) => s + Number(l.debit), 0);
      const cr = e.lines.reduce((s, l) => s + Number(l.credit), 0);
      expect({ entry: e.entryNumber, off: +(dr - cr).toFixed(2) }).toEqual({ entry: e.entryNumber, off: 0 });
    }
    // Raw materials were bought, used, thrown out and counted: the raw-materials account moved.
    const rm = await prisma.journalLine.findMany({ where: { journalEntry: { tenantId }, account: { code: '1051' } }, select: { debit: true, credit: true } });
    expect(rm.some((l) => Number(l.debit) > 0)).toBe(true);
    expect(rm.some((l) => Number(l.credit) > 0)).toBe(true);
  });
});
