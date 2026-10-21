import { ForbiddenException } from '@nestjs/common';
import { ProjectsService } from './projects.service';

/**
 * A project's customer and branch must be this shop's own (tenant isolation
 * check, 21 Oct 2026, finding P3): the project list reads both names back.
 * The stand-in database holds this shop's rows only; any other id is another
 * shop's.
 */
const TENANT = 't-build';
const MINE = { branch: new Set(['b-yard']), customer: new Set(['c-dela-cruz']) };
const owned = (set: Set<string>) =>
  jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && set.has(where.id) ? { id: where.id } : null));

function build() {
  const prisma: any = {
    branch:   { findFirst: owned(MINE.branch) },
    customer: { findFirst: owned(MINE.customer) },
    project: {
      findFirst: jest.fn().mockResolvedValue(null),
      create:    jest.fn(({ data }: any) => Promise.resolve({ id: 'prj-new', ...data })),
    },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  return { svc: new ProjectsService(prisma, {} as any), prisma };
}

describe('ProjectsService.create', () => {
  it.each([
    ['customer', { customerId: 'c-other-shop' }],
    ['branch', { branchId: 'b-other-shop' }],
  ])('refuses another shop\'s %s and writes nothing', async (_what, link) => {
    const { svc, prisma } = build();
    await expect(svc.create(TENANT, 'u1', { name: 'Fence', ...link })).rejects.toThrow(ForbiddenException);
    expect(prisma.project.create).not.toHaveBeenCalled();
  });

  it('still opens a project for this shop\'s customer and branch, or with neither', async () => {
    const { svc, prisma } = build();
    await svc.create(TENANT, 'u1', { name: 'Fence', customerId: 'c-dela-cruz', branchId: 'b-yard' });
    expect(prisma.project.create.mock.calls[0][0].data).toMatchObject({ tenantId: TENANT, customerId: 'c-dela-cruz', branchId: 'b-yard' });
    await svc.create(TENANT, 'u1', { name: 'Gate' });
    expect(prisma.project.create.mock.calls[1][0].data).toMatchObject({ customerId: null, branchId: null });
  });
});
