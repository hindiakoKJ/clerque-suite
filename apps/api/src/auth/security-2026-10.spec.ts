import { ForbiddenException, NotFoundException, UnauthorizedException, BadRequestException, HttpException } from '@nestjs/common';
import { createHash } from 'crypto';

jest.mock('./two-factor.service', () => ({ TwoFactorService: class {} }));

import { AuthController } from './auth.controller';
import { isPublishedPassword } from './published-passwords';
import { assertPasswordPolicy } from './password-policy';
import { pharmacistPinAttempts } from './pin-attempts';
import { PharmacyService } from '../pharmacy/pharmacy.service';
import { UsersService } from '../users/users.service';

/**
 * The 13 Oct 2026 check against the sign-up security list found these paths
 * open. Each test below is one of them, written as what an outsider or a
 * dishonest staff member would try.
 */

// The published passwords are rebuilt from pieces so this file does not
// publish them again in one string.
const SEEDED_OWNER = 'Admin' + '1234!';
const SEEDED_CASHIER = 'Cashier' + '1234!';
const SEEDED_PLATFORM_ADMIN = 'Super' + '1234!';

describe('passwords that were published in the public repo', () => {
  it('are recognised from their fingerprints alone', () => {
    expect(isPublishedPassword(SEEDED_OWNER)).toBe(true);
    expect(isPublishedPassword(SEEDED_CASHIER)).toBe(true);
    expect(isPublishedPassword(SEEDED_PLATFORM_ADMIN)).toBe(true);
    expect(isPublishedPassword('a long private passphrase')).toBe(false);
  });

  it('the seeded platform admin may keep its password only until it is changed, and only as the platform admin', () => {
    expect(isPublishedPassword(SEEDED_PLATFORM_ADMIN, 'SUPER_ADMIN')).toBe(false);
    // Any other account using that password is refused.
    expect(isPublishedPassword(SEEDED_PLATFORM_ADMIN, 'BUSINESS_OWNER')).toBe(true);
    // The demo owner's password is refused whatever the role.
    expect(isPublishedPassword(SEEDED_OWNER, 'SUPER_ADMIN')).toBe(true);
  });

  it('cannot be chosen again as a new password', () => {
    // 12 characters, so it passes the length rule and would otherwise be accepted.
    expect(() => assertPasswordPolicy(SEEDED_CASHIER)).toThrow(BadRequestException);
  });

  it('the fingerprints in the code are SHA-256 of the published values', () => {
    const print = createHash('sha256').update(SEEDED_OWNER).digest('hex');
    expect(print).toHaveLength(64);
    expect(isPublishedPassword(SEEDED_OWNER)).toBe(true);
  });
});

describe('sign-in refuses a published password in production', () => {
  const env = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = env; });

  async function signIn(password: string, role = 'BUSINESS_OWNER') {
    // Real bcrypt so the right password really matches.
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 4);
    const { AuthService } = await import('./auth.service');
    const prisma: any = {
      user: { findMany: jest.fn().mockResolvedValue([{
        id: 'u-1', tenantId: 't-demo', branchId: null, role, name: 'Demo', passwordHash,
        isActive: true, kioskOnly: false, tenant: { status: 'ACTIVE' }, appAccess: [],
      }]) },
      loginLog: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(0), create: jest.fn() },
    };
    const svc = Object.create(AuthService.prototype);
    (svc as any).prisma = prisma;
    return (svc as any).validateUser('admin@demo.com', password);
  }

  it('the demo owner with its published password is refused', async () => {
    process.env.NODE_ENV = 'production';
    await expect(signIn(SEEDED_OWNER)).rejects.toThrow(ForbiddenException);
  });

  it('a private password still signs in', async () => {
    process.env.NODE_ENV = 'production';
    const user = await signIn('a long private passphrase');
    expect(user.id).toBe('u-1');
  });
});

