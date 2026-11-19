import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PayrollReadService } from './payroll-read.service';

const D = (x: string | number) => new Prisma.Decimal(x);

function build(over: Record<string, any> = {}) {
  const prisma: any = {
    user:                 { findMany: jest.fn().mockResolvedValue([]) },
    timeEntry:            { findMany: jest.fn().mockResolvedValue([]) },
    payRun:               { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    payslip:              { findMany: jest.fn().mockResolvedValue([]) },
    cashAdvanceDeduction: { findMany: jest.fn().mockResolvedValue([]) },
    cashAdvance:          { findMany: jest.fn().mockResolvedValue([]) },
    ...over,
  };
  return { prisma, svc: new PayrollReadService(prisma) };
}

const run = {
  id: 'r1', tenantId: 't1', label: 'Nov 1-15', periodStart: new Date('2026-11-01T00:00:00Z'), periodEnd: new Date('2026-11-15T00:00:00Z'),
  frequency: 'SEMI_MONTHLY', status: 'COMPLETED', totalGross: D('20000'), totalDeductions: D('1500.5'), totalNet: D('18499.5'),
  employeeCount: 2, processedAt: new Date('2026-11-16T01:00:00Z'), createdAt: new Date(),
};

describe('PayrollReadService', () => {
  it('staff: active people of the key tenant only, never the platform admin or an auditor, and no government numbers', async () => {
    const { prisma, svc } = build();
    prisma.user.findMany.mockResolvedValue([{
      id: 'u1', name: 'Ana', position: 'Barista', role: 'CASHIER', employmentType: 'REGULAR',
      salaryType: 'DAILY', salaryRate: D('610'), hiredAt: new Date('2026-03-01T00:00:00+08:00'), branch: { id: 'b1', name: 'Main' },
    }]);
    const r = await svc.staff('t1');
    const q = prisma.user.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ tenantId: 't1', isActive: true, role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] } });
    expect(Object.keys(q.select)).not.toEqual(expect.arrayContaining(['sssNumber']));
    for (const secret of ['sssNumber', 'philhealthNumber', 'pagibigNumber', 'tin', 'email', 'phone', 'kioskPin', 'passwordHash', 'photo']) {
      expect(q.select[secret]).toBeUndefined();
    }
    expect(r.staff[0]).toEqual({
      id: 'u1', name: 'Ana', position: 'Barista', role: 'CASHIER', employmentType: 'REGULAR',
      branch: { id: 'b1', name: 'Main' }, salaryType: 'DAILY', salaryRate: '610.00', hiredAt: '2026-03-01',
    });
  });

  it('staff: a person with no rate reads null, not 0.00', async () => {
    const { prisma, svc } = build();
    prisma.user.findMany.mockResolvedValue([{ id: 'u2', name: 'Ben', position: null, role: 'CASHIER', employmentType: 'REGULAR', salaryType: null, salaryRate: null, hiredAt: null, branch: null }]);
    const r = await svc.staff('t1');
    expect(r.staff[0]).toMatchObject({ salaryRate: null, salaryType: null, branch: null, hiredAt: null });
  });

  it('hours: every status in whole Manila days, open entries with no clock-out', async () => {
    const { prisma, svc } = build();
    prisma.timeEntry.findMany.mockResolvedValue([
      { id: 'e1', userId: 'u1', clockIn: new Date('2026-11-14T23:55:00Z'), clockOut: null, breakMins: 0, status: 'OPEN', grossHours: null, otHours: null,
        user: { name: 'Ana', isActive: true, branch: { id: 'b1', name: 'Main' } } },
    ]);
    const r = await svc.hours('t1', { from: '2026-11-01', to: '2026-11-15' });
    const where = prisma.timeEntry.findMany.mock.calls[0][0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.status).toBeUndefined();
    expect(where.clockIn.gte.toISOString()).toBe('2026-10-31T16:00:00.000Z');
    expect(where.clockIn.lt.toISOString()).toBe('2026-11-15T16:00:00.000Z');
    expect(r.entries[0]).toEqual({
      id: 'e1', personId: 'u1', name: 'Ana', active: true, branch: { id: 'b1', name: 'Main' },
      clockIn: '2026-11-15T07:55:00+08:00', clockOut: null, breakMins: 0, status: 'OPEN', grossHours: null, otHours: null,
    });
  });

  it.each([
    [{ from: '2026-11-01' }],
    [{ from: '2026-11-15', to: '2026-11-01' }],
    [{ from: '2026-09-01', to: '2026-11-30' }],
    [{ from: '1/11/2026', to: '2026-11-15' }],
  ])('hours refuses %j', async (q) => {
    const { svc } = build();
    await expect(svc.hours('t1', q)).rejects.toThrow(BadRequestException);
  });

  it('runs: newest first, totals as strings, the period as calendar days', async () => {
    const { prisma, svc } = build();
    prisma.payRun.findMany.mockResolvedValue([run]);
    const r = await svc.runs('t1', { limit: '3' });
    expect(prisma.payRun.findMany.mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1' }, take: 3 });
    expect(r.runs[0]).toEqual({
      id: 'r1', label: 'Nov 1-15', periodStart: '2026-11-01', periodEnd: '2026-11-15',
      hoursFrom: '2026-11-01T00:00:00+08:00', hoursTo: '2026-11-16T00:00:00+08:00',
      frequency: 'SEMI_MONTHLY', status: 'COMPLETED', employeeCount: 2,
      totalGross: '20000.00', totalDeductions: '1500.50', totalNet: '18499.50', processedAt: '2026-11-16T09:00:00+08:00',
    });
    await expect(svc.runs('t1', { limit: '99' })).rejects.toThrow(BadRequestException);
  });

  it("run: another tenant's run is not found", async () => {
    const { prisma, svc } = build();
    await expect(svc.run('t1', 'r9')).rejects.toThrow(NotFoundException);
    expect(prisma.payRun.findFirst.mock.calls[0][0].where).toEqual({ id: 'r9', tenantId: 't1' });
    await expect(svc.run('t1', "r1'; --")).rejects.toThrow(BadRequestException);
  });

  it('run: every payslip, with the cash advance taken back named as such', async () => {
    const { prisma, svc } = build();
    prisma.payRun.findFirst.mockResolvedValue(run);
    prisma.payslip.findMany.mockResolvedValue([{
      userId: 'u1', employeeName: 'Ana', position: 'Barista', department: 'Main',
      regularHours: D('88'), overtimeHours: D('4'), basicPay: D('6710'), overtimePay: D('381.25'), allowances: D('0'), grossPay: D('7091.25'),
      sssContrib: D('350'), philhealthContrib: D('177.28'), pagibigContrib: D('100'), withholdingTax: D('0'),
      otherDeductions: D('1000'), totalDeductions: D('1627.28'), netPay: D('5463.97'),
    }]);
    prisma.cashAdvanceDeduction.findMany.mockResolvedValue([{ cashAdvanceId: 'ca1', userId: 'u1', amount: D('1000') }]);
    const r = await svc.run('t1', 'r1');
    expect(prisma.payslip.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', payRunId: 'r1' });
    expect(r.payslips[0]).toMatchObject({ personId: 'u1', branch: 'Main', grossPay: '7091.25', cashAdvance: '1000.00', netPay: '5463.97', overtimeHours: '4.00' });
    expect(r.cashAdvanceTaken).toEqual([{ cashAdvanceId: 'ca1', personId: 'u1', amount: '1000.00' }]);
  });

  it('cash advances: asked for or still owed, in the key tenant', async () => {
    const { prisma, svc } = build();
    prisma.cashAdvance.findMany.mockResolvedValue([{
      id: 'ca1', userId: 'u1', status: 'OPEN', amount: D('3000'), perPayday: D('1000'), balance: D('2000'),
      givenAt: new Date('2026-11-03T02:00:00Z'), createdAt: new Date('2026-11-02T02:00:00Z'), user: { name: 'Ana' },
    }]);
    const r = await svc.cashAdvances('t1');
    expect(prisma.cashAdvance.findMany.mock.calls[0][0].where).toEqual({ tenantId: 't1', status: { in: ['REQUESTED', 'OPEN'] } });
    expect(r.cashAdvances[0]).toEqual({
      id: 'ca1', personId: 'u1', name: 'Ana', status: 'OPEN', amount: '3000.00', perPayday: '1000.00', balance: '2000.00',
      givenAt: '2026-11-03T10:00:00+08:00', requestedAt: '2026-11-02T10:00:00+08:00',
    });
  });
});
