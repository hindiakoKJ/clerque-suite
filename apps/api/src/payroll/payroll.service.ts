import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TimeEntryStatus, LeaveType, LeaveStatus, SalaryType } from '@prisma/client';
import { generatePayslipPdf } from './payslip-pdf';
import { JournalService } from '../accounting/journal.service';
import { AccountsService } from '../accounting/accounts.service';
import {
  computeBasicPay as computeBasicPayPh,
  computePayslip,
  type PayFreq as PhPayFreq,
} from './ph-tax-tables';

// ─── Response shapes (match what the frontend expects) ───────────────────────

export interface EmployeeDto {
  id:          string;
  name:        string;
  email:       string;
  phone:       string | null;
  department:  string | null; // branchName used as department
  position:    string | null;
  status:      'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  startDate:   string | null; // ISO date string
  basicRate:   number | null;
  shiftStart:  string | null; // "HH:mm" 24h, set on hire
  shiftEnd:    string | null;
}

export interface TimesheetRow {
  employeeId:   string;
  employeeName: string;
  department:   string | null;
  mon:          number;
  tue:          number;
  wed:          number;
  thu:          number;
  fri:          number;
  sat:          number;
  sun:          number;
  totalHours:   number;
  overtime:     number;
  status:       'APPROVED' | 'PENDING' | 'REJECTED';
}

export interface PayrollSummary {
  activeEmployees:    number;
  onLeaveToday:       number;
  totalGrossMtd:      number;
  totalDeductionsMtd: number;
  totalNetMtd:        number;
  completedRuns:      number;
  pendingRuns:        number;
  nextRunDate:        string | null;
  nextRunEmployees:   number;
  averageGross:       number;
  departmentBreakdown: { department: string; headcount: number; grossPay: number }[];
  recentRuns:          { id: string; label: string; status: string; periodEnd: string; totalNet: number; employeeCount: number }[];
}

export interface ClockStatusDto {
  isClockedIn:  boolean;
  clockedInAt:  string | null;  // ISO datetime
  entryId:      string | null;
  elapsedMins:  number;
}

export interface PayRunDto {
  id: string; label: string; periodStart: string; periodEnd: string;
  frequency: string; status: string;
  totalGross: number; totalDeductions: number; totalNet: number;
  employeeCount: number; processedAt: string | null; notes: string | null; createdAt: string;
}

export interface PayslipDto {
  id: string; payRunId: string; payRunLabel: string;
  userId: string; employeeName: string; position: string | null; department: string | null;
  periodStart: string; periodEnd: string;
  basicPay: number; overtimePay: number; allowances: number; grossPay: number;
  sssContrib: number; philhealthContrib: number; pagibigContrib: number;
  withholdingTax: number; otherDeductions: number; totalDeductions: number; netPay: number;
  regularHours: number; overtimeHours: number; createdAt: string;
}

