import { ForbiddenException } from '@nestjs/common';
import { RentalsService } from './rentals.service';

/**
 * A rental's branch, customer and linked sales must be this shop's own
 * (tenant isolation check, 21 Oct 2026, findings K1 and P3).
 *
 * The unit list shows each unit's branch name and the rental list the
 * customer's name and phone, so another shop's id read that shop's row back.
 * The deposit and return order links are unique, so another shop's order id
 * would also squat on that shop's sale. The stand-in database holds this
 * shop's rows only; any other id is another shop's.
 */
const TENANT = 't-dme';
const MINE = {
  branch:   new Set(['b-main']),
  customer: new Set(['c-lola']),
  order:    new Set(['o-deposit', 'o-damage']),
};
const owned = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

function build() {
  const tx = {
    rentalAgreement: {
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'r-new', ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'r-1', ...data })),
    },
    serializedUnit: { update: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    product:  { findFirst: jest.fn().mockResolvedValue({ id: 'p-wheelchair' }) },
    branch:   { findFirst: owned(MINE.branch) },
    customer: { findFirst: owned(MINE.customer) },
    order:    { findFirst: owned(MINE.order) },
    serializedUnit: {
      findFirst: jest.fn().mockResolvedValue({ id: 'u-1', tenantId: TENANT, status: 'IN_STOCK' }),
      create:    jest.fn(({ data }: any) => Promise.resolve({ id: 'u-new', ...data })),
    },
    rentalAgreement: {
      findFirst: jest.fn().mockResolvedValue({ id: 'r-1', tenantId: TENANT, status: 'OPEN', depositCents: 100000, serializedUnitId: 'u-1' }),
    },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  return { svc: new RentalsService(prisma), prisma, tx };
}

const OPEN = {
  branchId: 'b-main', customerId: 'c-lola', serializedUnitId: 'u-1',
  rentalRate: 500, rateUnit: 'week' as const, depositCents: 100000, dueAt: '2026-11-21',
};

describe('RentalsService.createUnit', () => {
  it('refuses another shop\'s branch', async () => {
    const { svc, prisma } = build();
    await expect(svc.createUnit(TENANT, { branchId: 'b-other-shop', productId: 'p-wheelchair', serialNumber: 'WC-1' }))
      .rejects.toThrow(ForbiddenException);
    expect(prisma.serializedUnit.create).not.toHaveBeenCalled();
  });

  it('still adds a unit at this shop\'s branch', async () => {
    const { svc, prisma } = build();
    await svc.createUnit(TENANT, { branchId: 'b-main', productId: 'p-wheelchair', serialNumber: 'WC-1' });
    expect(prisma.serializedUnit.create.mock.calls[0][0].data).toMatchObject({ tenantId: TENANT, branchId: 'b-main' });
  });
});

describe('RentalsService.openRental', () => {
  it.each([
    ['customer', { customerId: 'c-other-shop' }],
    ['branch', { branchId: 'b-other-shop' }],
    ['deposit sale', { depositOrderId: 'o-other-shop' }],
  ])('refuses another shop\'s %s and writes nothing', async (_what, override) => {
    const { svc, tx } = build();
    await expect(svc.openRental(TENANT, 'u1', { ...OPEN, ...override })).rejects.toThrow(ForbiddenException);
    expect(tx.rentalAgreement.create).not.toHaveBeenCalled();
    expect(tx.serializedUnit.update).not.toHaveBeenCalled();
  });

  it('still opens a rental for this shop\'s customer, with or without a deposit sale', async () => {
    const { svc, tx } = build();
    await svc.openRental(TENANT, 'u1', { ...OPEN, depositOrderId: 'o-deposit' });
    expect(tx.rentalAgreement.create.mock.calls[0][0].data).toMatchObject({ customerId: 'c-lola', branchId: 'b-main', depositOrderId: 'o-deposit' });
    await svc.openRental(TENANT, 'u1', OPEN);
    expect(tx.rentalAgreement.create).toHaveBeenCalledTimes(2);
  });
});

describe('RentalsService.returnRental', () => {
  it('refuses another shop\'s sale as the return receipt', async () => {
    const { svc, tx } = build();
    await expect(svc.returnRental(TENANT, 'r-1', { returnOrderId: 'o-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(tx.rentalAgreement.update).not.toHaveBeenCalled();
  });

  it('still returns with this shop\'s receipt, or with none', async () => {
    const { svc, tx } = build();
    await svc.returnRental(TENANT, 'r-1', { returnOrderId: 'o-damage', damageFeeCents: 20000 });
    expect(tx.rentalAgreement.update.mock.calls[0][0].data).toMatchObject({ returnOrderId: 'o-damage', refundCents: 80000 });
    await svc.returnRental(TENANT, 'r-1', {});
    expect(tx.rentalAgreement.update).toHaveBeenCalledTimes(2);
  });
});
