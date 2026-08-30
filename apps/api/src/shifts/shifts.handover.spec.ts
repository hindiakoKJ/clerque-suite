import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ShiftsService } from './shifts.service';

/**
 * The handover drawer count — the shortage firewall between two cashiers.
 *
 * The quick till switch leaves the shift (and its eventual variance) with the
 * drawer owner. Fair — unless the drawer was already short before the relief
 * cashier took over. This count records declared-vs-expected at the moment of
 * handover, on the immutable audit log and the shift's own notes, so a
 * later shortage can be placed before or after the takeover.
 */
describe('ShiftsService — recordHandover', () => {
  const TENANT = 't1';
  const SHIFT = {
    id: 'sh-1',
    tenantId: TENANT,
    branchId: 'br-1',
    cashierId: 'u-maria',        // drawer owner
    openingCash: new Prisma.Decimal(1000),
    openedAt: new Date(),
    closedAt: null,
    closingCashDeclared: null,
    closingCashExpected: null,
    variance: null,
    notes: null,
  };

  function build(opts: { shift?: any; cashOrders?: number } = {}) {
    const shift = opts.shift === undefined ? { ...SHIFT } : opts.shift;
    const noteWrites: any[] = [];
    const auditRows: any[] = [];

    const prisma: any = {
      shift: {
        findFirst: jest.fn().mockResolvedValue(shift),
        update: jest.fn(({ data }: any) => { noteWrites.push(data); return Promise.resolve({}); }),
      },
      // buildSummary inputs: one cash order of the given amount, no cash-outs.
      order: {
        findMany: jest.fn().mockResolvedValue(
          opts.cashOrders
            ? [{
                id: 'o-1', totalAmount: new Prisma.Decimal(opts.cashOrders), status: 'COMPLETED',
                payments: [{ method: 'CASH', amount: new Prisma.Decimal(opts.cashOrders) }],
              }]
            : [],
        ),
      },
      shiftCashOut: { findMany: jest.fn().mockResolvedValue([]) },
      // Refunds reduce expected cash: money handed back across the counter
      // left the drawer just like a paid-out did.
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const audit: any = { log: jest.fn((r: any) => { auditRows.push(r); return Promise.resolve(); }) };
    return { svc: new ShiftsService(prisma, audit), noteWrites, auditRows };
  }

  it('records declared vs expected and computes the variance', async () => {
    // Float ₱1000 + ₱500 cash sale = ₱1500 expected. Relief counts ₱1400.
    const { svc, auditRows, noteWrites } = build({ cashOrders: 500 });
    const out = await svc.recordHandover(TENANT, 'sh-1', 'u-anna', 'Anna', 1400);

    expect(out.expectedCash).toBe(1500);
    expect(out.variance).toBe(-100);           // short — and now ON THE RECORD

    // Immutable trail carries both parties and both figures.
    expect(auditRows[0].entityType).toBe('SHIFT_HANDOVER');
    expect(auditRows[0].after.drawerOwner).toBe('u-maria');
    expect(auditRows[0].after.countedBy).toBe('u-anna');
    expect(auditRows[0].after.variance).toBe(-100);

    // And the Z-read notes show it where variances are reviewed.
    expect(noteWrites[0].notes).toContain('Anna counted 1400.00');
    expect(noteWrites[0].notes).toContain('-100.00');
  });

  it('appends to existing notes rather than replacing them', async () => {
    const { svc, noteWrites } = build({ shift: { ...SHIFT, notes: 'opened late' } });
    await svc.recordHandover(TENANT, 'sh-1', 'u-anna', 'Anna', 1000);

    expect(noteWrites[0].notes.startsWith('opened late\n')).toBe(true);
  });

  it('refuses a closed shift — the real close already counted it', async () => {
    const { svc } = build({ shift: { ...SHIFT, closedAt: new Date() } });
    await expect(svc.recordHandover(TENANT, 'sh-1', 'u-anna', 'Anna', 1000))
      .rejects.toThrow(BadRequestException);
  });

  it('refuses an unknown or foreign shift', async () => {
    const { svc } = build({ shift: null });
    await expect(svc.recordHandover(TENANT, 'sh-x', 'u-anna', 'Anna', 1000))
      .rejects.toThrow(NotFoundException);
  });

  it('rejects a nonsense amount', async () => {
    const { svc } = build();
    await expect(svc.recordHandover(TENANT, 'sh-1', 'u-anna', 'Anna', NaN))
      .rejects.toThrow(BadRequestException);
    await expect(svc.recordHandover(TENANT, 'sh-1', 'u-anna', 'Anna', -5))
      .rejects.toThrow(BadRequestException);
  });
});
