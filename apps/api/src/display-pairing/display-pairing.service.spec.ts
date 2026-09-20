import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DisplayPairingService } from './display-pairing.service';
import { pairingCodeAttempts } from '../auth/pin-attempts';

/**
 * Pairing a kitchen, bar or customer screen.
 *
 * 1. A kitchen/bar code must name a real station. A code with no station
 *    used to pair fine, then the tablet showed "All caught up" forever
 *    while tickets waited.
 * 2. The 4-digit code is the only secret on redeem, so wrong codes are limited.
 */
describe('DisplayPairingService', () => {
  const TENANT = 't-carolina';
  const KITCHEN = { id: 'st-kitchen', hasKds: true };

  function build(opts: { station?: unknown; row?: unknown; tenant?: unknown } = {}) {
    const prisma: any = {
      station: { findFirst: jest.fn().mockResolvedValue(opts.station ?? null) },
      tenant: {
        findFirst: jest.fn().mockResolvedValue(
          'tenant' in opts ? opts.tenant : { id: TENANT, name: 'Carolina' },
        ),
      },
      displayPairing: {
        findFirst:  jest.fn().mockResolvedValue(null),
        create:     jest.fn(async ({ data }: any) => ({
          id: 'p1', createdAt: new Date(), redeemedAt: null, lastSeenAt: null, ...data,
        })),
        findUnique: jest.fn().mockResolvedValue(opts.row ?? null),
        update:     jest.fn(async ({ data }: any) => ({ ...(opts.row as object), ...data })),
      },
    };
    return { svc: new DisplayPairingService(prisma), prisma };
  }

  beforeEach(() => pairingCodeAttempts.clear());

  describe('createCode: kitchen and bar screens need a station', () => {
    it.each(['KDS_KITCHEN', 'KDS_BAR', 'KDS_GENERIC'] as const)(
      'refuses a %s code with no station, in plain words, and creates nothing',
      async (role) => {
        const { svc, prisma } = build();
        await expect(svc.createCode(TENANT, 'u-anne', role)).rejects.toThrow(
          new BadRequestException(
            'Pick the station this screen is for, such as Kitchen or Bar, in Settings > Displays. ' +
              'A kitchen or bar screen with no station shows no orders.',
          ),
        );
        expect(prisma.displayPairing.create).not.toHaveBeenCalled();
        expect(prisma.displayPairing.findFirst).not.toHaveBeenCalled();
      },
    );

    it("refuses a station that is not this business's, or is switched off", async () => {
      const { svc, prisma } = build({ station: null });
      await expect(
        svc.createCode(TENANT, 'u-anne', 'KDS_KITCHEN', { stationId: 'st-other-shop' }),
      ).rejects.toThrow('That station was not found. Refresh the page and pick the station again.');
      expect(prisma.station.findFirst.mock.calls[0][0].where).toEqual({
        id: 'st-other-shop', tenantId: TENANT, isActive: true,
      });
      expect(prisma.displayPairing.create).not.toHaveBeenCalled();
    });

    it('refuses a station whose screen is not turned on (its queue would refuse the tablet)', async () => {
      const { svc, prisma } = build({ station: { id: 'st-kitchen', hasKds: false } });
      await expect(
        svc.createCode(TENANT, 'u-anne', 'KDS_KITCHEN', { stationId: 'st-kitchen' }),
      ).rejects.toThrow(/Settings > Floor Layout/);
      expect(prisma.displayPairing.create).not.toHaveBeenCalled();
    });

    it('creates a kitchen code bound to the picked station', async () => {
      const { svc, prisma } = build({ station: KITCHEN });
      const row = await svc.createCode(TENANT, 'u-anne', 'KDS_KITCHEN', { stationId: 'st-kitchen' });
      expect(row.stationId).toBe('st-kitchen');
      expect(row.code).toMatch(/^\d{4}$/);
      expect(prisma.displayPairing.create.mock.calls[0][0].data).toMatchObject({
        tenantId: TENANT, role: 'KDS_KITCHEN', stationId: 'st-kitchen',
      });
    });

    it('a customer display still needs no station', async () => {
      const { svc, prisma } = build();
      const row = await svc.createCode(TENANT, 'u-anne', 'CUSTOMER_DISPLAY');
      expect(row.stationId).toBeNull();
      expect(prisma.station.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('redeem: wrong codes are limited (10 in 15 minutes per business)', () => {
    const LIVE = {
      id: 'p1', tenantId: TENANT, createdById: 'u-anne', role: 'KDS_KITCHEN', stationId: 'st-kitchen',
      label: null, code: '4821', redeemedAt: null, revokedAt: null,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    };

    it('after 10 wrong codes even the right one waits, with a plain 429', async () => {
      const { svc, prisma } = build();
      for (let i = 0; i < 10; i++) {
        await expect(svc.redeem('carolina', String(1000 + i))).rejects.toThrow(NotFoundException);
      }
      prisma.displayPairing.findUnique.mockResolvedValue(LIVE);
      const err = await svc.redeem('carolina', '4821').catch((e) => e);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse().message).toMatch(
        /^Too many wrong pairing codes\. Try again in 15 minutes, then make a new code in Settings > Displays\.$/,
      );
      expect(prisma.displayPairing.findUnique).toHaveBeenCalledTimes(10);
      expect(prisma.displayPairing.update).not.toHaveBeenCalled();
    });

    it('used, revoked and expired codes count as failed tries too', async () => {
      const { svc, prisma } = build();
      prisma.displayPairing.findUnique.mockResolvedValue({ ...LIVE, redeemedAt: new Date() });
      for (let i = 0; i < 10; i++) {
        await expect(svc.redeem('carolina', '4821')).rejects.toThrow(BadRequestException);
      }
      const err = await svc.redeem('carolina', '4821').catch((e) => e);
      expect(err.getStatus()).toBe(429);
    });

    it('a good code pairs and starts the count again', async () => {
      const { svc, prisma } = build();
      for (let i = 0; i < 9; i++) {
        await expect(svc.redeem('carolina', '1111')).rejects.toThrow(NotFoundException);
      }
      prisma.displayPairing.findUnique.mockResolvedValueOnce(LIVE);
      prisma.displayPairing.update.mockResolvedValueOnce({ ...LIVE, redeemedAt: new Date() });
      await expect(svc.redeem('carolina', '4821')).resolves.toMatchObject({ stationId: 'st-kitchen' });
      for (let i = 0; i < 10; i++) {
        await expect(svc.redeem('carolina', '1111')).rejects.toThrow(NotFoundException);
      }
    });

    it('another business can still pair', async () => {
      const { svc, prisma } = build();
      for (let i = 0; i < 10; i++) {
        await expect(svc.redeem('carolina', '1111')).rejects.toThrow(NotFoundException);
      }
      prisma.tenant.findFirst.mockResolvedValue({ id: 't-other', name: 'Other' });
      await expect(svc.redeem('other', '1111')).rejects.toThrow(NotFoundException);
    });

    it('an unknown company code is not counted against anyone', async () => {
      const { svc } = build({ tenant: null });
      for (let i = 0; i < 20; i++) {
        await expect(svc.redeem('nope', '1111')).rejects.toThrow('Tenant not found.');
      }
    });
  });
});
