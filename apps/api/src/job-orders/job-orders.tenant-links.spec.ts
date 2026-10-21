import { BadRequestException, NotFoundException } from '@nestjs/common';
import { JobOrdersService } from './job-orders.service';

/**
 * Any product or technician a job-order line names must be this shop's own,
 * whatever the line's kind (tenant isolation check, 21 Oct 2026, finding P3).
 *
 * Only PART and CONSUMABLE lines were checked for a product and only LABOR
 * lines for a technician, so another shop's ids rode in on the other kinds
 * and the job order read their names back. The stand-in database holds this
 * shop's rows only; any other id is another shop's.
 */
const TENANT = 't-repair';

function build() {
  const prisma: any = {
    jobOrder: {
      findFirst:  jest.fn().mockResolvedValue({ id: 'jo-1', status: 'IN_PROGRESS' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    product: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && where.id === 'p-belt' ? { id: 'p-belt' } : null)),
    },
    user: {
      // An active technician and one who has left; both are this shop's.
      findFirst: jest.fn(({ where }: any) => {
        const staff: Record<string, boolean> = { 'u-tech': true, 'u-left': false };
        const ok = where.tenantId === TENANT && where.id in staff && (where.isActive === undefined || staff[where.id] === where.isActive);
        return Promise.resolve(ok ? { id: where.id } : null);
      }),
    },
    jobOrderLine: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 'line-new', ...data })) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  return { svc: new JobOrdersService(prisma, {} as any), prisma };
}

const LINE = { description: 'Work', quantity: 1, unitPrice: 500 };

describe('JobOrdersService.addLine', () => {
  it('refuses another shop\'s product on a LABOR or SUBLET line', async () => {
    const { svc, prisma } = build();
    await expect(svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'LABOR', productId: 'p-other-shop' } as any)).rejects.toThrow(NotFoundException);
    await expect(svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'SUBLET', productId: 'p-other-shop' } as any)).rejects.toThrow(NotFoundException);
    expect(prisma.jobOrderLine.create).not.toHaveBeenCalled();
  });

  it('refuses another shop\'s technician on a PART line', async () => {
    const { svc, prisma } = build();
    await expect(svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'PART', productId: 'p-belt', technicianId: 'u-other-shop' } as any))
      .rejects.toThrow(NotFoundException);
    expect(prisma.jobOrderLine.create).not.toHaveBeenCalled();
  });

  it('works as before for this shop\'s lines', async () => {
    const { svc, prisma } = build();
    await svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'PART', productId: 'p-belt' } as any);
    await svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'LABOR', technicianId: 'u-tech', productId: 'p-belt' } as any);
    // A technician who has left is still refused on a LABOR line, and still
    // accepted elsewhere, exactly as before.
    await expect(svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'LABOR', technicianId: 'u-left' } as any)).rejects.toThrow(NotFoundException);
    await svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'SUBLET', technicianId: 'u-left' } as any);
    expect(prisma.jobOrderLine.create).toHaveBeenCalledTimes(3);
  });

  it('still asks a PART line for its product', async () => {
    const { svc } = build();
    await expect(svc.addLine(TENANT, 'jo-1', { ...LINE, kind: 'PART' } as any)).rejects.toThrow(BadRequestException);
  });
});
