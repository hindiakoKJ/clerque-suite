import { ForbiddenException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { activeTenantScope } from './tenant-context';

const logger = new Logger('TenantScope');

/**
 * The tenant scope: a safety net under every shop query.
 *
 * Clerque keeps every shop in one database; each shop table has a required
 * `tenantId`. During a shop's request (tenant-context.ts), every query on such
 * a table gets "and tenantId = this shop" added, and a write that names
 * another shop is refused. A query that forgot its filter then finds nothing
 * in another shop, instead of reading or changing it.
 *
 * It is a net, not the rule: services keep their own tenantId filters and
 * their checks that ids sent by the screen belong to the shop (a foreign id
 * written into a new row is not a query this net can see).
 *
 * Not covered, by design or by Prisma: raw SQL ($queryRaw / $executeRaw),
 * nested writes and relation filters inside a query, tables without their own
 * tenantId (order lines, journal lines: reached through their parent), and
 * the two tables whose tenantId may be empty (ConsoleLog, LoginLog).
 */

/** Shop tables: every model with a required scalar tenantId, read from the schema. */
export const TENANT_MODELS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models
    .filter((m) => m.fields.some((f) => f.name === 'tenantId' && f.kind === 'scalar' && f.isRequired))
    .map((m) => m.name),
);

/** Operations whose `where` gets the shop added. */
const WHERE_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy',
  'update', 'updateMany', 'updateManyAndReturn', 'upsert',
  'delete', 'deleteMany',
]);

/** Operations whose `data` must not name another shop. */
const DATA_OPS = new Set(['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn']);

const OTHER_SHOP = 'That record belongs to another shop.';

function asArray(v: unknown): unknown[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/**
 * The where clause, also limited to the shop. Added as one more AND, so it
 * works for unique lookups (the unique keys stay at the top) and for any
 * filter the caller wrote, including its own tenantId condition.
 */
export function withTenant(where: unknown, tenantId: string): Record<string, unknown> {
  if (where == null || typeof where !== 'object') return { tenantId };
  const w = where as Record<string, unknown>;
  return { ...w, AND: [...asArray(w.AND), { tenantId }] };
}

/** Refuse data that sets tenantId (or connects the tenant) to another shop. */
export function assertDataInShop(data: unknown, tenantId: string): void {
  for (const row of asArray(data)) {
    if (row == null || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const t = r.tenantId;
    const set = t && typeof t === 'object' ? (t as { set?: unknown }).set : t;
    if (set !== undefined && set !== null && set !== tenantId) throw new ForbiddenException(OTHER_SHOP);
    const connectId = (r.tenant as { connect?: { id?: unknown } } | undefined)?.connect?.id;
    if (connectId !== undefined && connectId !== tenantId) throw new ForbiddenException(OTHER_SHOP);
  }
}

/** The query's arguments, scoped to the shop. Pure: no database, no context. */
export function scopeArgs(operation: string, args: unknown, tenantId: string): Record<string, unknown> {
  const a = { ...((args ?? {}) as Record<string, unknown>) };
  if (DATA_OPS.has(operation)) assertDataInShop(a.data, tenantId);
  if (operation === 'upsert') {
    assertDataInShop(a.create, tenantId);
    assertDataInShop(a.update, tenantId);
  }
  if (WHERE_OPS.has(operation)) a.where = withTenant(a.where, tenantId);
  return a;
}

/**
 * The Prisma client extension. Off when TENANT_SCOPE=off (an escape hatch for
 * an emergency, not a setting to use).
 */
export const tenantScopeExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const tenantId = activeTenantScope();
        if (!tenantId || !TENANT_MODELS.has(model)) return query(args);
        let scoped: typeof args;
        try {
          scoped = scopeArgs(operation, args, tenantId) as typeof args;
        } catch (err) {
          // A write naming another shop: logged (shop, table, operation only) so probing shows up.
          logger.warn(`Refused ${model}.${operation} naming another shop, from shop ${tenantId}`);
          throw err;
        }
        return query(scoped);
      },
    },
  },
});

export function tenantScopeEnabled(): boolean {
  return (process.env.TENANT_SCOPE ?? '').toLowerCase() !== 'off';
}
