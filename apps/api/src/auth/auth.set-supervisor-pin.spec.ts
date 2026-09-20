import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuthService } from './auth.service';

/**
 * The supervisor PIN approves a cashier's void or refund. It gets the same
 * "not 1234, not a birth year" rule as the till PIN when it is set.
 */
describe('AuthService — setSupervisorPin', () => {
  async function build() {
    const prisma: any = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          passwordHash: await bcrypt.hash('right-password', 4),
          isActive: true,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new AuthService(prisma, {} as any, {} as any, {} as any);
    return { svc, prisma };
  }

  it.each(['1234', '0000', '123456', '1990', '121212', '9876'])(
    'refuses the easy-to-guess PIN %p and saves nothing',
    async (pin) => {
      const { svc, prisma } = await build();
      await expect(svc.setSupervisorPin('u-anne', 'right-password', pin)).rejects.toThrow(
        new BadRequestException(
          'That PIN is too easy to guess. Avoid 1234, 0000, repeated digits, counting up or down, ' +
            'and years like 1990. This PIN approves voids and refunds.',
        ),
      );
      expect(prisma.user.update).not.toHaveBeenCalled();
    },
  );

  it('still requires 4 to 6 digits', async () => {
    const { svc } = await build();
    await expect(svc.setSupervisorPin('u-anne', 'right-password', '1234567')).rejects.toThrow(
      'PIN must be 4 to 6 digits.',
    );
  });

  it('saves a PIN that is not easy to guess, hashed', async () => {
    const { svc, prisma } = await build();
    await svc.setSupervisorPin('u-anne', 'right-password', ' 830516 ');
    const saved = prisma.user.update.mock.calls[0][0].data.supervisorPinHash;
    expect(await bcrypt.compare('830516', saved)).toBe(true);
  });
});
