import { SubRecipesController } from './sub-recipes.controller';
import { SubRecipesService } from './sub-recipes.service';
import { boardRowWithoutCost, recipeWithoutCosts, batchResultWithoutCosts } from './prep-costs';

/**
 * "Show purchase costs to staff" OFF must hide costs on the prep board too.
 *
 * Go-live audit: turning the switch off did not hide costs. The board printed
 * every prep's cost per gram on the card, GET one recipe carried the cost of
 * everything in it, and recording a batch answered with what the batch was
 * worth -- to the cook, the barista and the cashier alike.
 *
 * Filtered on the way OUT only. The service keeps working with the real
 * figures, because making a batch blends them into the average cost and the
 * profit reports run on that average.
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
  Any key that could carry money. None of the prep responses has a non-money
  key that matches this, so the check needs no exceptions.
*/
const MONEY_KEY = /cost|price|value/i;
const moneyKeys = (response: unknown) => allKeys(response).filter((k) => MONEY_KEY.test(k));

const TENANT = 't1';
const BRANCH = 'b1';
const SYRUP  = 'rm-syrup';

const user = (role: string) => ({
  sub: 'u1', tenantId: TENANT, branchId: BRANCH, role, personaKey: null,
}) as any;

/**
 * The real service over Cafe Carolina's syrup: 1000 g sugar + 500 ml water
 * yielding 1130 ml. `showToStaff` is Tenant.showPurchaseCostsToStaff.
 */
function build(showToStaff: boolean) {
  const lines = [
    { id: 'rm-sugar', name: 'White Sugar', unit: 'g',  cost: 0.09,  qty: 1000 },
    { id: 'rm-water', name: 'Water',       unit: 'ml', cost: 0.002, qty: 500  },
  ];
  const syrupRow = {
    id: SYRUP, name: 'White Sugar Syrup', unit: 'ml', costPrice: 0.0806, batchYield: 1130,
    lowStockAlert: 500,
    inventory: [{ quantity: 711 }],
    subRecipeItems: lines.map((l) => ({
      id: 'sri-' + l.id, quantity: l.qty,
      rawMaterial: { id: l.id, name: l.name, unit: l.unit, costPrice: l.cost },
    })),
  };
  const costWrites: number[] = [];
  const tx: any = {
    rawMaterialInventory: {
      update:     jest.fn().mockResolvedValue({}),
      upsert:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ quantity: 711 }),
    },
    rawMaterial: {
      update: jest.fn(({ data }: any) => { costWrites.push(Number(data.costPrice)); return Promise.resolve({}); }),
    },
    accountingEvent: { create: jest.fn().mockResolvedValue({}) },
    rawMaterialLot: {
      create:    jest.fn().mockResolvedValue({}),
      findMany:  jest.fn().mockResolvedValue([]),
      update:    jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  };
  const prisma: any = {
    tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: showToStaff }) },
    rawMaterial: {
      // GET one recipe, and makeBatch's own read of it.
      findFirst: jest.fn().mockResolvedValue({
        id: syrupRow.id, name: syrupRow.name, unit: syrupRow.unit,
        costPrice: syrupRow.costPrice, batchYield: syrupRow.batchYield,
        subRecipeItems: syrupRow.subRecipeItems,
      }),
      // The board.
      findMany: jest.fn().mockResolvedValue([syrupRow]),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH, name: 'Main' }) },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    rawMaterialInventory: {
      findMany: jest.fn().mockResolvedValue([
        { rawMaterialId: 'rm-sugar', quantity: 8000 },
        { rawMaterialId: 'rm-water', quantity: 108000 },
        { rawMaterialId: SYRUP, quantity: 711 },
      ]),
    },
    bomItem: {
      findMany: jest.fn().mockResolvedValue([
        { rawMaterialId: SYRUP, quantity: 30, product: { id: 'p-latte', name: 'Latte',
          category: { id: 'c1', name: 'Coffee', station: { id: 's-bar', name: 'Bar', kind: 'BAR' } } } },
      ]),
    },
    variantBomItem:           { findMany: jest.fn().mockResolvedValue([]) },
    modifierOptionIngredient: { findMany: jest.fn().mockResolvedValue([]) },
    station: { findMany: jest.fn().mockResolvedValue([{ kind: 'BAR' }]) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  const svc = new SubRecipesService(prisma);
  const controller = new SubRecipesController(svc, prisma);
  return { controller, prisma, costWrites };
}

