import { ConflictException } from '@nestjs/common';
import { AdminService } from './admin.service';

/**
 * The Console "bootstrap super admin" used to match ANY user with the email
 * and promote it. Shop staff emails are unique only within a shop and the
 * shop owner picks the staff password, so a shop owner who made a staff
 * account with the right email became platform admin over every shop.
 *
 * Now: a shop account with that email anywhere stops the bootstrap and
 * nothing is written; only a row that is already SUPER_ADMIN is re-used.
 */
describe('AdminService — bootstrapSuperAdmin never promotes a shop account', () => {
  const actor = { email: 'kj@hns.test' };

  function build(users: Array<{ id: string; email: string; role: string; tenantId: string; createdAt?: Date }>) {
    const matches = (where: any, u: (typeof users)[number]) => {
      const wanted = String(where.email.equals).toLowerCase();
      if (u.email.toLowerCase() !== wanted) return false;
      if (typeof where.role === 'string') return u.role === where.role;
      if (where.role?.not) return u.role !== where.role.not;
      return true;
    };
    const prisma: any = {
      tenant: { findFirst: jest.fn(async () => ({ id: 't-home' })) },
      user: {
        findFirst: jest.fn(async ({ where }: any) => users.find((u) => matches(where, u)) ?? null),
        update:    jest.fn(async ({ where, data }: any) => ({ ...users.find((u) => u.id === where.id), ...data })),
        create:    jest.fn(async ({ data }: any) => ({ id: 'u-new', ...data })),
      },
      consoleLog: { create: jest.fn(async () => ({})) },
    };
    return { svc: new AdminService(prisma, {} as any, {} as any), prisma };
  }

  it('refuses when a shop staff account in another shop has the email, and writes nothing', async () => {
    const { svc, prisma } = build([
      { id: 'u-shopb-staff', email: 'support@hns.test', role: 'GENERAL_EMPLOYEE', tenantId: 't-shop-b' },
    ]);
    await expect(svc.bootstrapSuperAdmin({ email: 'support@hns.test', name: 'Support' }, actor))
      .rejects.toThrow(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.consoleLog.create).not.toHaveBeenCalled();
  });

  it('refuses even when the shop account spells the email in other letter case', async () => {
    const { svc, prisma } = build([
      { id: 'u-owner', email: 'KJ@HNS.test', role: 'BUSINESS_OWNER', tenantId: 't-shop-b' },
    ]);
    await expect(svc.bootstrapSuperAdmin({ email: 'kj@hns.test', name: 'KJ' }, actor))
      .rejects.toThrow(/shop account already uses this email/);
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('refuses when a shop account and an existing super admin share the email, and changes neither', async () => {
    const { svc, prisma } = build([
      { id: 'u-sa', email: 'kj@hns.test', role: 'SUPER_ADMIN', tenantId: 't-home' },
      { id: 'u-shopb', email: 'kj@hns.test', role: 'BUSINESS_OWNER', tenantId: 't-shop-b' },
    ]);
    await expect(svc.bootstrapSuperAdmin({ email: 'kj@hns.test', name: 'KJ' }, actor))
      .rejects.toThrow(ConflictException);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('re-running for an existing super admin only re-activates that SUPER_ADMIN row', async () => {
    const { svc, prisma } = build([
      { id: 'u-sa', email: 'kj@hns.test', role: 'SUPER_ADMIN', tenantId: 't-home' },
    ]);
    const res = await svc.bootstrapSuperAdmin({ email: 'KJ@hns.test ', name: 'KJ' }, actor);
    expect(res).toMatchObject({ userId: 'u-sa', generatedPassword: null });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u-sa' },
      data:  { isActive: true, role: 'SUPER_ADMIN' },
    });
    // The lookup that may be re-used is pinned to SUPER_ADMIN rows.
    const reused = prisma.user.findFirst.mock.calls.find(([a]: any) => a.where.role === 'SUPER_ADMIN');
    expect(reused[0].where.email).toEqual({ equals: 'kj@hns.test', mode: 'insensitive' });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('creates a new super admin in the home shop when nobody has the email', async () => {
    const { svc, prisma } = build([
      { id: 'u-other', email: 'someone@else.test', role: 'BUSINESS_OWNER', tenantId: 't-shop-b' },
    ]);
    const res = await svc.bootstrapSuperAdmin({ email: 'kj@hns.test', name: 'KJ' }, actor);
    expect(res.generatedPassword).toEqual(expect.any(String));
    expect(prisma.user.create.mock.calls[0][0].data).toMatchObject({
      email: 'kj@hns.test', role: 'SUPER_ADMIN', isActive: true, tenantId: 't-home',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
