import { canSeePurchaseCosts, COST_DECIDER_ROLES } from './cost-visibility';
import { ProcureService } from './procure.service';
import { DocumentsService } from '../documents/documents.service';

/**
 * Who sees what the shop paid.
 *
 * Procure is one screen for the whole shop, so the price of a delivery sat in
 * front of everyone who could open the request. Cafe Carolina wants exactly
 * that; a bigger shop may not. The switch is the owner's, the default is the
 * behaviour every existing shop already has, and — the part that matters —
 * the hiding happens on the SERVER. A screen that merely stops drawing the
 * number is one network tab away from being no policy at all.
 */
describe('Purchase costs — whose eyes', () => {
  const TENANT = 't1';

  describe('the rule itself', () => {
    it('shows everyone the costs while the switch is on', () => {
      for (const role of ['CASHIER', 'GENERAL_EMPLOYEE', 'WAREHOUSE_STAFF', 'BUSINESS_OWNER']) {
        expect(canSeePurchaseCosts(role, true)).toBe(true);
      }
    });

    it('keeps them for the people who decide, once it is off', () => {
      for (const role of COST_DECIDER_ROLES) expect(canSeePurchaseCosts(role, false)).toBe(true);
    });

    it('hides them from everyone else once it is off', () => {
      for (const role of ['CASHIER', 'SALES_LEAD', 'GENERAL_EMPLOYEE', 'WAREHOUSE_STAFF']) {
        expect(canSeePurchaseCosts(role, false)).toBe(false);
      }
    });

    it('errs open when the tenant could not be read', () => {
      // A row written before the column existed, or a lookup that failed.
      // Hiding money from the owner because of a null is the worse failure.
      expect(canSeePurchaseCosts('CASHIER', null)).toBe(true);
      expect(canSeePurchaseCosts('CASHIER', undefined)).toBe(true);
      expect(canSeePurchaseCosts(null, false)).toBe(false);
    });
  });

  describe('the request that comes back', () => {
    const request = {
      id: 'req1', requestNumber: 'REQ-20260904-001', status: 'BOUGHT', tenantId: TENANT,
      lines: [{
        id: 'l1', lineNumber: 1, qtyRequested: 3, packsBought: 2, packSize: 1000, packCost: 180,
        rawMaterial: { id: 'rm1', name: 'Chicken breast', unit: 'g', costPrice: 0.24 },
      }],
    };

    function build(showToStaff: boolean) {
      const prisma: any = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: showToStaff }) },
        purchaseRequest: {
          findFirst: jest.fn().mockResolvedValue(JSON.parse(JSON.stringify(request))),
          findMany:  jest.fn().mockResolvedValue([JSON.parse(JSON.stringify(request))]),
        },
      };
      return { svc: new ProcureService(prisma, {} as any), prisma };
    }

    it('gives the owner every number, switch off or on', async () => {
      for (const flag of [true, false]) {
        const { svc } = build(flag);
        const r: any = await svc.get(TENANT, 'req1', 'BUSINESS_OWNER');
        expect(Number(r.lines[0].packCost)).toBe(180);
        expect(Number(r.lines[0].rawMaterial.costPrice)).toBe(0.24);
        expect(r.costsHidden).toBeUndefined();
      }
    });

    it('gives the cook every number while the switch is on', async () => {
      const { svc } = build(true);
      const r: any = await svc.get(TENANT, 'req1', 'CASHIER');
      expect(Number(r.lines[0].packCost)).toBe(180);
      expect(r.costsHidden).toBeUndefined();
    });

    it('takes the money out of the cook\'s copy once it is off — including the ingredient cost', async () => {
      const { svc } = build(false);
      const r: any = await svc.get(TENANT, 'req1', 'CASHIER');
      expect(r.costsHidden).toBe(true);
      expect(r.lines[0].packCost).toBeNull();
      expect(r.lines[0].rawMaterial.costPrice).toBeNull();
      // What the shop asked for and what arrived is the staff's own work.
      expect(Number(r.lines[0].qtyRequested)).toBe(3);
      expect(Number(r.lines[0].packsBought)).toBe(2);
      expect(Number(r.lines[0].packSize)).toBe(1000);
    });

    it('does the same to the list, not just one request', async () => {
      const { svc } = build(false);
      const rows: any = await svc.list(TENANT, undefined, undefined, 'WAREHOUSE_STAFF');
      expect(rows[0].costsHidden).toBe(true);
      expect(rows[0].lines[0].packCost).toBeNull();
    });
  });

  describe('the receipt photo', () => {
    function build(showToStaff: boolean) {
      const findMany = jest.fn().mockResolvedValue([{ id: 'doc1', filename: 'receipt.jpg' }]);
      const prisma: any = {
        tenant:   { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: showToStaff }) },
        document: { findMany },
      };
      return { svc: new DocumentsService(prisma, {} as any), findMany };
    }

    it('is hidden from staff once costs are, because it shows the same prices', async () => {
      const { svc, findMany } = build(false);
      await expect(svc.list(TENANT, 'PurchaseRequest', 'req1', 'CASHIER')).resolves.toEqual([]);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('still reaches the owner', async () => {
      const { svc } = build(false);
      await expect(svc.list(TENANT, 'PurchaseRequest', 'req1', 'BUSINESS_OWNER')).resolves.toHaveLength(1);
    });

    it('will not serve the file either — the list is not the only door', async () => {
      const findFirst = jest.fn().mockResolvedValue({
        id: 'doc1', entityType: 'PurchaseRequest', filename: 'receipt.jpg', mimeType: 'image/jpeg',
        sizeBytes: 10, storagePath: 'k',
      });
      const prisma: any = {
        tenant:   { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: false }) },
        document: { findFirst },
      };
      const storage: any = { getStream: jest.fn() };
      const svc = new DocumentsService(prisma, storage);
      const res: any = { setHeader: jest.fn() };
      await expect(svc.serve(TENANT, 'doc1', res, 'CASHIER')).rejects.toThrow(/not found/i);
      expect(storage.getStream).not.toHaveBeenCalled();
    });

    it('leaves every other kind of document alone', async () => {
      // A BIR attachment or a signed contract has nothing to do with this
      // switch, and must not be swept up by it.
      const { svc, findMany } = build(false);
      await expect(svc.list(TENANT, 'JournalEntry', 'je1', 'CASHIER')).resolves.toHaveLength(1);
      expect(findMany).toHaveBeenCalled();
    });
  });
});
