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
    /*
      Closing refuses while anything from the period is still queued for the
      books — otherwise those entries are locked out permanently and the books
      end up short with a trial balance that still foots. Zero here means the
      queue is drained, which is the normal case these cases describe.
    */
    accountingEvent: { count: jest.fn().mockResolvedValue(0) },
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

  describe('closing over transactions that have not posted yet', () => {
    /*
      Sales reach the books through a queue drained by a cron, so there is
      always a short window where a sale exists and its journal entry does not.
      Closing during that window locked the period against entries already on
      their way: the queue then hit the period lock and failed permanently, the
      books were short by exactly those sales, and the trial balance still
      footed.

      It got worse once failed events began retrying automatically — a period
      closed over a pending sale produces an event that fails every ten
      minutes forever.
    */
    const PERIOD = { id: 'p1', tenantId: 't1', name: 'August 2026', status: 'OPEN', endDate: new Date('2026-08-31') };

    it('refuses while transactions are still queued', async () => {
      const prisma = makePrismaMock();
      prisma.accountingPeriod.findFirst.mockResolvedValue(PERIOD);
      prisma.accountingEvent.count.mockResolvedValue(3);
      const svc = new AccountingPeriodsService(prisma as never, { log: jest.fn() } as never);
      await expect(svc.closePeriod('t1', 'p1', 'u1')).rejects.toThrow(/have not reached the books/);
    });

    it('says how many, and what to do about it', async () => {
      const prisma = makePrismaMock();
      prisma.accountingPeriod.findFirst.mockResolvedValue(PERIOD);
      prisma.accountingEvent.count.mockResolvedValue(1);
      const svc = new AccountingPeriodsService(prisma as never, { log: jest.fn() } as never);
      await expect(svc.closePeriod('t1', 'p1', 'u1'))
        .rejects.toThrow(/1 transaction .*has not reached.*try again shortly/s);
    });

    it('does not close the period when it refuses', async () => {
      const prisma = makePrismaMock();
      prisma.accountingPeriod.findFirst.mockResolvedValue(PERIOD);
      prisma.accountingEvent.count.mockResolvedValue(2);
      const svc = new AccountingPeriodsService(prisma as never, { log: jest.fn() } as never);
      await svc.closePeriod('t1', 'p1', 'u1').catch(() => undefined);
      expect(prisma.accountingPeriod.update).not.toHaveBeenCalled();
    });

    it('counts FAILED as well as PENDING', async () => {
      // A failed event is no more able to post after the lock than a pending
      // one, and it is the louder problem of the two.
      const prisma = makePrismaMock();
      prisma.accountingPeriod.findFirst.mockResolvedValue(PERIOD);
      const svc = new AccountingPeriodsService(prisma as never, { log: jest.fn() } as never);
      await svc.closePeriod('t1', 'p1', 'u1').catch(() => undefined);
      expect(prisma.accountingEvent.count.mock.calls[0][0].where.status)
        .toEqual({ in: ['PENDING', 'FAILED'] });
    });

    it('closes normally once the queue is drained', async () => {
      const prisma = makePrismaMock();
      prisma.accountingPeriod.findFirst.mockResolvedValue(PERIOD);
      prisma.accountingPeriod.update.mockResolvedValue({ ...PERIOD, status: 'CLOSED' });
      const svc = new AccountingPeriodsService(prisma as never, { log: jest.fn() } as never);
      await expect(svc.closePeriod('t1', 'p1', 'u1')).resolves.toMatchObject({ status: 'CLOSED' });
    });
  });
});
