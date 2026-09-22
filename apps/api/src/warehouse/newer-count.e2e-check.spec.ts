import { PrismaClient } from '@prisma/client';
import { InventoryService } from '../inventory/inventory.service';
import { ProcureService } from '../procure/procure.service';
import { StationCountService } from '../procure/station-count.service';
import { lineNotes, monthDay, weeklyCountNotes } from '../procure/weekly-count';
import { manilaDayOf } from '../ingredient-reports/daily-usage';
import { WarehouseService } from './warehouse.service';

/**
 * Newest count wins, run against a REAL database.
 *
 * The unit spec (newer-count.spec.ts) proves the rule against an in-memory
 * shop. This runs the shop's own path end to end: a buy list's "how much is
 * left?" through ProcureService.recordCount, the owner's "Adjust the books to
 * match" on a weekly count through StationCountService.adjust, and the counts
 * screen's Post -- with real Postgres filters and its real advisory lock, so
 * two counts posted in the same instant are shown to move a shared item once.
 *
 * Guarded on localhost and skipped when DATABASE_URL is anything else, the
 * same guard as station-request.e2e-check.spec.ts. It creates its own shop
 * and deletes it. Never point this at a database that is not local.
 */
const url = process.env.DATABASE_URL ?? '';
const LOCAL = /@localhost[:/]/.test(url) || /@127\.0\.0\.1[:/]/.test(url);
const maybe = LOCAL ? describe : describe.skip;

