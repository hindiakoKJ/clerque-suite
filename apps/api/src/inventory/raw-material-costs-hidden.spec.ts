import { InventoryController } from './inventory.controller';
import {
  InventoryService, rawMaterialRowWithoutCost, rawMaterialStockRowWithoutCost,
} from './inventory.service';

/**
 * "Show purchase costs to staff" OFF must hide costs on the ingredient list.
 *
 * Go-live audit: turning the switch off did not hide costs. GET raw-materials
 * is how the cook's and the barista's pickers learn the ingredient names, and
 * every row carried the ingredient's cost per unit; the stock list carried
 * that and the peso value of the shelf.
 *
 * Filtered on the way OUT only. RawMaterial.costPrice is what every recipe and
 * every profit figure is costed from, so it is never blanked to hide it.
 */

/** Every key in a response, at any depth. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) { for (const v of value) allKeys(v, out); return out; }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    for (const [k, v] of Object.entries(value)) { out.push(k); allKeys(v, out); }
  }
  return out;
}
/*
  Any key that could carry money. The ingredient rows have no non-money key
  that matches it ("availableQty" does not contain "value"), so the check
  needs no exceptions.
*/
const MONEY_KEY = /cost|price|value/i;
const moneyKeys = (response: unknown) => allKeys(response).filter((k) => MONEY_KEY.test(k));

const TENANT = 't1';
const BRANCH = 'b1';
const user = (role: string) => ({ sub: 'u1', tenantId: TENANT, branchId: BRANCH, role }) as any;

/** A RawMaterial row with every column the table has, as Prisma returns it. */
const milk = {
  id: 'rm-milk', tenantId: TENANT, name: 'Fresh Milk', unit: 'ml', category: 'INGREDIENT',
  costPrice: 0.095, lowStockAlert: 2000, lotsTracked: false, batchYield: null, isActive: true,
  createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-20'),
  inventory: [{ quantity: 5400 }],
};

function build(showToStaff: boolean) {
  const prisma: any = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: showToStaff }) },
    rawMaterial: {
      // The list itself, and the "which of these does a recipe use" read (select: id).
      findMany: jest.fn(({ select }: any) => Promise.resolve(select ? [{ id: milk.id }] : [structuredClone(milk)])),
      update:   jest.fn(),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    rawMaterialInventory: {
      findMany: jest.fn().mockResolvedValue([{
        id: 'inv1', tenantId: TENANT, branchId: BRANCH, rawMaterialId: milk.id, quantity: 5400,
        createdAt: new Date('2026-09-01'), updatedAt: new Date('2026-09-20'),
        rawMaterial: { id: milk.id, name: milk.name, unit: milk.unit, costPrice: milk.costPrice, isActive: true },
      }]),
    },
  };
  const svc = new InventoryService(prisma, {} as any);
  const controller = new InventoryController(svc, {} as any, prisma);
  return { controller, prisma, svc };
}

