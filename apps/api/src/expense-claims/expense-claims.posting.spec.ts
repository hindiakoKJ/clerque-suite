import { ExpenseClaimsService } from './expense-claims.service';

/**
 * A reimbursed expense has to reach the books.
 *
 * Nothing in this whole directory referenced the journal. A claim went DRAFT →
 * SUBMITTED → APPROVED → PAID, the employee got their money, and the expense
 * appeared nowhere: the shop's costs were understated by every peso ever
 * reimbursed, and profit overstated by the same amount. The period-close
 * checklist even warned the owner these would "leak across periods" while the
 * screen was in fact posting nothing at all.
 *
 * Posted on PAID rather than APPROVED, because that is when the cash actually
 * moves — approving creates an obligation, not an outflow.
 */
describe('ExpenseClaimsService.markPaid — reaching the books', () => {
  const TENANT = 't1';
  const CLAIM = 'c1';

  function build(items: Array<{ category: string; description: string; amount: number }>) {
    const events: any[] = [];
    const tx: any = {
      expenseClaim: {
        update: jest.fn().mockResolvedValue({
          id: CLAIM, claimNumber: 'EXP-2026-000004', status: 'PAID', items,
        }),
      },
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
    };
    const prisma: any = {
      expenseClaim: {
        findFirst: jest.fn().mockResolvedValue({ id: CLAIM, tenantId: TENANT, status: 'APPROVED' }),
      },
      $transaction: jest.fn((fn: any) => fn(tx)),
    };
    const svc = new ExpenseClaimsService(prisma) as any;
    return { svc, prisma, tx, events };
  }

  const pay = (svc: any) =>
    svc.markPaid(TENANT, CLAIM, 'BUSINESS_OWNER', { paymentRef: 'GC-11' });

  it('queues an entry for a reimbursed expense', async () => {
    const { svc, events } = build([{ category: 'Transport', description: 'Taxi to supplier', amount: 320 }]);
    await pay(svc);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('PAID_OUT');
    expect(Number(events[0].payload.amount)).toBe(320);
  });

  it('keeps the category, so the GL is not one Miscellaneous bucket', async () => {
    const { svc, events } = build([
      { category: 'Transport',     description: 'Taxi',    amount: 320 },
      { category: 'Communication', description: 'Load',    amount: 100 },
    ]);
    await pay(svc);
    expect(events.map((e) => e.payload.category)).toEqual(['TRANSPORT', 'COMMUNICATION']);
  });

  it('posts one entry per line, not one lump for the claim', async () => {
    // A taxi fare and a box of receipts are different expenses; collapsing
    // them loses the only detail the GL would have had.
    const { svc, events } = build([
      { category: 'Transport', description: 'Taxi',   amount: 320 },
      { category: 'Meals',     description: 'Lunch',  amount: 250 },
      { category: 'Supplies',  description: 'Folder', amount: 90  },
    ]);
    await pay(svc);
    expect(events).toHaveLength(3);
  });

  it('names the claim and the line, so the entry is traceable', async () => {
    const { svc, events } = build([{ category: 'Meals', description: 'Client lunch', amount: 250 }]);
    await pay(svc);
    expect(events[0].payload.reason).toMatch(/EXP-2026-000004/);
    expect(events[0].payload.reason).toMatch(/Client lunch/);
  });

  it('skips a zero line rather than posting an empty entry', async () => {
    const { svc, events } = build([
      { category: 'Meals',     description: 'Nothing', amount: 0   },
      { category: 'Transport', description: 'Taxi',    amount: 320 },
    ]);
    await pay(svc);
    expect(events).toHaveLength(1);
  });

  it('marks the claim paid and queues in the SAME transaction', async () => {
    // A claim marked PAID whose events did not queue would be invisible to
    // both the screen and the books, and nothing would look at it again.
    const { svc, prisma, tx } = build([{ category: 'Meals', description: 'Lunch', amount: 250 }]) as any;
    await pay(svc);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.expenseClaim.update).toHaveBeenCalled();
    expect(tx.accountingEvent.create).toHaveBeenCalled();
  });

  it('still refuses to pay a claim that was never approved', async () => {
    const { svc, prisma } = build([{ category: 'Meals', description: 'Lunch', amount: 250 }]) as any;
    prisma.expenseClaim.findFirst.mockResolvedValue({ id: CLAIM, tenantId: TENANT, status: 'SUBMITTED' });
    await expect(pay(svc)).rejects.toThrow(/Only APPROVED claims/);
  });

  it('still refuses a role that cannot pay', async () => {
    const { svc } = build([{ category: 'Meals', description: 'Lunch', amount: 250 }]);
    await expect(svc.markPaid(TENANT, CLAIM, 'CASHIER', { paymentRef: 'x' }))
      .rejects.toThrow(/BUSINESS_OWNER or FINANCE_LEAD/);
  });
});
