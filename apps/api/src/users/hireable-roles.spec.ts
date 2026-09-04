import { HIREABLE_ROLES, isHireableRole } from '@repo/shared-types';
import { PERMISSION_MATRIX } from '@repo/shared-types';
import { STAFF_ROLES } from './dto/create-user.dto';

/**
 * One list of roles a shop can hire into, not four.
 *
 * There were four copies — the Prisma enum, the shared `UserRole` type, the
 * users DTO, and a hand-typed union in the Staff screen — and three of them
 * were meant to agree. They had drifted: AR_ACCOUNTANT and AP_ACCOUNTANT are
 * valid in the database, carry `ledger:view` in PERMISSION_MATRIX, and are
 * named in 107 @Roles decorators across the API, but neither the DTO nor the
 * only UI that assigns roles offered them. A hundred-odd endpoints were gated
 * to two roles nobody could hold, and no shop could hire an AR or AP clerk.
 */
describe('Hireable roles — one list', () => {
  it('offers AR and AP clerks, the two that had gone missing', () => {
    expect(HIREABLE_ROLES).toContain('AR_ACCOUNTANT');
    expect(HIREABLE_ROLES).toContain('AP_ACCOUNTANT');
  });

  it('is the SAME object the users DTO validates against', () => {
    // Not "equal to" — the same reference. A copy could drift again.
    expect(STAFF_ROLES).toBe(HIREABLE_ROLES);
  });

  it('excludes SUPER_ADMIN, who is platform staff rather than a shop hire', () => {
    expect(HIREABLE_ROLES).not.toContain('SUPER_ADMIN');
  });

  it('excludes SERVICE, which is an API key and has no User row at all', () => {
    expect(HIREABLE_ROLES as readonly string[]).not.toContain('SERVICE');
  });

  it('can assign every role the permission matrix actually grants something to', () => {
    /*
      The check that would have caught the original drift. A role that carries
      permissions but cannot be assigned is a dead branch in the authorization
      model: the endpoints look guarded and are in fact unreachable.
    */
    const granted = new Set<string>();
    for (const roles of Object.values(PERMISSION_MATRIX)) {
      for (const r of roles as readonly string[]) granted.add(r);
    }
    // SUPER_ADMIN is granted everything and is deliberately not hireable.
    granted.delete('SUPER_ADMIN');
    const unassignable = [...granted].filter((r) => !isHireableRole(r));
    expect(unassignable).toEqual([]);
  });

  it('has no duplicates', () => {
    expect(new Set(HIREABLE_ROLES).size).toBe(HIREABLE_ROLES.length);
  });
});
