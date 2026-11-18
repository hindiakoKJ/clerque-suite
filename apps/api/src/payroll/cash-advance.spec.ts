/**
 * Staff cash advances: what a payslip takes back, and what the books show.
 */
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { planAdvanceDeductions, validateAdvanceTerms } from './cash-advance';
import { CashAdvanceService } from './cash-advance.service';
import { PayrollService } from './payroll.service';

const d = (s: string) => new Date(`${s}T12:00:00+08:00`);

describe('planAdvanceDeductions', () => {
  it('takes the agreed amount per payday', () => {
    expect(planAdvanceDeductions([{ id: 'a', balance: 3000, perPayday: 1000, givenAt: d('2026-11-03') }], 5000))
      .toEqual([{ id: 'a', amount: 1000 }]);
  });

  it('never takes more than is still owed', () => {
    expect(planAdvanceDeductions([{ id: 'a', balance: 400, perPayday: 1000, givenAt: d('2026-11-03') }], 5000))
      .toEqual([{ id: 'a', amount: 400 }]);
  });

  it('never leaves the payslip below zero; the rest waits for next payday', () => {
    expect(planAdvanceDeductions([{ id: 'a', balance: 3000, perPayday: 3000, givenAt: d('2026-11-03') }], 1250.5))
      .toEqual([{ id: 'a', amount: 1250.5 }]);
  });

  it('pays the oldest advance first when there are two', () => {
    const plan = planAdvanceDeductions([
      { id: 'new', balance: 2000, perPayday: 1000, givenAt: d('2026-11-10') },
      { id: 'old', balance: 2000, perPayday: 1000, givenAt: d('2026-11-01') },
    ], 1500);
    expect(plan).toEqual([{ id: 'old', amount: 1000 }, { id: 'new', amount: 500 }]);
  });

  it('takes nothing from a payslip with no net pay', () => {
    expect(planAdvanceDeductions([{ id: 'a', balance: 500, perPayday: 500, givenAt: d('2026-11-03') }], 0)).toEqual([]);
  });
});

describe('validateAdvanceTerms', () => {
  it('accepts a normal advance', () => expect(validateAdvanceTerms(3000, 1000)).toBeNull());
  it('refuses a zero advance', () => expect(validateAdvanceTerms(0, 0)).toMatch(/how much/));
  it('refuses taking back more per payday than the advance', () => expect(validateAdvanceTerms(1000, 1500)).toMatch(/more than the advance/));
  it('refuses centavos past 2 places', () => expect(validateAdvanceTerms(1000.555, 500)).toMatch(/2 decimal/));
});

// ── CashAdvanceService ──────────────────────────────────────────────────

function makeCaService() {
  const prisma: any = {
    cashAdvance: {
      findFirst:        jest.fn(),
      findFirstOrThrow: jest.fn().mockResolvedValue({
        id: 'ca1', userId: 'emp', status: 'OPEN', amount: 3000, perPayday: 1000, balance: 3000,
        createdAt: new Date(), user: { name: 'Ana' }, deductions: [],
      }),
      create:     jest.fn().mockResolvedValue({ id: 'ca1' }),
      update:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      delete:     jest.fn().mockResolvedValue({}),
    },
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'emp', name: 'Ana', isActive: true }) },
  };
  const journal = { create: jest.fn().mockResolvedValue({ id: 'je1' }), reverse: jest.fn().mockResolvedValue({ id: 'je2' }) };
  const accounts = { findByCode: jest.fn(async (_t: string, code: string) => ({ id: `acct-${code}` })) };
  const svc = new CashAdvanceService(prisma, journal as any, accounts as any);
  return { svc, prisma, journal, accounts };
}

const OWNER = { sub: 'owner', role: 'BUSINESS_OWNER' };

