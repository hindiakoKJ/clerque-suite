import { NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';

/**
 * Ownership is established before the idempotency read.
 *
 * Both Z-Read and X-Read used to look up an existing record FIRST, keyed on
 * something the caller supplies (branchId+date, shiftId) with no tenant in the
 * predicate. Handing over another tenant's id returned their figures.
 *
 * The Z-Read case was worse than a read. On a date the victim had not closed
 * yet the lookup missed, execution fell through, and a ZReadLog was CREATED
 * carrying the caller's tenantId against the victim's branchId. The unique
 * constraint on (branchId, date) then made that row permanent squatter: the
 * victim could never generate their real Z-Read for that day, and a Z-Read is
 * a BIR record.
 */
describe('ReportsService — tenant isolation on Z-Read and X-Read', () => {
  const OURS   = 'tenant-ours';
  const THEIRS = 'tenant-theirs';

  function build(opts: { branchBelongsToCaller?: boolean; shiftBelongsToCaller?: boolean } = {}) {
    const prisma: any = {
      branch: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.branchBelongsToCaller && where.tenantId === OURS ? { id: where.id } : null,
          ),
        ),
      },
      shift: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            opts.shiftBelongsToCaller && where.tenantId === OURS ? { id: where.id } : null,
          ),
        ),
      },
      // If either of these is ever reached for a foreign id, the guard failed.
      zReadLog: { findUnique: jest.fn().mockResolvedValue({ id: 'their-zread', grossSales: 999999 }), create: jest.fn() },
      xReadLog: { findUnique: jest.fn().mockResolvedValue({ id: 'their-xread' }), create: jest.fn() },
      order:    { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new ReportsService(prisma) as any;
    return { svc, prisma };
  }

  describe('generateZRead', () => {
    it("refuses another tenant's branch instead of returning their Z-Read", async () => {
      const { svc } = build({ branchBelongsToCaller: false });
      await expect(svc.generateZRead(OURS, 'branch-of-' + THEIRS, '2026-08-30'))
        .rejects.toThrow(NotFoundException);
    });

    it('never reads the Z-Read table for a branch it does not own', async () => {
      // The read itself is the leak — reaching it at all means the guard is
      // in the wrong order again.
      const { svc, prisma } = build({ branchBelongsToCaller: false });
      await expect(svc.generateZRead(OURS, 'branch-of-' + THEIRS, '2026-08-30')).rejects.toThrow();
      expect(prisma.zReadLog.findUnique).not.toHaveBeenCalled();
    });

    it('never CREATES a row against a branch it does not own', async () => {
      // This is the squatter: a create here permanently occupies the victim's
      // (branchId, date) slot.
      const { svc, prisma } = build({ branchBelongsToCaller: false });
      await expect(svc.generateZRead(OURS, 'branch-of-' + THEIRS, '2026-08-30')).rejects.toThrow();
      expect(prisma.zReadLog.create).not.toHaveBeenCalled();
    });

    it('checks the branch against the CALLER tenant, not just any tenant', async () => {
      const { svc, prisma } = build({ branchBelongsToCaller: true });
      await svc.generateZRead(OURS, 'branch-1', '2026-08-30').catch(() => {});
      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ tenantId: OURS }) }),
      );
    });
  });

  describe('generateXRead', () => {
    it("refuses another tenant's shift instead of returning their totals", async () => {
      const { svc } = build({ shiftBelongsToCaller: false });
      await expect(svc.generateXRead(OURS, 'shift-of-' + THEIRS)).rejects.toThrow(NotFoundException);
    });

    it('never reads the X-Read table for a shift it does not own', async () => {
      const { svc, prisma } = build({ shiftBelongsToCaller: false });
      await expect(svc.generateXRead(OURS, 'shift-of-' + THEIRS)).rejects.toThrow();
      expect(prisma.xReadLog.findUnique).not.toHaveBeenCalled();
    });
  });
});
