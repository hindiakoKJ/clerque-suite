import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { tenantScopeEnabled, tenantScopeExtension } from '../common/tenant-scope';

/** The client's model properties (prisma.order, prisma.user, ...), from the schema. */
const MODEL_KEYS: ReadonlySet<string> = new Set(
  Prisma.dmmf.datamodel.models.map((m) => m.name.charAt(0).toLowerCase() + m.name.slice(1)),
);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super();
    if (!tenantScopeEnabled()) return;
    /*
      The tenant scope (common/tenant-scope.ts) is a Prisma client extension,
      and an extension is a new client, not this class. So this service hands
      out the extended client's models and $transaction (a transaction's tx is
      scoped too) and keeps everything else, onModuleInit included, as is.
      Both share one connection pool.
    */
    const extended = this.$extends(tenantScopeExtension) as unknown as Record<string, unknown>;
    return new Proxy(this, {
      get: (target, prop, receiver) => {
        if (typeof prop === 'string' && (MODEL_KEYS.has(prop) || prop === '$transaction')) {
          const value = extended[prop];
          return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(extended) : value;
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  async onModuleInit() {
    // Log masked DB URL so we can verify env vars are received on Render
    const url = process.env.DATABASE_URL ?? '(not set)';
    const masked = url.length > 20
      ? url.replace(/:([^:@]+)@/, ':***@').substring(0, 80) + '...'
      : url;
    this.logger.log(`Connecting to: ${masked}`);
    // So the logs show whether the shop safety net is on (common/tenant-scope.ts).
    this.logger.log(tenantScopeEnabled() ? 'Tenant scope: on' : 'Tenant scope: OFF (TENANT_SCOPE=off)');

    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
    } catch (err) {
      this.logger.error(`Database connection failed: ${(err as Error).message}`);
      // Don't crash on startup — let health checks surface the issue
      // The app will still start; DB errors will surface per-request
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
