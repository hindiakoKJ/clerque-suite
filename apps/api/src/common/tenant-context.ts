import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Which shop the current request works for, carried through every await
 * without passing it by hand.
 *
 * Isolation in Clerque was by convention: every query had to remember
 * `tenantId` from the token, and a few forgot. The Prisma tenant scope
 * (tenant-scope.ts) reads this context and adds the caller's shop to every
 * query on a shop table, so a forgotten filter finds nothing instead of
 * another shop's row.
 *
 * Set by TenantContextInterceptor after the guards have run, for a signed-in
 * shop user or an API-key caller. Not set (so nothing is scoped, exactly as
 * before) for sign-in itself, public routes, guards, background jobs and the
 * platform admin, whose work spans shops by design.
 */
export interface TenantContextStore {
  /** The caller's shop: the token's tenantId, never anything from the request. */
  tenantId?: string;
  /** Work that spans shops by design, inside a request (see runAsSystem). */
  system?: boolean;
}

export const tenantContext = new AsyncLocalStorage<TenantContextStore>();

/** The shop every query must be scoped to right now, or null when nothing is scoped. */
export function activeTenantScope(): string | null {
  const store = tenantContext.getStore();
  if (!store || store.system || !store.tenantId) return null;
  return store.tenantId;
}

/**
 * Run work that reads or writes other shops' rows on purpose, from inside a
 * shop's request: telling the platform admin about a payment, a check that a
 * code is unique across all shops. Use it for the smallest block that needs
 * it, and say why next to the call.
 */
export function runAsSystem<T>(fn: () => T): T {
  return tenantContext.run({ ...(tenantContext.getStore() ?? {}), system: true }, fn);
}

/** Run work for one shop, scoped like a request of that shop (e.g. a job handling one shop at a time). */
export function runForTenant<T>(tenantId: string, fn: () => T): T {
  return tenantContext.run({ tenantId }, fn);
}

/**
 * The shop a signed-in caller is scoped to: their token's tenantId, unless
 * they are the platform admin (their work spans shops; their routes keep
 * their own checks).
 */
export function scopedTenantFor(user: unknown): string | null {
  if (!user || typeof user !== 'object') return null;
  const u = user as { tenantId?: unknown; role?: unknown; isSuperAdmin?: unknown };
  if (u.isSuperAdmin === true || u.role === 'SUPER_ADMIN') return null;
  return typeof u.tenantId === 'string' && u.tenantId.length > 0 ? u.tenantId : null;
}
