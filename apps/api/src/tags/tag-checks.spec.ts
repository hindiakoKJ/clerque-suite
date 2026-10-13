import { BadRequestException, ConflictException } from '@nestjs/common';
import { TagChecksService, compareRollCall, writeOffReasonCode } from './tag-checks.service';

/**
 * The checks that catch a part leaving without a sale. The shop this is for
 * found its theft only because a customer brought back a part that had never
 * been rung up; these make that a rule, not luck.
 */

function build(over: any = {}) {
  const prisma: any = {
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1' }) },
    serializedUnit: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    order: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'owner-1', name: 'Owner' }]) },
    notification: { createMany: jest.fn() },
    shift: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryItem: { findUnique: jest.fn().mockResolvedValue({ id: 'inv-1', quantity: 2 }), update: jest.fn() },
    inventoryLog: { create: jest.fn() },
    accountingEvent: { create: jest.fn() },
    ...over,
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const documents = { uploadBuffer: jest.fn().mockResolvedValue({ id: 'doc-1' }) };
  const audit = { log: jest.fn() };
  const telegram = { ownerNotice: jest.fn().mockResolvedValue(undefined) };
  return { svc: new TagChecksService(prisma, documents as any, audit as any, telegram as any), prisma, documents, audit, telegram };
}

const SHELF = [
  { serialNumber: '000001', product: { name: 'Headlamp LH Vios' } },
  { serialNumber: '000002', product: { name: 'Engine 2NZ' } },
  { serialNumber: '000003', product: { name: 'Door FR Vios' } },
];

describe('roll call', () => {
  it('compares what was found with what should be on the shelf', () => {
    const r = compareRollCall(['000001', '000003', '000009'],
      SHELF.map((s) => ({ number: s.serialNumber, productName: s.product.name })), new Map([['000009', 'Sold on ORD-9, but found on the shelf.']]));
    expect(r.found).toEqual(['000001', '000003']);
    expect(r.missing).toEqual([{ number: '000002', productName: 'Engine 2NZ' }]);
    expect(r.unexpected).toEqual([{ number: '000009', why: 'Sold on ORD-9, but found on the shelf.' }]);
  });

  it('is blind for staff: a cashier learns only that it was sent', async () => {
    const { svc } = build({ serializedUnit: { findMany: jest.fn().mockResolvedValueOnce(SHELF).mockResolvedValueOnce([]) } });
    expect(await svc.rollCall('t', 'u', 'CASHIER', 'b1', ['000001', '000003'])).toEqual({ received: 2 });
  });

  it('the owner gets the missing list, in the bell, on Telegram (owners only) and in the record', async () => {
    const { svc, prisma, telegram } = build({ serializedUnit: { findMany: jest.fn().mockResolvedValueOnce(SHELF).mockResolvedValueOnce([]) } });
    const r: any = await svc.rollCall('t', 'owner-1', 'BUSINESS_OWNER', 'b1', ['000001', '000003', 'junk']);
    expect(r.result.missing).toEqual([{ number: '000002', productName: 'Engine 2NZ' }]);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityType: 'TAG_ROLL_CALL' }) });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ title: 'Roll call: 1 missing', body: expect.stringContaining('Missing: Tag 000002 Engine 2NZ') })] });
    expect(telegram.ownerNotice).toHaveBeenCalledWith('t', 'b1', 'Roll call: 1 missing', ['Missing: Tag 000002 Engine 2NZ'], { ownersOnly: true });
  });

  it('a full count tells nobody', async () => {
    const { svc, prisma, telegram } = build({ serializedUnit: { findMany: jest.fn().mockResolvedValueOnce(SHELF).mockResolvedValueOnce([]) } });
    await svc.rollCall('t', 'u', 'CASHIER', 'b1', ['000001', '000002', '000003']);
    expect(prisma.notification.createMany).not.toHaveBeenCalled();
    expect(telegram.ownerNotice).not.toHaveBeenCalled();
  });

  it('a part sold but still found on the shelf is named', async () => {
    const { svc } = build({
      serializedUnit: { findMany: jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ serialNumber: '000004', status: 'SOLD', acquiredCost: 1, branchId: 'b1', soldOrderId: 'o1' }]) },
      order: { findMany: jest.fn().mockResolvedValue([{ id: 'o1', orderNumber: 'ORD-2026-000044' }]) },
    });
    const r: any = await svc.rollCall('t', 'owner-1', 'BUSINESS_OWNER', 'b1', ['000004']);
    expect(r.result.unexpected).toEqual([{ number: '000004', why: 'Sold on ORD-2026-000044, but found on the shelf.' }]);
  });

  it('refuses an empty count', async () => {
    const { svc } = build();
    await expect(svc.rollCall('t', 'u', 'CASHIER', 'b1', ['abc'])).rejects.toThrow(BadRequestException);
  });

  it('a missing part shows when it was last seen', async () => {
    const calls = [
      { after: { branchId: 'b1', countedAt: '2026-10-13T09:00:00Z', countedById: 'u', found: ['000001'], missing: [{ number: '000002', productName: 'Engine' }], unexpected: [] }, createdAt: new Date(), performedBy: 'u' },
      { after: { branchId: 'b1', countedAt: '2026-10-06T09:00:00Z', countedById: 'u', found: ['000001', '000002'], missing: [], unexpected: [] }, createdAt: new Date(), performedBy: 'u' },
    ];
    const { svc } = build({ auditLog: { findMany: jest.fn().mockResolvedValue(calls) } });
    const list = await svc.listRollCalls('t');
    expect(list[0].missing).toEqual([{ number: '000002', productName: 'Engine', lastSeenAt: '2026-10-06T09:00:00Z' }]);
  });
});

