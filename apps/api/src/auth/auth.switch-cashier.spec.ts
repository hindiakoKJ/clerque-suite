import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/**
 * Quick cashier switch — the restroom-break handover.
 *
 * The full drawer handover exists to move DRAWER ACCOUNTABILITY. A break
 * moves only WHO IS RINGING, so the switch swaps the session and leaves the
 * open shift alone. These tests pin the guard rails: tenant isolation,
 * PIN uniqueness, kiosk-only refusal, role limits and the 2FA wall.
 */
describe('AuthService — switchCashierByPin', () => {
  const TENANT = 't-carolina';

  const ANNA = {
    id: 'u-anna', tenantId: TENANT, branchId: 'br-1', role: 'CASHIER',
    name: 'Anna', enable2fa: false,
  };

  function build(matches: unknown[]) {
    const prisma: any = {
      user: { findMany: jest.fn().mockResolvedValue(matches) },
    };
    // Only prisma is exercised by this method.
    const svc = new AuthService(prisma, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it('resolves the relief cashier by PIN within the tenant', async () => {
    const { svc, prisma } = build([ANNA]);
    const user = await svc.switchCashierByPin(TENANT, '4729');

    expect(user.id).toBe('u-anna');
    // Tenant scoping and the eligibility filters live in the query itself.
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe(TENANT);
    expect(where.isActive).toBe(true);
    expect(where.kioskOnly).toBe(false);
    expect(where.kioskPin).toBe('4729');
    expect(where.role.in).toEqual(['CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER']);
  });

  it('rejects a PIN nobody owns', async () => {
    const { svc } = build([]);
    await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
  });

  it('refuses an ambiguous PIN rather than guessing who is ringing', async () => {
    const { svc } = build([ANNA, { ...ANNA, id: 'u-ben', name: 'Ben' }]);
    await expect(svc.switchCashierByPin(TENANT, '4729')).rejects.toThrow(ForbiddenException);
  });

  it('refuses a 2FA-enrolled account — a PIN is not a second factor', async () => {
    const { svc } = build([{ ...ANNA, enable2fa: true }]);
    await expect(svc.switchCashierByPin(TENANT, '4729')).rejects.toThrow(ForbiddenException);
  });

  it('rejects malformed PINs before touching the database', async () => {
    const { svc, prisma } = build([]);
    await expect(svc.switchCashierByPin(TENANT, 'abc')).rejects.toThrow(UnauthorizedException);
    await expect(svc.switchCashierByPin(TENANT, '12')).rejects.toThrow(UnauthorizedException);
    await expect(svc.switchCashierByPin(TENANT, '')).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
