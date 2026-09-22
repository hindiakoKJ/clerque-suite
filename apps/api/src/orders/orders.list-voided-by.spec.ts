import { OrdersService } from './orders.service';
import { TaxCalculatorService } from '../tax/tax.service';

/**
 * Orders > "voided by ___".
 *
 * The Orders list renders `voided by {o.voidedBy?.name ?? '?'}` on every
 * voided row, but GET /orders never loaded voidedBy, so all of them read
 * "voided by ?" -- including the one the owner had just approved with her own
 * PIN. GET /orders/:id did load it, which is why nobody noticed from the
 * detail page.
 */
describe('OrdersService.findAll — who voided it', () => {
  const build = () => {
    const prisma = {
      order: {
        count:    jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          { id: 'o1', orderNumber: 'ORD-2026-000088', status: 'VOIDED', voidedBy: { name: 'Carolina (Owner)' } },
        ]),
      },
    } as any;
    const svc = new OrdersService(
      prisma, {} as any, new TaxCalculatorService(),
      {} as any, {} as any, {} as any, {} as any, {} as any,
    );
    return { svc, prisma };
  };

  it('asks for the name of the person who voided each order', async () => {
    const { svc, prisma } = build();
    await svc.findAll('tenant-1', 'branch-1', undefined, 200, 0);

    const args = prisma.order.findMany.mock.calls[0][0];
    expect(args.include.voidedBy).toEqual({ select: { name: true } });
  });

  it('does not hand out supervisor ids in bulk: the list shows a name and nothing else', async () => {
    const { svc, prisma } = build();
    await svc.findAll('tenant-1', 'branch-1');

    const select = prisma.order.findMany.mock.calls[0][0].include.voidedBy.select;
    expect(select.id).toBeUndefined();
  });

  it('passes the name through to the caller, and keeps the cashier and the page shape', async () => {
    const { svc, prisma } = build();
    const out = await svc.findAll('tenant-1', 'branch-1', undefined, 200, 0);

    expect(out.data[0].voidedBy).toEqual({ name: 'Carolina (Owner)' });
    expect(out).toMatchObject({ total: 1, take: 200, skip: 0 });
    expect(prisma.order.findMany.mock.calls[0][0].include.createdBy).toEqual({ select: { id: true, name: true } });
  });
});
