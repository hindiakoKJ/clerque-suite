import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { KdsService } from './kds.service';
import { confirmLineUsage, returnLineUsage } from '../orders/usage-confirm';

jest.mock('../orders/usage-confirm', () => ({
  confirmLineUsage: jest.fn(async () => true),
  returnLineUsage: jest.fn(async () => true),
}));

/**
 * The station screen under the owner's rule: marking a waiting line ready is
 * the moment its ingredients and cost are taken; un-bumping gives them back.
 * Because a tap now moves stock and the books, the customer-facing display
 * cannot tap, and a kitchen tablet cannot tap the bar's tickets.
 */
describe('KdsService — the ready tap takes the ingredients', () => {
  const TENANT = 't1';

  function build(line: Record<string, unknown>, orderStatus = 'PAID') {
    const row: any = {
      id: 'li1', orderId: 'o1', prepStatus: 'PENDING', readyAt: null, quantity: 1, refundedQty: 0,
      usageOnReady: true, usagePostedAt: null, ...line,
    };
    const tx: any = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      orderItem: {
        findFirst: jest.fn(async () => ({
          ...row,
          order: { status: orderStatus },
          product: { category: { stationId: 's-bar', station: { hasKds: true, isActive: true } } },
        })),
        findMany: jest.fn(async () => []),
        updateMany: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { count: 1 }; }),
        update: jest.fn(async ({ data }: any) => { Object.assign(row, data); return { id: row.id, prepStatus: row.prepStatus }; }),
      },
      order: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return { svc: new KdsService(prisma), row, tx, prisma };
  }
  const cook = { userId: 'u-cook' };
  const barScreen = { userId: 'u-paired-by', isDevice: true, deviceRole: 'KDS_BAR', stationId: 's-bar' };

  beforeEach(() => jest.clearAllMocks());

  it('bumping a waiting line confirms it, as the person who bumped, inside the same transaction', async () => {
    const { svc, tx, row } = build({});
    await svc.bumpReady(TENANT, 'li1', cook);
    expect(confirmLineUsage).toHaveBeenCalledWith(tx, TENANT, 'li1', expect.objectContaining({ actorId: 'u-cook', trigger: 'READY' }));
    expect(row).toMatchObject({ prepStatus: 'READY', readyById: 'u-cook' });
  });

  it('a line used at the sale is only marked ready', async () => {
    const { svc } = build({ usageOnReady: false });
    await svc.bumpReady(TENANT, 'li1', barScreen);
    expect(confirmLineUsage).not.toHaveBeenCalled();
  });

  it('the customer display cannot bump or serve; a tablet cannot tap another station\'s ticket', async () => {
    const shown = build({});
    const customerDisplay = { userId: 'u', isDevice: true, deviceRole: 'CUSTOMER_DISPLAY', stationId: null };
    await expect(shown.svc.bumpReady(TENANT, 'li1', customerDisplay)).rejects.toThrow(ForbiddenException);
    await expect(shown.svc.markServed(TENANT, 'li1', customerDisplay)).rejects.toThrow(ForbiddenException);
    expect(shown.prisma.$transaction).not.toHaveBeenCalled();

    const kitchen = build({});
    await expect(kitchen.svc.bumpReady(TENANT, 'li1', { ...barScreen, deviceRole: 'KDS_KITCHEN', stationId: 's-kitchen' }))
      .rejects.toThrow('This screen is paired to another station.');
    expect(confirmLineUsage).not.toHaveBeenCalled();
  });

  it('served after a ready tap that never confirmed still confirms; a voided order cannot be served', async () => {
    const ready = build({ prepStatus: 'READY', readyAt: new Date() });
    await ready.svc.markServed(TENANT, 'li1', cook);
    expect(confirmLineUsage).toHaveBeenCalledTimes(1);
    expect(ready.row.prepStatus).toBe('SERVED');
    expect(ready.tx.$queryRaw).toHaveBeenCalled();   // the order lock

    const voided = build({ prepStatus: 'READY' }, 'VOIDED');
    await expect(voided.svc.markServed(TENANT, 'li1', cook)).rejects.toThrow('This order was voided. There is nothing to serve.');
  });

  it('un-bumping gives the usage back first; a refused give-back leaves the ticket as it was', async () => {
    const ok = build({ prepStatus: 'READY', usagePostedAt: new Date() }, 'COMPLETED');
    await ok.svc.unbump(TENANT, 'li1');
    expect(returnLineUsage).toHaveBeenCalledWith(ok.tx, TENANT, 'li1');
    expect(ok.row).toMatchObject({ prepStatus: 'PENDING', readyById: null });

    (returnLineUsage as jest.Mock).mockRejectedValueOnce(new BadRequestException('earlier day'));
    const refused = build({ prepStatus: 'READY', usagePostedAt: new Date() }, 'COMPLETED');
    await expect(refused.svc.unbump(TENANT, 'li1')).rejects.toThrow('earlier day');
    expect(refused.row.prepStatus).toBe('READY');
  });
});
