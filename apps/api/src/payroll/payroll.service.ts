import {
  Injectable,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, TimeEntryStatus } from '@prisma/client';

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

type PayFreq = 'WEEKLY' | 'SEMI_MONTHLY' | 'MONTHLY';

/** SSS 2024 — Employee contribution: 4% of Monthly Salary Credit (floored ₱4k, capped ₱30k) */
function computeSss(monthlyGross: number, freq: PayFreq): number {
  const msc = Math.max(4000, Math.min(30000, Math.ceil(monthlyGross / 500) * 500));
  const monthly = msc * 0.04; // 4% employee share
  const factor = freq === 'SEMI_MONTHLY' ? 0.5 : freq === 'WEEKLY' ? 7 / 30 : 1;
  return round2(monthly * factor);
}

/** PhilHealth 2024 — Employee contribution: 2.5% of salary (min ₱250, max ₱2,500/month) */
function computePhilHealth(monthlyGross: number, freq: PayFreq): number {
  const monthlyEmployee = Math.max(250, Math.min(monthlyGross * 0.025, 2500));
  const factor = freq === 'SEMI_MONTHLY' ? 0.5 : freq === 'WEEKLY' ? 7 / 30 : 1;
  return round2(monthlyEmployee * factor);
}

/** Pag-IBIG 2024 — Employee: 1% if salary ≤ ₱1,500; else 2% capped at ₱100/month */
function computePagibig(monthlyGross: number, freq: PayFreq): number {
  const monthlyEmployee = monthlyGross <= 1500 ? monthlyGross * 0.01 : Math.min(monthlyGross * 0.02, 100);
  const factor = freq === 'SEMI_MONTHLY' ? 0.5 : freq === 'WEEKLY' ? 7 / 30 : 1;
  return round2(monthlyEmployee * factor);
}

/** BIR TRAIN Law withholding tax — annualize period gross, compute annual bracket tax, pro-rate back */
function computeWithholdingTax(periodGross: number, freq: PayFreq): number {
  const periods = freq === 'SEMI_MONTHLY' ? 24 : freq === 'WEEKLY' ? 52 : 12;
  const annual = periodGross * periods;
  let annualTax = 0;
  if (annual <= 250_000) annualTax = 0;
  else if (annual <= 400_000) annualTax = (annual - 250_000) * 0.15;
  else if (annual <= 800_000) annualTax = 22_500 + (annual - 400_000) * 0.20;
  else if (annual <= 2_000_000) annualTax = 102_500 + (annual - 800_000) * 0.25;
  else if (annual <= 8_000_000) annualTax = 402_500 + (annual - 2_000_000) * 0.30;
  else annualTax = 2_202_500 + (annual - 8_000_000) * 0.35;
  return round2(annualTax / periods);
}

/** Compute basic pay for the period from salary info */
function computeBasicPay(
  rate: number | null, type: string | null,
  regularHours: number, freq: PayFreq,
): number {
  if (!rate || !type) return 0;
  if (type === 'HOURLY') return round2(rate * regularHours);
  if (type === 'DAILY')  return round2((rate / 8) * regularHours);
  // MONTHLY: prorate to period
  if (type === 'MONTHLY') {
    if (freq === 'SEMI_MONTHLY') return round2(rate / 2);
    if (freq === 'WEEKLY')       return round2(rate * 12 / 52);
    return round2(rate);
  }
  if (type === 'SEMI_MONTHLY') {
    if (freq === 'SEMI_MONTHLY') return round2(rate);
    if (freq === 'MONTHLY')      return round2(rate * 2);
    return round2(rate * 2 / (52 / 12));
  }
  return 0;
}

/** Normalize frequency to monthly equivalent for statutory contribution lookup */
function toMonthlyGross(periodGross: number, freq: PayFreq): number {
  if (freq === 'SEMI_MONTHLY') return periodGross * 2;
  if (freq === 'WEEKLY')       return round2(periodGross * (52 / 12));
  return periodGross;
}

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class PayrollService {
  constructor(private readonly prisma: PrismaService) {}

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

    // PH statutory deductions (SSS + PhilHealth + Pag-IBIG) — simplified flat percentages
    // These are rough MTD estimates; real payroll runs need lookup tables
    const deductionRate    = 0.09;  // ~9% combined employee share
    const totalDeductionsMtd = round2(totalGrossMtd * deductionRate);
    const totalNetMtd      = round2(totalGrossMtd - totalDeductionsMtd);

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
      // Already past EOM — next run is the 15th of next month
      const nextMonth = month + 2 > 12 ? 1 : month + 2;
      const nextYear  = month + 2 > 12 ? year + 1 : year;
      nextRunDate = `${nextYear}-${String(nextMonth).padStart(2,'0')}-15`;
    }

    return {
      activeEmployees,
      onLeaveToday:       0,            // Phase 2: leave management not yet implemented
      totalGrossMtd:      round2(totalGrossMtd),
      totalDeductionsMtd,
      totalNetMtd,
      completedRuns:      0,            // Phase 2: formal pay-run records not yet implemented
      pendingRuns:        0,
      nextRunDate,
      nextRunEmployees:   activeEmployees,
      averageGross,
      departmentBreakdown,
      recentRuns:         [],           // Phase 2
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
      const grossPay    = round2(basicPay + otPay);
      if (grossPay === 0) continue; // Skip employees with zero earnings

      const monthlyGross = toMonthlyGross(grossPay, freq);
      const sss          = computeSss(monthlyGross, freq);
      const philhealth   = computePhilHealth(monthlyGross, freq);
      const pagibig      = computePagibig(monthlyGross, freq);
      const wht          = computeWithholdingTax(grossPay, freq);
      const totalDed     = round2(sss + philhealth + pagibig + wht);
      const netPay       = round2(grossPay - totalDed);

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
        grossPay,
        sssContrib:        sss,
        philhealthContrib: philhealth,
        pagibigContrib:    pagibig,
        withholdingTax:    wht,
        otherDeductions:   0,
        totalDeductions:   totalDed,
        netPay,
        regularHours:      round2(hours.regular),
        overtimeHours:     round2(hours.ot),
      });

      totalGross      += grossPay;
      totalDeductions += totalDed;
      totalNet        += netPay;
    }

    // Atomically: delete old payslips (re-processing), insert new, update run status
    const updatedRun = await this.prisma.$transaction(async (tx) => {
      await tx.payslip.deleteMany({ where: { payRunId } });
      await tx.payslip.createMany({ data: payslipData });
      return tx.payRun.update({
        where: { id: payRunId },
        data: {
          status:        'COMPLETED' as any,
          totalGross:    round2(totalGross),
          totalDeductions: round2(totalDeductions),
          totalNet:      round2(totalNet),
          employeeCount: payslipData.length,
          processedAt:   new Date(),
          processedById,
        },
      });
    });

    return this.serializePayRun(updatedRun);
  }

  async cancelPayRun(payRunId: string, tenantId: string): Promise<PayRunDto> {
    const run = await this.prisma.payRun.findFirst({ where: { id: payRunId, tenantId } });
    if (!run) throw new NotFoundException('Pay run not found');
    if ((run.status as string) === 'COMPLETED') throw new BadRequestException('Completed pay runs cannot be cancelled');
    const updated = await this.prisma.payRun.update({
      where: { id: payRunId },
      data: { status: 'CANCELLED' as any },
    });
    return this.serializePayRun(updated);
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
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
