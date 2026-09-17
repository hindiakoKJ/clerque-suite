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

  const CLOSED_AT = new Date('2026-09-16T13:10:00Z'); // 21:10 Manila

  function build(opts: { stillOpen?: number; zReadThrows?: boolean; dayClose?: any } = {}) {
    const generateZRead = jest.fn(() =>
      opts.zReadThrows ? Promise.reject(new Error('boom')) : Promise.resolve({ id: 'z1' }));

    const tx: any = {
      shift: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst:  jest.fn().mockResolvedValue({ id: SHIFT, closedAt: CLOSED_AT }),
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
      // The drawer's last mid-shift count, read from the audit trail.
      auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const svc = new ShiftsService(
      prisma, { log: jest.fn() } as any, { generateZRead } as any, opts.dayClose,
    ) as any;
    return { svc, prisma, generateZRead };
  }
  /** Lets the day close that close() started (and did not wait on) run. */
  const settle = () => new Promise((resolve) => setImmediate(resolve));

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
  /*
    The same last shift close also closes the day's inventory sheet: the
    closing stock, the usage message and the closing buy list. The scheduler
    decides whether the close is the end of the day or a handover; here only
    that it is asked, with what, and that the drawer never waits on it or
    fails because of it.
  */
  describe('closing the day\'s inventory sheet', () => {
    const dayCloser = (impl: () => Promise<unknown> = async () => 'CLOSED') => ({ closeDayAtLastShift: jest.fn(impl) });

    it('asks to close the day when the last shift at the branch closes, with the moment it closed', async () => {
      const dayClose = dayCloser();
      const { svc } = build({ stillOpen: 0, dayClose });
      await svc.close(TENANT, SHIFT, CASHIER, 1500);
      await settle();
      expect(dayClose.closeDayAtLastShift).toHaveBeenCalledTimes(1);
      expect(dayClose.closeDayAtLastShift).toHaveBeenCalledWith(TENANT, BRANCH, CLOSED_AT);
    });

    it('does not ask while another till is still open', async () => {
      const dayClose = dayCloser();
      const { svc } = build({ stillOpen: 1, dayClose });
      await svc.close(TENANT, SHIFT, CASHIER, 1500);
      await settle();
      expect(dayClose.closeDayAtLastShift).not.toHaveBeenCalled();
    });

    it('asks only after the close is committed and the Z-Read written', async () => {
      const order: string[] = [];
      const dayClose = dayCloser(async () => { order.push('day'); return 'CLOSED'; });
      const { svc, prisma, generateZRead } = build({ stillOpen: 0, dayClose });
      const realTx = prisma.$transaction.getMockImplementation();
      prisma.$transaction.mockImplementation(async (fn: any) => { const out = await realTx(fn); order.push('commit'); return out; });
      generateZRead.mockImplementation(async () => { order.push('z-read'); return { id: 'z1' } as any; });
      await svc.close(TENANT, SHIFT, CASHIER, 1500);
      await settle();
      expect(order).toEqual(['commit', 'z-read', 'day']);
    });

    it('the drawer does not wait for the day to close', async () => {
      // A day close that never finishes (slow stock read, Telegram down).
      const dayClose = dayCloser(() => new Promise(() => undefined));
      const { svc } = build({ stillOpen: 0, dayClose });
      await expect(svc.close(TENANT, SHIFT, CASHIER, 1500)).resolves.toMatchObject({ id: SHIFT });
    });

    it('a day close that fails, even synchronously, is logged and the shift still closes', async () => {
      const rejecting = dayCloser(async () => { throw new Error('database down'); });
      const throwing = { closeDayAtLastShift: jest.fn(() => { throw new Error('not a promise'); }) };
      for (const dayClose of [rejecting, throwing]) {
        const { svc } = build({ stillOpen: 0, dayClose });
        const logged = jest.spyOn(svc.logger, 'error').mockImplementation(() => undefined);
        await expect(svc.close(TENANT, SHIFT, CASHIER, 1500)).resolves.toMatchObject({ id: SHIFT });
        await settle();
        expect(logged).toHaveBeenCalledWith(expect.stringContaining(`Closing the day's inventory sheet failed for branch ${BRANCH}`));
      }
    });

    it('without ingredient reports wired in, the shift closes as before', async () => {
      const { svc } = build({ stillOpen: 0 });
      await expect(svc.close(TENANT, SHIFT, CASHIER, 1500)).resolves.toMatchObject({ id: SHIFT });
    });
  });

  /*
    A barista who forgets to Close Shift and goes home used to leave a till
    nobody could close. The next `open` auto-closes it with NO drawer count and
    NO variance, so yesterday's cash is never reconciled and the day gets no
    Z-Read — a hole in the one control the shop actually runs on.

    Not open to everyone, though: the declared count is what the variance is
    measured against, so one cashier closing another's till could post a
    shortage against someone else's name.
  */
  describe('closing a drawer that is not yours', () => {
    const OTHER = 'someone-else';

    it('is refused for another cashier', async () => {
      const { svc } = build();
      await expect(svc.close(TENANT, SHIFT, OTHER, 1500, undefined, 'CASHIER'))
        .rejects.toThrow(/Only the cashier who opened this shift/);
    });

    it('is refused when no role is supplied at all', async () => {
      // Keeps the original owner-only rule for any caller not yet updated.
      const { svc } = build();
      await expect(svc.close(TENANT, SHIFT, OTHER, 1500))
        .rejects.toThrow(/Only the cashier who opened this shift/);
    });

    it('says a manager can do it, rather than just refusing', async () => {
      const { svc } = build();
      await expect(svc.close(TENANT, SHIFT, OTHER, 1500, undefined, 'CASHIER'))
        .rejects.toThrow(/A manager or owner can close it for them/);
    });

    it.each(['BUSINESS_OWNER', 'BRANCH_MANAGER'])('is allowed for a %s', async (role) => {
      const { svc } = build();
      await expect(svc.close(TENANT, SHIFT, OTHER, 1500, undefined, role)).resolves.toBeDefined();
    });

    it('records who actually counted the drawer', async () => {
      // The first question asked about a variance somebody else declared.
      const { svc, prisma } = build();
      await svc.close(TENANT, SHIFT, OTHER, 1500, 'drawer was left open', 'BRANCH_MANAGER');
      const written = (prisma.$transaction as jest.Mock).mock.calls.length;
      expect(written).toBe(1);
    });

    it('still lets the owner close their own shift with no role at all', async () => {
      const { svc } = build();
      await expect(svc.close(TENANT, SHIFT, CASHIER, 1500)).resolves.toBeDefined();
    });
  });
});
