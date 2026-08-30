import {
  effectivePermissions, detectViolations, hasBlockingViolation,
  PERMISSION_MATRIX, type PermissionKey, type UserRole,
} from '@repo/shared-types';

/**
 * What a user can ACTUALLY do is the role's permissions PLUS the extras
 * granted on top.
 *
 * Every SOD rule fires only when ALL of its conflicting permissions are
 * present together. The API used to judge the override array alone, so
 * granting someone a permission that conflicts with one their ROLE already
 * carries was checked against a one- or two-element set, matched nothing, and
 * saved clean. The staff editor built the correct union and warned in the
 * browser — so the two disagreed, and the lenient one was the server.
 */
describe('effectivePermissions', () => {
  const permsOf = (role: UserRole): PermissionKey[] =>
    (Object.keys(PERMISSION_MATRIX) as PermissionKey[])
      .filter((p) => (PERMISSION_MATRIX[p] as readonly string[]).includes(role));

  it("includes everything the role already carries", () => {
    const cashier = effectivePermissions('CASHIER', []);
    for (const p of permsOf('CASHIER')) expect(cashier).toContain(p);
  });

  it('adds the granted extras on top', () => {
    const extra = permsOf('BUSINESS_OWNER').find((p) => !permsOf('CASHIER').includes(p))!;
    expect(effectivePermissions('CASHIER', [extra])).toContain(extra);
  });

  it('does not duplicate a grant the role already had', () => {
    const own = permsOf('CASHIER')[0];
    const out = effectivePermissions('CASHIER', [own]);
    expect(out.filter((p) => p === own)).toHaveLength(1);
  });

  it.each([[null], [undefined], [[]]])('treats %p as no extras', (custom) => {
    expect(effectivePermissions('CASHIER', custom as PermissionKey[] | null | undefined))
      .toEqual(expect.arrayContaining(permsOf('CASHIER')));
  });

  it('is what makes a role-vs-grant conflict detectable at all', () => {
    /*
      The bug in one assertion. Take any BLOCK rule whose conflicting
      permissions are split — one held by the role, one granted on top. Judged
      on the grant alone the rule cannot fire, because not all of its
      permissions are present. Judged on the effective set, it does.
    */
    const roles: UserRole[] = ['CASHIER', 'BOOKKEEPER', 'WAREHOUSE_STAFF', 'MDM', 'SALES_LEAD'];
    const found = roles.some((role) => {
      const own = permsOf(role);
      // every permission this role does NOT already have
      const grantable = (Object.keys(PERMISSION_MATRIX) as PermissionKey[])
        .filter((p) => !own.includes(p));
      return grantable.some((grant) =>
        !hasBlockingViolation(role, [grant])                                  // invisible before
        && hasBlockingViolation(role, effectivePermissions(role, [grant])),   // caught after
      );
    });
    expect(found).toBe(true);
  });

  it('leaves an owner alone — the rules exempt them by design', () => {
    // A solo owner IS the cashier and the bookkeeper. detectViolations returns
    // early for BUSINESS_OWNER, and widening the permission set must not
    // change that.
    const owner = effectivePermissions('BUSINESS_OWNER', []);
    expect(detectViolations('BUSINESS_OWNER', owner)).toEqual([]);
  });
});
