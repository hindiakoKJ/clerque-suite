import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { payRunWindow } from '../payroll/pay-time';
import { DAY_MS } from '../ingredient-reports/daily-usage';
import { manilaIso, manilaWindow, money2, requireDay, requireId } from './format';

/** The longest stretch of hours one read may cover: a monthly run plus slack. */
const MAX_HOURS_DAYS = 62;
/** A read never returns more rows than this; a shop that hits it narrows the dates. */
const MAX_ENTRIES = 5000;
const MAX_STAFF = 1000;
const MAX_RUNS = 24;
const DEFAULT_RUNS = 6;

/** The same people a pay run pays (PayrollService.processPayRun): never the platform admin or an outside auditor. */
const NOT_STAFF = ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] as const;

/** A pay run's period dates are stored as calendar dates at UTC midnight. */
const periodDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * GET /service/payroll/... -- read-only payroll for AIBA's Payroll room
 * (KJ 2026-11-19: Clerque computes pay; AIBA reads and checks).
 *
 * Scope payroll:read, off until the owner ticks it. Nothing here writes,
 * processes, locks or approves anything: it reads the same rows the pay run
 * reads, so AIBA can list missing punches before cutoff and check the run
 * after it.
 *
 * Personal data is kept to what the checks need: names, branch, position,
 * rate and the payslip amounts. Government numbers, TIN, email, phone,
 * kiosk PIN and photos are never returned.
 *
 * Every query is filtered by the key's own tenant.
 */
