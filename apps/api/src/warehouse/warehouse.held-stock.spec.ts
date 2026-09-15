import { Prisma } from '@prisma/client';
import { WarehouseService } from './warehouse.service';

/**
 * A ticket waiting at a kitchen or bar screen has not taken its ingredients
 * off the books yet -- the ready tap does that -- but they are promised.
 *
 * Pinned here for the warehouse readers that DECIDE something from stock:
 * sending a transfer refuses to carry away what waiting tickets at the source
 * hold, and starting a count expects the shelf to be short by that amount.
 * Only tickets at the same branch, on an order that will still be made, hold
 * anything; with nothing waiting both behave exactly as before.
 */

const TENANT = 't1';
const FROM = 'b-main';
const OTHER = 'b-court';

interface Ticket {
  branchId: string;
  status: string;
  productId?: string;
  quantity?: number;
  refundedQty?: number;
  usagePostedAt?: Date | null;
}

/*
  Enough of the order/recipe tables for heldUsage to run for real. The line
  query honours the filters the helper sends -- waiting, tenant, status and
  branch -- so a ticket at another branch or on a voided order is left out by
  the same where clause the database would apply.
*/
function recipeTables(tickets: Ticket[]) {
  const bom = [{ productId: 'latte', rawMaterialId: 'milk', quantity: 200, rawMaterial: null }];
  return {
    orderItem: {
      findMany: jest.fn(async ({ where }: any) => tickets
        .filter((t) => where.usageOnReady === true && where.usagePostedAt === null && (t.usagePostedAt ?? null) === null)
        .filter((t) => where.order.tenantId === TENANT)
        .filter((t) => where.order.status.in.includes(t.status))
        .filter((t) => !where.order.branchId || where.order.branchId.in.includes(t.branchId))
        .map((t) => ({
          productId: t.productId ?? 'latte', variantId: null,
          quantity: t.quantity ?? 1, refundedQty: t.refundedQty ?? 0,
          modifiers: [], order: { branchId: t.branchId },
        }))),
    },
    bomItem: {
      findMany: jest.fn(async ({ where }: any) => bom.filter((b) => where.productId.in.includes(b.productId))),
    },
    variantBomItem: { findMany: jest.fn(async () => []) },
    modifierOption: { findMany: jest.fn(async () => []) },
  };
}

describe('WarehouseService.sendTransfer — what waiting tickets hold stays behind', () => {
  function build(opts: { tickets?: Ticket[]; onHand?: number; quantity?: number } = {}) {
    const invUpdates: any[] = [];
    const statusResets: any[] = [];
    const transfer: any = {
      id: 'tr1', tenantId: TENANT, transferNumber: 'ST-2026-000009', fromBranchId: FROM, toBranchId: OTHER,
      status: 'IN_TRANSIT', sentAt: new Date('2026-09-15T02:00:00Z'),
      lines: [{ id: 'l1', rawMaterialId: 'milk', quantity: opts.quantity ?? 700, unitCost: 0.08 }],
    };
    const tx: any = {
      ...recipeTables(opts.tickets ?? []),
      stockTransfer: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
        findFirstOrThrow: jest.fn().mockResolvedValue(transfer),
        update: jest.fn().mockImplementation((a: any) => { statusResets.push(a); return Promise.resolve(transfer); }),
      },
      stockTransferLine: { update: jest.fn().mockResolvedValue({}) },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue({ quantity: new Prisma.Decimal(opts.onHand ?? 1000) }),
        findMany: jest.fn().mockResolvedValue([{ rawMaterialId: 'milk', quantity: 300 }]),
        update: jest.fn().mockImplementation((a: any) => { invUpdates.push(a); return Promise.resolve({}); }),
      },
      rawMaterialLot: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn(), create: jest.fn() },
      rawMaterial: {
        findMany: jest.fn().mockResolvedValue([{ id: 'milk', name: 'Milk', unit: 'ml', costPrice: 0.08, category: 'INGREDIENT' }]),
      },
      branch: { findMany: jest.fn().mockResolvedValue([{ id: FROM, name: 'Main' }, { id: OTHER, name: 'Court bar' }]) },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    return { svc: new WarehouseService(prisma, undefined as any), tx, invUpdates, statusResets };
  }

  it('refuses to send milk that a waiting bar ticket at the source still needs, and says so', async () => {
    // 1,000 ml on the books; two lattes waiting hold 400 ml; 700 ml asked for.
    const { svc, invUpdates, statusResets } = build({ tickets: [{ branchId: FROM, status: 'PAID', quantity: 2 }] });

    const err = await svc.sendTransfer(TENANT, 'tr1').catch((e: unknown) => e) as Error;
    expect(err.message).toBe(
      'Insufficient stock at source for raw-material milk: have 1000, of which 400 is held for kitchen/bar ' +
      'tickets still waiting to be made, so 600 can be sent; need 700.',
    );
    expect(invUpdates).toEqual([]);
    expect(statusResets[0].data).toEqual({ status: 'DRAFT', sentAt: null });
  });

  it('asks only about the source branch and only about the ingredients being moved', async () => {
    const { svc, tx } = build({ tickets: [{ branchId: FROM, status: 'PAID', quantity: 2 }], quantity: 600 });
    await svc.sendTransfer(TENANT, 'tr1');
    expect(tx.orderItem.findMany.mock.calls[0][0].where.order.branchId).toEqual({ in: [FROM] });
  });

  it('sends everything that is free, and still takes off only the amount moved', async () => {
    // 1,000 - 400 held = 600 free; sending exactly 600 goes, and the book
    // falls by 600 -- the held 400 is taken later by the ready tap.
    const { svc, invUpdates } = build({ tickets: [{ branchId: FROM, status: 'COMPLETED', quantity: 2 }], quantity: 600 });
    await svc.sendTransfer(TENANT, 'tr1');
    expect(invUpdates).toHaveLength(1);
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 600 });
  });

  it('ignores a waiting ticket at another branch', async () => {
    const { svc, invUpdates } = build({ tickets: [{ branchId: OTHER, status: 'PAID', quantity: 2 }] });
    await svc.sendTransfer(TENANT, 'tr1');
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 700 });
  });

  it('ignores a waiting line on a voided order -- it will never be made', async () => {
    const { svc, invUpdates } = build({ tickets: [{ branchId: FROM, status: 'VOIDED', quantity: 2 }] });
    await svc.sendTransfer(TENANT, 'tr1');
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 700 });
  });

  it('ignores a line whose ready tap already took its ingredients', async () => {
    const { svc, invUpdates } = build({
      tickets: [{ branchId: FROM, status: 'PAID', quantity: 2, usagePostedAt: new Date('2026-09-15T03:00:00Z') }],
    });
    await svc.sendTransfer(TENANT, 'tr1');
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 700 });
  });

  describe('with nothing waiting', () => {
    it('sends the whole shelf, as before', async () => {
      const { svc, invUpdates } = build({ quantity: 1000 });
      await svc.sendTransfer(TENANT, 'tr1');
      expect(invUpdates[0].data.quantity).toEqual({ decrement: 1000 });
    });

    it('refuses one more than the shelf with the same message as before', async () => {
      const { svc, invUpdates } = build({ quantity: 1001 });
      await expect(svc.sendTransfer(TENANT, 'tr1')).rejects.toThrow(
        'Insufficient stock at source for raw-material milk: have 1000, need 1001.',
      );
      expect(invUpdates).toEqual([]);
    });
  });
});

