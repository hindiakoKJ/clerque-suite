import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * Self-service till/login PIN.
 *
 * The PIN is a credential (PIN login mints a full session), so setting it
 * demands the account password, and collisions are rejected at write time —
 * the till switch refuses ambiguous PINs at use time, and stranding two
 * cashiers mid-shift is the worse place to discover the clash.
 */
describe('AuthService — setMyPin', () => {
  const TENANT = 't1';
  const ME = 'u-anna';
  let HASH: string;

  beforeAll(async () => {
    HASH = await bcrypt.hash('correct-horse', 4);
  });

  function build(opts: { clash?: boolean } = {}) {
    const updates: any[] = [];
    const prisma: any = {
      user: {
        findFirst: jest.fn(({ where }: any) => {
          if (where.id === ME) return Promise.resolve({ id: ME, passwordHash: HASH });
          // The clash probe: someone else already owns this PIN?
          return Promise.resolve(opts.clash ? { id: 'u-ben' } : null);
        }),
        update: jest.fn(({ where, data }: any) => { updates.push({ where, data }); return Promise.resolve({}); }),
      },
    };
    const svc = new AuthService(prisma, {} as any, {} as any, {} as any);
    return { svc, updates };
  }

  it('saves a valid PIN after password confirmation', async () => {
    const { svc, updates } = build();
    await svc.setMyPin(ME, TENANT, '4729', 'correct-horse');
    expect(updates[0].data.kioskPin).toBe('4729');
  });

  it('refuses the wrong password — an unattended till is not authority', async () => {
    const { svc, updates } = build();
    await expect(svc.setMyPin(ME, TENANT, '4729', 'guess')).rejects.toThrow(UnauthorizedException);
    expect(updates).toHaveLength(0);
  });

  it('refuses a PIN someone else at the shop already uses', async () => {
    const { svc, updates } = build({ clash: true });
    await expect(svc.setMyPin(ME, TENANT, '4729', 'correct-horse')).rejects.toThrow(ForbiddenException);
    expect(updates).toHaveLength(0);
  });

  it('rejects malformed PINs', async () => {
    const { svc } = build();
    await expect(svc.setMyPin(ME, TENANT, '12', 'correct-horse')).rejects.toThrow(BadRequestException);
    await expect(svc.setMyPin(ME, TENANT, 'abcd', 'correct-horse')).rejects.toThrow(BadRequestException);
    await expect(svc.setMyPin(ME, TENANT, '123456789', 'correct-horse')).rejects.toThrow(BadRequestException);
  });
});
