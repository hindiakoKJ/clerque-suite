import { BadRequestException } from '@nestjs/common';
import { ProcureService } from './procure.service';

/**
 * A second owner or an MDM account is often created with no branch. Every
 * Procure route used to read `user.branchId!`, so for them the open list,
 * Check stock and the menu ceiling all asked about a branch of `undefined`
 * and came back empty with no error. Now: given nothing, the shop's first
 * branch; given something, it has to belong to this tenant.
 */
describe('ProcureService.resolveBranch', () => {
  const TENANT = 't1';

  function build(branches: Array<{ id: string; tenantId: string; createdAt: Date }>) {
    const findFirst = jest.fn(({ where, orderBy }: any) => {
      let rows = branches.filter((b) => b.tenantId === where.tenantId && (!where.id || b.id === where.id));
      if (orderBy?.createdAt === 'asc') rows = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      return Promise.resolve(rows[0] ? { id: rows[0].id } : null);
    });
    const svc = new ProcureService({ branch: { findFirst } } as any, {} as any);
    return { svc, findFirst };
  }

  const MAIN  = { id: 'b-main',  tenantId: TENANT, createdAt: new Date('2026-01-01') };
  const COURT = { id: 'b-court', tenantId: TENANT, createdAt: new Date('2026-03-01') };
  const OTHER = { id: 'b-other', tenantId: 'someone-else', createdAt: new Date('2025-01-01') };

  it('keeps the branch the caller named when it is theirs', async () => {
    const { svc, findFirst } = build([MAIN, COURT]);
    await expect(svc.resolveBranch(TENANT, 'b-court')).resolves.toBe('b-court');
    expect(findFirst.mock.calls[0][0].where).toEqual({ id: 'b-court', tenantId: TENANT });
  });

  it('falls back to the shop\'s first branch when the caller has none', async () => {
    const { svc } = build([COURT, MAIN]);
    await expect(svc.resolveBranch(TENANT, null)).resolves.toBe('b-main');
    await expect(svc.resolveBranch(TENANT, undefined)).resolves.toBe('b-main');
  });

  it('refuses a branch that belongs to another tenant', async () => {
    const { svc } = build([MAIN, OTHER]);
    await expect(svc.resolveBranch(TENANT, 'b-other')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('says so when the tenant has no branch at all', async () => {
    const { svc } = build([]);
    await expect(svc.resolveBranch(TENANT)).rejects.toThrow(/no branch yet/);
  });
});
