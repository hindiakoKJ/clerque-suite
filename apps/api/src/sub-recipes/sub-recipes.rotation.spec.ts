import { BadRequestException } from '@nestjs/common';
import { SubRecipesService } from './sub-recipes.service';

/**
 * GET /inventory/sub-recipes/rotation: which branch, when the caller has none.
 * An owner account often has no branch, and asking for a branch of undefined
 * came back as an empty board -- a card saying "no sauces" is worse than none.
 */
describe('SubRecipesService.rotation — which branch', () => {
  function build(branches: Array<{ id: string; name: string; tenantId: string; isActive?: boolean }>) {
    const prisma: any = {
      branch: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(
          branches.find((b: any) => b.tenantId === where.tenantId && (where.id === undefined || b.id === where.id)
            && (where.isActive === undefined || (b.isActive ?? true) === where.isActive)) ?? null)),
      },
    };
    const svc = new SubRecipesService(prisma) as any;
    jest.spyOn(svc, 'list').mockResolvedValue([]);
    return { svc, prisma };
  }

  it('uses the shop\'s first branch when none is given', async () => {
    const { svc, prisma } = build([{ id: 'b1', name: 'Main', tenantId: 't1' }]);
    await expect(svc.rotation('t1', undefined, null)).resolves.toEqual({ branchId: 'b1', branchName: 'Main', rows: [] });
    expect(prisma.branch.findFirst.mock.calls[0][0]).toMatchObject({ where: { tenantId: 't1' }, orderBy: { createdAt: 'asc' } });
    expect(svc.list).toHaveBeenCalledWith('t1', 'b1', null);
  });

  it('skips a closed first branch', async () => {
    const { svc } = build([{ id: 'b0', name: 'Closed', tenantId: 't1', isActive: false }, { id: 'b1', name: 'Main', tenantId: 't1' }]);
    await expect(svc.rotation('t1', undefined, null)).resolves.toMatchObject({ branchId: 'b1' });
  });

  it('refuses another shop\'s branch', async () => {
    const { svc } = build([{ id: 'b9', name: 'Elsewhere', tenantId: 't2' }]);
    await expect(svc.rotation('t1', 'b9', null)).rejects.toThrow(BadRequestException);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('passes the viewer\'s persona on, so a barista\'s card shows the bar', async () => {
    const { svc } = build([{ id: 'b1', name: 'Main', tenantId: 't1' }]);
    await svc.rotation('t1', 'b1', 'BARISTA');
    expect(svc.list).toHaveBeenCalledWith('t1', 'b1', 'BARISTA');
  });
});
