/**
 * Sprint 14 — Subscription billing privacy invariant test.
 *
 * The console privacy invariant: SUPER_ADMIN should NEVER see tenant
 * business financials (Order totals, Payslip amounts, JournalEntry, etc.)
 * via this module. The billing module reads ONLY:
 *   - subscriptionInvoice (HNS↔tenant relationship — operational data)
 *   - tenant (slim metadata: id, name, slug, planCode, status)
 *
 * This test wires up a Prisma mock that throws if any of the forbidden
 * tables are queried, then exercises every public method on the service.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionBillingService } from './subscription-billing.service';
import { PrismaService } from '../prisma/prisma.service';

const FORBIDDEN_MODELS = [
  'order',
  'orderItem',
  'orderPayment',
  'orderDiscount',
  'payslip',
  'payRun',
  'journalEntry',
  'journalEntryLine',
  'aRInvoice',
  'aRPayment',
  'aPBill',
  'aPPayment',
  'accountingEvent',
  'inventoryItem',
  'inventoryLog',
  'product',
  'rawMaterial',
  'customer',
  'expenseClaim',
  'timeEntry',
  'leaveRequest',
] as const;

function makePrivacyEnforcingMock() {
  const mock: any = {
    subscriptionInvoice: {
      findMany:   jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst:  jest.fn().mockResolvedValue(null),
      create:     jest.fn().mockResolvedValue({ id: 'inv-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      count:      jest.fn().mockResolvedValue(0),
      aggregate:  jest.fn().mockResolvedValue({ _sum: {}, _count: { _all: 0 } }),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany:   jest.fn().mockResolvedValue([]),
      count:      jest.fn().mockResolvedValue(0),
    },
  };
  // Block any access to forbidden tables — every property is a Proxy that
  // throws if .findMany / .findFirst / etc. are called on it.
  for (const model of FORBIDDEN_MODELS) {
    mock[model] = new Proxy({}, {
      get(_t, prop) {
        return () => {
          throw new Error(
            `PRIVACY INVARIANT BREACH: subscription-billing service queried "${model}.${String(prop)}". ` +
            `Console must NEVER read tenant business data via this module.`,
          );
        };
      },
    });
  }
  return mock;
}

describe('SubscriptionBillingService — console privacy invariant', () => {
  let svc: SubscriptionBillingService;
  let prisma: ReturnType<typeof makePrivacyEnforcingMock>;

  beforeEach(async () => {
    prisma = makePrivacyEnforcingMock();
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        SubscriptionBillingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = moduleRef.get(SubscriptionBillingService);
  });

  it('listInvoices does not touch tenant-business tables', async () => {
    await svc.listInvoices({});
    expect(prisma.subscriptionInvoice.findMany).toHaveBeenCalled();
  });

  it('getInvoice does not touch tenant-business tables', async () => {
    prisma.subscriptionInvoice.findUnique.mockResolvedValueOnce({
      id: 'inv-1', tenantId: 'tenant-1', invoiceNumber: 'SUB-2026-000001',
    });
    await svc.getInvoice('inv-1');
    expect(prisma.subscriptionInvoice.findUnique).toHaveBeenCalled();
  });

  it('metrics does not touch tenant-business tables', async () => {
    await svc.metrics();
    // tenant.count is allowed (operational); subscription_invoice aggregates
    // are allowed. NO order/payslip/JE access.
    expect(prisma.tenant.count).toHaveBeenCalled();
    expect(prisma.subscriptionInvoice.count).toHaveBeenCalled();
    expect(prisma.subscriptionInvoice.aggregate).toHaveBeenCalled();
  });

  it('issueInvoice does not touch tenant-business tables', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({
      id: 'tenant-1', name: 'Acme', planCode: 'STD_SOLO', status: 'ACTIVE',
    });
    prisma.subscriptionInvoice.findFirst.mockResolvedValue(null);
    await svc.issueInvoice({
      tenantId:    'tenant-1',
      periodStart: '2026-05-01',
      periodEnd:   '2026-06-01',
    });
    expect(prisma.subscriptionInvoice.create).toHaveBeenCalled();
  });

  // Smoke test — confirm the mock actually throws when a forbidden model is
  // accessed. If this test ever fails, the privacy mock is broken and the
  // other tests above are no longer guarding the invariant.
  it('the privacy mock throws when forbidden tables are accessed (guard the guard)', () => {
    expect(() => prisma.order.findMany()).toThrow(/PRIVACY INVARIANT BREACH/);
    expect(() => prisma.payslip.findFirst()).toThrow(/PRIVACY INVARIANT BREACH/);
    expect(() => prisma.journalEntry.aggregate()).toThrow(/PRIVACY INVARIANT BREACH/);
  });
});
