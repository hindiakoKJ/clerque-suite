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
}

// ─── Util ─────────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