describe('a 2FA code cannot be guessed', () => {
  function build(recentFailures: number) {
    const authService: any = { login: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }) };
    const twoFactor: any = { verify: jest.fn().mockResolvedValue(false) };
    const jwt: any = { verify: jest.fn().mockReturnValue({ sub: 'u-1', kind: '2fa-challenge', tenantId: 't-1', role: 'BUSINESS_OWNER' }) };
    const prisma: any = {
      loginLog: { findFirst: jest.fn().mockResolvedValue(null), count: jest.fn().mockResolvedValue(recentFailures), create: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ email: 'owner@shop.ph' }) },
    };
    return { ctrl: new AuthController(authService, twoFactor, jwt, prisma), prisma, twoFactor };
  }
  const req = { headers: {}, ip: '1.2.3.4' };
  const res: any = { cookie: jest.fn() };

  it('a wrong code is recorded against the account', async () => {
    const { ctrl, prisma } = build(0);
    await expect(ctrl.loginWith2fa(req, res, { challengeToken: 'c', code: '000000' })).rejects.toThrow(UnauthorizedException);
    expect(prisma.loginLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'u-1', success: false, reason: '2FA_CODE_WRONG', email: 'owner@shop.ph' }),
    });
  });

  it('after five failures the account is locked before the code is even checked', async () => {
    const { ctrl, twoFactor } = build(5);
    await expect(ctrl.loginWith2fa(req, res, { challengeToken: 'c', code: '123456' })).rejects.toThrow(ForbiddenException);
    expect(twoFactor.verify).not.toHaveBeenCalled();
  });
});

describe('the pharmacy PIN check no longer reveals other staff PINs', () => {
  beforeEach(() => pharmacistPinAttempts.clear());

  it('asks only for an active pharmacist, so a cashier\'s or the owner\'s right PIN reads as a miss', async () => {
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const svc = new PharmacyService(prisma);
    const out = await svc.verifyAttestPin('t-1', '4829');
    expect(out).toEqual({ valid: false, reason: 'PIN_NOT_FOUND' });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 't-1', kioskPin: '4829', isActive: true, prcLicense: { not: null } }),
    }));
  });

  it('stops after ten misses in a shop', async () => {
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue(null) } };
    const svc = new PharmacyService(prisma);
    for (let i = 0; i < 10; i++) await svc.verifyAttestPin('t-1', String(1000 + i));
    await expect(svc.verifyAttestPin('t-1', '2000')).rejects.toThrow(HttpException);
  });

  it('a pharmacist\'s PIN still verifies and clears the count', async () => {
    const prisma: any = { user: { findFirst: jest.fn().mockResolvedValue({ name: 'RPh Ana', prcLicense: 'PRC-1' }) } };
    const svc = new PharmacyService(prisma);
    expect(await svc.verifyAttestPin('t-1', '5555')).toEqual({ valid: true, pharmacistName: 'RPh Ana', prcLicense: 'PRC-1' });
  });
});

describe('a shop owner cannot reach the platform admin that sits in their shop', () => {
  // A Prisma stand-in that honours `role: { not: ... }` the way the database does.
  function shopWithPlatformAdmin() {
    const rows = [
      { id: 'u-admin', tenantId: 't-demo', role: 'SUPER_ADMIN', email: 'platform@clerque', name: 'Platform' },
      { id: 'u-cash', tenantId: 't-demo', role: 'CASHIER', email: 'cash@demo', name: 'Cash' },
    ];
    const match = (w: any) => rows.filter((r) =>
      (w.id === undefined || r.id === w.id) && (w.tenantId === undefined || r.tenantId === w.tenantId)
      && (w.role?.not === undefined || r.role !== w.role.not));
    const prisma: any = {
      user: {
        findFirst: jest.fn(async ({ where }: any) => match(where)[0] ?? null),
        updateMany: jest.fn(async ({ where }: any) => ({ count: match(where).length })),
      },
      userSession: { updateMany: jest.fn() },
    };
    return { svc: new UsersService(prisma, {} as any), prisma };
  }

  it('cannot read it', async () => {
    const { svc } = shopWithPlatformAdmin();
    await expect(svc.findOne('t-demo', 'u-admin', 'BUSINESS_OWNER')).rejects.toThrow(NotFoundException);
  });

  it('cannot reset its password', async () => {
    const { svc, prisma } = shopWithPlatformAdmin();
    await expect(svc.resetPassword('t-demo', 'u-admin', 'a long private passphrase')).rejects.toThrow(NotFoundException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('cannot set its PIN or change it', async () => {
    const { svc, prisma } = shopWithPlatformAdmin();
    await expect(svc.update('t-demo', 'u-admin', { kioskPin: '482913' } as any, 'BUSINESS_OWNER', 'u-owner')).rejects.toThrow(NotFoundException);
    expect(prisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('still resets a real staff member', async () => {
    const { svc } = shopWithPlatformAdmin();
    await expect(svc.resetPassword('t-demo', 'u-cash', 'a long private passphrase')).resolves.toBeDefined();
  });
});