@Injectable()
export class PayrollReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** Who works here: the people a pay run would consider, with their rate. */
  async staff(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where:   { tenantId, isActive: true, role: { notIn: [...NOT_STAFF] as any[] } },
      select:  {
        id: true, name: true, position: true, role: true, employmentType: true,
        salaryType: true, salaryRate: true, hiredAt: true,
        branch: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
      take:    MAX_STAFF + 1,
    });
    if (users.length > MAX_STAFF) throw new BadRequestException(`More than ${MAX_STAFF} staff; ask Clerque support.`);
    return {
      staff: users.map((u) => ({
        id:             u.id,
        name:           u.name,
        position:       u.position ?? null,
        role:           u.role,
        employmentType: u.employmentType,
        branch:         u.branch ? { id: u.branch.id, name: u.branch.name } : null,
        salaryType:     u.salaryType ?? null,
        salaryRate:     money2(u.salaryRate),
        hiredAt:        u.hiredAt ? manilaIso(u.hiredAt)!.slice(0, 10) : null,
      })),
    };
  }

  /**
   * Time entries clocked in from `from` to `to` (Manila days, both included),
   * every status: OPEN ones are the missing clock-outs, and a pay run pays
   * CLOSED as well as APPROVED, so the room needs to see both.
   */
  async hours(tenantId: string, query: { from?: unknown; to?: unknown }) {
    const from = requireDay(query.from, 'from');
    const to = requireDay(query.to, 'to');
    if (to < from) throw new BadRequestException('to is before from.');
    const { start, end } = manilaWindow(from, to);
    if ((end.getTime() - start.getTime()) / DAY_MS > MAX_HOURS_DAYS) {
      throw new BadRequestException(`Ask for at most ${MAX_HOURS_DAYS} days at a time.`);
    }
    const rows = await this.prisma.timeEntry.findMany({
      where:   { tenantId, clockIn: { gte: start, lt: end } },
      select:  {
        id: true, userId: true, clockIn: true, clockOut: true, breakMins: true,
        status: true, grossHours: true, otHours: true,
        user: { select: { name: true, isActive: true, branch: { select: { id: true, name: true } } } },
      },
      orderBy: [{ clockIn: 'asc' }, { id: 'asc' }],
      take:    MAX_ENTRIES + 1,
    });
    if (rows.length > MAX_ENTRIES) throw new BadRequestException(`More than ${MAX_ENTRIES} time entries; ask for fewer days.`);
    return {
      from,
      to,
      entries: rows.map((e) => ({
        id:          e.id,
        personId:    e.userId,
        name:        e.user.name,
        active:      e.user.isActive,
        branch:      e.user.branch ? { id: e.user.branch.id, name: e.user.branch.name } : null,
        clockIn:     manilaIso(e.clockIn),
        clockOut:    manilaIso(e.clockOut),
        breakMins:   e.breakMins,
        status:      e.status,
        grossHours:  money2(e.grossHours),
        otHours:     money2(e.otHours),
      })),
    };
  }

  /** The latest pay runs, newest period first, with their totals only. */
  async runs(tenantId: string, query: { limit?: unknown }) {
    let limit = DEFAULT_RUNS;
    if (query.limit != null && query.limit !== '') {
      const n = Number(query.limit);
      if (!Number.isInteger(n) || n < 1 || n > MAX_RUNS) throw new BadRequestException(`limit must be 1 to ${MAX_RUNS}.`);
      limit = n;
    }
    const runs = await this.prisma.payRun.findMany({
      where:   { tenantId },
      orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
      take:    limit,
    });
    return { runs: runs.map((r) => this.runHead(r)) };
  }

  /** One pay run with every payslip and the cash advances it took back. */
  async run(tenantId: string, id: unknown) {
    const runId = requireId(id, 'id');
    const run = await this.prisma.payRun.findFirst({ where: { id: runId, tenantId } });
    if (!run) throw new NotFoundException('Pay run not found.');
    const [slips, takes] = await Promise.all([
      this.prisma.payslip.findMany({ where: { tenantId, payRunId: run.id }, orderBy: { employeeName: 'asc' } }),
      this.prisma.cashAdvanceDeduction.findMany({
        where:  { tenantId, payRunId: run.id },
        select: { cashAdvanceId: true, userId: true, amount: true },
      }),
    ]);
    return {
      run: this.runHead(run),
      payslips: slips.map((s) => ({
        personId:          s.userId,
        name:              s.employeeName,
        position:          s.position ?? null,
        branch:            s.department ?? null,
        regularHours:      money2(s.regularHours),
        overtimeHours:     money2(s.overtimeHours),
        basicPay:          money2(s.basicPay),
        overtimePay:       money2(s.overtimePay),
        allowances:        money2(s.allowances),
        grossPay:          money2(s.grossPay),
        sss:               money2(s.sssContrib),
        philhealth:        money2(s.philhealthContrib),
        pagibig:           money2(s.pagibigContrib),
        withholdingTax:    money2(s.withholdingTax),
        cashAdvance:       money2(s.otherDeductions),
        totalDeductions:   money2(s.totalDeductions),
        netPay:            money2(s.netPay),
      })),
      cashAdvanceTaken: takes.map((t) => ({ cashAdvanceId: t.cashAdvanceId, personId: t.userId, amount: money2(t.amount) })),
    };
  }

  /** Cash advances asked for or still owed. */
  async cashAdvances(tenantId: string) {
    const rows = await this.prisma.cashAdvance.findMany({
      where:   { tenantId, status: { in: ['REQUESTED', 'OPEN'] as any[] } },
      select:  {
        id: true, userId: true, status: true, amount: true, perPayday: true, balance: true, givenAt: true, createdAt: true,
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
      take:    MAX_STAFF,
    });
    return {
      cashAdvances: rows.map((a) => ({
        id:          a.id,
        personId:    a.userId,
        name:        a.user.name,
        status:      a.status,
        amount:      money2(a.amount),
        perPayday:   money2(a.perPayday),
        balance:     money2(a.balance),
        givenAt:     manilaIso(a.givenAt),
        requestedAt: manilaIso(a.createdAt),
      })),
    };
  }

  private runHead(r: {
    id: string; label: string; periodStart: Date; periodEnd: Date; frequency: string; status: string;
    totalGross: any; totalDeductions: any; totalNet: any; employeeCount: number; processedAt: Date | null;
  }) {
    const w = payRunWindow(r.periodStart, r.periodEnd);
    return {
      id:              r.id,
      label:           r.label,
      periodStart:     periodDay(r.periodStart),
      periodEnd:       periodDay(r.periodEnd),
      // The instants the run counts hours in: clock-ins from `hoursFrom`, before `hoursTo`.
      hoursFrom:       manilaIso(w.from),
      hoursTo:         manilaIso(w.to),
      frequency:       r.frequency,
      status:          r.status,
      employeeCount:   r.employeeCount,
      totalGross:      money2(r.totalGross),
      totalDeductions: money2(r.totalDeductions),
      totalNet:        money2(r.totalNet),
      processedAt:     manilaIso(r.processedAt),
    };
  }
}