describe('Prep board costs — hidden from staff when the owner says so', () => {
  describe('the board (GET /inventory/sub-recipes)', () => {
    it("a cook's board carries no money at all once costs are hidden", async () => {
      const { controller } = build(false);
      const rows: any[] = await controller.list(user('GENERAL_EMPLOYEE'));
      expect(rows).toHaveLength(1);
      expect(moneyKeys(rows)).toEqual([]);
      // ...and is still the whole board: what is on hand, what it serves, what it is made from.
      expect(rows[0].name).toBe('White Sugar Syrup');
      expect(rows[0].onHand).toBe(711);
      expect(rows[0].batches).toBe(8);
      expect(rows[0].serves[0]).toMatchObject({ productName: 'Latte', servingsLeft: 23 });
      expect(rows[0].components.map((c: any) => c.name)).toEqual(['White Sugar', 'Water']);
    });

    it('hides it from the cashier and the barista too, not only the cook', async () => {
      for (const role of ['CASHIER', 'SALES_LEAD', 'WAREHOUSE_STAFF']) {
        const { controller } = build(false);
        expect(moneyKeys(await controller.list(user(role)))).toEqual([]);
      }
    });

    it("the owner's board in the same shop still shows the cost", async () => {
      for (const role of ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM']) {
        const { controller } = build(false);
        const rows: any[] = await controller.list(user(role));
        expect(rows[0].costPrice).toBe(0.0806);
      }
    });

    it('changes nothing for a shop that shows costs to its staff', async () => {
      const { controller } = build(true);
      const rows: any[] = await controller.list(user('GENERAL_EMPLOYEE'));
      expect(rows[0].costPrice).toBe(0.0806);
    });

    it('does not ask the database for the owner, who always sees', async () => {
      const { controller, prisma } = build(false);
      await controller.list(user('BUSINESS_OWNER'));
      expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('one recipe (GET /inventory/sub-recipes/:id)', () => {
    it('a cook sees what goes in, but not what anything costs', async () => {
      const { controller } = build(false);
      const recipe: any = await controller.get(user('GENERAL_EMPLOYEE'), SYRUP);
      expect(moneyKeys(recipe)).toEqual([]);
      expect(recipe.subRecipeItems.map((l: any) => [l.rawMaterial.name, l.quantity]))
        .toEqual([['White Sugar', 1000], ['Water', 500]]);
    });

    it('the owner sees the cost of the prep and of every ingredient in it', async () => {
      const { controller } = build(false);
      const recipe: any = await controller.get(user('BUSINESS_OWNER'), SYRUP);
      expect(recipe.costPrice).toBe(0.0806);
      expect(recipe.subRecipeItems.map((l: any) => l.rawMaterial.costPrice)).toEqual([0.09, 0.002]);
    });
  });

  describe('recording a batch (POST /inventory/sub-recipes/:id/batches)', () => {
    it("the cook's answer says what was made, not what it was worth", async () => {
      const { controller } = build(false);
      const res: any = await controller.makeBatch(user('GENERAL_EMPLOYEE'), SYRUP, { branchId: BRANCH, batches: 1 });
      expect(moneyKeys(res)).toEqual([]);
      expect(res.produced).toBe(1130);
      expect(res.unit).toBe('ml');
      expect(res.consumed.map((c: any) => [c.name, c.quantity])).toEqual([['White Sugar', 1000], ['Water', 500]]);
    });

    it('still records the batch at its real cost -- only the answer is filtered', async () => {
      // Blanking the stored cost to hide it would zero every margin in the shop.
      const { controller, costWrites } = build(false);
      await controller.makeBatch(user('GENERAL_EMPLOYEE'), SYRUP, { branchId: BRANCH, batches: 1 });
      // (711 x 0.0806 + 1130 x (91 / 1130)) / 1841: the old average blended with this batch.
      expect(costWrites).toHaveLength(1);
      expect(costWrites[0]).toBeCloseTo((711 * 0.0806 + 91) / 1841, 6);
    });

    it('the owner still gets the cost of the batch', async () => {
      const { controller } = build(false);
      const res: any = await controller.makeBatch(user('BUSINESS_OWNER'), SYRUP, { branchId: BRANCH, batches: 1 });
      expect(res.inputValue).toBeCloseTo(91, 6);         // 1000 x 0.09 + 500 x 0.002
      expect(res.unitCost).toBeCloseTo(91 / 1130, 6);
      expect(res.newWac).toBeCloseTo((711 * 0.0806 + 91) / 1841, 6);
    });
  });

  describe('the filters themselves', () => {
    it('leave a row that has no cost alone', () => {
      expect(boardRowWithoutCost({ id: 'x', name: 'Sauce' })).toEqual({ id: 'x', name: 'Sauce' });
      expect(recipeWithoutCosts({ id: 'x' })).toEqual({ id: 'x' });
      // A duplicate tap answers without costs already.
      const dup = { rawMaterialId: 'x', produced: 1130, duplicate: true, message: 'Already recorded.' };
      expect(batchResultWithoutCosts(dup)).toEqual(dup);
    });

    it('do not change the object they were given', () => {
      const row = { id: 'x', costPrice: 1, subRecipeItems: [{ rawMaterial: { id: 'y', costPrice: 2 } }] };
      recipeWithoutCosts(row);
      boardRowWithoutCost(row);
      expect(row.costPrice).toBe(1);
      expect(row.subRecipeItems[0].rawMaterial.costPrice).toBe(2);
    });
  });
});
