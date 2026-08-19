/**
 * InventoryService.adjust() — accounting-event payload correctness.
 *
 * Two GL defects fixed 2026-08:
 *   (A) paymentMethod was never forwarded into the INVENTORY_ADJUSTMENT
 *       payload, so the journal handler credited 3010 Owner's Capital for
 *       every stock-in even when the owner paid cash. Now forwarded when
 *       provided, omitted when absent (handler default = OWNER_FUNDED,
 *       preserving back-compat for the counter mobile app).
 *   (B) totalValue was computed from product.costPrice, ignoring the
 *       dto.unitCost the operator typed (which DOES drive WAC avgCost) —
 *       GL value diverged from what was actually paid. Positive receipts
 *       now value at (dto.unitCost ?? product.costPrice); negative flows
 *       unchanged.
 *
 * Test approach mirrors products.service.spec.ts: plain prisma mock with
 * just enough surface for adjust() — product.findFirst, branch.findFirst,
 * user.findMany (supervisor PIN attest), and a $transaction pass-through
 * whose tx captures accountingEvent.create.
 */
import * as bcrypt from 'bcryptjs';
import { InventoryService } from './inventory.service';

const TENANT = 'tenant-a';
const USER = 'user-1';

function makeTxMock() {
  return {
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({ id: 'item-1', quantity: 10 }),
    },
    inventoryLog: { create: jest.fn().mockResolvedValue({ id: 'log-1' }) },
    accountingEvent: { create: jest.fn().mockResolvedValue({ id: 'evt-1' }) },
  };
}

function makePrismaMock(tx: ReturnType<typeof makeTxMock>) {
  return {
    product: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(tx)),
  };
}

describe('InventoryService.adjust — accounting event payload', () => {
  let tx: ReturnType<typeof makeTxMock>;
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: InventoryService;

  beforeEach(() => {
    tx = makeTxMock();
    prisma = makePrismaMock(tx);
    // adjust() doesn't touch AccountingPeriodsService — stub it out.
    service = new InventoryService(prisma as any, {} as any);
    prisma.product.findFirst.mockResolvedValue({
      id: 'prod-1',
      tenantId: TENANT,
      name: 'Arabica Beans 1kg',
      costPrice: 50,
    });
  });

  function capturedPayload(): Record<string, unknown> {
    expect(tx.accountingEvent.create).toHaveBeenCalledTimes(1);
    return (tx.accountingEvent.create.mock.calls[0][0] as any).data.payload;
  }

  describe('paymentMethod pass-through (defect A)', () => {
    it('includes paymentMethod in the payload when the client sends one', async () => {
      await service.adjust(TENANT, USER, {
        productId: 'prod-1', branchId: 'branch-1',
        quantity: 10, type: 'STOCK_IN', paymentMethod: 'CASH',
      } as any);
      expect(capturedPayload().paymentMethod).toBe('CASH');
    });

    it('omits the paymentMethod key entirely when not sent (handler defaults to OWNER_FUNDED)', async () => {
      await service.adjust(TENANT, USER, {
        productId: 'prod-1', branchId: 'branch-1',
        quantity: 10, type: 'STOCK_IN',
      } as any);
      expect(capturedPayload()).not.toHaveProperty('paymentMethod');
    });
  });

  describe('totalValue valuation (defect B)', () => {
    it('uses dto.unitCost for positive receipts when provided', async () => {
      await service.adjust(TENANT, USER, {
        productId: 'prod-1', branchId: 'branch-1',
        quantity: 10, type: 'STOCK_IN', unitCost: 55,
      } as any);
      const payload = capturedPayload();
      expect(payload.totalValue).toBe(550);       // 10 × 55 (what was paid)
      expect(payload.costPrice).toBe(50);         // master cost still reported
    });

    it('rounds to 2 decimals', async () => {
      prisma.product.findFirst.mockResolvedValue({
        id: 'prod-1', tenantId: TENANT, name: 'Arabica Beans 1kg', costPrice: 10,
      });
      await service.adjust(TENANT, USER, {
        productId: 'prod-1', branchId: 'branch-1',
        quantity: 3, type: 'STOCK_IN', unitCost: 10.333,
      } as any);
      expect(capturedPayload().totalValue).toBe(31); // round2(30.999)
    });

    it('falls back to product.costPrice when unitCost is absent', async () => {
      await service.adjust(TENANT, USER, {
        productId: 'prod-1', branchId: 'branch-1',
        quantity: 10, type: 'STOCK_IN',
      } as any);
      expect(capturedPayload().totalValue).toBe(500); // 10 × 50 master cost
    });
  });

  describe('negative adjustments unchanged', () => {
    beforeEach(() => {
      // SecAudit A3 supervisor PIN attest — one active supervisor whose
      // hash matches the PIN sent below.
      prisma.user.findMany.mockResolvedValue([{
        id: 'sup-1',
        name: 'Branch Manager',
        role: 'BRANCH_MANAGER',
        supervisorPinHash: bcrypt.hashSync('4291', 4),
      }]);
      // 20 on hand so a -5 write-off doesn't go negative.
      tx.inventoryItem.findUnique.mockResolvedValue({ id: 'item-1', quantity: 20, avgCost: 48 });
    });

    it('values write-offs at product.costPrice even if a unitCost sneaks in, with no paymentMethod key', async () => {
      await service.adjust(TENANT, USER, {
        productId: 'prod-1', branchId: 'branch-1',
        quantity: -5, type: 'STOCK_OUT',
        reasonCode: 'DAMAGE', supervisorPin: '4291',
        unitCost: 55, // must NOT affect negative-flow valuation
      } as any);
      const payload = capturedPayload();
      expect(payload.totalValue).toBe(250); // |−5| × 50 costPrice, not 55
      expect(payload.costPrice).toBe(50);
      expect(payload.quantity).toBe(-5);
      expect(payload.adjustmentType).toBe('STOCK_OUT');
      expect(payload).not.toHaveProperty('paymentMethod');
    });
  });
});
