import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * A staff account's branch must be one of the shop's own branches.
 *
 * POST /users and PATCH /users/:id stored dto.branchId as given. Another
 * shop's branch id was saved on the account, the staff list then showed that
 * shop's branch name, and the person's sign-in carried it. The id is checked
 * against the caller's shop now, and refused with the same words whether it is
 * missing or belongs to someone else.
 */
describe('UsersService — a staff branch must be this shop\'s', () => {
  const TENANT = 'shop-a';
  const OWN_BRANCH = 'br-a';
  const FOREIGN_BRANCH = 'br-b';
  const STRONG = 'Carolina!2026x';

  function build() {
    const prisma: any = {
      user: {
        findFirst:  jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        count:      jest.fn().mockResolvedValue(0),
        create:     jest.fn(async (args: any) => ({ id: 'u-new', ...args.data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue(null) },
      branch: {
        // The database's answer: only shop A's own branch matches { id, tenantId }.
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === OWN_BRANCH && where.tenantId === TENANT ? { id: OWN_BRANCH } : null),
        findMany:  jest.fn().mockResolvedValue([]),
      },
      userAppAccess: { upsert: jest.fn().mockResolvedValue({}) },
      telegramLink:  { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      userSession:   {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (ops: unknown) =>
        Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(prisma),
      ),
    };
    const svc = new UsersService(prisma, { log: jest.fn() } as any);
    return { svc, prisma };
  }

  const staff = (over: any = {}) => ({
    name: 'Anne', email: 'anne@carolina.ph', password: STRONG, role: 'CASHIER', ...over,
  });

  describe('create()', () => {
    it('refuses another shop\'s branch and creates nothing', async () => {
      const { svc, prisma } = build();
      await expect(
        svc.create(TENANT, staff({ branchId: FOREIGN_BRANCH }) as any, 'BUSINESS_OWNER'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.branch.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: FOREIGN_BRANCH, tenantId: TENANT } }),
      );
    });

    it('still saves the shop\'s own branch', async () => {
      const { svc, prisma } = build();
      await svc.create(TENANT, staff({ branchId: OWN_BRANCH }) as any, 'BUSINESS_OWNER');
      expect(prisma.user.create.mock.calls[0][0].data.branchId).toBe(OWN_BRANCH);
    });
  });

  describe('update()', () => {
    beforeEach(() => jest.clearAllMocks());

    it('refuses moving someone to another shop\'s branch and writes nothing', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: 'staff-1', role: 'CASHIER', customPermissions: [] });
      await expect(
        svc.update(TENANT, 'staff-1', { branchId: FOREIGN_BRANCH } as any, 'BUSINESS_OWNER', 'owner-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('still moves someone to the shop\'s own branch', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: 'staff-1', role: 'CASHIER', customPermissions: [] });
      await svc.update(TENANT, 'staff-1', { branchId: OWN_BRANCH } as any, 'BUSINESS_OWNER', 'owner-1');
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ branchId: OWN_BRANCH }) }),
      );
    });

    it('still clears the branch with null, without a lookup', async () => {
      const { svc, prisma } = build();
      prisma.user.findFirst.mockResolvedValue({ id: 'staff-1', role: 'CASHIER', customPermissions: [] });
      await svc.update(TENANT, 'staff-1', { branchId: null } as any, 'BUSINESS_OWNER', 'owner-1');
      expect(prisma.branch.findFirst).not.toHaveBeenCalled();
      expect(prisma.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ branchId: null }) }),
      );
    });
  });
});
