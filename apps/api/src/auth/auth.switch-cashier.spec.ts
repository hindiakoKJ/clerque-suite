import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { tillPinAttempts } from './pin-attempts';

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

  beforeEach(() => tillPinAttempts.clear());

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
    // Till roles only: an owner or manager session must never land on a shared till.
    expect(where.OR).toEqual([{ role: { in: ['CASHIER', 'SALES_LEAD'] } }]);
  });

  it('never looks up the owner or a manager, so their PIN reads as "no cashier has that PIN"', async () => {
    const { svc, prisma } = build([]);
    await expect(svc.switchCashierByPin(TENANT, '4729')).rejects.toThrow(
      'No cashier has that PIN. Owners and managers sign in with email and password.',
    );
    const roles: string[] = prisma.user.findMany.mock.calls[0][0].where.OR[0].role.in;
    expect(roles).not.toContain('BUSINESS_OWNER');
    expect(roles).not.toContain('BRANCH_MANAGER');
    expect(roles).not.toContain('SUPER_ADMIN');
  });

  describe('wrong-PIN limit (5 in 15 minutes, for the whole business)', () => {
    it('after 5 wrong PINs even the right one waits, with a plain 429', async () => {
      const { svc, prisma } = build([]);
      for (let i = 0; i < 5; i++) {
        await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
      }
      prisma.user.findMany.mockResolvedValue([ANNA]);
      const err = await svc.switchCashierByPin(TENANT, '4729').catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse().message).toMatch(
        /^Too many wrong PINs\. Try again in 15 minutes, or sign in with your email and password\.$/,
      );
      expect(prisma.user.findMany).toHaveBeenCalledTimes(5);
    });

    it('a right PIN starts the count again', async () => {
      const { svc, prisma } = build([]);
      for (let i = 0; i < 4; i++) {
        await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
      }
      prisma.user.findMany.mockResolvedValueOnce([ANNA]);
      await expect(svc.switchCashierByPin(TENANT, '4729')).resolves.toMatchObject({ id: 'u-anna' });
      for (let i = 0; i < 4; i++) {
        await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
      }
    });

    it('another business is not locked out', async () => {
      const { svc } = build([]);
      for (let i = 0; i < 5; i++) {
        await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
      }
      await expect(svc.switchCashierByPin('t-other', '9999')).rejects.toThrow(UnauthorizedException);
    });

    it('a shared PIN is refused but is not counted as a wrong guess', async () => {
      const { svc, prisma } = build([]);
      for (let i = 0; i < 4; i++) {
        await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
      }
      prisma.user.findMany.mockResolvedValueOnce([ANNA, { ...ANNA, id: 'u-ben' }]);
      await expect(svc.switchCashierByPin(TENANT, '4729')).rejects.toThrow(ForbiddenException);
      // Still one wrong try left.
      await expect(svc.switchCashierByPin(TENANT, '9999')).rejects.toThrow(UnauthorizedException);
    });
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

  /*
    The same screen is the manual "back in a minute" lock, and in a one-person
    cafe the person who taps it is the owner. Her own PIN gets her back into
    her own session; it lands nobody new on the till, so the role list that
    keeps owner sessions off shared tills does not apply to it. Everyone else
    is still held to the till roles.
  */
  describe('unlocking the screen the same person locked', () => {
    const OWNER = { id: 'u-anne', tenantId: TENANT, branchId: 'br-1', role: 'BUSINESS_OWNER', name: 'Anne', enable2fa: false };

    /** A findMany that obeys the where clause, so it is the query that decides who is found. */
    function realistic() {
      const people = [
        { ...OWNER, isActive: true, kioskOnly: false, kioskPin: '8180' },
        { ...ANNA,  isActive: true, kioskOnly: false, kioskPin: '4729' },
      ];
      const prisma: any = {
        user: {
          findMany: jest.fn(async ({ where }: any) => {
            const conds: any[] = where.OR ?? [{ role: where.role }];
            return people.filter((u) => u.tenantId === where.tenantId && u.isActive && !u.kioskOnly
              && u.kioskPin === where.kioskPin
              && conds.some((c) => (c.id ? c.id === u.id : c.role.in.includes(u.role))));
          }),
        },
      };
      return new AuthService(prisma, {} as any, {} as any, {} as any);
    }

    it('lets the owner back into her own screen with her own PIN', async () => {
      await expect(realistic().switchCashierByPin(TENANT, '8180', 'u-anne'))
        .resolves.toMatchObject({ id: 'u-anne', role: 'BUSINESS_OWNER' });
    });

    it("still refuses the owner's PIN on somebody else's session", async () => {
      await expect(realistic().switchCashierByPin(TENANT, '8180', 'u-anna')).rejects.toThrow(
        'No cashier has that PIN. Owners and managers sign in with email and password.',
      );
    });

    it('still refuses it with no session named, and still lets a relief cashier take over', async () => {
      await expect(realistic().switchCashierByPin(TENANT, '8180')).rejects.toThrow(UnauthorizedException);
      await expect(realistic().switchCashierByPin(TENANT, '4729', 'u-anne')).resolves.toMatchObject({ id: 'u-anna' });
      await expect(realistic().switchCashierByPin(TENANT, '1111', 'u-anne')).rejects.toThrow(UnauthorizedException);
    });
  });

  it('rejects malformed PINs before touching the database', async () => {
    const { svc, prisma } = build([]);
    await expect(svc.switchCashierByPin(TENANT, 'abc')).rejects.toThrow(UnauthorizedException);
    await expect(svc.switchCashierByPin(TENANT, '12')).rejects.toThrow(UnauthorizedException);
    await expect(svc.switchCashierByPin(TENANT, '')).rejects.toThrow(UnauthorizedException);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