describe('Ingredient list costs — hidden from staff when the owner says so', () => {
  describe('GET /inventory/raw-materials', () => {
    it("a cook's ingredient list carries no money at all once costs are hidden", async () => {
      const { controller } = build(false);
      const rows: any[] = await controller.listRawMaterials(user('GENERAL_EMPLOYEE'), undefined, BRANCH);
      expect(moneyKeys(rows)).toEqual([]);
      // Still the list the pickers need: names, units, stock and the low flag.
      expect(rows[0]).toMatchObject({ name: 'Fresh Milk', unit: 'ml', stockQty: 5400, isLowStock: false, inRecipe: true });
    });

    it('hides it from the cashier and the stock clerk too', async () => {
      for (const role of ['CASHIER', 'SALES_LEAD', 'WAREHOUSE_STAFF']) {
        const { controller } = build(false);
        expect(moneyKeys(await controller.listRawMaterials(user(role), undefined, BRANCH))).toEqual([]);
      }
    });

    it("the owner's list in the same shop still shows the cost", async () => {
      for (const role of ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM']) {
        const { controller } = build(false);
        const rows: any[] = await controller.listRawMaterials(user(role), undefined, BRANCH);
        expect(rows[0].costPrice).toBe(0.095);
      }
    });

    it('changes nothing for a shop that shows costs to its staff', async () => {
      const { controller } = build(true);
      const rows: any[] = await controller.listRawMaterials(user('GENERAL_EMPLOYEE'), undefined, BRANCH);
      expect(rows[0].costPrice).toBe(0.095);
    });

    it('leaves the key OUT, so a screen can tell "hidden" from "no cost on file"', async () => {
      const { controller } = build(false);
      const [row]: any[] = await controller.listRawMaterials(user('GENERAL_EMPLOYEE'), undefined, BRANCH);
      expect(row).not.toHaveProperty('costPrice');
    });

    it('never touches the stored cost -- only the answer is filtered', async () => {
      const { controller, prisma } = build(false);
      await controller.listRawMaterials(user('GENERAL_EMPLOYEE'), undefined, BRANCH);
      expect(prisma.rawMaterial.update).not.toHaveBeenCalled();
    });
  });

  describe('GET /inventory/raw-materials/stock', () => {
    it("the stock clerk's list has no cost and no peso value of the shelf", async () => {
      const { controller } = build(false);
      const rows: any[] = await controller.listRawMaterialStock(user('WAREHOUSE_STAFF'), BRANCH);
      expect(moneyKeys(rows)).toEqual([]);
      expect(rows[0]).toMatchObject({ quantity: 5400, rawMaterial: { name: 'Fresh Milk', unit: 'ml' } });
    });

    it('the owner still sees both', async () => {
      const { controller } = build(false);
      const [row]: any[] = await controller.listRawMaterialStock(user('BUSINESS_OWNER'), BRANCH);
      expect(row.costPrice).toBe(0.095);
      expect(row.totalValue).toBeCloseTo(513, 6);          // 5400 ml x 0.095
      expect(row.rawMaterial.costPrice).toBe(0.095);
    });
  });

  /*
    WAREHOUSE_STAFF open Stock on hand, and from it the Movement Log; they
    receive, and edit an ingredient's name. Each of those answered with money.
  */
  describe('GET /inventory/movements', () => {
    const moves = () => [
      { id: 'm1', kind: 'RAW_MATERIAL', type: 'STOCK_IN', itemName: 'Fresh Milk', quantity: 1000, totalValue: 95, paymentMethod: 'CASH' },
      { id: 'm2', kind: 'PRODUCT', type: 'SALE_DEDUCTION', itemName: 'Latte', quantity: -1, totalValue: null, paymentMethod: null },
    ];

    it("the stock clerk's log says what moved, not what it was worth", async () => {
      const { controller, svc } = build(false);
      jest.spyOn(svc, 'getAllMovements').mockResolvedValue(moves() as any);
      const rows: any[] = await controller.getMovements(user('WAREHOUSE_STAFF'), BRANCH);
      expect(moneyKeys(rows)).toEqual([]);
      expect(rows[0]).toMatchObject({ itemName: 'Fresh Milk', quantity: 1000, paymentMethod: 'CASH' });
    });

    it('the owner, and a shop that shows costs, still get the value', async () => {
      for (const [show, role] of [[false, 'BUSINESS_OWNER'], [true, 'WAREHOUSE_STAFF']] as const) {
        const { controller, svc } = build(show);
        jest.spyOn(svc, 'getAllMovements').mockResolvedValue(moves() as any);
        const rows: any[] = await controller.getMovements(user(role), BRANCH);
        expect(rows[0].totalValue).toBe(95);
      }
    });
  });

  describe('POST /inventory/raw-materials/:id/receive', () => {
    const answer = () => ({
      rawMaterialId: milk.id, branchId: BRANCH, quantityBefore: 5400, quantityAfter: 6400, quantity: 1000,
      receivedAt: '2026-09-21T00:00:00.000Z', paymentMethod: 'CASH', totalValue: 95, warning: null,
      marginAlerts: [{ productId: 'p1', name: 'Latte', price: 120, cost: 130, lossEach: 10 }],
    });

    it('answers the stock clerk without the delivery value or the margin alerts, and says who asked', async () => {
      const { controller, svc } = build(false);
      const spy = jest.spyOn(svc, 'receiveRawMaterialChecked').mockResolvedValue(answer() as any);
      const res: any = await controller.receiveRawMaterial(user('WAREHOUSE_STAFF'), milk.id, { branchId: BRANCH, quantity: 1000 } as any);
      expect(moneyKeys(res)).toEqual([]);
      expect(res).toMatchObject({ quantityAfter: 6400, paymentMethod: 'CASH', warning: null });
      expect(spy.mock.calls[0][4]).toEqual({ costsHidden: true });
    });

    it('the owner, and a shop that shows costs, get the full answer', async () => {
      for (const [show, role] of [[false, 'BUSINESS_OWNER'], [true, 'WAREHOUSE_STAFF']] as const) {
        const { controller, svc } = build(show);
        const spy = jest.spyOn(svc, 'receiveRawMaterialChecked').mockResolvedValue(answer() as any);
        const res: any = await controller.receiveRawMaterial(user(role), milk.id, { branchId: BRANCH, quantity: 1000 } as any);
        expect(res.totalValue).toBe(95);
        expect(res.marginAlerts).toHaveLength(1);
        expect(spy.mock.calls[0][4]).toEqual({ costsHidden: false });
      }
    });
  });

  describe('the ten-times refusal on a receipt', () => {
    // Milk on file at ₱0.095 per ml; a clerk types the price of the whole litre.
    function guarded() {
      const prisma: any = {
        rawMaterial: { findFirst: jest.fn().mockResolvedValue({ ...milk }) },
        branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT' }) },
        rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      return new InventoryService(prisma, { assertDateIsOpen: jest.fn() } as any);
    }

    it('does not recite the cost on file to someone costs are hidden from', async () => {
      const err = await guarded()
        .receiveRawMaterial(TENANT, milk.id, { branchId: BRANCH, quantity: 1000, costPrice: 95 } as any, { costsHidden: true })
        .catch((e) => e);
      expect(err.message).toContain('"Fresh Milk": ₱95.00 per ml is about ten times off what it usually costs.');
      expect(err.message).toMatch(/Check the unit/);                 // the screen still offers "the price really changed"
      expect(err.message).not.toMatch(/0\.095|on file at|times more/);
    });

    it('still names it for the owner, word for word as before', async () => {
      const err = await guarded()
        .receiveRawMaterial(TENANT, milk.id, { branchId: BRANCH, quantity: 1000, costPrice: 95 } as any)
        .catch((e) => e);
      expect(err.message).toMatch(/is on file at ₱0\.095 per ml/);
      expect(err.message).toMatch(/1000 times more/);
    });
  });

  describe('PATCH /inventory/raw-materials/:id', () => {
    it("answers the stock clerk's edit without the cost on file or margin alerts", async () => {
      const { controller, svc } = build(false);
      jest.spyOn(svc, 'updateRawMaterial').mockResolvedValue({ ...milk, name: 'Whole Milk', marginAlerts: [] } as any);
      const res: any = await controller.updateRawMaterial(user('WAREHOUSE_STAFF'), milk.id, { name: 'Whole Milk' } as any);
      expect(moneyKeys(res)).toEqual([]);
      expect(res.name).toBe('Whole Milk');
    });

    it('the owner gets the saved row as it was', async () => {
      const { controller, svc } = build(false);
      jest.spyOn(svc, 'updateRawMaterial').mockResolvedValue({ ...milk, marginAlerts: [] } as any);
      const res: any = await controller.updateRawMaterial(user('BUSINESS_OWNER'), milk.id, { name: 'x' } as any);
      expect(res.costPrice).toBe(0.095);
      expect(res).toHaveProperty('marginAlerts');
    });
  });

  describe('the filters themselves', () => {
    it('do not change the row they were given', () => {
      const row = { id: 'x', costPrice: 1, totalValue: 5, rawMaterial: { id: 'y', costPrice: 1 } };
      rawMaterialRowWithoutCost(row);
      rawMaterialStockRowWithoutCost(row);
      expect(row).toEqual({ id: 'x', costPrice: 1, totalValue: 5, rawMaterial: { id: 'y', costPrice: 1 } });
    });
  });
});
