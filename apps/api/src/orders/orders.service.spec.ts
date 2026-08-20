import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';
import { NumberingService } from '../numbering/numbering.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { VoidApprovalsService } from '../void-approvals/void-approvals.service';
import { OrderQuoteService } from './order-quote.service';

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
    tenant:      { findUniqueOrThrow: jest.fn(), findUnique: jest.fn().mockResolvedValue({ returnsOwnerOnly: false }) },
    product:     { findMany: jest.fn().mockResolvedValue([]) },
    prescription: { findMany: jest.fn().mockResolvedValue([]) },
    user:        { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
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

    const numberingMock = { next: jest.fn().mockResolvedValue('ORD-2026-000001') } as any;
    // Sprint 19 — OrdersService now optionally invokes LoyaltyService after a
    // sale lands (stamp-card accrual). Tests don't exercise that path; mock it
    // out so the module compiles. The catch in OrdersService.create swallows
    // any error here, but a no-op mock keeps logs clean.
    const loyaltyMock = { accrueStampsForOrder: jest.fn().mockResolvedValue(undefined) } as any;
    // Sprint 22 — Maker-checker for voids over threshold. OrdersService.void()
    // calls hasApprovedFor() when the cashier passes a void-approval id;
    // tests in this file don't exercise that path so a permissive mock that
    // claims every check has been pre-approved keeps the rest of the suite
    // green.
    const voidApprovalsMock = {
      hasApprovedFor: jest.fn().mockResolvedValue(true),
    } as any;
    const quoteMock = { quote: jest.fn() } as any;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService,              useValue: prisma  },
        { provide: AccountingPeriodsService,   useValue: periods },
        { provide: TaxCalculatorService,       useValue: taxCalc },
        { provide: AuditService,               useValue: audit   },
        { provide: NumberingService,           useValue: numberingMock },
        { provide: LoyaltyService,             useValue: loyaltyMock   },
        { provide: VoidApprovalsService,       useValue: voidApprovalsMock },
        // Only used on the service-principal path (enforceServerTotals);
        // these suites exercise the POS path, which never calls it.
        { provide: OrderQuoteService,          useValue: quoteMock },
      ],
    }).compile();

    svc = module.get(OrdersService);
  });

  // ─── SOD: Cashier dual-authorization ─────────────────────────────────────

  describe('SOD dual-authorization', () => {
    /**
     * Approval is a supervisor PIN verified against that supervisor's hash
     * inside the service. It used to be a bare `supervisorId` in the request
     * body — the role was checked but the identity was not proven, so a
     * cashier could pass an id harvested from any earlier voided order (or
     * their own) and self-authorize.
     */
    const pinUser = async (over: Partial<{ id: string; name: string; role: string; pin: string }> = {}) => ({
      id:                over.id   ?? 'lead-1',
      name:              over.name ?? 'Maria Lead',
      role:              over.role ?? 'SALES_LEAD',
      supervisorPinHash: await bcrypt.hash(over.pin ?? '4321', 4),
    });

    it('throws BadRequestException when CASHIER provides no supervisor PIN', async () => {
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());

      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer cancelled'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a PIN that matches no supervisor in the tenant', async () => {
      prisma.user.findMany.mockResolvedValue([await pinUser({ pin: '4321' })]);
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer cancelled', '9999'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects a malformed PIN without querying users', async () => {
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer cancelled', 'abc'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('SOD: a harvested supervisor id is no longer accepted as authorization', async () => {
      // The old exploit: read voidedBy.id off a previous void, send it as
      // supervisorId. That value is not a PIN, so it cannot authorize.
      prisma.user.findMany.mockResolvedValue([await pinUser()]);
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', 'lead-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('excludes the requesting cashier from the supervisor lookup (no self-approval)', async () => {
      prisma.user.findMany.mockResolvedValue([]);
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', '4321'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            NOT:      { id: 'cashier-1' },
          }),
        }),
      );
    });

    it('rejects an ambiguous PIN shared by two supervisors', async () => {
      prisma.user.findMany.mockResolvedValue([
        await pinUser({ id: 'lead-1', pin: '4321' }),
        await pinUser({ id: 'owner-1', role: 'BUSINESS_OWNER', name: 'Owner', pin: '4321' }),
      ]);
      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', '4321'),
      ).rejects.toThrow(/more than one supervisor/i);
    });

    it('proceeds when CASHIER supplies a valid SALES_LEAD PIN', async () => {
      prisma.user.findMany.mockResolvedValue([await pinUser({ pin: '4321' })]);
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());

      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', '4321'),
      ).resolves.toBeDefined();
    });

    it('proceeds when CASHIER supplies a valid BUSINESS_OWNER PIN', async () => {
      prisma.user.findMany.mockResolvedValue([
        await pinUser({ id: 'owner-1', role: 'BUSINESS_OWNER', name: 'Owner', pin: '1357' }),
      ]);
      prisma.order.findFirst.mockResolvedValue(completedOrderToday());

      await expect(
        svc.void('tenant-1', 'order-1', 'cashier-1', 'CASHIER', 'Customer request', '1357'),
      ).resolves.toBeDefined();
    });
  });

  // ─── Direct void (supervisor roles) ───────────────────────────────────────

  describe('supervisor direct void (no co-auth needed)', () => {
    const directRoles = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'];

    directRoles.forEach((role) => {
      it(`${role} can void without a supervisor PIN`, async () => {
        prisma.order.findFirst.mockResolvedValue(completedOrderToday());

        await expect(
          svc.void('tenant-1', 'order-1', 'mgr-1', role, 'Customer cancelled'),
        ).resolves.toBeDefined();

        // Supervisor lookup should NOT be called for direct-void roles
        expect(prisma.user.findMany).not.toHaveBeenCalled();
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
