import { ForbiddenException } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { TENANT_MODELS, scopeArgs, withTenant, assertDataInShop } from './tenant-scope';
import { activeTenantScope, runAsSystem, runForTenant, scopedTenantFor, tenantContext } from './tenant-context';
import { TenantContextInterceptor } from './interceptors/tenant-context.interceptor';

/**
 * The safety net under every shop query: during a shop's request, a query
 * that forgot "where tenantId" finds nothing in another shop, and a write
 * that names another shop is refused.
 */
describe('tenant scope: which tables', () => {
  it('covers the shop tables and leaves the rest alone', () => {
    for (const m of ['Order', 'Product', 'Customer', 'Branch', 'User', 'SerializedUnit', 'JournalEntry', 'BankReconciliation', 'RawMaterial']) {
      expect(TENANT_MODELS.has(m)).toBe(true);
    }
    // No tenantId of their own (reached through a parent), or one that may be empty.
    for (const m of ['Tenant', 'OrderItem', 'JournalLine', 'BomItem', 'PlatformConfig', 'LoginLog', 'ConsoleLog']) {
      expect(TENANT_MODELS.has(m)).toBe(false);
    }
  });
});

describe('tenant scope: queries', () => {
  it('adds the shop to a lookup by id, keeping the id where Prisma needs it', () => {
    expect(scopeArgs('findUnique', { where: { id: 'o1' } }, 'A')).toEqual({ where: { id: 'o1', AND: [{ tenantId: 'A' }] } });
    expect(scopeArgs('update', { where: { id: 'r1' }, data: { status: 'DONE' } }, 'A'))
      .toEqual({ where: { id: 'r1', AND: [{ tenantId: 'A' }] }, data: { status: 'DONE' } });
    expect(scopeArgs('delete', { where: { branchId_productId: { branchId: 'b', productId: 'p' } } }, 'A'))
      .toEqual({ where: { branchId_productId: { branchId: 'b', productId: 'p' }, AND: [{ tenantId: 'A' }] } });
  });

  it('a list with no filter at all is limited to the shop', () => {
    expect(scopeArgs('findMany', {}, 'A')).toEqual({ where: { tenantId: 'A' } });
    expect(scopeArgs('count', undefined, 'A')).toEqual({ where: { tenantId: 'A' } });
    expect(scopeArgs('deleteMany', { where: { status: 'OLD' } }, 'A')).toEqual({ where: { status: 'OLD', AND: [{ tenantId: 'A' }] } });
  });

  it('keeps the caller’s own AND conditions and its own tenantId filter', () => {
    expect(withTenant({ AND: [{ a: 1 }], tenantId: 'A' }, 'A')).toEqual({ AND: [{ a: 1 }, { tenantId: 'A' }], tenantId: 'A' });
    expect(withTenant({ AND: { a: 1 } }, 'A')).toEqual({ AND: [{ a: 1 }, { tenantId: 'A' }] });
    // A query naming another shop finds nothing: both conditions must hold.
    expect(withTenant({ tenantId: 'B' }, 'A')).toEqual({ tenantId: 'B', AND: [{ tenantId: 'A' }] });
  });

  it('counts, sums and groups are limited to the shop', () => {
    expect(scopeArgs('aggregate', { where: { paidAt: { gte: 1 } }, _sum: { totalAmount: true } }, 'A'))
      .toEqual({ where: { paidAt: { gte: 1 }, AND: [{ tenantId: 'A' }] }, _sum: { totalAmount: true } });
    expect(scopeArgs('groupBy', { by: ['status'] }, 'A')).toEqual({ by: ['status'], where: { tenantId: 'A' } });
  });
});

describe('tenant scope: writes', () => {
  it('a new row for the caller’s own shop is fine', () => {
    expect(() => scopeArgs('create', { data: { tenantId: 'A', name: 'x' } }, 'A')).not.toThrow();
    expect(() => scopeArgs('createMany', { data: [{ tenantId: 'A' }, { tenantId: 'A' }] }, 'A')).not.toThrow();
    expect(() => scopeArgs('create', { data: { tenant: { connect: { id: 'A' } } } }, 'A')).not.toThrow();
  });

  it('a row for another shop is refused, however it is named', () => {
    expect(() => scopeArgs('create', { data: { tenantId: 'B' } }, 'A')).toThrow(ForbiddenException);
    expect(() => scopeArgs('createMany', { data: [{ tenantId: 'A' }, { tenantId: 'B' }] }, 'A')).toThrow(ForbiddenException);
    expect(() => scopeArgs('create', { data: { tenant: { connect: { id: 'B' } } } }, 'A')).toThrow(ForbiddenException);
  });

  it('an update cannot move a row to another shop', () => {
    expect(() => scopeArgs('update', { where: { id: 'm1' }, data: { tenantId: 'B' } }, 'A')).toThrow(ForbiddenException);
    expect(() => scopeArgs('updateMany', { where: {}, data: { tenantId: { set: 'B' } } }, 'A')).toThrow(ForbiddenException);
    expect(() => scopeArgs('upsert', { where: { id: 'm1' }, create: { tenantId: 'B' }, update: {} }, 'A')).toThrow(ForbiddenException);
    expect(() => scopeArgs('upsert', { where: { id: 'm1' }, create: { tenantId: 'A' }, update: { tenantId: 'B' } }, 'A')).toThrow(ForbiddenException);
  });

  it('data with no tenant at all is left to the schema', () => {
    expect(() => assertDataInShop({ name: 'x' }, 'A')).not.toThrow();
    expect(() => assertDataInShop(undefined, 'A')).not.toThrow();
  });
});

describe('tenant context', () => {
  it('nothing is scoped outside a request (jobs, sign-in, public routes)', () => {
    expect(activeTenantScope()).toBeNull();
  });

  it('a shop’s work is scoped; system work inside it is not; the shop comes back after', async () => {
    await runForTenant('A', async () => {
      expect(activeTenantScope()).toBe('A');
      await Promise.resolve();
      expect(activeTenantScope()).toBe('A');
      runAsSystem(() => expect(activeTenantScope()).toBeNull());
      expect(activeTenantScope()).toBe('A');
    });
    expect(activeTenantScope()).toBeNull();
  });

  it('the platform admin and a missing token are not scoped; a shop user and an API key are', () => {
    expect(scopedTenantFor(undefined)).toBeNull();
    expect(scopedTenantFor({ role: 'SUPER_ADMIN', tenantId: 'home' })).toBeNull();
    expect(scopedTenantFor({ role: 'BUSINESS_OWNER', isSuperAdmin: true, tenantId: 'home' })).toBeNull();
    expect(scopedTenantFor({ role: 'CASHIER', tenantId: 'A' })).toBe('A');
    expect(scopedTenantFor({ isApiKey: true, tenantId: 'A' })).toBe('A');
    expect(scopedTenantFor({ role: 'CASHIER', tenantId: '' })).toBeNull();
  });

  it('the interceptor runs the handler inside the caller’s shop', async () => {
    const seen: Array<string | null> = [];
    const ctx = (user: unknown) => ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any;
    const handler = { handle: () => { seen.push(activeTenantScope()); return of('done'); } };
    const i = new TenantContextInterceptor();
    await lastValueFrom(i.intercept(ctx({ role: 'CASHIER', tenantId: 'A' }), handler));
    await lastValueFrom(i.intercept(ctx({ role: 'SUPER_ADMIN', tenantId: 'home' }), handler));
    await lastValueFrom(i.intercept(ctx(undefined), handler));
    expect(seen).toEqual(['A', null, null]);
    expect(tenantContext.getStore()).toBeUndefined();
  });
});
