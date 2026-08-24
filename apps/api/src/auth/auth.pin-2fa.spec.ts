import { UnauthorizedException } from '@nestjs/common';

// TwoFactorService pulls in otplib, which ships ESM that Jest cannot parse.
// The controller only ever holds a reference to it on this path, so stubbing
// the module keeps the import graph loadable without weakening the test.
jest.mock('./two-factor.service', () => ({ TwoFactorService: class {} }));

import { AuthController } from './auth.controller';

/**
 * PIN login must honour 2FA.
 *
 * /auth/login checks User.enable2fa and hands back a short-lived challenge
 * instead of real tokens. /auth/pin-login did not — so an account with 2FA
 * enabled could skip its second factor simply by signing in with a 4-8 digit
 * PIN instead of its password. The PIN is strictly weaker than the password
 * 2FA exists to backstop, which made the route an outright bypass.
 */
describe('AuthController — pin-login honours 2FA', () => {
  const USER = {
    id: 'u-1', tenantId: 't-1', branchId: 'br-1', role: 'CASHIER', name: 'Cashier',
  };

  function build(enable2fa: boolean) {
    const authService: any = {
      validateUserByPin: jest.fn().mockResolvedValue(USER),
      login: jest.fn().mockResolvedValue({ accessToken: 'real-access', refreshToken: 'real-refresh' }),
    };
    const prisma: any = { user: { findUnique: jest.fn().mockResolvedValue({ enable2fa }) } };
    const jwt: any = { sign: jest.fn().mockReturnValue('challenge-token') };

    // (authService, twoFactor, jwt, prisma)
    const ctrl = new AuthController(authService, {} as any, jwt, prisma);
    return { ctrl, authService, jwt };
  }

  const req = { headers: {}, ip: '1.2.3.4' };
  const res: any = { cookie: jest.fn(), clearCookie: jest.fn() };
  const dto: any = { email: 'cashier@shop.ph', pin: '1234', companyCode: 'SHOP' };

  it('issues tokens when the account has no 2FA', async () => {
    const { ctrl, authService } = build(false);
    const out: any = await ctrl.pinLogin(req, dto, res);

    expect(out.accessToken).toBe('real-access');
    expect(authService.login).toHaveBeenCalled();
  });

  it('returns a challenge instead of tokens when 2FA is on', async () => {
    const { ctrl, authService, jwt } = build(true);
    const out: any = await ctrl.pinLogin(req, dto, res);

    expect(out.requires2fa).toBe(true);
    expect(out.challengeToken).toBe('challenge-token');
    // Crucially: no real session was minted.
    expect(out.accessToken).toBeUndefined();
    expect(authService.login).not.toHaveBeenCalled();
    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: USER.id, kind: '2fa-challenge' }),
      expect.objectContaining({ expiresIn: '5m' }),
    );
  });

  it('still rejects a wrong PIN outright', async () => {
    const { ctrl } = build(false);
    (ctrl as any).authService.validateUserByPin = jest.fn().mockResolvedValue(null);
    await expect(ctrl.pinLogin(req, dto, res)).rejects.toThrow(UnauthorizedException);
  });
});
