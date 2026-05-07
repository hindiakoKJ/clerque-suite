/**
 * Unit tests for the Sync (Payroll) module's critical methods:
 * - editEmployeeSalary (with audit log)
 * - setTimesheetStatus (approve / reject)
 * - submitLeave / setLeaveStatus (approve / reject)
 * - generateThirteenthMonth (idempotent compute)
 *
 * These were 0% covered before this spec. We mock Prisma with the minimum
 * surface needed for each path.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { PrismaService } from '../prisma/prisma.service';

const TENANT  = 'tenant-A';
const TARGET  = 'user-target';
const ACTOR   = 'user-actor';

function makePrismaMock() {
  return {
    user: {
      findFirst:  jest.fn(),
      update:     jest.fn(),
      findMany:   jest.fn().mockResolvedValue([]),
      count:      jest.fn().mockResolvedValue(0),
    },
    timeEntry: {
      findFirst:  jest.fn(),
      update:     jest.fn(),
      findMany:   jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    leaveRequest: {
      findFirst:  jest.fn(),
      findMany:   jest.fn().mockResolvedValue([]),
      create:     jest.fn(),
      update:     jest.fn(),
    },
    thirteenthMonth: {
      upsert:     jest.fn(),
      findMany:   jest.fn().mockResolvedValue([]),
    },
    payRun: {
      count:      jest.fn().mockResolvedValue(0),
      findMany:   jest.fn().mockResolvedValue([]),
    },
    payslip: {
      groupBy:    jest.fn().mockResolvedValue([]),
      aggregate:  jest.fn().mockResolvedValue({ _sum: { totalDeductions: null } }),
      findMany:   jest.fn().mockResolvedValue([]),
      findFirst:  jest.fn(),
    },
    auditLog: { create: jest.fn() },
    tenant:   { findUnique: jest.fn() },
  };
}

describe('PayrollService — Sprint 3 endpoints', () => {
  let svc:    PayrollService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayrollService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = module.get(PayrollService);
  });

  // ── editEmployeeSalary ────────────────────────────────────────────────────
  describe('editEmployeeSalary', () => {
    it('updates the user with provided fields', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: TARGET, name: 'Maria', role: 'CASHIER',
        salaryRate: 15000, salaryType: 'MONTHLY', hiredAt: null,
      });
      prisma.user.update.mockResolvedValue({
        id: TARGET, name: 'Maria',
        salaryRate: 18000, salaryType: 'MONTHLY', hiredAt: null,
      });

      const result = await svc.editEmployeeSalary(TENANT, TARGET, ACTOR, {
        salaryRate: 18000,
        salaryType: 'MONTHLY' as any,
      });

      expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: TARGET },
        data: expect.objectContaining({ salaryType: 'MONTHLY' }),
      }));
      expect(result.salaryRate).toBeDefined();
    });

    it('throws NotFoundException when target user not in tenant', async () => {
      prisma.user.findFirst.mockResolvedValue(null);
      await expect(svc.editEmployeeSalary(TENANT, TARGET, ACTOR, { salaryRate: 18000 }))
        .rejects.toThrow(NotFoundException);
    });

    it('attempts to write an audit log row (best-effort)', async () => {
      prisma.user.findFirst.mockResolvedValue({
        id: TARGET, name: 'Maria', role: 'CASHIER',
        salaryRate: 15000, salaryType: 'MONTHLY', hiredAt: null,
      });
      prisma.user.update.mockResolvedValue({
        id: TARGET, name: 'Maria',
        salaryRate: 18000, salaryType: 'MONTHLY', hiredAt: null,
      });

      await svc.editEmployeeSalary(TENANT, TARGET, ACTOR, { salaryRate: 18000 });
      // auditLog.create is best-effort; if available it's called
      // (in our mock it is, so verify the before/after payload shape)
      expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT, actorId: ACTOR, action: 'SETTING_CHANGED',
          targetType: 'User', targetId: TARGET,
        }),
      }));
    });
  });

  // ── setTimesheetStatus ────────────────────────────────────────────────────
  describe('setTimesheetStatus', () => {
    it('approves a CLOSED timesheet entry', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue({ id: 'te-1', status: 'CLOSED', userId: TARGET });
      prisma.timeEntry.update.mockResolvedValue({ id: 'te-1', status: 'APPROVED' });
      const result = await svc.setTimesheetStatus(TENANT, 'te-1', ACTOR, 'APPROVED');
      expect(prisma.timeEntry.update).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'te-1' },
        data:  { status: 'APPROVED' },
      }));
      expect(result.status).toBe('APPROVED');
    });

    it('rejects when entry is OPEN (not CLOSED)', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue({ id: 'te-1', status: 'OPEN', userId: TARGET });
      await expect(svc.setTimesheetStatus(TENANT, 'te-1', ACTOR, 'APPROVED'))
        .rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when entry not in tenant', async () => {
      prisma.timeEntry.findFirst.mockResolvedValue(null);
      await expect(svc.setTimesheetStatus(TENANT, 'te-1', ACTOR, 'APPROVED'))
        .rejects.toThrow(NotFoundException);
    });
  });

  // ── bulkSetTimesheetStatus ────────────────────────────────────────────────
  describe('bulkSetTimesheetStatus', () => {
    it('approves all CLOSED entries for an employee × week', async () => {
      prisma.timeEntry.updateMany.mockResolvedValue({ count: 5 });
      const result = await svc.bulkSetTimesheetStatus(TENANT, TARGET, '2026-05-04', ACTOR, 'APPROVED');
      expect(result).toEqual({ count: 5 });
      expect(prisma.timeEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT, userId: TARGET, status: 'CLOSED',
        }),
        data:  { status: 'APPROVED' },
      }));
    });
  });

  // ── submitLeave ───────────────────────────────────────────────────────────
  describe('submitLeave', () => {
    it('creates a PENDING leave request', async () => {
      prisma.leaveRequest.create.mockResolvedValue({ id: 'leave-1', status: 'PENDING' });
      const result = await svc.submitLeave(TENANT, TARGET, {
        type: 'VACATION' as any,
        startDate: '2026-05-10',
        endDate:   '2026-05-12',
        daysCount: 3,
        reason:    'Family trip',
      });
      expect(prisma.leaveRequest.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT, userId: TARGET, type: 'VACATION', status: 'PENDING',
        }),
      }));
      expect(result.status).toBe('PENDING');
    });

    it('rejects when startDate > endDate', async () => {
      await expect(svc.submitLeave(TENANT, TARGET, {
        type: 'VACATION' as any,
        startDate: '2026-05-12',
        endDate:   '2026-05-10', // earlier than start
        daysCount: 3,
        reason:    'oops',
      })).rejects.toThrow(BadRequestException);
    });

    it('rejects daysCount <= 0', async () => {
      await expect(svc.submitLeave(TENANT, TARGET, {
        type: 'VACATION' as any,
        startDate: '2026-05-10',
        endDate:   '2026-05-10',
        daysCount: 0,
        reason:    'no',
      })).rejects.toThrow(BadRequestException);
    });
  });

  // ── setLeaveStatus ────────────────────────────────────────────────────────
  describe('setLeaveStatus', () => {
    it('approves a PENDING leave', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'leave-1', status: 'PENDING' });
      prisma.leaveRequest.update.mockResolvedValue({ id: 'leave-1', status: 'APPROVED' });
      const result = await svc.setLeaveStatus(TENANT, 'leave-1', ACTOR, 'APPROVED');
      expect(result.status).toBe('APPROVED');
      expect(prisma.leaveRequest.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'APPROVED', approvedBy: ACTOR,
        }),
      }));
    });

    it('rejects re-approving an already-APPROVED leave', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'leave-1', status: 'APPROVED' });
      await expect(svc.setLeaveStatus(TENANT, 'leave-1', ACTOR, 'APPROVED'))
        .rejects.toThrow(BadRequestException);
    });

    it('records rejection reason when rejecting', async () => {
      prisma.leaveRequest.findFirst.mockResolvedValue({ id: 'leave-1', status: 'PENDING' });
      prisma.leaveRequest.update.mockResolvedValue({ id: 'leave-1', status: 'REJECTED' });
      await svc.setLeaveStatus(TENANT, 'leave-1', ACTOR, 'REJECTED', 'Cannot spare staff that week');
      expect(prisma.leaveRequest.update).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'REJECTED', rejectionReason: 'Cannot spare staff that week',
        }),
      }));
    });
  });

  // ── generateThirteenthMonth ──────────────────────────────────────────────
  describe('generateThirteenthMonth', () => {
    it('computes amount = basicSalaryYTD / 12 per employee', async () => {
      prisma.payslip.groupBy.mockResolvedValue([
        { userId: 'u1', _sum: { basicPay: 240_000 } },  // 240k YTD → 20k 13th-mo
        { userId: 'u2', _sum: { basicPay: 120_000 } },  // 120k YTD → 10k 13th-mo
      ]);
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1', name: 'Maria' },
        { id: 'u2', name: 'Jun' },
        { id: 'u3', name: 'NewHire' },  // no payslips → 0 YTD
      ]);
      prisma.thirteenthMonth.upsert.mockImplementation(async ({ create }: any) => create);

      const result = await svc.generateThirteenthMonth(TENANT, 2026);

      expect(result.year).toBe(2026);
      expect(result.count).toBe(3);  // 3 employees including the no-payslip one
      // Total = 20k + 10k + 0 = 30k
      expect(result.totalAmount).toBeCloseTo(30_000, 2);
      const u1 = result.rows.find((r: any) => r.userId === 'u1');
      expect(u1?.amount).toBeCloseTo(20_000, 2);
      const u3 = result.rows.find((r: any) => r.userId === 'u3');
      expect(u3?.amount).toBe(0);
    });

    it('is idempotent — re-running for same year upserts (no duplicates)', async () => {
      prisma.payslip.groupBy.mockResolvedValue([{ userId: 'u1', _sum: { basicPay: 120_000 } }]);
      prisma.user.findMany.mockResolvedValue([{ id: 'u1', name: 'Maria' }]);
      prisma.thirteenthMonth.upsert.mockImplementation(async ({ update }: any) => update);

      await svc.generateThirteenthMonth(TENANT, 2026);
      await svc.generateThirteenthMonth(TENANT, 2026);

      // upsert called twice; verify the where clause uses the unique compound key
      expect(prisma.thirteenthMonth.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: { tenantId_userId_year: { tenantId: TENANT, userId: 'u1', year: 2026 } },
      }));
    });
  });
});
