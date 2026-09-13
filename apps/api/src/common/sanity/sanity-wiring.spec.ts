import { CloseAndPlanService } from '../../close-and-plan/close-and-plan.service';
import { InventoryService } from '../../inventory/inventory.service';
import { ProductsService } from '../../products/products.service';
import { ProcureService } from '../../procure/procure.service';
import { CostSanityService } from './cost-sanity.service';
import { SanityConfirmRequiredException, SanityWarning, sanityContext } from './sanity.types';

/**
 * Where the question is asked: before anything is written.
 *
 * The rules and the history are tested elsewhere. What these pin is the one
 * property that makes the question worth anything: on every screen that saves
 * a cost or a price, an unanswered question stops the save BEFORE the first
 * write, and a confirmed one lets it through. A question asked after the stock
 * has posted would be a notification, not a check -- and one asked inside a
 * per-line loop would turn into a silent failure nobody can answer.
 */
describe('The price question is asked before anything is saved', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const ASKING = sanityContext('1', undefined, 'owner-1');

  /** A real CostSanityService whose judgement is fixed, so the wiring is what is tested. */
  function sanityThatWarns(warnings: (key: string) => SanityWarning[]) {
    const svc = new CostSanityService({ auditLog: { create: jest.fn().mockResolvedValue({}) } } as never);
    jest.spyOn(svc, 'checkIngredientCosts').mockImplementation(async (_t, lines) => lines.flatMap((l) => warnings(l.key)));
    jest.spyOn(svc, 'checkProduct').mockImplementation(async (_t, input) => warnings(`${input.key}:any`));
    jest.spyOn(svc, 'recordConfirmed');
    return svc;
  }

  const warning = (key: string, severity: 'unusual' | 'magnitude' = 'unusual'): SanityWarning => ({
    key, kind: 'INGREDIENT_COST', severity, name: 'Full cream milk', value: '0.190000',
    message: 'Full cream milk: ₱190.00 for 1,000 ml. Is this the correct cost?',
    typed: 190, usualLow: 86, usualHigh: 89, points: 8, unitLabel: 'for 1,000 ml',
  });

  describe('Stock on hand: receiving one delivery', () => {
    function build(sanity: CostSanityService) {
      const prisma: any = {};
      const svc = new InventoryService(prisma, {} as never, sanity) as any;
      svc.receiveRawMaterial = jest.fn().mockResolvedValue({ ok: true });
      return svc;
    }
    const dto = { branchId: BRANCH, quantity: 1000, costPrice: 0.19 };

    it('refuses before receiving when the cost has not been confirmed', async () => {
      const svc = build(sanityThatWarns((k) => [warning(k)]));
      await expect(svc.receiveRawMaterialChecked(TENANT, 'rm-milk', dto, ASKING)).rejects.toThrow(SanityConfirmRequiredException);
      expect(svc.receiveRawMaterial).not.toHaveBeenCalled();
    });

    it('receives once it is confirmed, and lifts the old guard for a confirmed ten-times price', async () => {
      const sanity = sanityThatWarns((k) => [warning(k, 'magnitude')]);
      const svc = build(sanity);
      await svc.receiveRawMaterialChecked(TENANT, 'rm-milk', dto,
        sanityContext('1', [{ key: 'rm:rm-milk:receive', value: '0.190000' }], 'owner-1'));
      expect(svc.receiveRawMaterial).toHaveBeenCalledWith(TENANT, 'rm-milk', expect.objectContaining({ acceptCostChange: true }));
      expect(sanity.recordConfirmed).toHaveBeenCalled();
    });

    it('does not ask a client that cannot show the question', async () => {
      const svc = build(sanityThatWarns((k) => [warning(k)]));
      await svc.receiveRawMaterialChecked(TENANT, 'rm-milk', dto, sanityContext(undefined, undefined));
      expect(svc.receiveRawMaterial).toHaveBeenCalledWith(TENANT, 'rm-milk', dto);
    });

    it('does not ask about a delivery that was already received under the same reference', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const svc = new InventoryService({ rawMaterialLot: { findFirst: jest.fn().mockResolvedValue({ id: 'lot-1' }) } } as never, {} as never, sanity) as any;
      svc.receiveRawMaterial = jest.fn().mockResolvedValue({ duplicate: true });
      await svc.receiveRawMaterialChecked(TENANT, 'rm-milk', { ...dto, referenceNumber: 'DR-1' }, ASKING);
      expect(sanity.checkIngredientCosts).not.toHaveBeenCalled();
      expect(svc.receiveRawMaterial).toHaveBeenCalled();
    });

    it('lifts the old guard for any price the person confirmed, not only a ten-times one', async () => {
      const svc = build(sanityThatWarns((k) => [warning(k, 'unusual')]));
      await svc.receiveRawMaterialChecked(TENANT, 'rm-milk', dto,
        sanityContext('1', [{ key: 'rm:rm-milk:receive', value: '0.190000' }], 'owner-1'));
      expect(svc.receiveRawMaterial).toHaveBeenCalledWith(TENANT, 'rm-milk', expect.objectContaining({ acceptCostChange: true }));
    });
  });

  describe('Stock on hand: editing an ingredient cost', () => {
    function build(sanity: CostSanityService, item: { unit: string; costPrice: number | null }) {
      const updates: any[] = [];
      const tx: any = {
        rawMaterial: { update: jest.fn(({ data }: any) => { updates.push(data); return Promise.resolve({ id: 'rm-milk', ...item, ...data, lowStockAlert: null }); }) },
        bomItem: { findMany: jest.fn().mockResolvedValue([]) },
      };
      const prisma: any = {
        rawMaterial: { findFirst: jest.fn().mockResolvedValue({ id: 'rm-milk', name: 'Full cream milk', category: 'INGREDIENT', ...item }) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT' }) },
        $transaction: jest.fn((fn: any) => fn(tx)),
      };
      return { svc: new InventoryService(prisma, {} as never, sanity) as any, updates };
    }

    it('refuses before overwriting a cost that looks wrong', async () => {
      const { svc, updates } = build(sanityThatWarns((k) => [warning(k)]), { unit: 'ml', costPrice: 0.088 });
      await expect(svc.updateRawMaterial(TENANT, 'rm-milk', { costPrice: 0.19 }, ASKING)).rejects.toThrow(SanityConfirmRequiredException);
      expect(updates).toEqual([]);
    });

    it('does not ask about a cost nobody changed', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const { svc, updates } = build(sanity, { unit: 'ml', costPrice: 0.088 });
      await svc.updateRawMaterial(TENANT, 'rm-milk', { name: 'Fresh milk', costPrice: 0.088 }, ASKING);
      expect(sanity.checkIngredientCosts).not.toHaveBeenCalled();
      expect(updates).toHaveLength(1);
    });

    it('does not compare against deliveries in a unit that is being changed in the same edit', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const recordUnit = jest.spyOn(sanity, 'recordUnitChange').mockResolvedValue();
      const { svc } = build(sanity, { unit: 'L', costPrice: 88 });
      await svc.updateRawMaterial(TENANT, 'rm-milk', { unit: 'ml', costPrice: 0.088 }, ASKING);
      expect(sanity.checkIngredientCosts).not.toHaveBeenCalled();
      expect(recordUnit).toHaveBeenCalledWith(TENANT, 'rm-milk', 'owner-1', 'L', 'ml');
    });
  });

  describe('Close & Plan: an evening of deliveries', () => {
    function build(sanity: CostSanityService) {
      const prisma: any = {
        rawMaterial: { findMany: jest.fn(({ where }: any) => Promise.resolve((where.id.in as string[]).map((id) => ({ id, name: id })))) },
        branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
        rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
        $transaction: jest.fn((fn: any) => fn(prisma)),
      };
      const inventory: any = { receiveRawMaterial: jest.fn().mockResolvedValue({ ok: true }) };
      return { svc: new CloseAndPlanService(prisma, inventory, sanity) as any, inventory };
    }
    const lines = [
      { rawMaterialId: 'rm-milk', qtyReceived: 1000, unitCost: 0.19, dupeOverride: true },
      { rawMaterialId: 'rm-sugar', qtyReceived: 1000, unitCost: 0.05, dupeOverride: true },
    ];

    it('asks about the whole draft at once, before the first line is received', async () => {
      const { svc, inventory } = build(sanityThatWarns((k) => (k === 'draft:0' ? [warning(k)] : [])));
      await expect(svc.batchReceive(TENANT, BRANCH, 'owner-1', lines, ASKING)).rejects.toThrow(SanityConfirmRequiredException);
      expect(inventory.receiveRawMaterial).not.toHaveBeenCalled();
    });

    it('receives every line once answered, lifting the old guard only for the confirmed one', async () => {
      const { svc, inventory } = build(sanityThatWarns((k) => (k === 'draft:0' ? [warning(k, 'magnitude')] : [])));
      await svc.batchReceive(TENANT, BRANCH, 'owner-1', lines, sanityContext('1', [{ key: 'draft:0', value: '0.190000' }], 'owner-1'));
      expect(inventory.receiveRawMaterial).toHaveBeenCalledTimes(2);
      expect(inventory.receiveRawMaterial.mock.calls[0][2]).toMatchObject({ acceptCostChange: true });
      expect(inventory.receiveRawMaterial.mock.calls[1][2].acceptCostChange).toBeUndefined();
    });
  });

  describe('Products: a selling price and a recipe', () => {
    function build(sanity: CostSanityService) {
      const writes: any[] = [];
      const product = {
        id: 'p1', tenantId: TENANT, name: 'Iced Latte', price: 150, costPrice: 45, isVatable: true,
        inventoryMode: 'UNIT_BASED', bomItems: [], category: null, variants: [], modifierGroups: [],
      };
      const prisma: any = {
        product: {
          findFirst: jest.fn().mockResolvedValue(product),
          update: jest.fn(({ data }: any) => { writes.push(data); return Promise.resolve({ ...product, ...data }); }),
          count: jest.fn().mockResolvedValue(0),
        },
        bomItem: { deleteMany: jest.fn(), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
        rawMaterial: { findMany: jest.fn().mockResolvedValue([]) },
        // the recipe-cap check a first recipe runs through
        tenant: { findUnique: jest.fn().mockResolvedValue({ planCode: null }) },
        $transaction: jest.fn((fn: any) => fn(prisma)),
      };
      return { svc: new ProductsService(prisma, sanity) as any, writes, prisma };
    }

    it('refuses a price jump before the product is updated', async () => {
      const { svc, writes } = build(sanityThatWarns((k) => [warning(k)]));
      await expect(svc.update(TENANT, 'p1', { price: 1500 }, 'BUSINESS_OWNER', ASKING)).rejects.toThrow(SanityConfirmRequiredException);
      expect(writes).toEqual([]);
    });

    it('does not ask about a price nobody changed', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const { svc, writes } = build(sanity);
      await svc.update(TENANT, 'p1', { name: 'Iced Latte (L)', price: 150 }, 'BUSINESS_OWNER', ASKING);
      expect(sanity.checkProduct).not.toHaveBeenCalled();
      expect(writes).toHaveLength(1);
    });

    it('judges the margin of a recipe drink when its price is cut, against the recipe on file', async () => {
      const sanity = sanityThatWarns(() => []);
      const { svc, prisma } = build(sanity);
      prisma.product.findFirst.mockResolvedValue({
        id: 'p1', tenantId: TENANT, name: 'Iced Latte', price: 65, costPrice: 52, isVatable: true,
        inventoryMode: 'RECIPE_BASED', bomItems: [{ rawMaterialId: 'rm-milk', quantity: 200, rawMaterial: { costPrice: 0.26 } }],
        category: null, variants: [], modifierGroups: [],
      });
      await svc.update(TENANT, 'p1', { price: 58 }, 'BUSINESS_OWNER', ASKING);
      expect(sanity.checkProduct).toHaveBeenCalledWith(TENANT, expect.objectContaining({ checkMargin: true, cost: 52, price: 58 }), ASKING);
    });

    it('judges a recipe before the old one is wiped', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      jest.spyOn(sanity, 'recipeCost').mockResolvedValue({ cost: 210, partlyPriced: false });
      const { svc, prisma } = build(sanity);
      await expect(svc.saveBom(TENANT, 'p1', [{ rawMaterialId: 'rm-milk', quantity: 200 }], ASKING)).rejects.toThrow(SanityConfirmRequiredException);
      expect(prisma.bomItem.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('Receipts: confirming a photographed receipt', () => {
    it('asks about each printed row before any of the three write paths runs', async () => {
      const { ProcureReceiptsService } = jest.requireActual('../../procure/procure-receipts.service');
      const prisma: any = {
        branch: { findFirst: jest.fn() },
        purchaseRequest: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
        purchaseRequestLine: { create: jest.fn(), update: jest.fn() },
      };
      const sanity = sanityThatWarns((k) => (k === 'row:1' ? [warning(k)] : []));
      const svc = new ProcureReceiptsService(prisma, {} as never, {} as never, {} as never, {} as never, sanity);
      await expect(svc.confirm(TENANT, 'owner-1', BRANCH, {
        paymentMethod: 'CASH',
        lines: [
          { rawMaterialId: 'rm-sugar', packsBought: 1, packSize: 1000, packCost: 85 },
          { rawMaterialId: 'rm-milk', packsBought: 1, packSize: 1000, packCost: 190 },
          { create: { name: 'Oat milk', unit: 'ml' }, packsBought: 1, packSize: 1000, packCost: 150 },
        ],
      }, ASKING)).rejects.toThrow(SanityConfirmRequiredException);
      // judged per printed row, and a brand-new ingredient (no history) is not asked about
      const judged = (sanity.checkIngredientCosts as jest.Mock).mock.calls[0][1].map((l: any) => l.key);
      expect(judged).toEqual(['row:0', 'row:1']);
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
      expect(prisma.purchaseRequest.create).not.toHaveBeenCalled();
    });
  });

  describe('Procure: posting what was bought', () => {
    it('does not ask again, as a dead end, about a ten-times price confirmed on the buy list', async () => {
      const request = {
        id: 'req1', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-1', status: 'BOUGHT', notes: null,
        lines: [{ id: 'l1', lineNumber: 'REQ-1-01', rawMaterialId: 'rm-milk', packsBought: 1, packSize: 1000, packCost: 900, receivedAt: null, brandNote: null, rawMaterial: { name: 'Full cream milk', unit: 'ml' } }],
      };
      const received: any[] = [];
      const prisma: any = {
        purchaseRequest: { findFirst: jest.fn().mockResolvedValue(request), update: jest.fn().mockResolvedValue(request) },
        purchaseRequestLine: { update: jest.fn().mockResolvedValue({}) },
        auditLog: {
          findMany: jest.fn().mockResolvedValue([
            { entityId: 'l1', after: { severity: 'magnitude', value: '0.900000' } },
          ]),
        },
      };
      const inventory: any = { receiveRawMaterial: jest.fn((_t: string, _rm: string, dto: any) => { received.push(dto); return Promise.resolve({}); }) };
      const svc = new ProcureService(prisma, inventory) as any;
      await svc.receiveRequest(TENANT, 'req1', 'owner-1', 'CASH', {});
      expect(received[0].acceptCostChange).toBe(true);
    });

    it('honours any price an owner confirmed, not only a ten-times one', async () => {
      const request = {
        id: 'req1', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-1', status: 'BOUGHT', notes: null,
        lines: [{ id: 'l1', lineNumber: 'REQ-1-01', rawMaterialId: 'rm-milk', packsBought: 1, packSize: 1000, packCost: 190, receivedAt: null, brandNote: null, rawMaterial: { name: 'Full cream milk', unit: 'ml' } }],
      };
      const received: any[] = [];
      const prisma: any = {
        purchaseRequest: { findFirst: jest.fn().mockResolvedValue(request), update: jest.fn().mockResolvedValue(request) },
        purchaseRequestLine: { update: jest.fn().mockResolvedValue({}) },
        auditLog: { findMany: jest.fn().mockResolvedValue([{ entityId: 'l1', after: { severity: 'unusual', value: '0.190000' } }]) },
      };
      const inventory: any = { receiveRawMaterial: jest.fn((_t: string, _rm: string, dto: any) => { received.push(dto); return Promise.resolve({}); }) };
      await (new ProcureService(prisma, inventory) as any).receiveRequest(TENANT, 'req1', 'owner-1', 'CASH', {});
      expect(received[0].acceptCostChange).toBe(true);
    });

    it('judges a price changed since then afresh', async () => {
      const request = {
        id: 'req1', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-1', status: 'BOUGHT', notes: null,
        lines: [{ id: 'l1', lineNumber: 'REQ-1-01', rawMaterialId: 'rm-milk', packsBought: 1, packSize: 1000, packCost: 950, receivedAt: null, brandNote: null, rawMaterial: { name: 'Full cream milk', unit: 'ml' } }],
      };
      const received: any[] = [];
      const prisma: any = {
        purchaseRequest: { findFirst: jest.fn().mockResolvedValue(request), update: jest.fn().mockResolvedValue(request) },
        purchaseRequestLine: { update: jest.fn().mockResolvedValue({}) },
        auditLog: { findMany: jest.fn().mockResolvedValue([{ entityId: 'l1', after: { severity: 'magnitude', value: '0.900000' } }]) },
      };
      const inventory: any = { receiveRawMaterial: jest.fn((_t: string, _rm: string, dto: any) => { received.push(dto); return Promise.resolve({}); }) };
      const svc = new ProcureService(prisma, inventory) as any;
      await svc.receiveRequest(TENANT, 'req1', 'owner-1', 'CASH', {});
      expect(received[0].acceptCostChange).toBeUndefined();
    });
  });

  describe('A cost change that pushes a drink into a loss', () => {
    function build(products: Array<{ id: string; name: string; price: number; isVatable: boolean; costPrice: number | null }>, newCostPerUnit: number, taxStatus = 'NON_VAT') {
      const tx: any = {
        bomItem: {
          findMany: jest.fn(({ select }: any) => (select.productId && !select.rawMaterial
            ? Promise.resolve(products.map((p) => ({ productId: p.id })))
            : Promise.resolve(products.map((p) => ({ productId: p.id, quantity: 200, rawMaterial: { costPrice: newCostPerUnit } }))))),
        },
        product: { findMany: jest.fn().mockResolvedValue(products), update: jest.fn().mockResolvedValue({}) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus }) },
      };
      const svc = new InventoryService({} as never, {} as never) as any;
      return { run: () => svc.recostProductsUsing(tx, TENANT, 'rm-milk') };
    }

    it('names the drink the new cost just pushed into a loss', async () => {
      // 200 ml of milk at ₱0.80 = ₱160, sold at ₱150; it used to cost ₱90.
      const { run } = build([{ id: 'p1', name: 'Iced Latte', price: 150, isVatable: false, costPrice: 90 }], 0.8);
      const { nowLosingMoney } = await run();
      expect(nowLosingMoney).toEqual([{ productId: 'p1', name: 'Iced Latte', price: 150, cost: 160, lossEach: 10 }]);
    });

    it('does not repeat itself about a drink that was already losing money', async () => {
      const { run } = build([{ id: 'p1', name: 'Iced Latte', price: 150, isVatable: false, costPrice: 155 }], 0.8);
      expect((await run()).nowLosingMoney).toEqual([]);
    });

    it('takes VAT out of the shelf price for a VAT-registered shop', async () => {
      // ₱168 shelf is ₱150 net; a ₱160 recipe loses money there.
      const { run } = build([{ id: 'p1', name: 'Iced Latte', price: 168, isVatable: true, costPrice: 90 }], 0.8, 'VAT');
      expect((await run()).nowLosingMoney).toHaveLength(1);
    });
  });

  describe('Procure: recording what was bought', () => {
    function build(sanity: CostSanityService) {
      const updates: any[] = [];
      const request = {
        id: 'req1', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-1', status: 'SENT', notes: null, boughtAt: null,
        lines: [{ id: 'l1', lineNumber: 'REQ-1-01', rawMaterialId: 'rm-milk', packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'Full cream milk', unit: 'ml' } }],
      };
      const prisma: any = {
        purchaseRequest: { findFirst: jest.fn().mockResolvedValue(request), update: jest.fn().mockResolvedValue(request) },
        purchaseRequestLine: { update: jest.fn(({ data }: any) => { updates.push(data); return Promise.resolve({}); }) },
        tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: true }) },
        $transaction: jest.fn((ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma))),
      };
      const svc = new ProcureService(prisma, {} as never, undefined, undefined, undefined, undefined, undefined, sanity) as any;
      return { svc, updates };
    }

    it('asks where the price is typed, before the line is written', async () => {
      const { svc, updates } = build(sanityThatWarns((k) => [warning(k)]));
      await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 1000, packCost: 190 }],
        { userId: 'owner-1', role: 'BUSINESS_OWNER' }, { sanity: ASKING })).rejects.toThrow(SanityConfirmRequiredException);
      expect(updates).toEqual([]);
    });

    it('does not ask again about a price that is already on the line', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const { svc, updates } = build(sanity);
      const req = await (svc as any).prisma.purchaseRequest.findFirst();
      req.lines[0] = { ...req.lines[0], packsBought: 1, packSize: 1000, packCost: 190 };
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 1000, packCost: 190 }],
        { userId: 'owner-1', role: 'BUSINESS_OWNER' }, { sanity: ASKING });
      expect((sanity.checkIngredientCosts as jest.Mock).mock.calls[0][1]).toEqual([]);
      expect(updates).toHaveLength(1);
    });

    it("lets a cashier's own save through on their yes, but does not switch off the owner's check at posting", async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const { svc, updates } = build(sanity);
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 1000, packCost: 190 }],
        { userId: 'cook-1', role: 'GENERAL_EMPLOYEE' },
        { sanity: sanityContext('1', [{ key: 'line:l1', value: '0.190000' }], 'cook-1', 'GENERAL_EMPLOYEE') });
      expect(updates).toHaveLength(1);
      expect(sanity.recordConfirmed).not.toHaveBeenCalled();
    });

    it('writes it once confirmed, and remembers the answer against the line', async () => {
      const sanity = sanityThatWarns((k) => [warning(k)]);
      const { svc, updates } = build(sanity);
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 1000, packCost: 190 }],
        { userId: 'owner-1', role: 'BUSINESS_OWNER' },
        { sanity: sanityContext('1', [{ key: 'line:l1', value: '0.190000' }], 'owner-1') });
      expect(updates).toHaveLength(1);
      const entityOf = (sanity.recordConfirmed as jest.Mock).mock.calls[0][3];
      expect(entityOf(warning('line:l1'))).toEqual({ type: 'PurchaseRequestLine', id: 'l1' });
    });
  });
});
