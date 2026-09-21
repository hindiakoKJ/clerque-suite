import { AdminService } from './admin.service';

/**
 * login_logs is INSERT-only at the database: an audit trigger refuses DELETE.
 * The Console "Reset PW" and "Unlock" used to delete a user's failed sign-ins
 * and so failed with a 500 on production. They now write a marker row that
 * the lockout reads (auth/lockout.ts), and never delete.
 */
describe('AdminService — reset password and unlock never delete login logs', () => {
  const actor = { id: 'sa-1', email: 'kj@hns.test' } as any;

  function build() {
    const created: any[] = [];
    const prisma: any = {
      user: {
        findUnique: jest.fn(async () => ({
          id: 'u-owner', email: 'owner@cafe.test', name: 'Anne', role: 'BUSINESS_OWNER', tenantId: 't1',
          tenant: { id: 't1', slug: 'cafe-carolina' },
        })),
        update: jest.fn(async () => ({})),
      },
      tenant: { findUnique: jest.fn(async () => ({ id: 't1', slug: 'cafe-carolina' })) },
      userSession: { deleteMany: jest.fn(async () => ({ count: 2 })) },
      loginLog: {
        create:     jest.fn(async ({ data }: any) => { created.push(data); return data; }),
        deleteMany: jest.fn(async () => { throw new Error('SecAudit A2: DELETE on login_logs is forbidden'); }),
      },
      consoleLog: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    };
    const mail = { sendAdminPasswordResetNotice: jest.fn(async () => undefined) };
    return { svc: new AdminService(prisma, {} as any, mail as any), prisma, created };
  }

  it('reset password succeeds, lifts the lockout with a marker, and deletes nothing from login logs', async () => {
    const { svc, prisma, created } = build();
    const res = await svc.resetUserPassword('u-owner', actor, 'cafe-carolina');
    expect(res.generatedPassword).toEqual(expect.any(String));
    expect(prisma.loginLog.deleteMany).not.toHaveBeenCalled();
    expect(created).toEqual([expect.objectContaining({ userId: 'u-owner', success: true, reason: 'ADMIN_PASSWORD_RESET' })]);
    expect(prisma.userSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u-owner' } });
  });

  it('unlock writes the marker and deletes nothing', async () => {
    const { svc, prisma, created } = build();
    await expect(svc.clearLockout('u-owner', actor)).resolves.toEqual({ userId: 'u-owner', unlocked: true });
    expect(prisma.loginLog.deleteMany).not.toHaveBeenCalled();
    expect(created).toEqual([expect.objectContaining({ reason: 'ADMIN_UNLOCK', success: true })]);
  });
});
