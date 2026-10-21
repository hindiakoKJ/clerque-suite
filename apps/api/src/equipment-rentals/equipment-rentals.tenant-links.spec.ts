import { ForbiddenException } from '@nestjs/common';
import { EquipmentRentalsService } from './equipment-rentals.service';

/**
 * An item's branch and a rental's customer must be this club's own (tenant
 * isolation check, 21 Oct 2026, finding P3). The stand-in database holds
 * this club's rows only; any other id is another shop's.
 */
const TENANT = 'club-1';
const MINE = { branch: new Set(['b-courts']), customer: new Set(['c-ana']) };
const owned = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

function build() {
  const tx = {
    rentalTransaction: {
      count:  jest.fn().mockResolvedValue(0),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'r1', rentalNumber: data.rentalNumber, ...data })),
    },
    rentableItem: { updateMany: jest.fn().mockResolvedValue({}) },
  };
  const prisma: any = {
    branch:   { findFirst: owned(MINE.branch) },
    customer: { findFirst: owned(MINE.customer) },
    rentableItem: {
      create:   jest.fn(({ data }: any) => Promise.resolve({ id: 'i-new', ...data })),
      findMany: jest.fn().mockResolvedValue([
        { id: 'i1', name: 'Paddle A', status: 'AVAILABLE', isActive: true, branchId: 'b-courts', rentFeeCentavos: 5000, depositCentavos: 30000 },
      ]),
    },
    tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'UNREGISTERED' }) },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const journal  = { create: jest.fn().mockResolvedValue({ id: 'je' }) };
  const accounts = { findByCode: jest.fn((_t: string, code: string) => Promise.resolve({ id: `acct-${code}` })) };
  const tax      = { computeTaxBreakdown: (gross: number) => ({ netAmount: gross, vatAmount: 0, grossAmount: gross, totalAmount: gross }) };
  return { svc: new EquipmentRentalsService(prisma, journal as any, accounts as any, tax as any), prisma, tx };
}

describe('EquipmentRentalsService.createItem', () => {
  it('refuses another shop\'s branch', async () => {
    const { svc, prisma } = build();
    await expect(svc.createItem(TENANT, { name: 'Paddle B', branchId: 'b-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(prisma.rentableItem.create).not.toHaveBeenCalled();
  });

  it('still adds an item at this club\'s branch, or with no branch', async () => {
    const { svc, prisma } = build();
    await svc.createItem(TENANT, { name: 'Paddle B', branchId: 'b-courts' });
    await svc.createItem(TENANT, { name: 'Paddle C' });
    expect(prisma.rentableItem.create.mock.calls.map((c: any) => c[0].data.branchId)).toEqual(['b-courts', null]);
  });
});

describe('EquipmentRentalsService.rentOut', () => {
  it('refuses another shop\'s customer before anything is rented or posted', async () => {
    const { svc, tx } = build();
    await expect(svc.rentOut(TENANT, 'u1', { customerName: 'Ana', customerId: 'c-other-shop', itemIds: ['i1'] }))
      .rejects.toThrow(ForbiddenException);
    expect(tx.rentalTransaction.create).not.toHaveBeenCalled();
  });

  it('still rents out to this club\'s customer', async () => {
    const { svc, tx } = build();
    await svc.rentOut(TENANT, 'u1', { customerName: 'Ana', customerId: 'c-ana', itemIds: ['i1'] });
    expect(tx.rentalTransaction.create.mock.calls[0][0].data.customerId).toBe('c-ana');
  });
});