describe('CashAdvanceService', () => {
  it('handing over ₱3,000 from cash on hand posts DR 1034 / CR 1010', async () => {
    const { svc, journal } = makeCaService();
    await svc.give('t1', OWNER, { userId: 'emp', amount: 3000, perPayday: 1000, paidFrom: '1010' });
    const [, dto, by, source] = journal.create.mock.calls[0];
    expect(by).toBe('owner');
    expect(source).toBe('PAYROLL');
    expect(dto.lines).toEqual([
      expect.objectContaining({ accountId: 'acct-1034', debit: 3000 }),
      expect.objectContaining({ accountId: 'acct-1010', credit: 3000 }),
    ]);
  });

  it('nobody can give themself an advance, not even the payroll master', async () => {
    const { svc, journal } = makeCaService();
    await expect(svc.give('t1', { sub: 'emp', role: 'PAYROLL_MASTER' }, { userId: 'emp', amount: 1000, perPayday: 500, paidFrom: '1010' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(journal.create).not.toHaveBeenCalled();
  });

  it('a closed period leaves no advance behind for payslips to take', async () => {
    const { svc, journal, prisma } = makeCaService();
    journal.create.mockRejectedValueOnce(new BadRequestException('Period is closed'));
    await expect(svc.give('t1', OWNER, { userId: 'emp', amount: 1000, perPayday: 500, paidFrom: '1010' }))
      .rejects.toThrow('Period is closed');
    expect(prisma.cashAdvance.delete).toHaveBeenCalledWith({ where: { id: 'ca1' } });
  });

  it('refuses money from an account that is not cash or bank', async () => {
    const { svc } = makeCaService();
    await expect(svc.give('t1', OWNER, { userId: 'emp', amount: 1000, perPayday: 500, paidFrom: '4010' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('a staff member with a request still waiting cannot stack a second one', async () => {
    const { svc, prisma } = makeCaService();
    prisma.cashAdvance.findFirst.mockResolvedValueOnce({ id: 'waiting' });
    await expect(svc.request('t1', 'emp', { amount: 1000, perPayday: 500, reason: 'rent' }))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('approving a request claims it first, so two people cannot both pay it out', async () => {
    const { svc, prisma, journal } = makeCaService();
    prisma.cashAdvance.findFirst.mockResolvedValueOnce({ id: 'ca1', userId: 'emp', status: 'REQUESTED', amount: 2000, perPayday: 500 });
    prisma.cashAdvance.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.approve('t1', OWNER, 'ca1', { paidFrom: '1011' })).rejects.toBeInstanceOf(ConflictException);
    expect(journal.create).not.toHaveBeenCalled();
  });

  it('cancelling an advance nothing was taken from reverses its entry', async () => {
    const { svc, prisma, journal } = makeCaService();
    prisma.cashAdvance.findFirst.mockResolvedValueOnce({
      id: 'ca1', status: 'OPEN', amount: 3000, balance: 3000, journalEntryId: 'je1', _count: { deductions: 0 },
    });
    await svc.cancel('t1', OWNER, 'ca1');
    expect(journal.reverse).toHaveBeenCalledWith('t1', 'je1', 'owner');
  });

  it('an advance a payslip already took from cannot be cancelled', async () => {
    const { svc, prisma, journal } = makeCaService();
    prisma.cashAdvance.findFirst.mockResolvedValueOnce({
      id: 'ca1', status: 'OPEN', amount: 3000, balance: 2000, journalEntryId: 'je1', _count: { deductions: 1 },
    });
    await expect(svc.cancel('t1', OWNER, 'ca1')).rejects.toBeInstanceOf(BadRequestException);
    expect(journal.reverse).not.toHaveBeenCalled();
  });
});

// ── Payday: processPayRun + lockPayRun ──────────────────────────────────

describe('PayrollService with a cash advance', () => {
  function makePayroll() {
    const tx: any = {
      payslip:              { deleteMany: jest.fn(), createMany: jest.fn() },
      payRun:               { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cashAdvance:          { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      cashAdvanceDeduction: { createMany: jest.fn() },
    };
    const run = {
      id: 'run1', tenantId: 't1', label: 'Nov 1-15', status: 'DRAFT', frequency: 'SEMI_MONTHLY',
      periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-11-15T00:00:00Z'),
    };
    const prisma: any = {
      payRun: {
        findFirst:        jest.fn().mockResolvedValue(run),
        findFirstOrThrow: jest.fn().mockResolvedValue({ ...run, status: 'COMPLETED', createdAt: new Date() }),
        updateMany:       jest.fn().mockResolvedValue({ count: 1 }),
      },
      user: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'emp', name: 'Ana', position: 'Barista', salaryRate: 15000, salaryType: 'MONTHLY', branch: { name: 'Main' } },
        ]),
      },
      timeEntry:   { findMany: jest.fn().mockResolvedValue([]) },
      cashAdvance: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ca1', userId: 'emp', balance: 3000, perPayday: 1000, givenAt: new Date('2026-11-05T04:00:00Z') },
        ]),
      },
      payslip:      { findMany: jest.fn() },
      journalEntry: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const journal  = { create: jest.fn().mockResolvedValue({ id: 'je' }) };
    const accounts = { findByCode: jest.fn(async (_t: string, code: string) => ({ id: `acct-${code}` })) };
    const svc = new PayrollService(prisma, journal as any, accounts as any);
    return { svc, prisma, tx, journal };
  }

  it('takes ₱1,000 off the payslip and the advance balance', async () => {
    const { svc, tx } = makePayroll();
    await svc.processPayRun('run1', 't1', 'owner');

    const [slip] = tx.payslip.createMany.mock.calls[0][0].data;
    expect(slip.otherDeductions).toBe(1000);
    expect(slip.netPay).toBeCloseTo(slip.grossPay - slip.sssContrib - slip.philhealthContrib - slip.pagibigContrib - slip.withholdingTax - 1000, 2);
    expect(slip.totalDeductions).toBeCloseTo(slip.grossPay - slip.netPay, 2);

    expect(tx.cashAdvance.updateMany).toHaveBeenCalledWith({
      where: { id: 'ca1', tenantId: 't1', status: 'OPEN', balance: { gte: 1000 } },
      data:  { balance: { decrement: 1000 } },
    });
    expect(tx.cashAdvanceDeduction.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: 't1', payRunId: 'run1', cashAdvanceId: 'ca1', userId: 'emp', amount: 1000 }],
    });
  });

  it('stops the whole run if the advance changed underneath it', async () => {
    const { svc, tx } = makePayroll();
    tx.cashAdvance.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.processPayRun('run1', 't1', 'owner')).rejects.toBeInstanceOf(ConflictException);
    expect(tx.payRun.updateMany).not.toHaveBeenCalled();
  });

  it('locking credits 1034 with what payslips took back, and the entry balances', async () => {
    const { svc, prisma, journal } = makePayroll();
    prisma.payRun.findFirst.mockResolvedValue({
      id: 'run1', tenantId: 't1', label: 'Nov 1-15', status: 'COMPLETED', frequency: 'SEMI_MONTHLY',
      periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-11-15T00:00:00Z'),
    });
    const slip = {
      grossPay: 7500, sssContrib: 375, philhealthContrib: 187.5, pagibigContrib: 100,
      withholdingTax: 0, otherDeductions: 1000, netPay: 5837.5,
      basicPay: 7500, overtimePay: 0,
    };
    prisma.payslip.findMany.mockResolvedValue([slip]);

    await svc.lockPayRun('run1', 't1', 'owner');

    const lines = journal.create.mock.calls[0][1].lines as { accountId: string; debit?: number; credit?: number }[];
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'acct-1034', credit: 1000 }));
    expect(lines).toContainEqual(expect.objectContaining({ accountId: 'acct-2081', credit: 5837.5 }));
    const dr = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const cr = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
  });
});
