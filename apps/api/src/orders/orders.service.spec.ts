import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';

// ─── Helpers ──────────────────────────────────────────────────────────────

function today() { return new Date(); }

function makePrismaMock() {
  // Share the order.findFirst mock between the outer prisma object and the
  // $transaction tx object. This allows tests to set prisma.order.findFirst
  // once and have it work both for pre-transaction checks and the TOCTOU-safe
  // check that now lives inside the transaction (after the security fix).
  const orderFindFirst = jest.fn();
  const orderUpdate    = jest.fn().mockResolvedValue({ id: 'order-1', orderNumber: 'ORD-001', status: 'VOIDED', branchId: 'branch-1' });

  return {
    order:       { findFirst: orderFindFirst, update: orderUpdate, findUnique: jest.fn() },
    orderItem:   { findMany: jest.fn().mockResolvedValue([]) },
    inventoryItem: { findUnique: jest.fn(), update: jest.fn() },
    inventoryLog: { create: jest.fn() },
    accountingEvent: { create: jest.fn() },
    tenant:      { findUniqueOrThrow: jest.fn() },
    user:        { findFirst: jest.fn() },
    branch:      { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({
        order:           { findFirst: orderFindFirst, update: orderUpdate },
        orderItem:       { findMany: jest.fn().mockResolvedValue([]) },
        inventoryItem:   { findUnique: jest.fn().mockResolvedValue(null) },
        inventoryLog:    { create: jest.fn() },
        accountingEvent: { create: jest.fn() },
        orderPayment:    { findMany: jest.fn().mockResolvedValue([]) },
      });
    }),
  };
}

function makeAuditMock() {
  return {
    log:     jest.fn().mockResolvedValue(undefined),
    logVoid: jest.fn().mockResolvedValue(undefined),
  };
}

function makePeriodsMock() {
  return { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
}

function makeTaxCalcMock() {
  return {
    assertVatConsistency: jest.fn(),
    computePwdScDiscount: jest.fn(),
    computeTaxBreakdown:  jest.fn(),
  };
}

/** A minimal completed order dated today */
function completedOrderToday(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'order-1',
    tenantId: 'tenant-1',
    branchId: 'branch-1',
    orderNumber: 'ORD-001',
    status: 'COMPLETED',
    completedAt: today(),
    createdAt: today(),
    ...overrides,
  };
}

describe('OrdersService — void()', () => {
  let svc:     OrdersService;
  let prisma:  ReturnType<typeof makePrismaMock>;
  let audit:   ReturnType<typeof makeAuditMock>;
  let periods: ReturnType<typeof makePeriodsMock>;
  let taxCalc: ReturnType<typeof makeTaxCalcMock>;

  beforeEach(async () => {
    prisma  = makePrismaMock();
    audit   = makeAuditMock();
    periods = makePeriodsMock();
    taxCalc = makeTaxCalcMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService,              useValue: prisma  },
        { provide: AccountingPeriodsService,   useValue: periods },
        { provide: TaxCalculatorService,       useValue: taxCalc },
        { provide: AuditService,               useValue: audit   },
      ],
    }).compile();

    svc = module.get(OrdersService);
  });

  // ─── SOD: Cashier dual-authorization ─────────────────────────────────────

  describe('SOD dual-authorization', () => {
    it('throws BadRequestException when CASHIER provides no supervisorId', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // supervisor lookup — not reached
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());

      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer cancelled'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when supervisorId not found in tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null); // supervisor not found
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer cancelled', 'ghost-id'),
      ).rejects.toThrow(/not found/i);
    });

    it('throws ForbiddenException when supervisor role lacks void authority (e.g. CASHIER)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'other-cashier',
        role: 'CASHIER',
        name: 'Juan dela Cruz',
      });
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer cancelled', 'other-cashier'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when supervisor is GENERAL_EMPLOYEE', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'gen-emp', role: 'GENERAL_EMPLOYEE', name: 'Maria',
      });
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Wrong order', 'gen-emp'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('proceeds when CASHIER provides a valid SALES_LEAD supervisorId', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'lead-1', role: 'SALES_LEAD', name: 'Maria Lead',
      });
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());

      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', 'lead-1'),
      ).resolves.toBeDefined();
    });

    it('proceeds when CASHIER provides a BUSINESS_OWNER supervisorId', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: 'owner-1', role: 'BUSINESS_OWNER', name: 'Owner',
      });
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());

      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', 'owner-1'),
      ).resolves.toBeDefined();
    });
  });

  // ─── Direct void (supervisor roles) ───────────────────────────────────────

  describe('supervisor direct void (no co-auth needed)', () => {
    const directRoles = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'];

    directRoles.forEach((role) => {
      it(`${role} can void without supervisorId`, async () => {
        prisma.order.findFirst.mockResolvedValue(completedOrderToday());

        await expect(
          svc.void('tenant-1', 'order-1', 'mgr-1', role, 'Customer cancelled'),
        ).resolves.toBeDefined();

        // Supervisor lookup should NOT be called for direct-void roles
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
      });
    });
  });

  // ─── Order state guards ────────────────────────────────────────────────────

  describe('order state guards', () => {
    it('throws NotFoundException when order does not exist', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(
        svc.void('tenant-1', 'no-order', 'owner-1', 'BUSINESS_OWNER', 'Mistake'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when order is already VOIDED', async () => {
      prisma.order.findFirst.mockResolvedValue(
        completedOrderToday({ status: 'VOIDED' }),
      );
      await expect(
        svc.void('tenant-1', 'order-1', 'owner-1', 'BUSINESS_OWNER', 'Mistake'),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when order is in OPEN status', async () => {
      prisma.order.findFirst.mockResolvedValue(
        completedOrderToday({ status: 'OPEN' }),
      );
      await expect(
        svc.void('tenant-1', 'order-1', 'owner-1', 'BUSINESS_OWNER', 'Test'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Same-day rule ─────────────────────────────────────────────────────────

  describe('same-day void rule', () => {
    it('throws ForbiddenException for an order completed yesterday', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      prisma.order.findFirst.mockResolvedValue(
        completedOrderToday({ completedAt: yesterday }),
      );
      await expect(
        svc.void('tenant-1', 'order-1', 'owner-1', 'BUSINESS_OWNER', 'Late void'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws ForbiddenException for an order completed 30 days ago', async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      prisma.order.findFirst.mockResolvedValue(
        completedOrderToday({ completedAt: thirtyDaysAgo }),
      );
      await expect(
        svc.void('tenant-1', 'order-1', 'owner-1', 'BUSINESS_OWNER', 'Old void'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows void for an order completed today', async () => {
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());
      await expect(
        svc.void('tenant-1', 'order-1', 'owner-1', 'BUSINESS_OWNER', 'Customer request'),
      ).resolves.toBeDefined();
    });

    it('falls back to createdAt when completedAt is null (edge case)', async () => {
      // completedAt: null → should use createdAt which is today → should pass
      prisma.order.findFirst.mockResolvedValue(
        completedOrderToday({ completedAt: null, createdAt: today() }),
      );
      await expect(
        svc.void('tenant-1', 'order-1', 'owner-1', 'BUSINESS_OWNER', 'Test'),
      ).resolves.toBeDefined();
    });
  });
});
