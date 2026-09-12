import { ShiftsService, countIntervalMinutes } from './shifts.service';

/**
 * The till asks to be counted.
 *
 * A soft control, and the softest one there is: nothing is blocked, nobody is
 * told, and the cashier can carry on. What it buys is time. A drawer counted
 * every couple of hours narrows a shortage to a couple of hours of trading;
 * a drawer counted once at close narrows it to a whole day and a whole shift's
 * worth of people.
 *
 * The clock runs from the last count, and from the drawer opening when there
 * has been none. So counting often is never punished with more nagging.
 */
describe('The till asking to be counted', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const HOUR = 60 * 60 * 1000;

  function build(opts: { openedAt: Date; closedAt?: Date | null; lastCountAt?: Date | null } = { openedAt: new Date() }) {
    const shift = {
      id: 's1', tenantId: TENANT, branchId: BRANCH, cashierId: 'u1',
      openingCash: 1000 as unknown as never,
      openedAt: opts.openedAt,
      closedAt: opts.closedAt ?? null,
      closingCashDeclared: null, closingCashExpected: null, variance: null, notes: null,
    };
    const prisma: any = {
      order:           { findMany: jest.fn().mockResolvedValue([]) },
      shiftCashOut:    { findMany: jest.fn().mockResolvedValue([]) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog:        { findFirst: jest.fn().mockResolvedValue(opts.lastCountAt ? { createdAt: opts.lastCountAt } : null) },
    };
    const svc = new ShiftsService(prisma, {} as never, {} as never) as any;
    return { svc, prisma, shift };
  }

  it('runs the clock from the drawer opening until somebody counts', async () => {
    const openedAt = new Date(Date.now() - 30 * 60 * 1000);   // opened half an hour ago
    const { svc, shift } = build({ openedAt });
    const { countCheck } = await svc.buildSummary(shift);
    expect(countCheck.lastCountedAt).toBeNull();
    expect(countCheck.since).toEqual(openedAt);
    expect(countCheck.overdue).toBe(false);
    expect(countCheck.dueAt.getTime()).toBe(openedAt.getTime() + 2 * HOUR);
  });

  it('asks once the interval has passed, and says how long it has been', async () => {
    const openedAt = new Date(Date.now() - 3 * HOUR);
    const { svc, shift } = build({ openedAt });
    const { countCheck } = await svc.buildSummary(shift);
    expect(countCheck.overdue).toBe(true);
    expect(countCheck.minutesOverdue).toBeGreaterThanOrEqual(59);
  });

  it('starts the clock again at every count, so counting often is not punished', async () => {
    const openedAt    = new Date(Date.now() - 5 * HOUR);
    const lastCountAt = new Date(Date.now() - 10 * 60 * 1000);   // counted ten minutes ago
    const { svc, shift } = build({ openedAt, lastCountAt });
    const { countCheck } = await svc.buildSummary(shift);
    expect(countCheck.lastCountedAt).toEqual(lastCountAt);
    expect(countCheck.since).toEqual(lastCountAt);
    expect(countCheck.overdue).toBe(false);
  });

  it('asks nothing of a drawer that is already closed', async () => {
    const { svc, shift } = build({ openedAt: new Date(Date.now() - 9 * HOUR), closedAt: new Date() });
    const { countCheck } = await svc.buildSummary(shift);
    expect(countCheck).toBeNull();
  });

  it('reads the count it needs from the audit trail of this shift alone', async () => {
    const { svc, prisma, shift } = build({ openedAt: new Date() });
    await svc.buildSummary(shift);
    expect(prisma.auditLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: TENANT, entityType: 'SHIFT_HANDOVER', entityId: 's1' },
    }));
  });

  describe('how long a drawer may go uncounted', () => {
    it('is two hours unless the deployment says otherwise', () => {
      expect(countIntervalMinutes({} as NodeJS.ProcessEnv)).toBe(120);
      expect(countIntervalMinutes({ TILL_COUNT_INTERVAL_MINUTES: '90' } as never)).toBe(90);
    });

    it('refuses a setting that would nag every minute or never ask at all', () => {
      expect(countIntervalMinutes({ TILL_COUNT_INTERVAL_MINUTES: '1' } as never)).toBe(15);
      expect(countIntervalMinutes({ TILL_COUNT_INTERVAL_MINUTES: '99999' } as never)).toBe(720);
      expect(countIntervalMinutes({ TILL_COUNT_INTERVAL_MINUTES: 'soon' } as never)).toBe(120);
      expect(countIntervalMinutes({ TILL_COUNT_INTERVAL_MINUTES: '0' } as never)).toBe(120);
    });
  });
});
