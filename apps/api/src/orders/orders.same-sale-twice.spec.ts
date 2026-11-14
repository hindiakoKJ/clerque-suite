import { Prisma } from '@prisma/client';
import { OrdersService } from './orders.service';
import { TaxCalculatorService } from '../tax/tax.service';

/**
 * The same sale arriving twice at the same moment (a till's request timed
 * out while the server was still saving, then the offline queue sent it
 * again). The second insert hits the unique key and rolls back. The sale is
 * in the books, so the caller gets the saved order, not an error that parks
 * the sale as "Needs attention".
 */
describe('OrdersService.create: the same sale twice at once', () => {
  const TENANT = 'shop-1';
  const unique = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002', clientVersion: 'test', meta: { target: ['clientUuid'] },
    });

  const build = (saved: any) => {
    const prisma = { order: { findFirst: jest.fn().mockResolvedValue(saved) } } as any;
    const svc = new OrdersService(
      prisma, {} as any, new TaxCalculatorService(),
      {} as any, {} as any, {} as any, {} as any, {} as any,
    ) as any;
    return { svc, prisma };
  };

  it('returns the order the first copy saved', async () => {
    const first = { id: 'ord-1', clientUuid: 'u-1', tenantId: TENANT };
    const { svc, prisma } = build(first);
    jest.spyOn(svc, 'createOrder').mockRejectedValue(unique());

    await expect(svc.create(TENANT, 'cashier-1', { clientUuid: 'u-1' }, {})).resolves.toBe(first);
    expect(prisma.order.findFirst).toHaveBeenCalledWith({ where: { clientUuid: 'u-1', tenantId: TENANT } });
  });

  it('finds a service sale by its external reference', async () => {
    const first = { id: 'ord-2', externalRef: 'BK-1', tenantId: TENANT };
    const { svc, prisma } = build(first);
    jest.spyOn(svc, 'createOrder').mockRejectedValue(unique());

    await expect(svc.create(TENANT, null, {}, { externalRef: 'BK-1' })).resolves.toBe(first);
    expect(prisma.order.findFirst).toHaveBeenCalledWith({ where: { externalRef: 'BK-1', tenantId: TENANT } });
  });

  it('still refuses when nothing was saved under the sale\'s keys (another unique clash)', async () => {
    const { svc } = build(null);
    const err = unique();
    jest.spyOn(svc, 'createOrder').mockRejectedValue(err);

    await expect(svc.create(TENANT, 'cashier-1', { clientUuid: 'u-9' }, {})).rejects.toBe(err);
  });

  it('passes any other error through untouched', async () => {
    const { svc, prisma } = build({ id: 'x' });
    const err = new Error('Period is closed');
    jest.spyOn(svc, 'createOrder').mockRejectedValue(err);

    await expect(svc.create(TENANT, 'cashier-1', { clientUuid: 'u-1' }, {})).rejects.toBe(err);
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
  });
});
