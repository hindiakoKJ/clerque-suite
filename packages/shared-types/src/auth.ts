export type UserRole =
  | 'SUPER_ADMIN'
  | 'BUSINESS_OWNER'
  | 'ACCOUNTANT'
  | 'BRANCH_MANAGER'
  | 'CASHIER'
  | 'GENERAL_EMPLOYEE'
  | 'EXTERNAL_AUDITOR';

/* ─── App access ─────────────────────────────────────────────────────────── */

export type AppCode = 'POS' | 'LEDGER' | 'PAYROLL';

/**
 * Ordered by privilege level — higher index = more access.
 * levelValue() uses this order for comparisons.
 */
export type AccessLevel =
  | 'NONE'
  | 'CLOCK_ONLY'   // Payroll: punch-in/out + own history only
  | 'READ_ONLY'
  | 'OPERATOR'     // Can transact; cannot configure settings
  | 'FULL';

export interface AppAccessEntry {
  app: AppCode;
  level: AccessLevel;
}

/** Returns a numeric value for access level comparison */
export function levelValue(level: AccessLevel | undefined): number {
  const order: AccessLevel[] = ['NONE', 'CLOCK_ONLY', 'READ_ONLY', 'OPERATOR', 'FULL'];
  return order.indexOf(level ?? 'NONE');
}

/* ─── Default access per role ────────────────────────────────────────────── */

export const DEFAULT_APP_ACCESS: Record<UserRole, AppAccessEntry[]> = {
  SUPER_ADMIN:       [{ app: 'POS', level: 'FULL' }, { app: 'LEDGER', level: 'FULL' }, { app: 'PAYROLL', level: 'FULL' }],
  BUSINESS_OWNER:    [{ app: 'POS', level: 'FULL' }, { app: 'LEDGER', level: 'FULL' }, { app: 'PAYROLL', level: 'FULL' }],
  BRANCH_MANAGER:    [{ app: 'POS', level: 'OPERATOR' }, { app: 'LEDGER', level: 'READ_ONLY' }, { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  ACCOUNTANT:        [{ app: 'POS', level: 'NONE' }, { app: 'LEDGER', level: 'FULL' }, { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  CASHIER:           [{ app: 'POS', level: 'OPERATOR' }, { app: 'LEDGER', level: 'NONE' }, { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  GENERAL_EMPLOYEE:  [{ app: 'POS', level: 'NONE' }, { app: 'LEDGER', level: 'NONE' }, { app: 'PAYROLL', level: 'CLOCK_ONLY' }],
  EXTERNAL_AUDITOR:  [{ app: 'POS', level: 'READ_ONLY' }, { app: 'LEDGER', level: 'READ_ONLY' }, { app: 'PAYROLL', level: 'NONE' }],
};

/* ─── JWT ────────────────────────────────────────────────────────────────── */

export interface JwtPayload {
  sub: string;
  name: string;
  tenantId: string | null;
  branchId: string | null;
  role: UserRole;
  isSuperAdmin: boolean;
  appAccess: AppAccessEntry[];
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}
