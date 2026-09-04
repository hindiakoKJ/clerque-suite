import { WarehouseService } from './warehouse.service';

/**
 * A transfer between branches used to be the one stock movement with no
 * trail: the source's quantity went down, the destination's went up, and no
 * lot, no event and no Stock Movements line said so. It also left the
 * source's lots full while its pool fell, which breaks expiry order.
 *
 * Pinned here: send drains lots at the source oldest-first and writes an OUT
 * event per line; receive creates a lot at the destination at the shop's own
 * unit cost and writes an IN event; cancelling after send gives the stock
 * back as a fresh lot and says so. The journal never sees an entry for any of
 * it -- that is asserted in the journal spec -- but the log does.
 */
describe('WarehouseService — transfers leave a trail and move lots', () => {
  const TENANT = 't1';
  const FROM = 'b-main';
  const TO = 'b-court';

  function build(status: 'DRAFT' | 'IN_TRANSIT', opts: { onHand?: number; after?: number; lineCost?: number; lots?: any[] } = {}) {
    const events: any[] = [];
    const lotsCreated: any[] = [];
    const lotUpdates: any[] = [];
    const invUpdates: any[] = [];
    const lineUpdates: any[] = [];
    const transfer: any = {
      id: 'tr1', tenantId: TENANT, transferNumber: 'ST-2026-000007', fromBranchId: FROM, toBranchId: TO,
      status, sentAt: status === 'IN_TRANSIT' ? new Date('2026-09-02T02:00:00Z') : null,
      lines: [{ id: 'l1', rawMaterialId: 'sugar', quantity: 1500, unitCost: opts.lineCost ?? 0.09 }],
    };
    const tx: any = {
      stockTransferLine: {
        update: jest.fn().mockImplementation((a: any) => { lineUpdates.push(a); return Promise.resolve({}); }),
      },
      stockTransfer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ status }),
        findFirstOrThrow: jest.fn().mockResolvedValue(transfer),
        update: jest.fn().mockResolvedValue(transfer),
      },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue({ quantity: opts.onHand ?? 5000 }),
        // What the shelf holds AFTER the move -- the trail reads it to fill
        // the before/after columns in the movement log.
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'sugar', quantity: opts.after ?? 3500 }]),
        update: jest.fn().mockImplementation((a: any) => { invUpdates.push(a); return Promise.resolve({}); }),
        upsert: jest.fn().mockImplementation((a: any) => { invUpdates.push(a); return Promise.resolve({}); }),
      },
      rawMaterialLot: {
        findMany: jest.fn().mockResolvedValue(opts.lots ?? [
          { id: 'lot-old', qtyRemaining: 1000, unitCost: 0.06 },
          { id: 'lot-new', qtyRemaining: 4000, unitCost: 0.12 },
        ]),
        update: jest.fn().mockImplementation((a: any) => { lotUpdates.push(a); return Promise.resolve({}); }),
        create: jest.fn().mockImplementation((a: any) => { lotsCreated.push(a.data); return Promise.resolve(a.data); }),
      },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sugar', name: 'Sugar', unit: 'g', costPrice: 0.09, category: 'INGREDIENT' }]),
      },
      branch: {
        findMany: jest.fn().mockResolvedValue([{ id: FROM, name: 'Main' }, { id: TO, name: 'Court bar' }]),
      },
      accountingEvent: {
        create: jest.fn().mockImplementation((a: any) => { events.push(a.data); return Promise.resolve(a.data); }),
      },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new WarehouseService(prisma, undefined as any);
    return { svc, tx, events, lotsCreated, lotUpdates, invUpdates, lineUpdates };
  }

  it('send drains the source lots oldest-first and records the stock leaving', async () => {
    const { svc, events, lotUpdates } = build('DRAFT');
    await svc.sendTransfer(TENANT, 'tr1');

    // 1,500 g out of a 1,000 g lot and 500 g of the next
    expect(lotUpdates.map((u) => [u.where.id, Number(u.data.qtyRemaining)])).toEqual([['lot-old', 0], ['lot-new', 3500]]);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({
      kind: 'STOCK_TRANSFER', direction: 'OUT', rawMaterialName: 'Sugar', quantity: 1500,
      branchId: FROM, otherBranchName: 'Court bar', referenceNumber: 'ST-2026-000007', totalValue: 135,
      // the log must show the shelf falling, not 0 -> 0
      quantityAfter: 3500, quantityBefore: 5000,
    });
    expect(events[0].payload.reason).toBe('Transferred to Court bar');
  });

  it('receive puts a lot on the destination shelf at the shop\'s unit cost and records the arrival', async () => {
    const { svc, events, lotsCreated, invUpdates } = build('IN_TRANSIT');
    await svc.receiveTransfer(TENANT, 'tr1', 'u-court');

    // The destination's own pool, not just its lots: the numbers asserted
    // below come from the mocked shelf, so without this the upsert could be
    // deleted and every test would still pass.
    expect(invUpdates).toHaveLength(1);
    expect(invUpdates[0].where.branchId_rawMaterialId).toEqual({ branchId: TO, rawMaterialId: 'sugar' });
    expect(invUpdates[0].update.quantity.increment).toBe(1500);
    expect(lotsCreated).toHaveLength(1);
    expect(lotsCreated[0]).toMatchObject({
      branchId: TO, rawMaterialId: 'sugar', qtyReceived: 1500, qtyRemaining: 1500, unitCost: 0.09,
      referenceNumber: 'ST-2026-000007',
    });
    expect(events[0].payload).toMatchObject({
      kind: 'STOCK_TRANSFER', direction: 'IN', branchId: TO, byId: 'u-court',
      quantityAfter: 3500, quantityBefore: 2000,   // arriving stock: the shelf rose
    });
    expect(events[0].payload.reason).toBe('Transferred from Main');
  });

  it('cancelling after send gives the stock back as a fresh lot and says why', async () => {
    const { svc, events, lotsCreated, invUpdates } = build('IN_TRANSIT');
    await svc.cancelTransfer(TENANT, 'tr1');

    expect(invUpdates[0].data.quantity.increment).toBe(1500);
    expect(lotsCreated[0]).toMatchObject({ branchId: FROM, referenceNumber: 'ST-2026-000007-CANCELLED' });
    expect(events[0].payload).toMatchObject({ kind: 'STOCK_TRANSFER', branchId: FROM });
    expect(events[0].payload.reason).toMatch(/cancelled/);
  });

  it('cancelling a draft that never left touches no lot and writes no event', async () => {
    const { svc, events, lotsCreated } = build('DRAFT');
    await svc.cancelTransfer(TENANT, 'tr1');
    expect(lotsCreated).toEqual([]);
    expect(events).toEqual([]);
  });

  /*
    Value must not change hands on the way between two branches.

    The lots that leave carry their own layer cost; the destination lot used
    to be created at the ingredient's running average instead, so on a
    FIFO/FEFO shop stock left one branch worth one number and arrived at the
    other worth a different one, with no journal entry anywhere to explain
    the difference. Send now writes what the layers really cost onto the
    line, and receive builds the destination lot from that.
  */
  it('sends at what the layers actually cost, not at today\'s average', async () => {
    const { svc, lineUpdates } = build('DRAFT');
    await svc.sendTransfer(TENANT, 'tr1');

    // 1,000 g at 0.06 + 500 g at 0.12 = 120 over 1,500 g = 0.08 exactly.
    expect(lineUpdates).toHaveLength(1);
    expect(lineUpdates[0].where).toEqual({ id: 'l1' });
    expect(Number(lineUpdates[0].data.unitCost)).toBe(0.08);
  });

  it('arrives worth exactly what it left worth', async () => {
    const { svc, lotsCreated } = build('IN_TRANSIT', { lineCost: 0.08 });
    await svc.receiveTransfer(TENANT, 'tr1', 'u-court');
    expect(Number(lotsCreated[0].unitCost)).toBe(0.08);
  });

  it('leaves the line alone when the shop keeps no layers', async () => {
    const { svc, lineUpdates } = build('DRAFT', { lots: [] });
    await svc.sendTransfer(TENANT, 'tr1');
    expect(lineUpdates).toEqual([]);
  });
});
