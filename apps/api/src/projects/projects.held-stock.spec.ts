import { Prisma } from '@prisma/client';
import { ProjectsService } from './projects.service';

/**
 * Issuing materials to a project refuses what waiting kitchen/bar tickets at
 * the branch hold.
 *
 * Those tickets have not taken their ingredients off the books yet -- the
 * ready tap does that -- so the book figure alone would let a project walk off
 * with milk the tap still has to take. Only tickets at the same branch, on an
 * order that will still be made, hold anything; with nothing waiting the
 * issuance behaves exactly as before, and the decrement is always the amount
 * issued.
 */

const TENANT = 't1';
const BRANCH = 'b-main';
const OTHER = 'b-court';

interface Ticket { branchId: string; status: string; quantity: number }

function build(opts: { tickets?: Ticket[]; onHand?: number } = {}) {
  const tickets = opts.tickets ?? [];
  const invUpdates: any[] = [];
  const tx: any = {
    project: {
      findFirst: jest.fn().mockResolvedValue({ id: 'p1', tenantId: TENANT, projectCode: 'PRJ-2026-000001', status: 'ACTIVE' }),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
    rawMaterial: { findMany: jest.fn().mockResolvedValue([{ id: 'milk', name: 'Fresh milk', costPrice: 0.08 }]) },
    rawMaterialInventory: {
      findUnique: jest.fn().mockResolvedValue({ quantity: new Prisma.Decimal(opts.onHand ?? 1000) }),
      update: jest.fn().mockImplementation((a: any) => { invUpdates.push(a); return Promise.resolve({}); }),
    },
    /*
      Enough of the order/recipe tables for heldUsage to run for real. The line
      query honours the filters the helper sends -- waiting, tenant, status and
      branch -- the way the database would. A latte uses 200 ml of milk.
    */
    orderItem: {
      findMany: jest.fn(async ({ where }: any) => tickets
        .filter(() => where.usageOnReady === true && where.usagePostedAt === null)
        .filter(() => where.order.tenantId === TENANT)
        .filter((t) => where.order.status.in.includes(t.status))
        .filter((t) => !where.order.branchId || where.order.branchId.in.includes(t.branchId))
        .map((t) => ({
          productId: 'latte', variantId: null, quantity: t.quantity, refundedQty: 0,
          modifiers: [], order: { branchId: t.branchId },
        }))),
    },
    bomItem: {
      findMany: jest.fn(async ({ where }: any) => (where.productId.in.includes('latte')
        ? [{ productId: 'latte', rawMaterialId: 'milk', quantity: 200, rawMaterial: null }]
        : [])),
    },
    variantBomItem: { findMany: jest.fn(async () => []) },
    modifierOption: { findMany: jest.fn(async () => []) },
    materialIssuance: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'iss-1', issuanceNumber: 'ISS-2026-000001', lines: [] }),
    },
    account: { findMany: jest.fn().mockResolvedValue([]) },
    journalEntry: { create: jest.fn() },
  };
  const prisma: any = { $transaction: (fn: any) => fn(tx) };
  const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
  const svc = new ProjectsService(prisma, periods);
  const issue = (quantity: number) =>
    svc.issueMaterials(TENANT, 'p1', 'u1', { branchId: BRANCH, lines: [{ rawMaterialId: 'milk', quantity }] });
  return { issue, tx, invUpdates };
}

describe('ProjectsService.issueMaterials — what waiting tickets hold stays behind', () => {
  it('refuses milk that waiting bar tickets at the branch still need, and says how much is held', async () => {
    // 1,000 ml on the books; two lattes waiting hold 400 ml; 700 ml asked for.
    const { issue, invUpdates } = build({ tickets: [{ branchId: BRANCH, status: 'PAID', quantity: 2 }] });

    await expect(issue(700)).rejects.toThrow(
      'Insufficient stock for Fresh milk: have 1000, of which 400 is held for kitchen/bar ' +
      'tickets still waiting to be made, so 600 can be issued; need 700.',
    );
    expect(invUpdates).toEqual([]);
  });

  it('issues everything that is free, and takes off only the amount issued', async () => {
    const { issue, invUpdates, tx } = build({ tickets: [{ branchId: BRANCH, status: 'COMPLETED', quantity: 2 }] });
    await issue(600);
    expect(tx.orderItem.findMany.mock.calls[0][0].where.order.branchId).toEqual({ in: [BRANCH] });
    expect(invUpdates).toHaveLength(1);
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 600 });
  });

  it('ignores a waiting ticket at another branch', async () => {
    const { issue, invUpdates } = build({ tickets: [{ branchId: OTHER, status: 'PAID', quantity: 2 }] });
    await issue(700);
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 700 });
  });

  it('ignores a waiting line on a voided order -- it will never be made', async () => {
    const { issue, invUpdates } = build({ tickets: [{ branchId: BRANCH, status: 'VOIDED', quantity: 2 }] });
    await issue(700);
    expect(invUpdates[0].data.quantity).toEqual({ decrement: 700 });
  });

  describe('with nothing waiting', () => {
    it('issues the whole shelf, as before', async () => {
      const { issue, invUpdates } = build();
      await issue(1000);
      expect(invUpdates[0].data.quantity).toEqual({ decrement: 1000 });
    });

    it('refuses one more than the shelf with the same message as before', async () => {
      const { issue, invUpdates } = build();
      await expect(issue(1001)).rejects.toThrow('Insufficient stock for Fresh milk: have 1000, need 1001.');
      expect(invUpdates).toEqual([]);
    });
  });
});
