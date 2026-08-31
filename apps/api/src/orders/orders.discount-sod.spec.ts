import { ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * SOD: discretionary discounts need real authority.
 *
 * "CASHIER cannot self-authorize discounts" (order:apply_discount) used to be
 * enforced only by hiding the button in the web cart — the service never saw
 * the caller's role, so posting straight to POST /orders with a discount line
 * was accepted from any till account.
 *
 * Statutory PWD / Senior Citizen discounts stay exempt: they are a legal
 * entitlement under RA 9994 / RA 10754 that a cashier must be able to grant.
 */
describe('OrdersService.create — discount authority', () => {
  const TENANT = 'tenant-1';
  const CASHIER = 'cashier-1';

  let prisma: any;
  let svc: OrdersService;

  const basePayload = (over: Record<string, unknown> = {}) => ({
    clientUuid: 'uuid-1',
    // A real till always has one: a POS cash sale needs a drawer to put the
    // money in, so cash without a shiftId is now refused.
    shiftId: 'shift-1',
    branchId:   'branch-1',
    items:      [],
    payments:   [{ method: 'CASH', amount: 100 }],
    discounts:  [],
    subtotal:   100,
    discountAmount: 0,
    vatAmount:  0,
    totalAmount: 100,
    isPwdScDiscount: false,
    createdAt: new Date().toISOString(),
    ...over,
  });

  beforeEach(() => {
    prisma = {
      order:  { findFirst: jest.fn().mockResolvedValue(null) },
      user:   { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
      branch: { count: jest.fn().mockResolvedValue(1) },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({
          taxStatus: 'VAT', planCode: 'CLERQUE', isPtuHolder: false,
        }),
        findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT', planCode: 'CLERQUE' }),
      },
    };
    svc = new OrdersService(
      prisma as any,
      { assertDateIsOpen: jest.fn() } as any,          // periods
      { assertVatConsistency: jest.fn() } as any,      // taxCalc
      { log: jest.fn() } as any,                       // audit
      {} as any,                                       // numbering
      {} as any,                                       // loyalty
      {} as any,                                       // voidApprovals
      {} as any,                                       // quotes
    );
  });

  /** Reaching branch validation means the discount wall let the sale through. */
  const ranThrough = async (payload: unknown, role: string | null, custom?: string[]) => {
    try {
      await svc.create(TENANT, CASHIER, payload as never, {
        callerRole: role,
        callerCustomPermissions: custom ?? null,
      });
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        const body = err.getResponse() as { code?: string };
        if (body?.code === 'DISCOUNT_NOT_AUTHORIZED') return false;
      }
      return true; // some later, unrelated step — the wall was passed
    }
  };

  it('blocks a CASHIER applying a discretionary discount', async () => {
    const payload = basePayload({
      discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500 }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(false);
  });

  it('blocks a CASHIER naming themselves as the authorizer', async () => {
    const payload = basePayload({
      discounts: [{ discountType: 'MANAGER_OVERRIDE', discountAmount: 500, authorizedById: CASHIER }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(false);
  });

  it('blocks a whole-cart discount with no discount line to explain it', async () => {
    const payload = basePayload({ discountAmount: 250, discounts: [] });
    expect(await ranThrough(payload, 'CASHIER')).toBe(false);
  });

  it('blocks when the named authorizer lacks discount authority', async () => {
    prisma.user.findMany.mockResolvedValue([{ role: 'WAREHOUSE_STAFF', customPermissions: [] }]);
    const payload = basePayload({
      discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500, authorizedById: 'wh-1' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(false);
  });

  it('allows a CASHIER when a real supervisor authorized it', async () => {
    prisma.user.findMany.mockResolvedValue([{ role: 'BRANCH_MANAGER', customPermissions: [] }]);
    const payload = basePayload({
      discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500, authorizedById: 'mgr-1' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(true);
  });

  it.each(['BRANCH_MANAGER', 'SALES_LEAD', 'BUSINESS_OWNER'])(
    'allows %s to apply a discount directly',
    async (role) => {
      const payload = basePayload({
        discounts: [{ discountType: 'MANAGER_OVERRIDE', discountAmount: 500 }],
      });
      expect(await ranThrough(payload, role)).toBe(true);
    },
  );

  it('allows a CASHIER a statutory PWD discount (RA 10754)', async () => {
    const payload = basePayload({
      isPwdScDiscount: true,
      discounts: [{ discountType: 'PWD', discountAmount: 40, pwdScIdRef: 'PWD-123' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(true);
  });

  it('allows a CASHIER a statutory Senior Citizen discount (RA 9994)', async () => {
    const payload = basePayload({
      isPwdScDiscount: true,
      discounts: [{ discountType: 'SENIOR_CITIZEN', discountAmount: 40, pwdScIdRef: 'SC-9' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(true);
  });

  it('allows a configured PROMO to apply without supervisor approval', async () => {
    const payload = basePayload({
      discounts: [{ discountType: 'PROMO', discountAmount: 20, discountConfigId: 'promo-1' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(true);
  });

  it('allows a cashier holding order:apply_discount via customPermissions', async () => {
    const payload = basePayload({
      discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500 }],
    });
    expect(await ranThrough(payload, 'CASHIER', ['order:apply_discount'])).toBe(true);
  });

  it('does not gate service (API-key) callers, whose totals are recomputed', async () => {
    const payload = basePayload({
      discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500 }],
    });
    expect(await ranThrough(payload, null)).toBe(true);
  });
});
