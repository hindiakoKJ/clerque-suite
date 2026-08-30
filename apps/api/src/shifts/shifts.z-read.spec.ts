import { ShiftsService } from './shifts.service';

/**
 * Somebody has to actually write the Z-Read.
 *
 * `POST /reports/z-read` has always existed, is correct, and is idempotent per
 * branch per day — and nothing in the product ever called it. Not the web POS,
 * not the Counter app, which renders a Z-Read SCREEN from an in-memory summary
 * and posts nothing (its own comment calls live aggregation "a follow-up").
 * The Z-Read History report in Ledger reads a table nothing writes.
 *
 * For a VAT-registered shop that is the daily record the BIR expects a CAS to
 * keep, so its absence is not a missing convenience.
 *
 * The trigger is the LAST open shift at a branch closing, because that is when
 * the shop's day actually ends — not a clock. A cron at 23:55 would lock the
 * day's totals while the till was still open, and since the record is
 * idempotent the premature one would win and the late sales would never appear.
 */
describe('ShiftsService.close — writing the day\'s Z-Read', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const SHIFT = 's1';
  const CASHIER = 'u1';

  function build(opts: { stillOpen?: number; zReadThrows?: boolean } = {}) {
    const generateZRead = jest.fn(() =>
      opts.zReadThrows ? Promise.reject(new Error('boom')) : Promise.resolve({ id: 'z1' }));

    const tx: any = {
      shift: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst:  jest.fn().mockResolvedValue({ id: SHIFT, closedAt: new Date() }),
      },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      shift: {
        findFirst: jest.fn().mockResolvedValue({
          id: SHIFT, tenantId: TENANT, branchId: BRANCH, cashierId: CASHIER,
          openingCash: 1000, openedAt: new Date('2026-08-30T07:00:00Z'), closedAt: null,
          notes: null,
        }),
        // How many OTHER shifts are still open at this branch.
        count: jest.fn().mockResolvedValue(opts.stillOpen ?? 0),
      },
      order:           { findMany: jest.fn().mockResolvedValue([]) },
      shiftCashOut:    { findMany: jest.fn().mockResolvedValue([]) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const svc = new ShiftsService(
      prisma, { log: jest.fn() } as any, { generateZRead } as any,
    ) as any;
    return { svc, prisma, generateZRead };
  }

  it('writes the Z-Read when the last shift at the branch closes', async () => {
    const { svc, generateZRead } = build({ stillOpen: 0 });
    await svc.close(TENANT, SHIFT, CASHIER, 1500);
    expect(generateZRead).toHaveBeenCalledTimes(1);
  });

  it('writes it for the right tenant, branch and PH date', async () => {
    const { svc, generateZRead } = build({ stillOpen: 0 });
    await svc.close(TENANT, SHIFT, CASHIER, 1500);
    const [tenantId, branchId, date] = generateZRead.mock.calls[0] as any[];
    expect(tenantId).toBe(TENANT);
    expect(branchId).toBe(BRANCH);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('does NOT write one while another till is still open', async () => {
    // Two baristas, one goes home at 3pm. The shop's day is not over, and a
    // Z-Read now would lock the totals before the afternoon's sales.
    const { svc, generateZRead } = build({ stillOpen: 1 });
    await svc.close(TENANT, SHIFT, CASHIER, 1500);
    expect(generateZRead).not.toHaveBeenCalled();
  });

  it('asks about the branch, not the whole company', async () => {
    const { svc, prisma } = build({ stillOpen: 0 });
    await svc.close(TENANT, SHIFT, CASHIER, 1500);
    expect(prisma.shift.count).toHaveBeenCalledWith({
      where: { tenantId: TENANT, branchId: BRANCH, closedAt: null },
    });
  });

  it('still closes the shift when the Z-Read cannot be built', async () => {
    // A cashier at 10pm must be able to close her drawer whether or not the
    // report succeeds. A missing Z-Read is recoverable and idempotent; a
    // drawer she cannot close is not.
    const { svc } = build({ stillOpen: 0, zReadThrows: true });
    await expect(svc.close(TENANT, SHIFT, CASHIER, 1500)).resolves.toBeDefined();
  });

  it('still returns the closed shift, not the report', async () => {
    const { svc } = build({ stillOpen: 0 });
    const res = await svc.close(TENANT, SHIFT, CASHIER, 1500);
    expect(res.id).toBe(SHIFT);
  });

  it('generates AFTER the close is committed, never inside the transaction', async () => {
    // Inside the transaction, a slow report would hold write locks on the
    // shift row, and a failing one would roll the close back.
    const { svc, prisma, generateZRead } = build({ stillOpen: 0 });
    let txDone = false;
    prisma.$transaction.mockImplementation(async (fn: any) => {
      const tx: any = {
        shift: {
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
          findFirst:  jest.fn().mockResolvedValue({ id: SHIFT }),
        },
        accountingEvent: { create: jest.fn().mockResolvedValue({}) },
      };
      const out = await fn(tx);
      txDone = true;
      return out;
    });
    generateZRead.mockImplementation(() => {
      expect(txDone).toBe(true);
      return Promise.resolve({ id: 'z1' } as any);
    });
    await svc.close(TENANT, SHIFT, CASHIER, 1500);
    expect(generateZRead).toHaveBeenCalled();
  });
});
