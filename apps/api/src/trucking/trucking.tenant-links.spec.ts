import { ForbiddenException } from '@nestjs/common';
import { TruckingService } from './trucking.service';

/**
 * A fleet asset's branch and primary driver, and a trip's customer, must be
 * this shop's own (tenant isolation check, 21 Oct 2026, finding P3): each is
 * read back by name. The stand-in database holds this shop's rows only; any
 * other id is another shop's.
 */
const TENANT = 't-haul';
const MINE = {
  branch:   new Set(['b-depot']),
  user:     new Set(['u-driver']),
  customer: new Set(['c-mill']),
};
const owned = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

function build() {
  const prisma: any = {
    branch:   { findFirst: owned(MINE.branch) },
    user:     { findFirst: owned(MINE.user) },
    customer: { findFirst: owned(MINE.customer) },
    fleetAsset: {
      // The plate check finds no clash; the trip's asset lookup finds the truck.
      findFirst:  jest.fn(({ where }: any) => Promise.resolve(where.id ? { id: where.id } : null)),
      create:     jest.fn(({ data }: any) => Promise.resolve({ id: 'a-new', ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    tripTicket: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 'trip-new', ...data })) },
    accountingEvent: { create: jest.fn() },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const numbering = { next: jest.fn().mockResolvedValue('TRIP-0001') };
  const svc = new TruckingService(prisma, numbering as any);
  // getAsset after an update reads the asset back; not what these tests are about.
  jest.spyOn(svc, 'getAsset').mockResolvedValue({ id: 'a-1' } as any);
  return { svc, prisma };
}

describe('TruckingService fleet assets', () => {
  it.each([
    ['branch', { branchId: 'b-other-shop' }],
    ['primary driver', { primaryDriverId: 'u-other-shop' }],
  ])('refuses another shop\'s %s on create and update', async (_what, link) => {
    const { svc, prisma } = build();
    await expect(svc.createAsset(TENANT, { kind: 'TRUCK' as any, plateNumber: 'ABC 123', ...link })).rejects.toThrow(ForbiddenException);
    await expect(svc.updateAsset(TENANT, 'a-1', link)).rejects.toThrow(ForbiddenException);
    expect(prisma.fleetAsset.create).not.toHaveBeenCalled();
    expect(prisma.fleetAsset.updateMany).not.toHaveBeenCalled();
  });

  it('still sets this shop\'s branch and driver, and clears them with null without a lookup', async () => {
    const { svc, prisma } = build();
    await svc.createAsset(TENANT, { kind: 'TRUCK' as any, plateNumber: 'ABC 123', branchId: 'b-depot', primaryDriverId: 'u-driver' });
    expect(prisma.fleetAsset.create.mock.calls[0][0].data).toMatchObject({ branchId: 'b-depot', primaryDriverId: 'u-driver' });
    await svc.updateAsset(TENANT, 'a-1', { branchId: 'b-depot', primaryDriverId: 'u-driver' });
    expect(prisma.fleetAsset.updateMany.mock.calls[0][0].data).toMatchObject({ branchId: 'b-depot', primaryDriverId: 'u-driver' });

    prisma.branch.findFirst.mockClear();
    prisma.user.findFirst.mockClear();
    await svc.updateAsset(TENANT, 'a-1', { branchId: null, primaryDriverId: null } as any);
    expect(prisma.branch.findFirst).not.toHaveBeenCalled();
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.fleetAsset.updateMany.mock.calls[1][0].data).toMatchObject({ branchId: null, primaryDriverId: null });
  });
});

describe('TruckingService.createTrip -- the customer', () => {
  const TRIP = {
    branchId: 'b-depot', fleetAssetId: 'a-1', driverId: 'u-driver',
    originLabel: 'Naga', destinationLabel: 'Pili', freightAmount: 5000,
  } as any;

  it('refuses another shop\'s customer', async () => {
    const { svc, prisma } = build();
    await expect(svc.createTrip(TENANT, 'u1', { ...TRIP, customerId: 'c-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(prisma.tripTicket.create).not.toHaveBeenCalled();
  });

  it('still books a trip for this shop\'s customer, or for none', async () => {
    const { svc, prisma } = build();
    await svc.createTrip(TENANT, 'u1', { ...TRIP, customerId: 'c-mill' });
    await svc.createTrip(TENANT, 'u1', TRIP);
    expect(prisma.tripTicket.create.mock.calls.map((c: any) => c[0].data.customerId)).toEqual(['c-mill', null]);
  });
});
