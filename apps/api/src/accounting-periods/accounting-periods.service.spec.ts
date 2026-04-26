import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountingPeriodsService } from './accounting-periods.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

// ─── Minimal Prisma mock factory ───────────────────────────────────────────

function makePrismaMock() {
  return {
    accountingPeriod: {
      findMany:  jest.fn(),
      findFirst: jest.fn(),
      create:    jest.fn(),
      update:    jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
  };
}

function makeAuditMock() {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

describe('AccountingPeriodsService', () => {
  let svc:   AccountingPeriodsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let audit:  ReturnType<typeof makeAuditMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    audit  = makeAuditMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountingPeriodsService,
        { provide: PrismaService,  useValue: prisma },
        { provide: AuditService,   useValue: audit  },
      ],
    }).compile();

    svc = module.get(AccountingPeriodsService);
  });

  // ─── assertDateIsOpen ─────────────────────────────────────────────────────

  describe('assertDateIsOpen()', () => {
    it('does not throw when the date falls in no closed period', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue(null);
      await expect(
        svc.assertDateIsOpen('tenant-1', new Date('2026-04-15')),
      ).resolves.toBeUndefined();
    });

    it('throws ForbiddenException when date lands in a CLOSED period', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1',
        name: 'March 2026',
        status: 'CLOSED',
      });
      await expect(
        svc.assertDateIsOpen('tenant-1', new Date('2026-03-15')),
      ).rejects.toThrow(ForbiddenException);
    });

    it('error message includes the closed period name', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1',
        name: 'March 2026',
        status: 'CLOSED',
      });
      await expect(
        svc.assertDateIsOpen('tenant-1', new Date('2026-03-15')),
      ).rejects.toThrow(/March 2026/);
    });

    it('queries with CLOSED status + date range filter', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue(null);
      const date = new Date('2026-04-15');
      await svc.assertDateIsOpen('tenant-1', date);
      expect(prisma.accountingPeriod.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: 'tenant-1',
            status: 'CLOSED',
            startDate: { lte: date },
            endDate: { gte: date },
          }),
        }),
      );
    });
  });

  // ─── create ──────────────────────────────────────────────────────────────

  describe('create()', () => {
    it('throws BadRequestException when endDate <= startDate', async () => {
      await expect(
        svc.create('tenant-1', {
          name: 'Bad Period',
          startDate: '2026-04-30',
          endDate: '2026-04-01',
          notes: undefined,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when period overlaps an existing one', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'existing-period',
        name: 'April 2026',
      });
      await expect(
        svc.create('tenant-1', {
          name: 'April 2026 duplicate',
          startDate: '2026-04-01',
          endDate: '2026-04-30',
          notes: undefined,
        }),
      ).rejects.toThrow(/overlaps/i);
    });

    it('creates a period when validation passes', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue(null);
      prisma.accountingPeriod.create.mockResolvedValue({ id: 'new-period' });

      const result = await svc.create('tenant-1', {
        name: 'May 2026',
        startDate: '2026-05-01',
        endDate: '2026-05-31',
        notes: undefined,
      });
      expect(result).toEqual({ id: 'new-period' });
      expect(prisma.accountingPeriod.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─── closePeriod ─────────────────────────────────────────────────────────

  describe('closePeriod()', () => {
    it('throws NotFoundException when period does not exist', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue(null);
      await expect(
        svc.closePeriod('tenant-1', 'no-such-period', 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when period is already CLOSED', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1',
        status: 'CLOSED',
        name: 'April 2026',
      });
      await expect(
        svc.closePeriod('tenant-1', 'period-1', 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates status to CLOSED and records closedById + closedAt', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1',
        status: 'OPEN',
        name: 'April 2026',
      });
      prisma.accountingPeriod.update.mockResolvedValue({
        id: 'period-1',
        status: 'CLOSED',
        closedAt: new Date(),
      });

      await svc.closePeriod('tenant-1', 'period-1', 'user-owner');

      expect(prisma.accountingPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'period-1' },
          data: expect.objectContaining({
            status: 'CLOSED',
            closedById: 'user-owner',
          }),
        }),
      );
    });

    it('fires an audit log after closing (fire-and-forget)', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1', status: 'OPEN', name: 'April 2026',
      });
      prisma.accountingPeriod.update.mockResolvedValue({
        id: 'period-1', status: 'CLOSED', closedAt: new Date(),
      });

      await svc.closePeriod('tenant-1', 'period-1', 'user-owner');
      expect(audit.log).toHaveBeenCalledTimes(1);
    });
  });

  // ─── reopenPeriod ─────────────────────────────────────────────────────────

  describe('reopenPeriod()', () => {
    it('throws BadRequestException when reason is empty', async () => {
      await expect(
        svc.reopenPeriod('tenant-1', 'period-1', 'user-1', '   '),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when period does not exist', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue(null);
      await expect(
        svc.reopenPeriod('tenant-1', 'no-such', 'user-1', 'Valid reason here'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when period is already OPEN', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1', status: 'OPEN', name: 'April 2026',
      });
      await expect(
        svc.reopenPeriod('tenant-1', 'period-1', 'user-1', 'Some reason'),
      ).rejects.toThrow(BadRequestException);
    });

    it('updates to OPEN and increments reopenCount', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1',
        status: 'CLOSED',
        name: 'April 2026',
        closedById: 'user-closer',
        closedAt: new Date('2026-05-01'),
      });
      prisma.accountingPeriod.update.mockResolvedValue({
        id: 'period-1', status: 'OPEN', reopenCount: 1,
      });

      await svc.reopenPeriod('tenant-1', 'period-1', 'user-owner', 'Payroll correction');

      expect(prisma.accountingPeriod.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'OPEN',
            reopenedById: 'user-owner',
            reopenReason: 'Payroll correction',
            reopenCount: { increment: 1 },
          }),
        }),
      );
    });

    it('preserves closedById on reopen (historical fact must not be nulled)', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1', status: 'CLOSED', name: 'April 2026',
        closedById: 'user-closer', closedAt: new Date('2026-05-01'),
      });
      prisma.accountingPeriod.update.mockResolvedValue({ id: 'period-1', status: 'OPEN', reopenCount: 1 });

      await svc.reopenPeriod('tenant-1', 'period-1', 'user-owner', 'Payroll correction');

      const updateCall = prisma.accountingPeriod.update.mock.calls[0][0];
      // closedById must NOT appear in the update data (it's left unchanged)
      expect(updateCall.data).not.toHaveProperty('closedById');
      expect(updateCall.data).not.toHaveProperty('closedAt');
    });

    it('fires an audit log after reopening', async () => {
      prisma.accountingPeriod.findFirst.mockResolvedValue({
        id: 'period-1', status: 'CLOSED', name: 'April 2026',
        closedById: 'user-closer', closedAt: new Date(),
      });
      prisma.accountingPeriod.update.mockResolvedValue({ id: 'period-1', status: 'OPEN', reopenCount: 1 });

      await svc.reopenPeriod('tenant-1', 'period-1', 'user-owner', 'Payroll correction');
      expect(audit.log).toHaveBeenCalledTimes(1);
    });
  });
});
