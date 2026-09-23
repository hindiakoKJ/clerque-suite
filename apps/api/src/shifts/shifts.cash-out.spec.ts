import { ForbiddenException } from '@nestjs/common';
import { ShiftsService } from './shifts.service';

/**
 * Cash leaving the drawer needs a manager who is really a manager, never the
 * cashier herself, and leaves a trail either way.
 *
 * A cash drop used to pass on the mere presence of an approvedById -- any
 * string, her own id included -- and neither recording nor removing a
 * cash-out wrote an audit row, so a disputed drawer at close had no answer.
 */
describe('ShiftsService — cash-out approval and trail', () => {
  const TENANT = 't1';
  const SHIFT = 's1';
  const CASHIER = 'cashier-1';

  function build(opts: { approver?: { id: string } | null } = {}) {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const created = { id: 'co-1', type: 'CASH_DROP', amount: 300 };
    const prisma: any = {
      shift: { findFirst: jest.fn().mockResolvedValue({ id: SHIFT, branchId: 'b1', cashierId: CASHIER, closedAt: null, openingCash: 1000 }) },
      order: { findMany: jest.fn().mockResolvedValue([]) },
      shiftCashOut: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }),
        create:    jest.fn().mockResolvedValue(created),
        findFirst: jest.fn().mockResolvedValue({
          id: 'co-1', type: 'PAID_OUT', amount: 120, reason: 'Bought ice for the bar', category: 'supplies',
          createdById: CASHIER, approvedById: null, createdAt: new Date('2026-09-23T02:00:00Z'), shift: { closedAt: null },
        }),
        delete:    jest.fn().mockResolvedValue(undefined),
      },
      user: { findFirst: jest.fn().mockResolvedValue(opts.approver === undefined ? { id: 'mgr-1', role: 'BRANCH_MANAGER' } : opts.approver) },
      accountingEvent: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    const svc = new ShiftsService(prisma, audit as any, { generateZRead: jest.fn() } as any) as any;
    return { svc, prisma, audit };
  }

  const drop = (approvedById: string) => ({ type: 'CASH_DROP' as const, amount: 300, reason: 'Moving cash to the safe', approvedById });

  it('refuses a cash drop whose approver is not an active manager', async () => {
    const { svc } = build({ approver: null });
    await expect(svc.recordCashOut(TENANT, SHIFT, CASHIER, drop('nobody'))).rejects.toThrow(ForbiddenException);
  });

  it('refuses the cashier approving her own cash-out', async () => {
    const { svc } = build();
    await expect(svc.recordCashOut(TENANT, SHIFT, CASHIER, drop(CASHIER))).rejects.toThrow(/cannot approve your own/);
  });

  it('records a cash drop a real manager approved, and writes it to the trail with both names', async () => {
    const { svc, prisma, audit } = build();
    await svc.recordCashOut(TENANT, SHIFT, CASHIER, drop('mgr-1'));
    expect(prisma.user.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'mgr-1', tenantId: TENANT, isActive: true }),
    }));
    expect(prisma.shiftCashOut.create).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      entityType:  'SHIFT_CASH_OUT',
      performedBy: CASHIER,
      after:       expect.objectContaining({ amount: 300, createdById: CASHIER, approvedById: 'mgr-1' }),
    }));
  });

  it('needs a manager once the unapproved paid-outs of a shift add up to the threshold, even when each slip is small', async () => {
    const { svc, prisma } = build();
    // The till check (all cash-outs) and the approval check (unapproved paid-outs) both aggregate; tell them apart by the where clause.
    prisma.shiftCashOut.aggregate.mockImplementation(async ({ where }: any) =>
      where?.approvedById === null ? { _sum: { amount: 350 } } : { _sum: { amount: 350 } });
    const small = { type: 'PAID_OUT' as const, amount: 200, reason: 'Bought ice from next door' };
    await expect(svc.recordCashOut(TENANT, SHIFT, CASHIER, small)).rejects.toThrow(/require manager approval/);
  });

  it('lets a small paid-out through when the shift has little unapproved so far', async () => {
    const { svc, prisma } = build();
    prisma.shiftCashOut.aggregate.mockResolvedValue({ _sum: { amount: 100 } });
    const small = { type: 'PAID_OUT' as const, amount: 200, reason: 'Bought ice from next door' };
    await expect(svc.recordCashOut(TENANT, SHIFT, CASHIER, small)).resolves.toBeDefined();
  });

  it('keeps what a removed cash-out said, and who removed it, before deleting the row', async () => {
    const { svc, prisma, audit } = build();
    const order: string[] = [];
    audit.log.mockImplementation(async () => { order.push('audit'); });
    prisma.shiftCashOut.delete.mockImplementation(async () => { order.push('delete'); });

    await svc.deleteCashOut(TENANT, SHIFT, 'co-1', 'mgr-1', 'BRANCH_MANAGER');

    expect(order).toEqual(['audit', 'delete']);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action:      'VOID_PROCESSED',
      entityType:  'SHIFT_CASH_OUT',
      entityId:    'co-1',
      performedBy: 'mgr-1',
      before:      expect.objectContaining({ amount: 120, reason: 'Bought ice for the bar', createdById: CASHIER }),
    }));
  });
});
