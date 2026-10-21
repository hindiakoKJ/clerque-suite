import { ForbiddenException } from '@nestjs/common';
import { PreOrdersService } from './pre-orders.service';

/**
 * A pre-order's branch and customer must be this shop's own (tenant
 * isolation check, 21 Oct 2026, findings K1 and P3).
 *
 * GET /pre-orders/:id returns the whole customer record -- TIN, address,
 * phone -- so another shop's customer id turned a pre-order into a way to
 * read that shop's customer. The stand-in database holds this shop's rows
 * only; any other id is another shop's.
 */
const TENANT = 't-bakery';
const MINE = { branch: new Set(['b-main']), customer: new Set(['c-ana']) };
const owned = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

function build() {
  const prisma: any = {
    product:  { findMany: jest.fn(({ where }: any) => Promise.resolve(where.id.in.map((id: string) => ({ id })))) },
    branch:   { findFirst: owned(MINE.branch) },
    customer: { findFirst: owned(MINE.customer) },
    preOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'po-1', tenantId: TENANT, status: 'DRAFT', preOrderNumber: 'PO-000001',
        subtotalCents: 50000, discountCents: 0, depositCents: 0,
      }),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'po-2', ...data })),
      update: jest.fn(({ data }: any) => Promise.resolve({ id: 'po-1', ...data })),
    },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  return { svc: new PreOrdersService(prisma), prisma };
}

const CAKE = {
  branchId: 'b-main', pickupDate: '2026-11-01',
  items: [{ productId: 'p-cake', productName: 'Ube cake', quantity: 1, unitPriceCents: 50000 }],
};

describe('PreOrdersService.create', () => {
  it('refuses another shop\'s customer and writes nothing', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(TENANT, 'u1', { ...CAKE, customerId: 'c-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(prisma.preOrder.create).not.toHaveBeenCalled();
  });

  it('refuses another shop\'s branch', async () => {
    const { svc, prisma } = build();
    await expect(svc.create(TENANT, 'u1', { ...CAKE, branchId: 'b-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(prisma.preOrder.create).not.toHaveBeenCalled();
  });

  it('still takes a pre-order for this shop\'s customer, or for a walk-in with none', async () => {
    const { svc, prisma } = build();
    await svc.create(TENANT, 'u1', { ...CAKE, customerId: 'c-ana' });
    expect(prisma.preOrder.create.mock.calls[0][0].data).toMatchObject({ tenantId: TENANT, branchId: 'b-main', customerId: 'c-ana' });
    await svc.create(TENANT, 'u1', CAKE);
    expect(prisma.preOrder.create).toHaveBeenCalledTimes(2);
  });
});

describe('PreOrdersService.update', () => {
  it('refuses another shop\'s customer before writing', async () => {
    const { svc, prisma } = build();
    await expect(svc.update(TENANT, 'po-1', { customerId: 'c-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(prisma.preOrder.update).not.toHaveBeenCalled();
  });

  it('still sets this shop\'s customer, and clears it with null without a lookup', async () => {
    const { svc, prisma } = build();
    await svc.update(TENANT, 'po-1', { customerId: 'c-ana' });
    expect(prisma.preOrder.update.mock.calls[0][0].data.customerId).toBe('c-ana');
    prisma.customer.findFirst.mockClear();
    await svc.update(TENANT, 'po-1', { customerId: null });
    expect(prisma.customer.findFirst).not.toHaveBeenCalled();
    expect(prisma.preOrder.update.mock.calls[1][0].data.customerId).toBeNull();
  });
});
