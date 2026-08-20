import { ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';

/**
 * Privilege-escalation wall on staff mutation.
 *
 * PATCH /users/:id and POST /users are open to BUSINESS_OWNER *and* MDM so
 * the master-data role can maintain staff records. Nothing used to compare
 * the caller against what was being granted, and the SOD engine exempts an
 * owner target outright, so an MDM could PATCH their own row with
 * { role: 'BUSINESS_OWNER' } — or create a second owner account outright —
 * and take over the tenant.
 */
describe('UsersService — caller-authority wall', () => {
  const TENANT = 'tenant-1';
  const MDM_ID = 'mdm-1';

  let prisma: any;
  let svc: UsersService;

  beforeEach(() => {
    prisma = {
      user: {
        findFirst:  jest.fn().mockResolvedValue({ id: 'staff-1', role: 'CASHIER', customPermissions: [] }),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create:     jest.fn().mockResolvedValue({ id: 'new-1' }),
        count:      jest.fn().mockResolvedValue(0),
      },
      // Changing a role reseeds the user's per-app access rows.
      userAppAccess: { upsert: jest.fn().mockResolvedValue({}) },
      // A permissions change force-revokes the user's live sessions.
      userSession: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (ops: unknown) =>
        Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(prisma),
      ),
    };
    svc = new UsersService(prisma as any, { log: jest.fn() } as any);
  });

  describe('update()', () => {
    it('blocks an MDM from promoting themselves to BUSINESS_OWNER', async () => {
      await expect(
        svc.update(TENANT, MDM_ID, { role: 'BUSINESS_OWNER' } as any, 'MDM', MDM_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('blocks an MDM from promoting anyone else to BUSINESS_OWNER', async () => {
      await expect(
        svc.update(TENANT, 'staff-1', { role: 'BUSINESS_OWNER' } as any, 'MDM', MDM_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('blocks an MDM from granting custom permissions', async () => {
      await expect(
        svc.update(TENANT, 'staff-1', { customPermissions: ['ledger:period_reopen'] } as any, 'MDM', MDM_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks an MDM from editing the owner account', async () => {
      prisma.user.findFirst.mockResolvedValue({ role: 'BUSINESS_OWNER' });
      await expect(
        svc.update(TENANT, 'owner-1', { name: 'Renamed' } as any, 'MDM', MDM_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('blocks self-approval: an owner cannot change their own role or permissions', async () => {
      await expect(
        svc.update(TENANT, 'owner-1', { role: 'CASHIER' } as any, 'BUSINESS_OWNER', 'owner-1'),
      ).rejects.toThrow(ForbiddenException);
      await expect(
        svc.update(TENANT, 'owner-1', { customPermissions: [] } as any, 'BUSINESS_OWNER', 'owner-1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('still lets an MDM edit ordinary staff details', async () => {
      await expect(
        svc.update(TENANT, 'staff-1', { name: 'Maria Santos' } as any, 'MDM', MDM_ID),
      ).resolves.toBeDefined();
      expect(prisma.user.updateMany).toHaveBeenCalled();
    });

    it('still lets the owner promote someone else to BUSINESS_OWNER', async () => {
      await expect(
        svc.update(TENANT, 'staff-1', { role: 'BUSINESS_OWNER' } as any, 'BUSINESS_OWNER', 'owner-1'),
      ).resolves.toBeDefined();
      expect(prisma.user.updateMany).toHaveBeenCalled();
    });
  });

  describe('create()', () => {
    it('blocks an MDM from creating a BUSINESS_OWNER account', async () => {
      await expect(
        svc.create(TENANT, { name: 'X', email: 'x@y.com', password: 'Sup3rSecret!', role: 'BUSINESS_OWNER' } as any, 'MDM'),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });
});
