import { InventoryService } from './inventory.service';

/**
 * A delivery on terms: what the supplier will actually collect.
 *
 * The journal has always credited 2010 Accounts Payable with the GROSS — the
 * money that will leave the bank. The AP Bill created in the same transaction
 * billed `totalValue`, which is NET of recoverable VAT, with `vatAmount` hard
 * coded to zero.
 *
 * So a ₱1,120 delivery became a ₱1,000 payable. Three things followed: the AP
 * sub-ledger disagreed with the 2010 balance by exactly the VAT on every
 * credit purchase, the aging report understated what the shop owed, and paying
 * the supplier's actual ₱1,120 left ₱120 that matched no bill.
 *
 * The bill is the supplier's document, not a valuation of the shelf. Those are
 * two different numbers and only one of them is what gets paid.
 */
describe('InventoryService.receiveRawMaterial — the AP bill for a credit delivery', () => {
  const TENANT = 't1';
  const RM = 'rm-beans';
  const BRANCH = 'b1';

  function build(taxStatus: string) {
    const bills: any[] = [];
    const events: any[] = [];
    const tx: any = {
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue({ quantity: 0 }),
        upsert: jest.fn().mockResolvedValue({}),
      },
      rawMaterial: { update: jest.fn().mockResolvedValue({}) },
      rawMaterialLot: { create: jest.fn().mockResolvedValue({}) },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
      aPBill: {
        findFirst: jest.fn().mockResolvedValue({ billNumber: 'BILL-000004' }),
        create: jest.fn(({ data }: any) => { bills.push(data); return Promise.resolve({}); }),
      },
      product: { findMany: jest.fn().mockResolvedValue([]) },
      bomItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma: any = {
      rawMaterial: {
        findFirst: jest.fn().mockResolvedValue({
          id: RM, tenantId: TENANT, name: 'Coffee Beans', unit: 'g', costPrice: 0,
          category: 'INGREDIENT',
        }),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH, tenantId: TENANT }) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus }) },
      vendor: { findFirst: jest.fn().mockResolvedValue({ id: 'v1' }) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      rawMaterialInventory: { findUnique: jest.fn().mockResolvedValue({ quantity: 0 }) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new InventoryService(prisma, periods) as any;
    svc.assertBranchBelongsToTenant = jest.fn().mockResolvedValue(undefined);
    return { svc, bills, events };
  }

  // 1000 g at ₱1.12 VAT-inclusive = ₱1,120 paid, ₱1,000 of shelf, ₱120 input tax.
  const DTO = {
    branchId: BRANCH, quantity: 1000, costPrice: 1.12,
    paymentMethod: 'CREDIT' as const, vendorId: 'v1', referenceNumber: 'DR-77',
  };

  describe('VAT-registered shop', () => {
    it('bills the gross — what the supplier will collect', async () => {
      const { svc, bills } = build('VAT');
      await svc.receiveRawMaterial(TENANT, RM, DTO);
      expect(Number(bills[0].totalAmount)).toBeCloseTo(1120, 2);
      expect(Number(bills[0].balanceAmount)).toBeCloseTo(1120, 2);
    });

    it('splits out the input VAT instead of calling it zero', async () => {
      // NIRC Sec 110 gives the credit only where the tax is invoiced AND
      // recorded. Zero here is the shop declining its own input tax.
      const { svc, bills } = build('VAT');
      await svc.receiveRawMaterial(TENANT, RM, DTO);
      expect(Number(bills[0].vatAmount)).toBeCloseTo(120, 2);
      expect(Number(bills[0].subtotal)).toBeCloseTo(1000, 2);
    });

    it('keeps the bill and the journal talking about the same money', async () => {
      // The sub-ledger total must equal what the journal credits to 2010, or
      // the AP aging and the balance sheet disagree by the VAT, forever.
      const { svc, bills, events } = build('VAT');
      await svc.receiveRawMaterial(TENANT, RM, DTO);
      const payload: any = events[0].payload;
      expect(Number(bills[0].totalAmount)).toBeCloseTo(Number(payload.grossValue), 2);
      expect(Number(bills[0].subtotal)).toBeCloseTo(Number(payload.totalValue), 2);
      expect(Number(bills[0].vatAmount)).toBeCloseTo(Number(payload.inputVat), 2);
    });

    it('adds up: subtotal plus VAT is the total', async () => {
      const { svc, bills } = build('VAT');
      await svc.receiveRawMaterial(TENANT, RM, DTO);
      const b = bills[0];
      expect(Number(b.subtotal) + Number(b.vatAmount)).toBeCloseTo(Number(b.totalAmount), 2);
    });
  });

  describe('shop that is not VAT-registered', () => {
    it('bills the whole amount with no VAT split, because none is recoverable', async () => {
      // Nothing to claim, so the price paid IS the cost of the shelf.
      const { svc, bills } = build('NON_VAT');
      await svc.receiveRawMaterial(TENANT, RM, DTO);
      expect(Number(bills[0].totalAmount)).toBeCloseTo(1120, 2);
      expect(Number(bills[0].subtotal)).toBeCloseTo(1120, 2);
      expect(Number(bills[0].vatAmount)).toBeCloseTo(0, 2);
    });
  });
});