describe('a part brought back that was never sold', () => {
  const unsold = { id: 't2', status: 'IN_STOCK', branchId: 'b1', soldOrderId: null, product: { name: 'Engine 2NZ' } };

  it('tells the owner at once, with when it was last seen and whose drawers were open since', async () => {
    const { svc, prisma, telegram } = build({
      serializedUnit: { findFirst: jest.fn().mockResolvedValue(unsold) },
      auditLog: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([{ after: { found: ['000002'], countedAt: '2026-10-06T09:00:00Z' } }]) },
      shift: { findMany: jest.fn().mockResolvedValue([{ cashierId: 'c1' }, { cashierId: 'c1' }]) },
      user: { findMany: jest.fn().mockResolvedValueOnce([{ name: 'Benjie' }]).mockResolvedValueOnce([{ id: 'owner-1' }]) },
    });
    const r = await svc.returnedUnsold('t', 'u', '000002', 'customer says it does not start');
    expect(r).toEqual({ told: true, lastSeen: '2026-10-06T09:00:00Z' });
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityType: 'TAG_RETURNED_UNSOLD' }) });
    expect(prisma.notification.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      title: 'Returned but never sold: Tag 000002', body: expect.stringContaining('Drawers open since then: Benjie'),
    })] });
    expect(telegram.ownerNotice).toHaveBeenCalledWith('t', 'b1', 'Returned but never sold: Tag 000002',
      expect.arrayContaining(['Drawers open since then: Benjie.']), { ownersOnly: true });
  });

  it('a part that WAS sold is a normal return: refunded from Orders by the owner', async () => {
    const { svc } = build({
      serializedUnit: { findFirst: jest.fn().mockResolvedValue({ ...unsold, status: 'SOLD', soldOrderId: 'o1' }) },
      order: { findFirst: jest.fn().mockResolvedValue({ orderNumber: 'ORD-2026-000044' }) },
    });
    await expect(svc.returnedUnsold('t', 'u', '000002')).rejects.toThrow(/sold on ORD-2026-000044/);
  });
});

describe('writing a part off', () => {
  const costed = { id: 't1', serialNumber: '000001', status: 'IN_STOCK', acquiredCost: 1800, branchId: 'b1', productId: 'p1', product: { name: 'Headlamp' } };
  const photo = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'p.jpg' };

  it('needs a photo of the part', async () => {
    const { svc } = build({ serializedUnit: { findFirst: jest.fn().mockResolvedValue(costed) } });
    await expect(svc.writeOff('t', 'owner-1', 't1', 'DAMAGED', undefined, undefined)).rejects.toThrow(/photo/);
  });

  it('damage goes to waste (5070), a lost or stolen part to write-off (5060)', () => {
    expect(writeOffReasonCode('DAMAGED')).toBe('DAMAGE');
    expect(writeOffReasonCode('SCRAP')).toBe('DAMAGE');
    expect(writeOffReasonCode('STOLEN')).toBe('THEFT');
    expect(writeOffReasonCode('LOST')).toBe('THEFT');
  });

  it('takes the piece off the shelf and out of the books at its own cost', async () => {
    const { svc, prisma } = build({ serializedUnit: { findFirst: jest.fn().mockResolvedValue(costed), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } });
    const r = await svc.writeOff('t', 'owner-1', 't1', 'STOLEN', 'not found at two counts', photo);
    expect(r).toEqual({ number: '000001', status: 'RETIRED', bookedTo: '5060' });
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { quantity: expect.anything() } });
    expect(prisma.accountingEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      payload: expect.objectContaining({ adjustmentType: 'STOCK_OUT', quantity: -1, totalValue: 1800, reasonCode: 'THEFT' }),
    }) });
  });

  it('a part still waiting for its cost was never in the books: it is retired, nothing is posted', async () => {
    const { svc, prisma } = build({ serializedUnit: { findFirst: jest.fn().mockResolvedValue({ ...costed, acquiredCost: null }), updateMany: jest.fn().mockResolvedValue({ count: 1 }) } });
    const r = await svc.writeOff('t', 'owner-1', 't1', 'DAMAGED', undefined, photo);
    expect(r.bookedTo).toBeNull();
    expect(prisma.accountingEvent.create).not.toHaveBeenCalled();
  });

  it('a part that is not on the shelf cannot be written off', async () => {
    const { svc } = build({ serializedUnit: { findFirst: jest.fn().mockResolvedValue({ ...costed, status: 'SOLD' }) } });
    await expect(svc.writeOff('t', 'owner-1', 't1', 'DAMAGED', undefined, photo)).rejects.toThrow(ConflictException);
  });
});

describe('label gaps', () => {
  it('lists the printed numbers that never became a tag', async () => {
    const { svc } = build({
      auditLog: { findMany: jest.fn().mockResolvedValue([{ after: { from: '000001', to: '000005' }, createdAt: new Date('2026-10-13') }]) },
      serializedUnit: { findMany: jest.fn().mockResolvedValue([{ serialNumber: '000001' }, { serialNumber: '000002' }, { serialNumber: '000004' }]) },
    });
    const r = await svc.labelGaps('t');
    expect(r.totalUnused).toBe(2);
    expect(r.runs[0].unused).toEqual(['000003', '000005']);
  });
});
