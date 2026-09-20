import { UsersService } from './users.service';

/**
 * A cashier with no branch cannot open a shift.
 *
 * Settings > Users has no Branch field: it posts name, email, password and
 * role, and the account was stored with branchId null. The first thing that
 * cashier does is tap Open Shift, and the till stops at "This account has no
 * branch" with nothing but a sign-out button. On a Friday go-live that is a
 * closed counter until the owner is found.
 *
 * Counter > Staff asks for a branch and refuses to create the account without
 * one, so the two doors disagreed. For a one-branch shop -- which is every
 * shop on day 1 -- there is exactly one right answer, so the API fills it in.
 * Nothing is guessed once there are two branches; that is a real choice.
 */
describe('a new account with no branch picked', () => {
  const STRONG = 'Carolina!2026x';

  function build(branches: Array<{ id: string }>) {
    const created: any[] = [];
    const prisma: any = {
      user: {
        findFirst: jest.fn().mockResolvedValue(null),
        count:     jest.fn().mockResolvedValue(0),
        create:    jest.fn(async (args: any) => { created.push(args.data); return { id: 'u-new', ...args.data }; }),
      },
      // No plan row: the seat-quota branch is not what these tests are about.
      tenant: { findUnique: jest.fn().mockResolvedValue(null) },
      branch: { findMany: jest.fn(async () => branches) },
    };
    const audit: any = { log: jest.fn() };
    return { svc: new UsersService(prisma, audit), prisma, created };
  }

  const staff = (over: any = {}) => ({
    name: 'Anne', email: 'anne@carolina.ph', password: STRONG, role: 'CASHIER', ...over,
  });

  it('puts a cashier in the shop\'s only branch', async () => {
    const { svc, created } = build([{ id: 'br-main' }]);
    await svc.create('t1', staff() as any, 'BUSINESS_OWNER');
    expect(created[0].branchId).toBe('br-main');
  });

  it('leaves the branch unset once the shop has two, because that is a real choice', async () => {
    const { svc, created } = build([{ id: 'br-main' }, { id: 'br-kiosk' }]);
    await svc.create('t1', staff() as any, 'BUSINESS_OWNER');
    expect(created[0].branchId).toBeNull();
  });

  it('never overrides a branch that was picked', async () => {
    const { svc, created, prisma } = build([{ id: 'br-main' }]);
    await svc.create('t1', staff({ branchId: 'br-kiosk' }) as any, 'BUSINESS_OWNER');
    expect(created[0].branchId).toBe('br-kiosk');
    expect(prisma.branch.findMany).not.toHaveBeenCalled();
  });

  it('leaves the owner and the accountant with no branch, because for them that means all of them', async () => {
    for (const role of ['BUSINESS_OWNER', 'ACCOUNTANT', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR']) {
      const { svc, created } = build([{ id: 'br-main' }]);
      await svc.create('t1', staff({ role, email: `${role}@carolina.ph` }) as any, 'BUSINESS_OWNER');
      expect(created[0].branchId).toBeNull();
    }
  });

  it('covers every role that is tied to one branch', async () => {
    // The same list as BRANCH_SCOPED_ROLES in common/branch-scope.ts. A role
    // missing here is an account that still cannot open its shift.
    for (const role of ['CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE']) {
      const { svc, created } = build([{ id: 'br-main' }]);
      await svc.create('t1', staff({ role, email: `${role}@carolina.ph` }) as any, 'BUSINESS_OWNER');
      expect(created[0].branchId).toBe('br-main');
    }
  });

  it('only counts branches that are open, and stops looking after two', async () => {
    const { svc, prisma } = build([{ id: 'br-main' }]);
    await svc.create('t1', staff() as any, 'BUSINESS_OWNER');
    expect(prisma.branch.findMany).toHaveBeenCalledWith({
      where:  { tenantId: 't1', isActive: true },
      select: { id: true },
      take:   2,
    });
  });

  it('gives nothing when the shop has no open branch at all', async () => {
    const { svc, created } = build([]);
    await svc.create('t1', staff() as any, 'BUSINESS_OWNER');
    expect(created[0].branchId).toBeNull();
  });
});
