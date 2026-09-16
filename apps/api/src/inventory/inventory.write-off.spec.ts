import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InventoryService } from './inventory.service';

/**
 * Taking raw material off the shelf for a reason that is not a sale.
 *
 * There was no way to do this at all: `adjust` resolves a productId against
 * the Product table, so it never reached a raw material. Spoiled milk, a
 * dropped bottle of syrup and beans past their date were unrecordable — the
 * stock stayed on the books, the recipe kept believing it was there, and the
 * POS kept offering drinks nobody could make.
 */
describe('InventoryService.writeOffRawMaterial', () => {
  const TENANT = 't1';
  const RM = 'rm-milk';
  const BRANCH = 'b1';

  /** A ticket line waiting at a kitchen or bar screen, and the order it belongs to. */
  type Ticket = { branchId: string; status: string; quantity: number };

  function build(opts: {
    onHand?: number;
    costPrice?: number | null;
    category?: string;
    duplicateRef?: boolean;
    missing?: boolean;
    /** Lattes waiting at a screen; each one uses 200 ml of the milk. */
    tickets?: Ticket[];
    /** What the row holds by the time the write lands, when a tap got there first. */
    rowAtWrite?: number;
  } = {}) {
    const events: any[] = [];
    const lots: any[] = [];
    const updates: any[] = [];
    const floors: any[] = [];
    const onHand = opts.onHand === undefined ? 5000 : opts.onHand;
    let row = opts.rowAtWrite ?? onHand;

    const tx: any = {
      rawMaterialLot: {
        findFirst: jest.fn().mockResolvedValue(opts.duplicateRef ? { id: 'existing' } : null),
        create:    jest.fn(({ data }: any) => { lots.push(data); return Promise.resolve(data); }),
      },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue({ quantity: onHand }),
        // Applied to the row as it is when the write lands, the way the database applies a decrement.
        update: jest.fn(({ data }: any) => {
          updates.push(data);
          row -= Number(data.quantity.decrement);
          return Promise.resolve({ quantity: row });
        }),
        updateMany: jest.fn(({ where, data }: any) => {
          floors.push({ where, data });
          if (row < 0) { row = Number(data.quantity); return Promise.resolve({ count: 1 }); }
          return Promise.resolve({ count: 0 });
        }),
      },
      /*
        Waiting lines, filtered the way the database would: by the order's
        status and branch as heldUsage asks for them.
      */
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.tickets ?? [])
          .filter(() => where.usageOnReady === true && where.usagePostedAt === null)
          .filter((t) => where.order.tenantId === TENANT && where.order.status.in.includes(t.status))
          .filter((t) => !where.order.branchId || where.order.branchId.in.includes(t.branchId))
          .map((t) => ({
            productId: 'latte', variantId: null, quantity: t.quantity, refundedQty: 0,
            modifiers: [], order: { branchId: t.branchId },
          })))),
      },
      bomItem: {
        findMany: jest.fn().mockResolvedValue([{ productId: 'latte', rawMaterialId: RM, quantity: '200', rawMaterial: null }]),
      },
      variantBomItem: { findMany: jest.fn().mockResolvedValue([]) },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve(data); }),
      },
    };

    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue(
          opts.missing ? null : {
            id: RM, tenantId: TENANT, name: 'Fresh Milk', unit: 'ml',
            category: opts.category ?? 'INGREDIENT',
            costPrice: opts.costPrice === undefined ? 0.09 : opts.costPrice,
          },
        ),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new InventoryService(prisma, periods as any) as any;
    return { svc, prisma, tx, events, lots, updates, floors, row: () => row };
  }

  const DTO = { branchId: BRANCH, quantity: 1000, reasonCode: 'EXPIRY' as const };

  it('reduces the quantity on hand', async () => {
    const { svc, updates, row } = build({ onHand: 5000 });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(res.quantityBefore).toBe(5000);
    expect(res.quantityAfter).toBe(4000);
    expect(Number(updates[0].quantity.decrement)).toBe(1000);
    expect(row()).toBe(4000);
  });

  // ── the kitchen's ready tap is now a second writer on the same row ───────

  it('takes the write-off off the row as it is, so a tap that landed first is not put back', async () => {
    /*
      Read 5000, then a latte marked ready took 200 before the write landed.
      Writing "5000 - 1000" would put the 200 back on the shelf; the decrement
      leaves 3800, which is what is physically there.
    */
    const { svc, updates, row } = build({ onHand: 5000, rowAtWrite: 4800 });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(Number(updates[0].quantity.decrement)).toBe(1000);
    expect(row()).toBe(3800);
    expect(res.quantityAfter).toBe(3800);
  });

  it('still never leaves the row below zero when a tap took the last of it in between', async () => {
    const { svc, floors, row } = build({ onHand: 1000, rowAtWrite: 800 });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(floors[0].where).toMatchObject({ branchId: BRANCH, rawMaterialId: RM, quantity: { lt: 0 } });
    expect(row()).toBe(0);
    expect(res.quantityAfter).toBe(0);
  });

  it('keeps the cap on the shelf figure: milk promised to a waiting ticket can still be written off', async () => {
    // A write-off records a loss that already happened; refusing it would not bring the milk back.
    const { svc } = build({
      onHand: 1000,
      tickets: [{ branchId: BRANCH, status: 'PAID', quantity: 4 }],   // 800 ml held
    });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', { ...DTO, quantity: 1000 });
    expect(res.quantityAfter).toBe(0);
    await expect(build({ onHand: 1000 }).svc.writeOffRawMaterial(TENANT, RM, 'u1', { ...DTO, quantity: 1001 }))
      .rejects.toThrow(BadRequestException);
  });

  it('warns, naming how much is held, when the write-off eats into what waiting tickets need', async () => {
    const { svc } = build({
      onHand: 1500,
      tickets: [{ branchId: BRANCH, status: 'PAID', quantity: 4 }],   // 800 ml held
    });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(res.quantityAfter).toBe(500);
    expect(res.heldQty).toBe(800);
    expect(res.heldWarning).toContain('800 ml');
    expect(res.heldWarning).toContain('leaves 500 ml');
    // The cost warning is its own thing and still says nothing here.
    expect(res.warning).toBeNull();
  });

  it('says nothing when what is left still covers the waiting tickets', async () => {
    const { svc } = build({
      onHand: 5000,
      tickets: [{ branchId: BRANCH, status: 'COMPLETED', quantity: 4 }],
    });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(res.heldQty).toBe(800);
    expect(res.heldWarning).toBeNull();
  });

  it('does not warn about a ticket at another branch or on a voided order', async () => {
    const { svc } = build({
      onHand: 1500,
      tickets: [
        { branchId: 'b2', status: 'PAID', quantity: 4 },
        { branchId: BRANCH, status: 'VOIDED', quantity: 4 },
      ],
    });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(res.heldQty).toBe(0);
    expect(res.heldWarning).toBeNull();
  });

  it('with nothing waiting, holds nothing and warns about nothing', async () => {
    const { svc } = build({ onHand: 1000 });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(res.quantityAfter).toBe(0);
    expect(res.heldQty).toBe(0);
    expect(res.heldWarning).toBeNull();
  });

  it('refuses to write off more than is on the shelf', async () => {
    // Negative stock is not a state a shelf can be in, and it makes every
    // later number — maxProducible, count variance, valuation — nonsense.
    const { svc } = build({ onHand: 500 });
    await expect(svc.writeOffRawMaterial(TENANT, RM, 'u1', { ...DTO, quantity: 1000 }))
      .rejects.toThrow(BadRequestException);
  });

  it('points at a cycle count when the shelf disagrees, rather than just refusing', async () => {
    const { svc } = build({ onHand: 500 });
    await expect(svc.writeOffRawMaterial(TENANT, RM, 'u1', { ...DTO, quantity: 1000 }))
      .rejects.toThrow(/cycle count/i);
  });

  it('carries the reason into the accounting event, so it lands in the right account', async () => {
    // Spoilage is not cost of sale. The reason is what routes it.
    const { svc, events } = build({ onHand: 5000 });
    await svc.writeOffRawMaterial(TENANT, RM, 'u1', { ...DTO, reasonCode: 'DAMAGE' });
    expect(events).toHaveLength(1);
    expect(events[0].payload.reasonCode).toBe('DAMAGE');
    expect(events[0].payload.quantity).toBeLessThan(0);
    expect(events[0].payload.totalValue).toBeLessThan(0);
  });

  it('carries the category, so a supply already expensed is not relieved twice', async () => {
    const { svc, events } = build({ onHand: 5000, category: 'OFFICE_SUPPLY' });
    await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(events[0].payload.category).toBe('OFFICE_SUPPLY');
  });

  it('says nothing to the books when the item has no cost price', async () => {
    // A quantity the books cannot value is a stock fact, not an entry.
    const { svc, events, updates } = build({ onHand: 5000, costPrice: null });
    await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(events).toHaveLength(0);
    expect(updates).toHaveLength(1);   // the stock still moved
  });

  it('writes the same reference off only once', async () => {
    // A double-tap on a tablet must not write the milk off twice, and a
    // write-off is not something a person can see happening.
    const { svc, updates } = build({ onHand: 5000, duplicateRef: true });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', { ...DTO, referenceNumber: 'WO-1' });
    expect(res.duplicate).toBe(true);
    expect(updates).toHaveLength(0);
  });

  it('records a negative lot as the write-off receipt', async () => {
    const { svc, lots } = build({ onHand: 5000 });
    await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(Number(lots[0].qtyReceived)).toBe(-1000);
    expect(Number(lots[0].qtyRemaining)).toBe(0);
  });

  it('refuses a raw material from another tenant', async () => {
    const { svc } = build({ missing: true });
    await expect(svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO)).rejects.toThrow(NotFoundException);
  });

  it('refuses to backdate into a closed period', async () => {
    const { svc, prisma } = build({ onHand: 5000 });
    void prisma;
    // periods.assertDateIsOpen is called before any write; if it throws the
    // whole thing must abort rather than moving stock and failing the entry.
    const periods = { assertDateIsOpen: jest.fn().mockRejectedValue(new BadRequestException('closed')) };
    const svc2 = new InventoryService((svc as any).prisma, periods as any) as any;
    await expect(svc2.writeOffRawMaterial(TENANT, RM, 'u1', DTO)).rejects.toThrow('closed');
  });
});