maybe('Newest count wins — against the real database', () => {
  jest.setTimeout(120_000);

  const prisma = new PrismaClient() as any;
  const inventory = new InventoryService(prisma, { assertDateIsOpen: async () => undefined } as any);
  const warehouse = new WarehouseService(prisma);
  const procure = new ProcureService(prisma, inventory, undefined, undefined, warehouse);
  const weekly = new StationCountService(prisma, warehouse);

  const tag = `newer-count-e2e-${Date.now()}`;
  let tenantId = '';
  let branchId = '';
  let ownerId = '';
  const ids: Record<string, string> = {};
  const tick = () => new Promise((r) => setTimeout(r, 25));
  const stock = async (name: string) => Number((await prisma.rawMaterialInventory.findUnique({
    where: { branchId_rawMaterialId: { branchId, rawMaterialId: ids[name] } }, select: { quantity: true },
  })).quantity);
  const material = async (name: string, qty: number, costPrice: number) => {
    ids[name] = (await inventory.createRawMaterial(tenantId, { name, unit: 'g', costPrice } as any)).id;
    await prisma.rawMaterialInventory.create({ data: { tenantId, branchId, rawMaterialId: ids[name], quantity: qty } });
  };
  /** An open buy list with these items on it, as the Procure screen makes one. */
  const buyList = async (requestNumber: string, names: string[]) => prisma.purchaseRequest.create({
    data: {
      tenantId, branchId, requestNumber, createdById: ownerId,
      lines: { create: names.map((n, i) => ({ lineNumber: `${requestNumber}-0${i + 1}`, rawMaterialId: ids[n], qtyRequested: 1000 })) },
    },
    include: { lines: true },
  });
  const lineOf = (req: any, name: string) => req.lines.find((l: any) => l.rawMaterialId === ids[name]).id;

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
    await material('Salt', 1000, 0.05);
    await material('Sugar', 5000, 0.07);
    await material('Beans', 2000, 1.85);
  });

  afterAll(async () => {
    if (tenantId) {
      await prisma.accountingEvent.deleteMany({ where: { tenantId } });
      await prisma.cycleCountLine.deleteMany({ where: { count: { tenantId } } });
      await prisma.cycleCount.deleteMany({ where: { tenantId } });
      await prisma.purchaseRequestLine.deleteMany({ where: { purchaseRequest: { tenantId } } });
      await prisma.purchaseRequest.deleteMany({ where: { tenantId } });
      await prisma.rawMaterialInventory.deleteMany({ where: { tenantId } });
      await prisma.rawMaterial.deleteMany({ where: { tenantId } });
      await prisma.user.deleteMany({ where: { tenantId } });
      await prisma.branch.deleteMany({ where: { tenantId } });
      await prisma.tenant.delete({ where: { id: tenantId } });
    }
    await prisma.$disconnect();
  });

  it('a buy list posted after the weekly Adjust leaves the adjusted item alone; a line counted after it, and an unrelated one, post', async () => {
    // A monthly count started on the counts screen before any of it, posted last.
    const monthly = await warehouse.startCycleCount(tenantId, branchId, ownerId, 'Monthly');
    const monthlySalt = monthly.lines.find((l: any) => l.rawMaterialId === ids.Salt)!;
    await warehouse.setLineCount(tenantId, monthlySalt.id, 990);

    // Last night the Kitchen counted salt 300 g short and sugar 200 g short, and sent it as a record.
    const lastNight = new Date(Date.now() - 12 * 3_600_000);
    const station = { id: `st-${tag}`, name: 'Kitchen' };
    const record = await prisma.cycleCount.create({
      data: {
        tenantId, branchId, countNumber: await warehouse.nextCountNumber(prisma, tenantId), status: 'RECORDED', startedById: ownerId,
        notes: weeklyCountNotes(manilaDayOf(lastNight), station),
        lines: { create: [
          { rawMaterialId: ids.Salt,  expectedQty: 1000, countedQty: 700,  varianceQty: -300, notes: lineNotes({ by: 'Joy', at: lastNight, stationId: station.id }) },
          { rawMaterialId: ids.Sugar, expectedQty: 5000, countedQty: 4800, varianceQty: -200, notes: lineNotes({ by: 'Joy', at: lastNight, stationId: station.id }) },
        ] },
      },
    });

    // This morning the cook builds the buy list: salt 650 g, beans 1.9 kg.
    const req = await buyList('REQ-E2E-001', ['Salt', 'Sugar', 'Beans']);
    const salt = await procure.recordCount(tenantId, req.id, lineOf(req, 'Salt'), ownerId, 650);
    await procure.recordCount(tenantId, req.id, lineOf(req, 'Beans'), ownerId, 1900);
    const countId = salt.countId;
    const saltLine = await prisma.cycleCountLine.findFirst({ where: { countId, rawMaterialId: ids.Salt } });
    expect(saltLine.notes).toMatch(/^\[AT:[^\]]+\] REQ-E2E-001-01$/);
    await tick();

    // The owner adjusts the books from last night's record.
    const adjusted = await weekly.adjust({ tenantId, ownBranchId: null }, record.id, ownerId, {});
    expect(adjusted).toMatchObject({ status: 'POSTED', adjusted: 2, skipped: [] });
    expect(await stock('Salt')).toBe(700);
    expect(await stock('Sugar')).toBe(4800);
    await tick();

    // After that, the cook counts sugar against the corrected book: 4.7 kg.
    const sugar = await procure.recordCount(tenantId, req.id, lineOf(req, 'Sugar'), ownerId, 4700);
    expect(sugar.expectedQty).toBe(4800);
    await tick();

    // The owner posts the buy list's count from the counts screen.
    const posted = await warehouse.postCycleCount(tenantId, countId, ownerId);
    const postedOn = monthDay((await prisma.cycleCount.findUnique({ where: { id: record.id } })).postedAt);
    expect(posted.leftAlone).toEqual([{
      rawMaterialId: ids.Salt, name: 'Salt', message: `Left alone: Salt was already adjusted by count ${record.countNumber} (posted ${postedOn}).`,
    }]);
    expect(posted.message).toBeNull();
    expect(await stock('Salt')).toBe(700);     // not 350: the 300 g is booked once
    expect(await stock('Sugar')).toBe(4700);
    expect(await stock('Beans')).toBe(1900);
    const events = await prisma.accountingEvent.findMany({ where: { tenantId } });
    const fromList = events.filter((e: any) => e.payload.referenceNumber === salt.countNumber).map((e: any) => e.payload.rawMaterialName).sort();
    expect(fromList).toEqual(['Beans', 'Sugar']);
    const list = await prisma.cycleCount.findUnique({ where: { id: countId }, include: { lines: true } });
    expect(list.status).toBe('POSTED');
    expect(list.notes).toBe('[REQ:REQ-E2E-001] Counted while building the buy list');
    // The salt line's figures as they were counted, and marked as left alone.
    const after = list.lines.find((l: any) => l.rawMaterialId === ids.Salt);
    expect([Number(after.expectedQty), Number(after.countedQty), Number(after.varianceQty)]).toEqual([1000, 650, -350]);
    expect(after.notes).toMatch(/^\[AT:[^\]]+\] \[LEFT:[^\]]+\] REQ-E2E-001-01$/);
    expect(list.lines.filter((l: any) => /\[LEFT:/.test(l.notes ?? '')).map((l: any) => l.rawMaterialId)).toEqual([ids.Salt]);

    // Last, the monthly count: every item on it was adjusted since it was started. It closes and says so; nothing moves.
    const last = await warehouse.postCycleCount(tenantId, monthly.id, ownerId);
    expect(last.status).toBe('POSTED');
    expect(last.message).toBe('Nothing moved: every item on this count was already adjusted or counted again by another count.');
    expect(last.leftAlone.map((l: any) => l.name)).toEqual(['Beans', 'Salt', 'Sugar']);
    expect([await stock('Salt'), await stock('Sugar'), await stock('Beans')]).toEqual([700, 4700, 1900]);
    expect(await prisma.accountingEvent.count({ where: { tenantId } })).toBe(events.length);

    // The weekly review still reads as it did when it was posted: nothing on it was counted again.
    const review = await weekly.review({ tenantId, ownBranchId: null }, record.id);
    expect(review.lines.map((l) => l.superseded)).toEqual([null, null]);
  });

  it('a post waits for another post at the branch, then reads it as posted: the item moves once', async () => {
    await material('Milk', 3000, 0.08);
    const a = await buyList('REQ-E2E-002', ['Milk']);
    const b = await buyList('REQ-E2E-003', ['Milk']);
    const first = await procure.recordCount(tenantId, a.id, lineOf(a, 'Milk'), ownerId, 2900);
    const second = await procure.recordCount(tenantId, b.id, lineOf(b, 'Milk'), ownerId, 2800);
    await tick();

    // The first post, caught at the moment it has moved milk and not yet committed.
    let finish!: () => void;
    const held = new Promise<void>((r) => { finish = r; });
    let hasLock!: () => void;
    const locked = new Promise<void>((r) => { hasLock = r; });
    const firstPost = prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`cycle-count-post:${tenantId}:${branchId}`}))`;
      await tx.rawMaterialInventory.update({
        where: { branchId_rawMaterialId: { branchId, rawMaterialId: ids.Milk } }, data: { quantity: { decrement: 100 } },
      });
      await tx.cycleCount.update({ where: { id: first.countId }, data: { status: 'POSTED', postedAt: new Date(), postedById: ownerId } });
      hasLock();
      await held;
    }, { timeout: 30_000 });
    await locked;

    let settled = false;
    const secondPost = warehouse.postCycleCount(tenantId, second.countId, ownerId).then((r) => { settled = true; return r; });
    await new Promise((r) => setTimeout(r, 500));
    expect(settled).toBe(false);          // waiting on the branch, not reading the first as still open
    finish();
    await firstPost;
    const res = await secondPost;
    expect(res.leftAlone.map((l) => l.name)).toEqual(['Milk']);
    expect(await stock('Milk')).toBe(2900);   // not 2,700
  });

  it('an older buy list posted before a newer weekly record is adjusted leaves the item for it: the newer count sets it', async () => {
    await material('Syrup', 1000, 0.3);
    // A week ago the buy list found syrup 100 short. It stayed open.
    const req = await buyList('REQ-E2E-004', ['Syrup']);
    const old = await procure.recordCount(tenantId, req.id, lineOf(req, 'Syrup'), ownerId, 900, new Date(Date.now() - 7 * 86_400_000));
    // Last night the Kitchen found it 400 short of the same book, and sent it as a record.
    const lastNight = new Date(Date.now() - 12 * 3_600_000);
    const station = { id: `st-${tag}`, name: 'Kitchen' };
    const record = await prisma.cycleCount.create({
      data: {
        tenantId, branchId, countNumber: await warehouse.nextCountNumber(prisma, tenantId), status: 'RECORDED', startedById: ownerId,
        notes: weeklyCountNotes(manilaDayOf(lastNight), station),
        lines: { create: [
          { rawMaterialId: ids.Syrup, expectedQty: 1000, countedQty: 600, varianceQty: -400, notes: lineNotes({ by: 'Joy', at: lastNight, stationId: station.id }) },
        ] },
      },
    });

    // The owner posts the old buy list first: the record, counted later and not yet adjusted, is read.
    const posted = await warehouse.postCycleCount(tenantId, old.countId, ownerId);
    expect(posted.leftAlone.map((l: any) => l.message)).toEqual([`Left alone: Syrup was counted again later (${record.countNumber}, ${monthDay(lastNight)}).`]);
    expect(await stock('Syrup')).toBe(1000);
    // Then adjusts from the record: syrup comes down to the 600 it found, not 900.
    const adjusted = await weekly.adjust({ tenantId, ownBranchId: null }, record.id, ownerId, {});
    expect(adjusted).toMatchObject({ status: 'POSTED', adjusted: 1, skipped: [] });
    expect(await stock('Syrup')).toBe(600);
  });
});
