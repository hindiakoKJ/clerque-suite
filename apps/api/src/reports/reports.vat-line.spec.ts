import { ReportsService, vatLineWindow, VAT_LINE, VAT_LINE_WARN_AT } from './reports.service';

/**
 * The VAT line on the owner's dashboard.
 *
 * A non-VAT shop must register for VAT once gross sales pass ₱3,000,000 in any
 * 12 months. Nothing told the owner they were getting close, so the first they
 * heard of it could be from BIR. The dashboard now carries the 12-month figure.
 */
describe('VAT line -- 12-month gross sales for a non-VAT shop', () => {
  const TENANT = 't1';

  const build = (taxStatus: string | null, sum: number | string | null = 2_500_000) => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue(taxStatus ? { taxStatus } : null) },
      order:  { aggregate: jest.fn().mockResolvedValue({ _sum: { totalAmount: sum } }) },
    };
    return { svc: new ReportsService(prisma), prisma };
  };

  describe('the window', () => {
    it('is the 365 Manila days ending today, today included', () => {
      // 2026-10-13 07:30 in Manila is still the 12th in UTC.
      const w = vatLineWindow(new Date('2026-10-12T23:30:00.000Z'));
      expect(w.toDay).toBe('2026-10-13');
      expect(w.fromDay).toBe('2025-10-14');
      expect(w.from.toISOString()).toBe('2025-10-13T16:00:00.000Z'); // 00:00 Manila
      expect(w.to.toISOString()).toBe('2026-10-13T15:59:59.999Z');   // 23:59:59.999 Manila
    });

    it('turns over at Manila midnight, not UTC midnight', () => {
      expect(vatLineWindow(new Date('2026-10-13T15:59:00.000Z')).toDay).toBe('2026-10-13');
      expect(vatLineWindow(new Date('2026-10-13T16:00:00.000Z')).toDay).toBe('2026-10-14');
    });
  });

  it('sums paid and completed sales by paid day, every branch, voids left out', async () => {
    const { svc, prisma } = build('NON_VAT');
    const now = new Date('2026-10-13T04:00:00.000Z');
    const out = await svc.getVatLine(TENANT, now);
    const { from, to } = vatLineWindow(now);
    expect(prisma.order.aggregate).toHaveBeenCalledWith({
      where: { tenantId: TENANT, status: { in: ['PAID', 'COMPLETED'] }, paidAt: { gte: from, lte: to } },
      _sum: { totalAmount: true },
    });
    expect(out).toEqual({
      applies: true, grossSales: 2_500_000, line: VAT_LINE, warnAt: VAT_LINE_WARN_AT,
      from: '2025-10-14', to: '2026-10-13',
    });
  });

  it('reads a Decimal total and a shop with no sales', async () => {
    expect(await build('UNREGISTERED', '2400000.456').svc.getVatLine(TENANT)).toMatchObject({ grossSales: 2_400_000.46 });
    expect(await build('UNREGISTERED', null).svc.getVatLine(TENANT)).toMatchObject({ applies: true, grossSales: 0 });
  });

  it('gives a VAT-registered shop nothing, and does not even add up its sales', async () => {
    const { svc, prisma } = build('VAT');
    await expect(svc.getVatLine(TENANT)).resolves.toEqual({ applies: false });
    expect(prisma.order.aggregate).not.toHaveBeenCalled();
  });

  it('the line is ₱3,000,000 and the warning starts at ₱2,400,000', () => {
    expect(VAT_LINE).toBe(3_000_000);
    expect(VAT_LINE_WARN_AT).toBe(2_400_000);
  });
});
