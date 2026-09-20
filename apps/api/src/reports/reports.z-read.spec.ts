import { ReportsService } from './reports.service';

/**
 * The Z-Read row for a day: dated that day, and counted again when the day is
 * closed again.
 *
 * ZReadLog.date is a date-only column. Saving PH midnight (16:00 UTC the day
 * before) into it dated every Z-Read one day early, and the export printed that
 * as the business date. And the first call wrote the row for good: a mid-day
 * call, then the real end-of-day close, left the day with the noon totals.
 */
describe('ReportsService.generateZRead: the day it is for, and counting again', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const DAY    = '2026-09-17';

  const sale = (total: number, method = 'CASH') => ({
    status: 'COMPLETED', subtotal: total, totalAmount: total, vatAmount: 0, discountAmount: 0,
    payments: [{ method, amount: total }], items: [],
  });

  function build(opts: { existing?: any; orders?: any[] } = {}) {
    const prisma: any = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      zReadLog: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn(({ data }: any) => Promise.resolve({ id: 'z-new', ...data })),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: opts.existing?.id, ...data })),
      },
      order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? [sale(150)]) },
    };
    return { svc: new ReportsService(prisma), prisma };
  }

  it('saves the row under the day it is for, not the day before', async () => {
    const { svc, prisma } = build();
    await svc.generateZRead(TENANT, BRANCH, DAY, 'u1');
    const { data } = prisma.zReadLog.create.mock.calls[0][0];
    // A date-only column keeps the UTC date: this must read 2026-09-17.
    expect((data.date as Date).toISOString().slice(0, 10)).toBe(DAY);
  });

  it('looks the day up by that same date', async () => {
    const { svc, prisma } = build();
    await svc.generateZRead(TENANT, BRANCH, DAY, 'u1');
    expect(prisma.zReadLog.findUnique).toHaveBeenCalledWith({
      where: { branchId_date: { branchId: BRANCH, date: new Date(`${DAY}T00:00:00Z`) } },
    });
  });

  it('still counts the sales of that day in Manila time', async () => {
    const { svc, prisma } = build();
    await svc.generateZRead(TENANT, BRANCH, DAY, 'u1');
    const { where } = prisma.order.findMany.mock.calls[0][0];
    expect(where.paidAt).toEqual({
      gte: new Date(`${DAY}T00:00:00+08:00`),
      lte: new Date(`${DAY}T23:59:59.999+08:00`),
    });
  });

  it('a later close of the same day updates the row with the whole day, instead of keeping the first totals', async () => {
    const existing = { id: 'z1', branchId: BRANCH, totalOrders: 1, netSales: 150, generatedById: 'u-morning' };
    const { svc, prisma } = build({ existing, orders: [sale(150), sale(200, 'GCASH')] });
    const out: any = await svc.generateZRead(TENANT, BRANCH, DAY, 'u-evening');

    expect(prisma.zReadLog.create).not.toHaveBeenCalled();
    expect(prisma.zReadLog.update).toHaveBeenCalledTimes(1);
    const { where, data } = prisma.zReadLog.update.mock.calls[0][0];
    expect(where).toEqual({ id: 'z1' });
    expect(data.totalOrders).toBe(2);
    expect(Number(data.netSales)).toBe(350);
    expect(Number(data.cashAmount)).toBe(150);
    expect(Number(data.nonCashAmount)).toBe(200);
    expect(data.generatedById).toBe('u-evening');
    expect(out.totalOrders).toBe(2);
  });

  it('writes one new row when the day has none', async () => {
    const { svc, prisma } = build();
    await svc.generateZRead(TENANT, BRANCH, DAY, 'u1');
    expect(prisma.zReadLog.update).not.toHaveBeenCalled();
    expect(prisma.zReadLog.create).toHaveBeenCalledTimes(1);
    const { data } = prisma.zReadLog.create.mock.calls[0][0];
    expect(data).toMatchObject({ tenantId: TENANT, branchId: BRANCH, totalOrders: 1, generatedById: 'u1' });
  });
});