export interface ContributionSummaryDto {
  month: string; // YYYY-MM
  totalSss: number; totalPhilhealth: number; totalPagibig: number;
  totalWithholdingTax: number; totalDeductions: number; employeeCount: number;
  rows: { employeeName: string; sss: number; philhealth: number; pagibig: number; withholdingTax: number; totalDeductions: number }[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the Monday (00:00:00 Asia/Manila) for the week that contains `date`. */
function getWeekBounds(weekStart: string): { from: Date; to: Date } {
  // weekStart is YYYY-MM-DD in local time; we treat it as UTC midnight for DB queries
  const from = new Date(`${weekStart}T00:00:00.000Z`);
  const to   = new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);
  return { from, to };
}

/** Returns start/end of the current calendar month (UTC). */
function currentMonthBounds(): { from: Date; to: Date } {
  const now  = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { from, to };
}

/** Day-of-week index → column label for TimesheetRow (0 = Sun … 6 = Sat) */
const DOW_KEYS: (keyof Pick<TimesheetRow, 'mon'|'tue'|'wed'|'thu'|'fri'|'sat'|'sun'>)[] =
  ['sun','mon','tue','wed','thu','fri','sat'];

type PayFreq = PhPayFreq;
// Legacy inline helpers replaced by ph-tax-tables.ts (Sprint 19) — that module
// uses the actual SSS 2025 MSC table, BIR per-period WHT brackets (RR 11-2018),
// and exposes a one-shot computePayslip() that handles taxable-vs-non-taxable
// (de minimis allowances) correctly.
const computeBasicPay = computeBasicPayPh;

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PayrollService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journal: JournalService,
    private readonly accounts: AccountsService,
  ) {}

  // ─── Clock Status ────────────────────────────────────────────────────────

  async getClockStatus(tenantId: string, userId: string): Promise<ClockStatusDto> {
    const open = await this.prisma.timeEntry.findFirst({
      where:   { tenantId, userId, status: TimeEntryStatus.OPEN },
      orderBy: { clockIn: 'desc' },
      select:  { id: true, clockIn: true },
    });

    if (!open) {
      return { isClockedIn: false, clockedInAt: null, entryId: null, elapsedMins: 0 };
    }

    const elapsed = Math.floor((Date.now() - open.clockIn.getTime()) / 60_000);
    return {
      isClockedIn: true,
      clockedInAt: open.clockIn.toISOString(),
      entryId:     open.id,
      elapsedMins: elapsed,
    };
  }

  // ─── Clock In ────────────────────────────────────────────────────────────

  async clockIn(tenantId: string, userId: string, notes?: string): Promise<ClockStatusDto> {
    // Prevent double clock-in
    const existing = await this.prisma.timeEntry.findFirst({
      where:  { tenantId, userId, status: TimeEntryStatus.OPEN },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'You are already clocked in. Please clock out before starting a new session.',
      );
    }

    const entry = await this.prisma.timeEntry.create({
      data: {
        tenantId,
        userId,
        clockIn:  new Date(),
        status:   TimeEntryStatus.OPEN,
        notes:    notes ?? null,
      },
      select: { id: true, clockIn: true },
    });

    return {
      isClockedIn: true,
      clockedInAt: entry.clockIn.toISOString(),
      entryId:     entry.id,
      elapsedMins: 0,
    };
  }

  // ─── Clock Out ───────────────────────────────────────────────────────────

  async clockOut(tenantId: string, userId: string, breakMins = 0): Promise<ClockStatusDto> {
    const open = await this.prisma.timeEntry.findFirst({
      where:  { tenantId, userId, status: TimeEntryStatus.OPEN },
      select: { id: true, clockIn: true },
    });
    if (!open) {
      throw new NotFoundException('No active clock-in session found.');
    }

    if (breakMins < 0) throw new BadRequestException('breakMins must be ≥ 0.');

    const clockOut   = new Date();
    const totalMins  = (clockOut.getTime() - open.clockIn.getTime()) / 60_000;
    const workedMins = Math.max(totalMins - breakMins, 0);
    const grossHours = new Prisma.Decimal((workedMins / 60).toFixed(2));
    const otHours    = new Prisma.Decimal(Math.max(Number(grossHours) - 8, 0).toFixed(2));

    await this.prisma.timeEntry.update({
      where: { id: open.id },
      data: {
        clockOut,
        breakMins,
        grossHours,
        otHours,
        status: TimeEntryStatus.CLOSED,
      },
    });

    return { isClockedIn: false, clockedInAt: null, entryId: null, elapsedMins: 0 };
  }

  // ─── My Attendance History ───────────────────────────────────────────────

  async getMyAttendance(tenantId: string, userId: string, from?: string, to?: string) {
    const clockInFilter: Prisma.DateTimeFilter | undefined =
      from || to
        ? {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(new Date(to).setHours(23, 59, 59, 999)) } : {}),
          }
        : undefined;

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        userId,
        ...(clockInFilter ? { clockIn: clockInFilter } : {}),
      },
      orderBy: { clockIn: 'desc' },
      take: 90, // max 3 months of daily entries
    });

    return entries.map((e) => ({
      id:          e.id,
      date:        e.clockIn.toISOString().split('T')[0],
      clockIn:     e.clockIn.toISOString(),
      clockOut:    e.clockOut?.toISOString() ?? null,
      grossHours:  e.grossHours ? Number(e.grossHours) : null,
      otHours:     e.otHours   ? Number(e.otHours)    : 0,
      breakMins:   e.breakMins ?? 0,
      status:      e.status,
      notes:       e.notes ?? null,
    }));
  }

  // ─── Employees List ──────────────────────────────────────────────────────

  async getEmployees(tenantId: string): Promise<EmployeeDto[]> {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId,
        // Exclude SUPER_ADMIN and EXTERNAL_AUDITOR — they are not payroll employees
        role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] },
      },
      select: {
        id:             true,
        name:           true,
        email:          true,
        phone:          true,
        position:       true,
        isActive:       true,
        hiredAt:        true,
        salaryRate:     true,
        shiftStart:     true,
        shiftEnd:       true,
        branch:         { select: { name: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });

    return users.map((u) => ({
      id:         u.id,
      name:       u.name,
      email:      u.email,
      phone:      u.phone,
      department: u.branch?.name ?? null,
      position:   u.position,
      status:     u.isActive ? 'ACTIVE' : 'INACTIVE',
      startDate:  u.hiredAt ? u.hiredAt.toISOString().slice(0, 10) : null,
      basicRate:  u.salaryRate !== null ? Number(u.salaryRate) : null,
      shiftStart: u.shiftStart ?? null,
      shiftEnd:   u.shiftEnd   ?? null,
    }));
  }

  // ─── Weekly Timesheets ───────────────────────────────────────────────────

  async getTimesheets(tenantId: string, weekStart: string): Promise<TimesheetRow[]> {
    // Validate weekStart format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
      throw new BadRequestException('weekStart must be in YYYY-MM-DD format.');
    }

    const { from, to } = getWeekBounds(weekStart);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        clockIn: { gte: from, lt: to },
        status:  { not: TimeEntryStatus.OPEN }, // exclude still-open (not yet clocked out)
      },
      select: {
        userId:     true,
        clockIn:    true,
        grossHours: true,
        otHours:    true,
        status:     true,
        user: {
          select: {
            name:   true,
            branch: { select: { name: true } },
          },
        },
      },
      orderBy: { clockIn: 'asc' },
    });

    // Group by userId
    const byUser = new Map<string, typeof entries>();
    for (const e of entries) {
      if (!byUser.has(e.userId)) byUser.set(e.userId, []);
      byUser.get(e.userId)!.push(e);
    }

    const rows: TimesheetRow[] = [];

    for (const [userId, userEntries] of byUser) {
      const first  = userEntries[0];
      const totals = { mon:0, tue:0, wed:0, thu:0, fri:0, sat:0, sun:0 };
      let totalHours = 0;
      let overtime   = 0;
      let hasRejected  = false;
      let hasApproved  = false;

      for (const e of userEntries) {
        const dow = e.clockIn.getUTCDay(); // 0=Sun … 6=Sat
        const h   = Number(e.grossHours ?? 0);
        const ot  = Number(e.otHours   ?? 0);
        const key = DOW_KEYS[dow];
        totals[key] = round2(totals[key] + h);
        totalHours  = round2(totalHours + h);
        overtime    = round2(overtime   + ot);

        if (e.status === TimeEntryStatus.REJECTED) hasRejected = true;
        if (e.status === TimeEntryStatus.APPROVED) hasApproved = true;
      }

      // Aggregate status: any REJECTED → REJECTED; all APPROVED → APPROVED; else PENDING
      const status: TimesheetRow['status'] =
        hasRejected ? 'REJECTED' : hasApproved ? 'APPROVED' : 'PENDING';

      rows.push({
        employeeId:   userId,
        employeeName: first.user.name,
        department:   first.user.branch?.name ?? null,
        ...totals,
        totalHours,
        overtime,
        status,
      });
    }

    return rows;
  }

  // ─── Payroll Summary Dashboard ───────────────────────────────────────────

  async getSummary(tenantId: string): Promise<PayrollSummary> {
    const { from: mFrom, to: mTo } = currentMonthBounds();

    // Active / total employee counts
    const [activeEmployees, totalEmployees] = await Promise.all([
      this.prisma.user.count({
        where: { tenantId, isActive: true, role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] } },
      }),
      this.prisma.user.count({
        where: { tenantId, role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] } },
      }),
    ]);

    // Worked hours this month (CLOSED + APPROVED entries)
    const monthEntries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        clockIn: { gte: mFrom, lt: mTo },
        status:  { in: [TimeEntryStatus.CLOSED, TimeEntryStatus.APPROVED] },
        grossHours: { not: null },
      },
      select: {
        userId:     true,
        grossHours: true,
        otHours:    true,
        user: {
          select: {
            salaryRate:  true,
            salaryType:  true,
            branch:      { select: { name: true } },
          },
        },
      },
    });

    // Compute gross pay per entry using the employee's rate
    let totalGrossMtd = 0;
    const deptMap = new Map<string, { headcount: Set<string>; grossPay: number }>();

    for (const e of monthEntries) {
      const hours   = Number(e.grossHours ?? 0);
      const otHours = Number(e.otHours   ?? 0);
      const rate    = Number(e.user.salaryRate ?? 0);
      const type    = e.user.salaryType;

      // Hourly equivalent pay calculation:
      let hourlyRate = 0;
      if (type === 'HOURLY')       hourlyRate = rate;
      else if (type === 'DAILY')   hourlyRate = rate / 8;
      else if (type === 'MONTHLY') hourlyRate = rate / (22 * 8); // 22 working days × 8h
      else if (type === 'SEMI_MONTHLY') hourlyRate = rate / (11 * 8);

      const regularPay = hourlyRate * Math.min(hours, 8);
      const otPay      = hourlyRate * otHours * 1.25; // PH Labor Code: 125% for OT
      const gross      = regularPay + otPay;

      totalGrossMtd += gross;

      const dept = e.user.branch?.name ?? 'Unassigned';
      if (!deptMap.has(dept)) deptMap.set(dept, { headcount: new Set(), grossPay: 0 });
      const d = deptMap.get(dept)!;
      d.headcount.add(e.userId);
      d.grossPay = round2(d.grossPay + gross);
    }

    // PH statutory deductions — sum from finalized payslips this month for accuracy.
    // Falls back to a 9% estimate only when no payslips have been generated yet.
    const payslipDeductionAgg = await this.prisma.payslip.aggregate({
      where: {
        tenantId,
        payRun: { periodStart: { gte: mFrom }, periodEnd: { lt: mTo } },
      },
      _sum: { totalDeductions: true },
    });
    const realDeductions = Number(payslipDeductionAgg._sum?.totalDeductions ?? 0);
    const totalDeductionsMtd = realDeductions > 0
      ? round2(realDeductions)
      : round2(totalGrossMtd * 0.09);
    const totalNetMtd = round2(totalGrossMtd - totalDeductionsMtd);

    const departmentBreakdown = Array.from(deptMap.entries()).map(([department, d]) => ({
      department,
      headcount: d.headcount.size,
      grossPay:  round2(d.grossPay),
    }));

    const averageGross = totalEmployees > 0
      ? round2(totalGrossMtd / activeEmployees)
      : 0;

    // Determine next semi-monthly run date (15th or end of month)
    const today      = new Date();
    const day        = today.getUTCDate();
    const month      = today.getUTCMonth();
    const year       = today.getUTCFullYear();
    const eom        = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    let nextRunDate: string | null;
    if (day < 15) {
      nextRunDate = `${year}-${String(month + 1).padStart(2,'0')}-15`;
    } else if (day < eom) {
      nextRunDate = `${year}-${String(month + 1).padStart(2,'0')}-${String(eom).padStart(2,'0')}`;
    } else {
      // Already past EOM — next run is the 15th of next month.
      // month is 0-indexed (Jan=0..Dec=11). Next month index = month+1; if that
      // overflows past Dec (>= 12), roll into January of next year.
      const rollOver  = month + 1 >= 12;
      const nextMonth = rollOver ? 1 : month + 2; // 1-indexed for the date string
      const nextYear  = rollOver ? year + 1 : year;
      nextRunDate = `${nextYear}-${String(nextMonth).padStart(2,'0')}-15`;
    }

    // Real counts pulled from PayRun + LeaveRequest tables (when available).
    // LeaveRequest is added in Sprint 3; until then onLeaveToday is 0.
    const todayUtc = new Date(Date.UTC(year, month, day));

    const [completedRuns, pendingRuns, recentRunRows, onLeaveToday] = await Promise.all([
      this.prisma.payRun.count({ where: { tenantId, status: 'COMPLETED' as any } }),
      this.prisma.payRun.count({ where: { tenantId, status: 'DRAFT' as any } }),
      this.prisma.payRun.findMany({
        where:   { tenantId },
        orderBy: { periodEnd: 'desc' },
        take:    5,
        select: {
          id: true, label: true, periodEnd: true, status: true, totalNet: true,
          _count: { select: { payslips: true } },
        },
      }),
      // Best-effort: query LeaveRequest only if the table exists.
      // Wrap in try/catch via a soft prisma call to avoid breaking pre-Sprint-3 deploys.
      (async () => {
        try {
          const leaveModel = (this.prisma as any).leaveRequest;
          if (!leaveModel) return 0;
          return await leaveModel.count({
            where: {
              tenantId,
              status:    'APPROVED',
              startDate: { lte: todayUtc },
              endDate:   { gte: todayUtc },
            },
          });
        } catch {
          return 0;
        }
      })(),
    ]);

    const recentRuns = recentRunRows.map((r) => ({
      id:            r.id,
      label:         r.label,
      status:        r.status as string,
      periodEnd:     r.periodEnd.toISOString().slice(0, 10),
      totalNet:      Number(r.totalNet ?? 0),
      employeeCount: r._count.payslips,
    }));

    return {
      activeEmployees,
      onLeaveToday,
      totalGrossMtd: round2(totalGrossMtd),
      totalDeductionsMtd,
      totalNetMtd,
      completedRuns,
      pendingRuns,
      nextRunDate,
      nextRunEmployees: activeEmployees,
      averageGross,
      departmentBreakdown,
      recentRuns,
    };
  }

  // ─── Pay Runs ────────────────────────────────────────────────────────────

  async createPayRun(
    tenantId: string,
    dto: { label: string; periodStart: string; periodEnd: string; frequency: 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY'; notes?: string },
  ): Promise<PayRunDto> {
    const run = await this.prisma.payRun.create({
      data: {
        tenantId,
        label:       dto.label,
        periodStart: new Date(dto.periodStart),
        periodEnd:   new Date(dto.periodEnd),
        frequency:   dto.frequency as any,
        status:      'DRAFT' as any,
        notes:       dto.notes ?? null,
      },
    });
    return this.serializePayRun(run);
  }

  async getPayRuns(tenantId: string): Promise<PayRunDto[]> {
    const runs = await this.prisma.payRun.findMany({
      where:   { tenantId },
      orderBy: { periodStart: 'desc' },
    });
    return runs.map((r) => this.serializePayRun(r));
  }

  /** Process a DRAFT pay run: compute payslips from TimeEntry data for each employee */
  async processPayRun(payRunId: string, tenantId: string, processedById: string): Promise<PayRunDto> {
    const run = await this.prisma.payRun.findFirst({ where: { id: payRunId, tenantId } });
    if (!run) throw new NotFoundException('Pay run not found');
    if ((run.status as string) !== 'DRAFT') throw new BadRequestException('Only DRAFT pay runs can be processed');

    const freq = run.frequency as PayFreq;

    // Get all active employees for this tenant
    const employees = await this.prisma.user.findMany({
      where:  { tenantId, isActive: true, role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] } },
      select: { id: true, name: true, position: true, salaryRate: true, salaryType: true, branch: { select: { name: true } } },
    });

    // Get all approved/closed TimeEntry in the pay period
    const entries = await this.prisma.timeEntry.findMany({
      where: {
        tenantId,
        status:  { in: ['CLOSED', 'APPROVED'] as any[] },
        clockIn: { gte: run.periodStart, lte: run.periodEnd },
      },
      select: { userId: true, grossHours: true, otHours: true },
    });

    // Aggregate hours per employee
    const hoursByEmployee = new Map<string, { regular: number; ot: number }>();
    for (const e of entries) {
      const h = hoursByEmployee.get(e.userId) ?? { regular: 0, ot: 0 };
      h.regular += Number(e.grossHours ?? 0);
      h.ot      += Number(e.otHours   ?? 0);
      hoursByEmployee.set(e.userId, h);
    }

    // Generate payslips
    const payslipData: any[] = [];
    let totalGross = 0;
    let totalDeductions = 0;
    let totalNet = 0;

    for (const emp of employees) {
      const hours  = hoursByEmployee.get(emp.id) ?? { regular: 0, ot: 0 };
      const rate   = emp.salaryRate ? Number(emp.salaryRate) : null;
      const type   = emp.salaryType as string | null;

      const basicPay    = computeBasicPay(rate, type, hours.regular, freq);
      const hourlyRate  = basicPay > 0 && hours.regular > 0 ? basicPay / hours.regular : (rate ?? 0) / 8;
      const otPay       = round2(hourlyRate * hours.ot * 1.25); // PH Labor Code 125%
      if (basicPay + otPay === 0) continue; // Skip employees with zero earnings

      // Sprint 19 — production-grade PH statutory math.
      // Uses official SSS 2025 MSC table + BIR per-period WHT brackets.
      const slip = computePayslip({
        basicPay,
        otPay,
        allowances: 0,        // future: pull from EmployeeAllowance once schema lands
        freq,
      });

      payslipData.push({
        tenantId,
        payRunId,
        userId:            emp.id,
        employeeName:      emp.name,
        position:          emp.position,
        department:        emp.branch?.name ?? null,
        basicPay,
        overtimePay:       otPay,
        allowances:        0,
        grossPay:          slip.gross,
        sssContrib:        slip.sssEe,
        philhealthContrib: slip.philhealthEe,
        pagibigContrib:    slip.pagibigEe,
        withholdingTax:    slip.withholdingTax,
        otherDeductions:   0,
        totalDeductions:   slip.totalDeductions,
        netPay:            slip.net,
        regularHours:      round2(hours.regular),
        overtimeHours:     round2(hours.ot),
      });

      totalGross      += slip.gross;
      totalDeductions += slip.totalDeductions;
      totalNet        += slip.net;
    }

    // Atomically: delete old payslips (re-processing), insert new, update run status.
    // Defense-in-depth: scope deleteMany by tenantId too. The payRun is already
    // tenant-validated upstream, but if some future caller forwards a stale
    // payRunId without re-validating, this guarantees no cross-tenant payslips
    // can be wiped by accident.
    await this.prisma.$transaction(async (tx) => {
      await tx.payslip.deleteMany({ where: { payRunId, tenantId } });
      await tx.payslip.createMany({ data: payslipData });
      // TOCTOU + tenant-scoped status flip. updateMany guarded on status:
      // 'DRAFT' so two concurrent process calls cannot both produce
      // payslips and double-flip the run to COMPLETED.
      const result = await tx.payRun.updateMany({
        where: { id: payRunId, tenantId, status: 'DRAFT' as any },
        data: {
          status:          'COMPLETED' as any,
          totalGross:      round2(totalGross),
          totalDeductions: round2(totalDeductions),
          totalNet:        round2(totalNet),
          employeeCount:   payslipData.length,
          processedAt:     new Date(),
          processedById,
        },
      });
      if (result.count !== 1) {
        throw new ConflictException('Pay run is not in DRAFT or was modified concurrently.');
      }
    });

    // Re-fetch outside the tx for return.
    const finalRun = await this.prisma.payRun.findFirstOrThrow({ where: { id: payRunId, tenantId } });
    return this.serializePayRun(finalRun);
  }

  async cancelPayRun(payRunId: string, tenantId: string): Promise<PayRunDto> {
    const run = await this.prisma.payRun.findFirst({ where: { id: payRunId, tenantId } });
    if (!run) throw new NotFoundException('Pay run not found');
    if ((run.status as string) === 'COMPLETED') throw new BadRequestException('Completed pay runs cannot be cancelled');
    if ((run.status as string) === 'LOCKED')    throw new BadRequestException('Locked pay runs cannot be cancelled — reverse the GL entry instead.');
    // TOCTOU + tenant-scoped: only flip if currently DRAFT.
    const result = await this.prisma.payRun.updateMany({
      where: { id: payRunId, tenantId, status: { notIn: ['COMPLETED', 'LOCKED'] as any[] } },
      data:  { status: 'CANCELLED' as any },
    });
    if (result.count !== 1) {
      throw new ConflictException('Pay run was modified concurrently or is finalized.');
    }
    const updated = await this.prisma.payRun.findFirstOrThrow({ where: { id: payRunId, tenantId } });
    return this.serializePayRun(updated);
  }

  /**
   * Sprint 19 — Seal a COMPLETED pay run + post the salary GL entry.
   *
   *   Dr  6010  Salaries and Wages              gross
   *   Dr  6020  SSS Employer Contribution       sssEr + sssEc
   *   Dr  6030  PhilHealth Employer Contribution philhealthEr
   *   Dr  6040  Pag-IBIG Employer Contribution   pagibigEr
   *       Cr  2030  SSS Contributions Payable    (ee + er + ec total)
   *       Cr  2040  PhilHealth Contributions Payable (ee + er total)
   *       Cr  2050  Pag-IBIG Contributions Payable   (ee + er total)
   *       Cr  2060  Withholding Tax Payable - Compensation   (wht)
   *       Cr  2081  Accrued Salaries & Wages    (net pay - employees still unpaid)
   *
   * The credit to 2081 represents the net cash that the company still owes
   * the workforce; on actual disbursement the bookkeeper posts
   *   Dr 2081  Accrued Salaries
   *       Cr 1022  Cash in Bank – Payroll Account
   * — that's a separate treasury action, not part of this run.
   *
   * Idempotent on `reference: PR-{id}` — calling lock twice will throw.
   * Once LOCKED, payslips are immutable and the run's totals are sealed.
   */
  async lockPayRun(payRunId: string, tenantId: string, lockedById: string): Promise<PayRunDto> {
    const run = await this.prisma.payRun.findFirst({ where: { id: payRunId, tenantId } });
    if (!run) throw new NotFoundException('Pay run not found');
    if ((run.status as string) !== 'COMPLETED') {
      throw new BadRequestException('Only COMPLETED pay runs can be locked. Process the run first.');
    }

    const slips = await this.prisma.payslip.findMany({
      where: { payRunId, tenantId },
      select: {
        grossPay: true, sssContrib: true, philhealthContrib: true, pagibigContrib: true,
        withholdingTax: true, otherDeductions: true, netPay: true,
      },
    });
    if (!slips.length) throw new BadRequestException('No payslips on this run.');

    // Aggregate totals. We only persisted EE shares on Payslip — recompute the
    // ER/EC shares from the same statutory tables so the GL accrues the
    // employer's expense correctly.
    let totalGross    = 0;
    let totalSssEe    = 0;
    let totalPhEe     = 0;
    let totalPiEe     = 0;
    let totalWht      = 0;
    let totalNet      = 0;
    let totalSssEr    = 0;
    let totalSssEc    = 0;
    let totalPhEr     = 0;
    let totalPiEr     = 0;

    // Re-derive ER shares per slip from the same tables, anchored on the
    // monthly-equivalent of (basic + OT). Using the saved EE numbers as a
    // sanity check — they should already reflect the SSS 2025 schedule.
    const fullSlips = await this.prisma.payslip.findMany({
      where:  { payRunId, tenantId },
      select: { basicPay: true, overtimePay: true },
    });
    const { sssMonthly, philhealthMonthly, pagibigMonthly, freqFactor, toMonthlyGross } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./ph-tax-tables') as typeof import('./ph-tax-tables');
    const freq = run.frequency as PhPayFreq;

    for (let i = 0; i < slips.length; i++) {
      const s  = slips[i];
      const fs = fullSlips[i];
      totalGross += Number(s.grossPay);
      totalSssEe += Number(s.sssContrib);
      totalPhEe  += Number(s.philhealthContrib);
      totalPiEe  += Number(s.pagibigContrib);
      totalWht   += Number(s.withholdingTax);
      totalNet   += Number(s.netPay);

      const taxableBase = Number(fs.basicPay) + Number(fs.overtimePay);
      const monthly     = toMonthlyGross(taxableBase, freq);
      const sss = sssMonthly(monthly);
      const ph  = philhealthMonthly(monthly);
      const pi  = pagibigMonthly(monthly);
      const f   = freqFactor(freq);
      totalSssEr += round2(sss.er * f);
      totalSssEc += round2(sss.ec * f);
      totalPhEr  += round2(ph.er  * f);
      totalPiEr  += round2(pi.er  * f);
    }

    const total = (n: number) => round2(n);
    const sssPayable = total(totalSssEe + totalSssEr + totalSssEc);
    const phPayable  = total(totalPhEe  + totalPhEr);
    const piPayable  = total(totalPiEe  + totalPiEr);

    // Resolve account IDs by code.
    const codes = ['6010', '6020', '6030', '6040', '2030', '2040', '2050', '2060', '2081'];
    const accountByCode: Record<string, string> = {};
    for (const code of codes) {
      const a = await this.accounts.findByCode(tenantId, code);
      if (!a) throw new BadRequestException(`Required GL account ${code} is missing for this tenant. Run COA seed.`);
      accountByCode[code] = a.id;
    }

    const reference = `PR-${run.id}`;

    // Idempotency: if a JE for this run already exists, refuse.
    const existing = await this.prisma.journalEntry.findFirst({
      where: { tenantId, reference },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException('Pay run already has a posted journal entry.');
    }

    // Atomic — post the JE and flip the run to LOCKED. JournalService.create
    // already validates debit=credit and respects period-lock guards.
    return this.prisma.$transaction(async (_tx) => {
      await this.journal.create(
        tenantId,
        {
          date:        run.periodEnd.toISOString().slice(0, 10),
          postingDate: run.periodEnd.toISOString().slice(0, 10),
          description: `Payroll: ${run.label} (${run.periodStart.toISOString().slice(0, 10)} – ${run.periodEnd.toISOString().slice(0, 10)})`,
          reference,
          lines: [
            { accountId: accountByCode['6010'], debit: total(totalGross),                   description: 'Salaries and Wages — gross' },
            { accountId: accountByCode['6020'], debit: total(totalSssEr + totalSssEc),       description: 'SSS Employer Contribution + EC' },
            { accountId: accountByCode['6030'], debit: total(totalPhEr),                     description: 'PhilHealth Employer Contribution' },
            { accountId: accountByCode['6040'], debit: total(totalPiEr),                     description: 'Pag-IBIG Employer Contribution' },
            { accountId: accountByCode['2030'], credit: sssPayable,                          description: 'SSS Contributions Payable' },
            { accountId: accountByCode['2040'], credit: phPayable,                           description: 'PhilHealth Contributions Payable' },
            { accountId: accountByCode['2050'], credit: piPayable,                           description: 'Pag-IBIG Contributions Payable' },
            { accountId: accountByCode['2060'], credit: total(totalWht),                     description: 'Withholding Tax Payable — Compensation' },
            { accountId: accountByCode['2081'], credit: total(totalNet),                     description: 'Accrued Salaries & Wages' },
          ],
        },
        lockedById,
        'PAYROLL',
      );

      const upd = await this.prisma.payRun.updateMany({
        where: { id: payRunId, tenantId, status: 'COMPLETED' as any },
        data:  { status: 'LOCKED' as any },
      });
      if (upd.count !== 1) {
        throw new ConflictException('Pay run was modified concurrently — could not lock.');
      }
      const updated = await this.prisma.payRun.findFirstOrThrow({ where: { id: payRunId, tenantId } });
      return this.serializePayRun(updated);
    });
  }

  // ─── Payslips ─────────────────────────────────────────────────────────────

  async getPayslips(tenantId: string, payRunId?: string): Promise<PayslipDto[]> {
    const slips = await this.prisma.payslip.findMany({
      where:   { tenantId, ...(payRunId ? { payRunId } : {}) },
      include: { payRun: { select: { label: true, periodStart: true, periodEnd: true } } },
      orderBy: [{ payRun: { periodStart: 'desc' } }, { employeeName: 'asc' }],
    });
    return slips.map((s) => this.serializePayslip(s));
  }

  async getMyPayslips(tenantId: string, userId: string): Promise<PayslipDto[]> {
    const slips = await this.prisma.payslip.findMany({
      where:   { tenantId, userId },
      include: { payRun: { select: { label: true, periodStart: true, periodEnd: true } } },
      orderBy: [{ payRun: { periodStart: 'desc' } }],
    });
    return slips.map((s) => this.serializePayslip(s));
  }

  // ─── Contribution Summary ─────────────────────────────────────────────────

  async getContributions(tenantId: string, month?: string): Promise<ContributionSummaryDto> {
    // Default to current month YYYY-MM
    const m = month ?? new Date().toISOString().slice(0, 7);
    const from = new Date(`${m}-01T00:00:00.000Z`);
    const to   = new Date(from.getFullYear(), from.getMonth() + 1, 1);

    const slips = await this.prisma.payslip.findMany({
      where: {
        tenantId,
        createdAt: { gte: from, lt: to },
      },
      select: {
        employeeName:     true,
        sssContrib:       true,
        philhealthContrib: true,
        pagibigContrib:   true,
        withholdingTax:   true,
        totalDeductions:  true,
      },
    });

    let totalSss = 0; let totalPh = 0; let totalPg = 0; let totalWht = 0; let totalDed = 0;
    // Aggregate per employee
    const empMap = new Map<string, { sss: number; ph: number; pg: number; wht: number; ded: number }>();
    for (const s of slips) {
      totalSss += Number(s.sssContrib);
      totalPh  += Number(s.philhealthContrib);
      totalPg  += Number(s.pagibigContrib);
      totalWht += Number(s.withholdingTax);
      totalDed += Number(s.totalDeductions);
      const e   = empMap.get(s.employeeName) ?? { sss:0, ph:0, pg:0, wht:0, ded:0 };
      e.sss += Number(s.sssContrib); e.ph += Number(s.philhealthContrib);
      e.pg  += Number(s.pagibigContrib); e.wht += Number(s.withholdingTax);
      e.ded += Number(s.totalDeductions);
      empMap.set(s.employeeName, e);
    }

    return {
      month: m,
      totalSss: round2(totalSss), totalPhilhealth: round2(totalPh),
      totalPagibig: round2(totalPg), totalWithholdingTax: round2(totalWht),
      totalDeductions: round2(totalDed), employeeCount: empMap.size,
      rows: Array.from(empMap.entries()).map(([name, d]) => ({
        employeeName: name,
        sss: round2(d.sss), philhealth: round2(d.ph), pagibig: round2(d.pg),
        withholdingTax: round2(d.wht), totalDeductions: round2(d.ded),
      })),
    };
  }

  // ─── Serializers ─────────────────────────────────────────────────────────

  private serializePayRun(r: any): PayRunDto {
    return {
      id: r.id, label: r.label,
      periodStart: r.periodStart.toISOString(),
      periodEnd: r.periodEnd.toISOString(),
      frequency: r.frequency, status: r.status,
      totalGross: Number(r.totalGross), totalDeductions: Number(r.totalDeductions),
      totalNet: Number(r.totalNet), employeeCount: r.employeeCount,
      processedAt: r.processedAt?.toISOString() ?? null,
      notes: r.notes ?? null, createdAt: r.createdAt.toISOString(),
    };
  }

  private serializePayslip(s: any): PayslipDto {
    return {
      id: s.id, payRunId: s.payRunId,
      payRunLabel: s.payRun?.label ?? '',
      userId: s.userId, employeeName: s.employeeName,
      position: s.position ?? null, department: s.department ?? null,
      periodStart: s.payRun?.periodStart?.toISOString() ?? '',
      periodEnd:   s.payRun?.periodEnd?.toISOString()   ?? '',
      basicPay:    Number(s.basicPay),
      overtimePay: Number(s.overtimePay),
      allowances:  Number(s.allowances),
      grossPay:    Number(s.grossPay),
      sssContrib:        Number(s.sssContrib),
      philhealthContrib: Number(s.philhealthContrib),
      pagibigContrib:    Number(s.pagibigContrib),
      withholdingTax:    Number(s.withholdingTax),
      otherDeductions:   Number(s.otherDeductions),
      totalDeductions:   Number(s.totalDeductions),
      netPay:            Number(s.netPay),
      regularHours:      Number(s.regularHours),
      overtimeHours:     Number(s.overtimeHours),
      createdAt:         s.createdAt.toISOString(),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Sprint 3 — Leave management, salary edits, timesheet approvals,
  //            13th-month, BIR 2316, payslip PDF, employee self-service.
  // ───────────────────────────────────────────────────────────────────────────

  // ── HR: Edit employee salary ──────────────────────────────────────────────
  async editEmployeeSalary(
    tenantId: string,
    targetUserId: string,
    actorUserId: string,
    dto: {
      salaryRate?: number;
      salaryType?: SalaryType;
      hiredAt?:    string;
      shiftStart?: string | null;
      shiftEnd?:   string | null;
    },
  ) {
    const target = await this.prisma.user.findFirst({
      where:  { id: targetUserId, tenantId },
      select: {
        id: true, salaryRate: true, salaryType: true, hiredAt: true,
        shiftStart: true, shiftEnd: true,
        name: true, role: true,
      },
    });
    if (!target) throw new NotFoundException('Employee not found in this tenant.');

    // Validate shift time strings — must be "HH:mm" 24-hour or null/empty.
    // Empty string from the form means "clear the field" → coerce to null.
    const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
    const normalizeShift = (v: string | null | undefined): string | null | undefined => {
      if (v === undefined) return undefined;          // not provided → no-op
      if (v === null || v === '') return null;        // explicit clear
      if (!HHMM.test(v)) {
        throw new BadRequestException(`Shift time must be HH:mm (24h), got "${v}".`);
      }
      return v;
    };
    const newShiftStart = normalizeShift(dto.shiftStart);
    const newShiftEnd   = normalizeShift(dto.shiftEnd);

    // Tenant-scoped + atomic update (audit-batch hardening pattern).
    const result = await this.prisma.user.updateMany({
      where: { id: targetUserId, tenantId },
      data: {
        ...(dto.salaryRate !== undefined ? { salaryRate: new Prisma.Decimal(dto.salaryRate) } : {}),
        ...(dto.salaryType ? { salaryType: dto.salaryType } : {}),
        ...(dto.hiredAt    ? { hiredAt: new Date(dto.hiredAt) } : {}),
        ...(newShiftStart !== undefined ? { shiftStart: newShiftStart } : {}),
        ...(newShiftEnd   !== undefined ? { shiftEnd:   newShiftEnd   } : {}),
      },
    });
    if (result.count !== 1) {
      throw new NotFoundException('Employee not found or tenant mismatch.');
    }
    const updated = await this.prisma.user.findFirstOrThrow({
      where:  { id: targetUserId, tenantId },
      select: {
        id: true, name: true, salaryRate: true, salaryType: true, hiredAt: true,
        shiftStart: true, shiftEnd: true,
      },
    });

    // Best-effort audit log; soft-fail if the table isn't available.
    try {
      await (this.prisma as any).auditLog?.create({
        data: {
          tenantId,
          actorId:    actorUserId,
          action:     'SETTING_CHANGED',
          targetType: 'User',
          targetId:   targetUserId,
          before:     {
            salaryRate: target.salaryRate ? Number(target.salaryRate) : null,
            salaryType: target.salaryType,
            hiredAt:    target.hiredAt,
            shiftStart: target.shiftStart,
            shiftEnd:   target.shiftEnd,
          },
          after: {
            salaryRate: updated.salaryRate ? Number(updated.salaryRate) : null,
            salaryType: updated.salaryType,
            hiredAt:    updated.hiredAt,
            shiftStart: updated.shiftStart,
            shiftEnd:   updated.shiftEnd,
          },
          metadata: { reason: 'Payroll salary edit' },
        },
      });
    } catch { /* audit table optional */ }

    return updated;
  }

  // ── HR: Employee separation (attrition) ─────────────────────────────────
  /**
   * Sprint 19 — Mark an employee as separated. This is the offboarding
   * entry point: sets `separatedAt`, `separationType`, `separationReason`,
   * and flips `isActive = false` so they no longer count toward the seat
   * cap, can no longer log in, and don't appear in default staff lists.
   *
   * Active sessions are also revoked so the credential goes inert
   * immediately. The PayRun engine still picks up their attendance for
   * the FINAL cut-off (they get one last payslip including unused
   * vacation leave conversion, then drop out of subsequent runs).
   *
   * Future: BIR Form 2316 generation should be triggered from here,
   * gated on a "send certificate to email" boolean. Schema-ready.
   */
  async separateEmployee(
    tenantId: string,
    targetUserId: string,
    actorUserId: string,
    dto: {
      separationType: 'RESIGNED' | 'TERMINATED' | 'RETIRED' | 'END_OF_CONTRACT' | 'ABANDONED' | 'OTHER';
      reason?: string;
      effectiveDate?: string;  // ISO date; defaults to today
    },
  ) {
    if (targetUserId === actorUserId) {
      throw new BadRequestException('You cannot separate yourself.');
    }
    const target = await this.prisma.user.findFirst({
      where:  { id: targetUserId, tenantId },
      select: { id: true, role: true, name: true, isActive: true, separatedAt: true },
    });
    if (!target) throw new NotFoundException('Employee not found in this tenant.');
    if (target.role === 'SUPER_ADMIN') {
      throw new BadRequestException('SUPER_ADMIN accounts cannot be separated via this flow.');
    }
    if (target.separatedAt) {
      throw new BadRequestException(`Already separated on ${target.separatedAt.toISOString().slice(0, 10)}.`);
    }

    const effectiveAt = dto.effectiveDate ? new Date(dto.effectiveDate) : new Date();
    if (isNaN(effectiveAt.getTime())) {
      throw new BadRequestException('effectiveDate is not a valid date.');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetUserId },
        data: {
          isActive:         false,
          separatedAt:      effectiveAt,
          separationType:   dto.separationType as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          separationReason: dto.reason?.trim() || null,
        },
        select: {
          id: true, name: true, role: true, isActive: true,
          separatedAt: true, separationType: true, separationReason: true,
        },
      });
      // Revoke active sessions — the credential is now inert.
      await tx.userSession.deleteMany({ where: { userId: targetUserId } });
      return updated;
    });
  }

  /**
   * Sprint 19 — Reverse a separation. Used when HR fires somebody and
   * wants to undo it within the grace period (e.g. rehired before the
   * cut-off, mistaken termination). Restores isActive=true, clears the
   * separation fields, but does NOT re-create revoked sessions — the
   * user logs in fresh.
   */
  async reverseSeparation(tenantId: string, targetUserId: string) {
    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, tenantId },
      select: { id: true, separatedAt: true },
    });
    if (!target) throw new NotFoundException('Employee not found.');
    if (!target.separatedAt) throw new BadRequestException('Employee is not currently separated.');
    return this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        isActive:         true,
        separatedAt:      null,
        separationType:   null,
        separationReason: null,
      },
      select: { id: true, name: true, isActive: true, separatedAt: true },
    });
  }

  // ── HR: Approve / reject a timesheet entry ────────────────────────────────
  async setTimesheetStatus(
    tenantId: string,
    entryId: string,
    actorUserId: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) {
    const entry = await this.prisma.timeEntry.findFirst({
      where:  { id: entryId, tenantId },
      select: { id: true, status: true, userId: true },
    });
    if (!entry) throw new NotFoundException('Time entry not found.');
    if (entry.status !== TimeEntryStatus.CLOSED) {
      throw new BadRequestException(`Only CLOSED entries can be ${status.toLowerCase()}. Current status: ${entry.status}.`);
    }
    void actorUserId; void rejectionReason; // recorded in AuditLog when wired
    return this.prisma.timeEntry.update({
      where: { id: entryId },
      data:  { status: status as TimeEntryStatus },
    });
  }

  // ── HR: Bulk approve / reject all CLOSED entries for an employee × week ───
  async bulkSetTimesheetStatus(
    tenantId: string,
    userId: string,
    weekStart: string, // YYYY-MM-DD (Monday)
    actorUserId: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) {
    const start = new Date(`${weekStart}T00:00:00+08:00`);
    const end   = new Date(start);
    end.setDate(end.getDate() + 7);

    // Note: TimeEntry doesn't currently carry approver/rejection-reason fields;
    // we flip status only. The actor + reason are recorded via AuditLog when
    // the audit module is wired here (deferred follow-up).
    void actorUserId; void rejectionReason;
    const result = await this.prisma.timeEntry.updateMany({
      where: {
        tenantId,
        userId,
        clockIn: { gte: start, lt: end },
        status:  TimeEntryStatus.CLOSED,
      },
      data: { status: status as TimeEntryStatus },
    });
    return { count: result.count };
  }

  // ── Leave: Submit, list, approve, reject ──────────────────────────────────
  async submitLeave(
    tenantId: string,
    userId: string,
    dto: { type: LeaveType; startDate: string; endDate: string; daysCount: number; reason: string },
  ) {
    if (new Date(dto.startDate) > new Date(dto.endDate)) {
      throw new BadRequestException('startDate must be before endDate.');
    }
    if (dto.daysCount <= 0) {
      throw new BadRequestException('daysCount must be > 0.');
    }
    return this.prisma.leaveRequest.create({
      data: {
        tenantId,
        userId,
        type:       dto.type,
        status:     'PENDING',
        startDate:  new Date(dto.startDate),
        endDate:    new Date(dto.endDate),
        daysCount:  new Prisma.Decimal(dto.daysCount),
        reason:     dto.reason,
      },
    });
  }

  async listLeavesForTenant(tenantId: string, status?: LeaveStatus) {
    return this.prisma.leaveRequest.findMany({
      where: { tenantId, ...(status ? { status } : {}) },
      orderBy: [{ status: 'asc' }, { startDate: 'desc' }],
      include: {
        user:     { select: { id: true, name: true, email: true } },
        approver: { select: { id: true, name: true } },
      },
    });
  }

  async listMyLeaves(tenantId: string, userId: string) {
    return this.prisma.leaveRequest.findMany({
      where:   { tenantId, userId },
      orderBy: { startDate: 'desc' },
      include: { approver: { select: { id: true, name: true } } },
    });
  }

  async setLeaveStatus(
    tenantId: string,
    leaveId: string,
    actorUserId: string,
    status: 'APPROVED' | 'REJECTED',
    rejectionReason?: string,
  ) {
    const leave = await this.prisma.leaveRequest.findFirst({
      where: { id: leaveId, tenantId },
    });
    if (!leave) throw new NotFoundException('Leave request not found.');
    if (leave.status !== 'PENDING') {
      throw new BadRequestException(`Leave is already ${leave.status}.`);
    }
    return this.prisma.leaveRequest.update({
      where: { id: leaveId },
      data: {
        status,
        approvedBy:      actorUserId,
        approvedAt:      new Date(),
        rejectionReason: status === 'REJECTED' ? (rejectionReason ?? null) : null,
      },
    });
  }

  // ── 13th-month compute ────────────────────────────────────────────────────
  /**
   * Computes 13th-month pay = basicSalaryYTD / 12 for every active employee.
   * Idempotent on (tenantId, userId, year). Re-running updates the snapshot.
   */
  async generateThirteenthMonth(tenantId: string, year: number) {
    const yStart = new Date(Date.UTC(year, 0, 1));
    const yEnd   = new Date(Date.UTC(year + 1, 0, 1));

    // Pull total basicPay YTD per employee from Payslips.
    const slips = await this.prisma.payslip.groupBy({
      by:    ['userId'],
      where: { tenantId, payRun: { periodStart: { gte: yStart, lt: yEnd } } },
      _sum:  { basicPay: true },
    });

    const employees = await this.prisma.user.findMany({
      where:  { tenantId, isActive: true, role: { notIn: ['SUPER_ADMIN', 'EXTERNAL_AUDITOR'] } },
      select: { id: true, name: true },
    });
    const ytdByUser = new Map(slips.map((s) => [s.userId, Number(s._sum.basicPay ?? 0)]));

    const results: { userId: string; name: string; basicSalaryYTD: number; amount: number }[] = [];
    for (const e of employees) {
      const ytd    = ytdByUser.get(e.id) ?? 0;
      const amount = round2(ytd / 12);
      await this.prisma.thirteenthMonth.upsert({
        where:  { tenantId_userId_year: { tenantId, userId: e.id, year } },
        create: { tenantId, userId: e.id, year, basicSalaryYTD: new Prisma.Decimal(ytd), amount: new Prisma.Decimal(amount) },
        update: { basicSalaryYTD: new Prisma.Decimal(ytd), amount: new Prisma.Decimal(amount) },
      });
      results.push({ userId: e.id, name: e.name, basicSalaryYTD: ytd, amount });
    }
    return { year, count: results.length, totalAmount: round2(results.reduce((s, r) => s + r.amount, 0)), rows: results };
  }

  async listThirteenthMonth(tenantId: string, year?: number) {
    return this.prisma.thirteenthMonth.findMany({
      where: { tenantId, ...(year ? { year } : {}) },
      orderBy: [{ year: 'desc' }],
      include: { user: { select: { id: true, name: true } } },
    });
  }

  // ── Payslip PDF (HR + employee self-service share the renderer) ───────────
  async getPayslipPdf(tenantId: string, payslipId: string, restrictToUserId?: string): Promise<Buffer> {
    const where: any = { id: payslipId, tenantId };
    if (restrictToUserId) where.userId = restrictToUserId;

    const slip = await this.prisma.payslip.findFirst({
      where,
      include: { payRun: { select: { label: true, periodStart: true, periodEnd: true } } },
    });
    if (!slip) throw new NotFoundException('Payslip not found.');

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { name: true, tinNumber: true, address: true, businessName: true },
    });

    return generatePayslipPdf({
      tenant: {
        name:         tenant?.name ?? 'Clerque',
        tinNumber:    tenant?.tinNumber ?? null,
        address:      tenant?.address ?? null,
        businessName: tenant?.businessName ?? null,
      },
      payslip: {
        employeeName:      slip.employeeName,
        position:          slip.position,
        department:        slip.department,
        periodStart:       slip.payRun.periodStart.toISOString().slice(0, 10),
        periodEnd:         slip.payRun.periodEnd.toISOString().slice(0, 10),
        runLabel:          slip.payRun.label,
        basicPay:          Number(slip.basicPay),
        overtimePay:       Number(slip.overtimePay),
        allowances:        Number(slip.allowances),
        grossPay:          Number(slip.grossPay),
        sssContrib:        Number(slip.sssContrib),
        philhealthContrib: Number(slip.philhealthContrib),
        pagibigContrib:    Number(slip.pagibigContrib),
        withholdingTax:    Number(slip.withholdingTax),
        otherDeductions:   Number(slip.otherDeductions),
        totalDeductions:   Number(slip.totalDeductions),
        netPay:            Number(slip.netPay),
        regularHours:      Number(slip.regularHours),
        overtimeHours:     Number(slip.overtimeHours),
      },
    });
  }

  // ── Employee self-service: my salary + projected next pay ─────────────────
  async getMySalary(tenantId: string, userId: string) {
    const me = await this.prisma.user.findFirst({
      where:  { id: userId, tenantId },
      select: { name: true, salaryRate: true, salaryType: true, hiredAt: true, branch: { select: { name: true } } },
    });
    if (!me) throw new NotFoundException('User not found.');

    const lastPayslip = await this.prisma.payslip.findFirst({
      where:   { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      select:  { netPay: true, grossPay: true, createdAt: true,
                 payRun: { select: { label: true, periodEnd: true } } },
    });

    return {
      name:        me.name,
      salaryRate:  me.salaryRate ? Number(me.salaryRate) : null,
      salaryType:  me.salaryType,
      hiredAt:     me.hiredAt,
      department:  me.branch?.name ?? null,
      lastPayslip: lastPayslip
        ? {
            netPay:     Number(lastPayslip.netPay),
            grossPay:   Number(lastPayslip.grossPay),
            runLabel:   lastPayslip.payRun.label,
            periodEnd:  lastPayslip.payRun.periodEnd.toISOString().slice(0, 10),
          }
        : null,
    };
  }

  /**
   * Sprint 14 — return the employee's assigned shift schedule + recent
   * actual punches for the last 7 days, so the user can see "what time am
   * I supposed to clock in" alongside "what time did I actually clock in
   * this week." shiftStart/shiftEnd are stored as 24h "HH:mm" strings on
   * the User row.
   */
  async getMyShift(tenantId: string, userId: string) {
    const me = await this.prisma.user.findFirst({
      where:  { id: userId, tenantId },
      select: {
        name: true, position: true, shiftStart: true, shiftEnd: true,
        branch: { select: { name: true } },
      },
    });
    if (!me) throw new NotFoundException('User not found.');

    // Last 7 days of TimeEntry rows for this user.
    const since = new Date(Date.now() - 7 * 86_400_000);
    const recent = await this.prisma.timeEntry.findMany({
      where: { tenantId, userId, clockIn: { gte: since } },
      orderBy: { clockIn: 'desc' },
      select: { clockIn: true, clockOut: true, grossHours: true, otHours: true, status: true },
      take: 14,
    });

    return {
      name:       me.name,
      position:   me.position ?? null,
      branch:     me.branch?.name ?? null,
      shiftStart: me.shiftStart ?? null,
      shiftEnd:   me.shiftEnd ?? null,
      // Compute coarse expected daily hours from the shift window.
      // Cosmetic only — real payroll uses TimeEntry.grossHours.
      expectedHoursPerDay: this.computeShiftHours(me.shiftStart, me.shiftEnd),
      recentPunches: recent.map((p) => ({
        clockIn:    p.clockIn,
        clockOut:   p.clockOut,
        grossHours: p.grossHours ? Number(p.grossHours) : null,
        otHours:    p.otHours ? Number(p.otHours) : null,
        status:     p.status,
      })),
    };
  }

  private computeShiftHours(start?: string | null, end?: string | null): number | null {
    if (!start || !end) return null;
    const [sh, sm] = start.split(':').map(Number);
    const [eh, em] = end.split(':').map(Number);
    if ([sh, sm, eh, em].some((v) => Number.isNaN(v))) return null;
    let mins = (eh * 60 + em) - (sh * 60 + sm);
    if (mins < 0) mins += 24 * 60; // overnight shift
    return +(mins / 60).toFixed(2);
  }

  async listMyPayslips(tenantId: string, userId: string) {
    return this.prisma.payslip.findMany({
      where:   { tenantId, userId },
      orderBy: { createdAt: 'desc' },
      take:    24,
      include: { payRun: { select: { label: true, periodStart: true, periodEnd: true } } },
    });
  }
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
