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

  function build(opts: {
    onHand?: number;
    costPrice?: number | null;
    category?: string;
    duplicateRef?: boolean;
    missing?: boolean;
  } = {}) {
    const events: any[] = [];
    const lots: any[] = [];
    const updates: any[] = [];

    const tx: any = {
      rawMaterialLot: {
        findFirst: jest.fn().mockResolvedValue(opts.duplicateRef ? { id: 'existing' } : null),
        create:    jest.fn(({ data }: any) => { lots.push(data); return Promise.resolve(data); }),
      },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue(
          opts.onHand === undefined ? { quantity: 5000 } : { quantity: opts.onHand },
        ),
        update: jest.fn(({ data }: any) => { updates.push(data); return Promise.resolve(data); }),
      },
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
    return { svc, prisma, tx, events, lots, updates };
  }

  const DTO = { branchId: BRANCH, quantity: 1000, reasonCode: 'EXPIRY' as const };

  it('reduces the quantity on hand', async () => {
    const { svc, updates } = build({ onHand: 5000 });
    const res = await svc.writeOffRawMaterial(TENANT, RM, 'u1', DTO);
    expect(res.quantityBefore).toBe(5000);
    expect(res.quantityAfter).toBe(4000);
    expect(Number(updates[0].quantity)).toBe(4000);
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
