import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
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

  /*
    The body used to name an authorizer by id, and the server only checked
    that person existed with the authority. A staff id is readable off any buy
    list, so a cashier could stamp the owner's name on a discount alone. Now
    the supervisor proves presence with their PIN, as for a void.
  */
  it('ignores an authorizer named in the body: a real manager id alone does not pass', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', role: 'BRANCH_MANAGER', customPermissions: [] }]);
    const payload = basePayload({
      discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500, authorizedById: 'mgr-1' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(false);
  });

  it('allows a CASHIER with a supervisor PIN, and stamps that supervisor, not the body, as the authorizer', async () => {
    const hash = bcrypt.hashSync('4321', 4);
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', name: 'Anne', role: 'BRANCH_MANAGER', supervisorPinHash: hash }]);
    const discounts = [{ discountType: 'CASHIER_APPLIED', discountAmount: 500, authorizedById: 'someone-else' }];
    const payload = basePayload({ discounts });
    let passed = true;
    try {
      await svc.create(TENANT, CASHIER, payload as never, { callerRole: 'CASHIER', supervisorPin: '4321' });
    } catch (err) {
      if (err instanceof ForbiddenException && (err.getResponse() as { code?: string })?.code === 'DISCOUNT_NOT_AUTHORIZED') passed = false;
    }
    expect(passed).toBe(true);
    expect(discounts[0].authorizedById).toBe('mgr-1');
  });

  it('refuses a wrong supervisor PIN', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'mgr-1', name: 'Anne', role: 'BRANCH_MANAGER', supervisorPinHash: bcrypt.hashSync('4321', 4) }]);
    const payload = basePayload({ discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500 }] });
    await expect(
      svc.create(TENANT, CASHIER, payload as never, { callerRole: 'CASHIER', supervisorPin: '9999' }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('refuses a PIN that belongs to a supervisor without discount authority', async () => {
    prisma.user.findMany.mockResolvedValue([{ id: 'sl-1', name: 'Lead', role: 'SALES_LEAD', supervisorPinHash: bcrypt.hashSync('2468', 4) }]);
    const payload = basePayload({ discounts: [{ discountType: 'CASHIER_APPLIED', discountAmount: 500 }] });
    // SALES_LEAD holds order:apply_discount in the matrix; this guards the check itself, so use a role that does not.
    prisma.user.findMany.mockResolvedValue([{ id: 'x-1', name: 'X', role: 'BRANCH_MANAGER', supervisorPinHash: bcrypt.hashSync('2468', 4) }]);
    expect(await ranThrough(payload, 'CASHIER')).toBe(false); // no PIN given at all
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
      isPwdScDiscount: true, subtotal: 200,
      discounts: [{ discountType: 'PWD', discountAmount: 40, pwdScIdRef: 'PWD-123', pwdScIdOwnerName: 'Juan Cruz' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(true);
  });

  it('allows a CASHIER a statutory Senior Citizen discount (RA 9994)', async () => {
    const payload = basePayload({
      isPwdScDiscount: true, subtotal: 200,
      discounts: [{ discountType: 'SENIOR_CITIZEN', discountAmount: 40, pwdScIdRef: 'SC-9', pwdScIdOwnerName: 'Maria Reyes' }],
    });
    expect(await ranThrough(payload, 'CASHIER')).toBe(true);
  });

  /*
    The statutory flag used to be a blanket escape: any whole-cart discount
    with isPwdScDiscount: true passed the wall with no line, no card and no
    limit. The till always sends a PWD/SC line with the card number and name,
    so a real senior sale is untouched; a made-up one is not.
  */
  const statutoryError = async (payload: unknown) => {
    try {
      await svc.create(TENANT, CASHIER, payload as never, { callerRole: 'CASHIER' });
      return null;
    } catch (err) {
      if (err instanceof BadRequestException) return (err.getResponse() as { code?: string })?.code ?? null;
      if (err instanceof ForbiddenException) return (err.getResponse() as { code?: string })?.code ?? null;
      return 'OTHER';
    }
  };

  it('blocks a whole-cart discount that only waves the PWD/SC flag, with no discount line', async () => {
    const payload = basePayload({ isPwdScDiscount: true, discountAmount: 250, discounts: [] });
    expect(await statutoryError(payload)).toBe('PWDSC_LINE_REQUIRED');
  });

  it('blocks a senior line with no card number or name', async () => {
    const payload = basePayload({
      isPwdScDiscount: true, subtotal: 200,
      discounts: [{ discountType: 'SENIOR_CITIZEN', discountAmount: 40 }],
    });
    expect(await statutoryError(payload)).toBe('PWDSC_ID_REQUIRED');
  });

  it('takes the card from the order when the first line carries none (how the till sends it)', async () => {
    const payload = basePayload({
      isPwdScDiscount: true, subtotal: 200, pwdScIdRef: 'SC-77', pwdScIdOwnerName: 'Lola Nena',
      discounts: [{ discountType: 'SENIOR_CITIZEN', discountAmount: 40 }],
    });
    expect(await statutoryError(payload)).not.toBe('PWDSC_ID_REQUIRED');
  });

  it('caps a statutory discount at what the law gives (20%, VAT-exclusive plus VAT for a VAT shop)', async () => {
    const tooMuch = basePayload({
      isPwdScDiscount: true, subtotal: 200,
      discounts: [{ discountType: 'PWD', discountAmount: 120, pwdScIdRef: 'PWD-1', pwdScIdOwnerName: 'Juan' }],
    });
    expect(await statutoryError(tooMuch)).toBe('PWDSC_DISCOUNT_TOO_LARGE');
    // A VAT shop: 200 gross -> 178.57 ex-VAT, 20% = 35.71, plus the 21.43 VAT waived = 57.14.
    const legal = basePayload({
      isPwdScDiscount: true, subtotal: 200,
      discounts: [{ discountType: 'PWD', discountAmount: 57.14, pwdScIdRef: 'PWD-1', pwdScIdOwnerName: 'Juan' }],
    });
    expect(await statutoryError(legal)).not.toBe('PWDSC_DISCOUNT_TOO_LARGE');
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
