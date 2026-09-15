import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';

/** What a bearer token has to be to sign someone in. */
describe('JwtStrategy.validate', () => {
  process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';
  const prisma: any = { user: { findUnique: jest.fn(async ({ where }: any) => (where.id === 'gone' ? { id: 'gone', isActive: false } : { id: where.id, isActive: true })) } };
  const strategy = new JwtStrategy(prisma);
  const access = { sub: 'owner-1', tenantId: 't1', branchId: null, role: 'BUSINESS_OWNER', name: 'Anne' } as any;

  it('an access token for an active user signs in', async () => {
    await expect(strategy.validate(access)).resolves.toBe(access);
  });

  it('a 2FA challenge token does not, though it names the same owner', async () => {
    await expect(strategy.validate({ ...access, kind: '2fa-challenge' })).rejects.toThrow(UnauthorizedException);
  });

  it('a refresh token does not either', async () => {
    await expect(strategy.validate({ sub: 'owner-1', type: 'refresh' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('a deactivated user does not', async () => {
    await expect(strategy.validate({ ...access, sub: 'gone' })).rejects.toThrow(UnauthorizedException);
  });
});
