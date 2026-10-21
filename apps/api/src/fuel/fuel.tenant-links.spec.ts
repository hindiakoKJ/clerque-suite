import { ForbiddenException } from '@nestjs/common';
import { FuelService } from './fuel.service';

/**
 * Ids a fuel record links to must be this shop's own (tenant isolation
 * check, 21 Oct 2026, findings P2 and P3).
 *
 * A dispense linked to another shop's order folded that sale's total into
 * this shop's cash collected, and since the link is unique it also stopped
 * that shop from linking its own sale. A named attendant read another shop's
 * employee name back, and a pump or tank dip could sit at another shop's
 * branch. The stand-in database holds this shop's rows only; any other id is
 * another shop's.
 */
const TENANT = 't-gas';
const CASHIER = 'u-cashier';
const MINE = {
  branch: new Set(['b-main']),
  user:   new Set([CASHIER, 'u-attendant']),
  order:  new Set(['o-mine']),
};
const owned = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

const ORDERS = [
  { id: 'o-mine', tenantId: TENANT, totalAmount: 1000 },
  { id: 'o-other-shop', tenantId: 't-elsewhere', totalAmount: 9999 },
];

function build() {
  const prisma: any = {
    branch: { findFirst: owned(MINE.branch) },
    user:   { findFirst: owned(MINE.user) },
    order: {
      findFirst: owned(MINE.order),
      // Honours the shop filter the way the database does.
      findMany: jest.fn(({ where }: any) => Promise.resolve(ORDERS.filter((o) =>
        where.id.in.includes(o.id) && (where.tenantId === undefined || o.tenantId === where.tenantId)))),
    },
    product:  { findFirst: jest.fn().mockResolvedValue({ id: 'p-diesel' }) },
    fuelPump: {
      create:    jest.fn(({ data }: any) => Promise.resolve({ id: 'pump-new', ...data })),
      findFirst: jest.fn().mockResolvedValue({ id: 'pump-1', tenantId: TENANT, isActive: true, currentMeter: 100, product: { price: 60 } }),
    },
    fuelDispense: {
      findFirst:  jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue({ id: 'd-1', orderId: null, pump: { tenantId: TENANT } }),
      create:     jest.fn(({ data }: any) => Promise.resolve({ id: 'd-new', ...data })),
      update:     jest.fn(({ data }: any) => Promise.resolve({ id: 'd-1', ...data })),
      findMany:   jest.fn(),
    },
    tankDip: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 'dip-new', ...data })) },
  };
  return { svc: new FuelService(prisma), prisma };
}

describe('FuelService.attachOrder -- the sale linked to a dispense', () => {
  it('refuses another shop\'s order and links nothing', async () => {
    const { svc, prisma } = build();
    await expect(svc.attachOrder(TENANT, 'd-1', 'o-other-shop')).rejects.toThrow(ForbiddenException);
    expect(prisma.fuelDispense.update).not.toHaveBeenCalled();
  });

  it('still links this shop\'s order', async () => {
    const { svc, prisma } = build();
    await svc.attachOrder(TENANT, 'd-1', 'o-mine');
    expect(prisma.fuelDispense.update).toHaveBeenCalledWith({ where: { id: 'd-1' }, data: { orderId: 'o-mine' } });
  });
});

describe('FuelService.getDailyReconciliation', () => {
  it('counts only this shop\'s sales as cash collected, even for a link written before the check', async () => {
    const { svc, prisma } = build();
    const day = new Date('2026-10-20T03:00:00Z');
    prisma.fuelDispense.findMany.mockResolvedValue([
      { status: 'COMPLETED', startedAt: day, totalCents: 100000, orderId: 'o-mine',       pump: { branchId: 'b-main' } },
      { status: 'COMPLETED', startedAt: day, totalCents: 50000,  orderId: 'o-other-shop', pump: { branchId: 'b-main' } },
    ]);
    const [row] = await svc.getDailyReconciliation(TENANT, { from: day, to: day });
    expect(prisma.order.findMany.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(row.cashCollectedCents).toBe(100000);
    // The foreign link reads as a fill nobody rang up here.
    expect(row.unrungLitersValueCents).toBe(50000);
  });
});

describe('FuelService.startDispense -- the attendant', () => {
  it('refuses another shop\'s staff as the attendant', async () => {
    const { svc, prisma } = build();
    await expect(svc.startDispense(TENANT, CASHIER, { pumpId: 'pump-1', openingMeter: 120, attendantId: 'u-other-shop' }))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.fuelDispense.create).not.toHaveBeenCalled();
  });

  it('still starts with this shop\'s attendant, or with the calling cashier and no lookup', async () => {
    const { svc, prisma } = build();
    await svc.startDispense(TENANT, CASHIER, { pumpId: 'pump-1', openingMeter: 120, attendantId: 'u-attendant' });
    expect(prisma.fuelDispense.create.mock.calls[0][0].data.attendantId).toBe('u-attendant');
    prisma.user.findFirst.mockClear();
    await svc.startDispense(TENANT, CASHIER, { pumpId: 'pump-1', openingMeter: 130 });
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
    expect(prisma.fuelDispense.create.mock.calls[1][0].data.attendantId).toBe(CASHIER);
  });
});

describe('FuelService pumps and tank dips -- the branch', () => {
  it('refuses another shop\'s branch', async () => {
    const { svc, prisma } = build();
    await expect(svc.createPump(TENANT, { branchId: 'b-other-shop', label: 'P1', fuelGrade: 'DIESEL' as any, productId: 'p-diesel' }))
      .rejects.toThrow(ForbiddenException);
    await expect(svc.recordTankDip(TENANT, CASHIER, {
      branchId: 'b-other-shop', fuelGrade: 'DIESEL' as any, recordedAt: '2026-10-21T06:00:00Z', kind: 'MORNING' as any, litersOnHand: 5000,
    })).rejects.toThrow(ForbiddenException);
    expect(prisma.fuelPump.create).not.toHaveBeenCalled();
    expect(prisma.tankDip.create).not.toHaveBeenCalled();
  });

  it('still records both at this shop\'s branch', async () => {
    const { svc, prisma } = build();
    await svc.createPump(TENANT, { branchId: 'b-main', label: 'P1', fuelGrade: 'DIESEL' as any, productId: 'p-diesel' });
    await svc.recordTankDip(TENANT, CASHIER, {
      branchId: 'b-main', fuelGrade: 'DIESEL' as any, recordedAt: '2026-10-21T06:00:00Z', kind: 'MORNING' as any, litersOnHand: 5000,
    });
    expect(prisma.fuelPump.create.mock.calls[0][0].data.branchId).toBe('b-main');
    expect(prisma.tankDip.create.mock.calls[0][0].data.branchId).toBe('b-main');
  });
});
