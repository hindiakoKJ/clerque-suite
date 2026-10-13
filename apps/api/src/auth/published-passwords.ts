import { createHash } from 'crypto';

/**
 * Passwords that were published in this public repository.
 *
 * From late April to early June 2026 every production boot seeded demo
 * accounts (a platform admin, a demo owner and a demo cashier) with literal
 * passwords written in main.ts and in the docs. The seed is gated now, but the
 * accounts stayed, and the passwords are in the git history for good.
 * Production refuses them on every account. Only SHA-256 fingerprints are kept
 * here, so this file does not publish them again.
 */
const PUBLISHED = new Set([
  '35b6b19b34c2c4d081483778fbf2099411e8ae9cfe50205540386ee40eed24e0', // the seeded platform admin's
  '5ce41ada64f1e8ffb0acfaafa622b141438f3a5777785e7f0b830fb73e40d3d6', // the seeded demo owner's
  'efc8b4b7747fdf385a3a6eb23109412b972e02138aa6cbcaf1b8ded18d6da87b', // the seeded demo cashier's
]);

const PLATFORM_ADMIN_SEED = '35b6b19b34c2c4d081483778fbf2099411e8ae9cfe50205540386ee40eed24e0';

/**
 * The platform admin is still signing in with the seeded password, and a
 * .test address cannot receive a reset link, so refusing it today would lock
 * the only platform admin out. Until it is changed (Settings > Security >
 * Change Password), the platform admin alone may still use it; set this to
 * false straight after.
 */
export const PLATFORM_ADMIN_MAY_USE_SEEDED_PASSWORD = true;

export function isPublishedPassword(password: string, role?: string): boolean {
  const print = createHash('sha256').update(password).digest('hex');
  if (!PUBLISHED.has(print)) return false;
  if (print === PLATFORM_ADMIN_SEED && role === 'SUPER_ADMIN' && PLATFORM_ADMIN_MAY_USE_SEEDED_PASSWORD) return false;
  return true;
}
