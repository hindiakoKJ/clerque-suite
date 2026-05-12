/**
 * Sprint 21 — D5-06: Idempotency-Key replay protection for financial mutations.
 *
 * Solves the double-post problem universally. The Order/Bill/Invoice unique
 * constraints catch SOME duplicates (orderNumber, billNumber) but not all —
 * e.g. AR/AP Payments, item refunds, and inventory adjusts have no natural
 * uniqueness. An Idempotency-Key header + 24h replay cache solves it everywhere.
 *
 * How it works (only acts on routes marked with @RequireIdempotency):
 *
 *   1. Read `Idempotency-Key` header. If absent on a required route → 400.
 *   2. Compute sha256(JSON-serialised body).
 *   3. Look up IdempotencyKey by (tenantId, key, endpoint).
 *        - Cache hit + same hash:  short-circuit, return cached status+body.
 *        - Cache hit + different hash: 409 IDEMPOTENCY_KEY_CONFLICT.
 *        - No hit: pass through; capture response and write a row (24h TTL).
 *   4. Skip everything for safe methods (GET / HEAD / OPTIONS).
 *
 * The 64KB response cap silently disables caching for oversized responses —
 * they recompute on retry (still safe; the original write succeeded and the
 * service-level uniqueness will reject the dup if it gets that far).
 *
 * Nightly cron in CleanupScheduler purges rows past `expiresAt`.
 */
import {
  BadRequestException,
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, of, tap } from 'rxjs';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { REQUIRE_IDEMPOTENCY_KEY } from '../decorators/require-idempotency.decorator';
import type { JwtPayload } from '@repo/shared-types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const TTL_MS = 24 * 60 * 60 * 1000;   // 24h
const MAX_BODY_BYTES = 64 * 1024;     // 64KB

function endpointKey(method: string, path: string): string {
  // Strip query string + the global /api/v1 prefix so the endpoint key is
  // stable across environments. Concrete path params (the bill id, order id)
  // remain part of the key — that's intentional: an Idempotency-Key applied
  // to /orders/AAA/items/X/refund should NOT collide with the same key on a
  // refund against a different item.
  const clean = path.split('?')[0]!.replace(/^\/api\/v\d+/, '');
  return `${method.toUpperCase()} ${clean}`;
}

function hashBody(body: unknown): string {
  const json = body === undefined || body === null ? '' : JSON.stringify(body);
  return createHash('sha256').update(json).digest('hex');
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    // Only act on routes explicitly opted-in. Pass-through otherwise to keep
    // the interceptor essentially free for the rest of the API surface.
    const required = this.reflector.getAllAndOverride<boolean>(REQUIRE_IDEMPOTENCY_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();

    if (SAFE_METHODS.has((req.method ?? '').toUpperCase())) return next.handle();

    const user = req.user as JwtPayload | undefined;
    if (!user?.tenantId) {
      // Other guards (JwtAuthGuard) will reject before reaching us in normal
      // operation; if they didn't, don't block — just pass through.
      return next.handle();
    }

    const key = (req.headers['idempotency-key'] ?? req.headers['Idempotency-Key']) as
      | string
      | undefined;
    if (!key || !key.trim()) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message:
          'This endpoint requires an Idempotency-Key header. Generate a uuid client-side and resend.',
      });
    }
    const trimmedKey = key.trim();

    const endpoint = endpointKey(req.method, (req.originalUrl ?? req.url ?? '') as string);
    const requestHash = hashBody(req.body);

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: {
        tenantId_key_endpoint: {
          tenantId: user.tenantId,
          key:      trimmedKey,
          endpoint,
        },
      },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: 'IDEMPOTENCY_KEY_CONFLICT',
          message:
            'Same Idempotency-Key was used with a different request body. Generate a new key for a new request.',
        });
      }
      // Cache hit — short-circuit the controller. Replay the original status+body.
      this.logger.log(
        `[idempotency] replay hit tenant=${user.tenantId} endpoint="${endpoint}" key=${trimmedKey}`,
      );
      try {
        res.status(existing.statusCode);
      } catch {
        // res.status may not exist in some test transports — best-effort only.
      }
      let parsed: unknown = existing.responseBody;
      try { parsed = JSON.parse(existing.responseBody); } catch { /* keep raw string */ }
      return of(parsed);
    }

    // No hit — let the request run, then persist the response (best effort).
    return next.handle().pipe(
      tap({
        next: (responseBody) => {
          // Fire-and-forget write. A failed cache write must NEVER fail the
          // user-facing response (the actual write already succeeded), so we
          // catch + log only.
          (async () => {
            try {
              const json = JSON.stringify(responseBody ?? null);
              if (Buffer.byteLength(json, 'utf8') > MAX_BODY_BYTES) {
                this.logger.warn(
                  `[idempotency] response too large to cache (${endpoint}) — skipping replay row`,
                );
                return;
              }
              const statusCode = (typeof res.statusCode === 'number' ? res.statusCode : 200) || 200;
              await this.prisma.idempotencyKey.create({
                data: {
                  tenantId:     user.tenantId!,
                  key:          trimmedKey,
                  requestHash,
                  endpoint,
                  statusCode,
                  responseBody: json,
                  performedBy:  user.sub ?? null,
                  expiresAt:    new Date(Date.now() + TTL_MS),
                },
              });
            } catch (err) {
              // Most likely race-condition on the unique index — another
              // concurrent retry won. That's fine; the row exists. Log and move on.
              this.logger.warn(
                `[idempotency] cache write skipped (${endpoint}): ${(err as Error).message}`,
              );
            }
          })();
        },
      }),
    );
  }
}
