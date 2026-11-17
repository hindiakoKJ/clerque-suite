import { ForbiddenException } from '@nestjs/common';
import { ProcureController } from './procure.controller';
import { ProcureReceiptsController } from './procure-receipts.controller';

/**
 * A branch-scoped role works on its own branch's purchase requests only, the
 * same as the list it is shown. A request id from another branch of the same
 * shop is refused before anything is read or posted.
 */
describe('Procure: a branch manager stays on their own branch', () => {
  const manager = { sub: 'u-mgr', tenantId: 't1', role: 'BRANCH_MANAGER', branchId: 'b1' } as any;
  const owner   = { sub: 'u-own', tenantId: 't1', role: 'BUSINESS_OWNER', branchId: null } as any;

  const procureCtl = (requestBranch: string | null) => {
    const procure = {
      branchOf:       jest.fn().mockResolvedValue(requestBranch),
      receiveRequest: jest.fn().mockResolvedValue({ ok: true }),
      cancel:         jest.fn().mockResolvedValue({ ok: true }),
      get:            jest.fn().mockResolvedValue({ id: 'r1' }),
      resolveBranch:  jest.fn().mockImplementation((_t: string, b: string) => Promise.resolve(b)),
      pullLowStock:   jest.fn().mockResolvedValue({ added: 0 }),
    };
    return { ctl: new ProcureController(procure as any, {} as any), procure };
  };

  it('refuses to receive another branch\'s request, and posts nothing', async () => {
    const { ctl, procure } = procureCtl('b2');
    await expect(ctl.receive(manager, 'r-b2', {} as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(procure.receiveRequest).not.toHaveBeenCalled();
  });

  it('refuses to cancel or read another branch\'s request', async () => {
    const { ctl, procure } = procureCtl('b2');
    await expect(ctl.cancel(manager, 'r-b2')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctl.get(manager, 'r-b2')).rejects.toBeInstanceOf(ForbiddenException);
    expect(procure.cancel).not.toHaveBeenCalled();
  });

  it('lets the manager act on their own branch, and the owner on any', async () => {
    const own = procureCtl('b1');
    await own.ctl.receive(manager, 'r-b1', {} as any);
    expect(own.procure.receiveRequest).toHaveBeenCalled();

    const any = procureCtl('b2');
    await any.ctl.receive(owner, 'r-b2', {} as any);
    expect(any.procure.receiveRequest).toHaveBeenCalled();
  });

  it('pulls low stock into the manager\'s own branch, not one named in the body', async () => {
    const { ctl } = procureCtl(null);
    await expect(ctl.pull(manager, { branchId: 'b2' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  describe('a receipt', () => {
    const receiptsCtl = (requestBranch: string | null) => {
      const receipts = {
        branchOfRequest: jest.fn().mockResolvedValue(requestBranch),
        confirm:         jest.fn().mockResolvedValue({ ok: true }),
      };
      return { ctl: new ProcureReceiptsController(receipts as any, {} as any, {} as any), receipts };
    };

    it('is not posted into another branch', async () => {
      const { ctl, receipts } = receiptsCtl(null);
      await expect(ctl.confirm(manager, { branchId: 'b2' } as any)).rejects.toBeInstanceOf(ForbiddenException);
      expect(receipts.confirm).not.toHaveBeenCalled();
    });

    it('is not landed on another branch\'s request', async () => {
      const { ctl, receipts } = receiptsCtl('b2');
      await expect(ctl.confirm(manager, { purchaseRequestId: 'r-b2' } as any)).rejects.toBeInstanceOf(ForbiddenException);
      expect(receipts.confirm).not.toHaveBeenCalled();
    });

    it('goes to the manager\'s own branch when none is named', async () => {
      const { ctl, receipts } = receiptsCtl(null);
      await ctl.confirm(manager, { lines: [] } as any);
      expect(receipts.confirm.mock.calls[0][3].branchId).toBe('b1');
    });
  });
});