describe('WarehouseService.startCycleCount — expects the shelf short by what waiting tickets hold', () => {
  const BRANCH = FROM;

  function build(opts: { tickets?: Ticket[]; rows?: Array<{ rawMaterialId: string; quantity: Prisma.Decimal }> } = {}) {
    const created: any[] = [];
    const tx: any = {
      ...recipeTables(opts.tickets ?? []),
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterial: { findMany: jest.fn().mockResolvedValue([{ id: 'beans' }, { id: 'milk' }, { id: 'syrup' }]) },
      rawMaterialInventory: {
        findMany: jest.fn().mockResolvedValue(opts.rows ?? [
          { rawMaterialId: 'beans', quantity: new Prisma.Decimal('4200.5') },
          { rawMaterialId: 'milk',  quantity: new Prisma.Decimal('1000') },
          // syrup has never been received: no row
        ]),
      },
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((a: any) => { created.push(a.data); return Promise.resolve(a.data); }),
      },
    };
    const prisma: any = { $transaction: (fn: any) => fn(tx) };
    const svc = new WarehouseService(prisma, undefined as any);
    const line = (rm: string) => created[0].lines.create.find((l: any) => l.rawMaterialId === rm);
    return { svc, tx, line };
  }

  it('snapshots on hand less the milk two waiting lattes hold, and defaults the count to it', async () => {
    const { svc, line } = build({ tickets: [{ branchId: BRANCH, status: 'PAID', quantity: 2 }] });
    await svc.startCycleCount(TENANT, BRANCH, 'u1');

    expect(Number(line('milk').expectedQty)).toBe(600);
    expect(Number(line('milk').countedQty)).toBe(600);
    // An ingredient no ticket uses keeps its book figure.
    expect(Number(line('beans').expectedQty)).toBe(4200.5);
  });

  it('never expects less than an empty shelf', async () => {
    // Held 1,200 against 1,000 on the books.
    const { svc, line } = build({ tickets: [{ branchId: BRANCH, status: 'PAID', quantity: 6 }] });
    await svc.startCycleCount(TENANT, BRANCH, 'u1');
    expect(Number(line('milk').expectedQty)).toBe(0);
    expect(Number(line('milk').countedQty)).toBe(0);
  });

  it('counts a partly refunded ticket only for what is still to be made', async () => {
    const { svc, line } = build({ tickets: [{ branchId: BRANCH, status: 'COMPLETED', quantity: 3, refundedQty: 2 }] });
    await svc.startCycleCount(TENANT, BRANCH, 'u1');
    expect(Number(line('milk').expectedQty)).toBe(800);
  });

  it('ignores a waiting ticket at another branch', async () => {
    const { svc, line, tx } = build({ tickets: [{ branchId: OTHER, status: 'PAID', quantity: 2 }] });
    await svc.startCycleCount(TENANT, BRANCH, 'u1');
    expect(tx.orderItem.findMany.mock.calls[0][0].where.order.branchId).toEqual({ in: [BRANCH] });
    expect(Number(line('milk').expectedQty)).toBe(1000);
  });

  it('ignores a waiting line on a voided order', async () => {
    const { svc, line } = build({ tickets: [{ branchId: BRANCH, status: 'VOIDED', quantity: 2 }] });
    await svc.startCycleCount(TENANT, BRANCH, 'u1');
    expect(Number(line('milk').expectedQty)).toBe(1000);
  });

  it('with nothing waiting snapshots the book figures exactly as before', async () => {
    const { svc, line } = build();
    await svc.startCycleCount(TENANT, BRANCH, 'u1');
    expect(line('beans').expectedQty.toString()).toBe('4200.5');
    expect(line('beans').countedQty.toString()).toBe('4200.5');
    expect(line('milk').expectedQty.toString()).toBe('1000');
    expect(line('syrup').expectedQty.toString()).toBe('0');
  });
});
