/**
 * Sprint 19 — Tenant read-only kill switch.
 *
 * Global interceptor that intercepts every POST/PATCH/PUT/DELETE on the
 * tenant plane and rejects with HTTP 423 Locked when `Tenant.readOnlyMode`
 * is true. Designed as the emergency lever during a suspected ransomware
 * compromise: SUPER_ADMIN flips the flag from Console, every cashier's
 * next sale freezes immediately, no further writes can damage data while
 * the operator investigates.
 *
 * Bypass conditions (allowed even when frozen):
 *   - SUPER_ADMIN actor (platform staff need to unfreeze + investigate)
 *   - Auth endpoints (login/logout/2fa) — operators need to log in to
 *     diagnose; auth flows don't write tenant data
 *   - GET / HEAD — reads always allowed; the freeze is write-only
 *   - /admin/* — Console subdomain, SUPER_ADMIN only by middleware
 *   - /tenant/* read-onlyish endpoints intentionally allowed: setting
 *     readOnlyMode itself comes from /admin
 *
 * Audit: every blocked attempt logs to console (operator can correlate
 * later) but does NOT spam the console_logs table — the freeze is itself
 * already audited at the moment it was set.
 */
import {
  CallHandler,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '@repo/shared-types';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALWAYS_ALLOWED_PREFIXES = [
  '/api/v1/auth/',
  '/api/v1/admin/',         // Console — SUPER_ADMIN, needs to unfreeze
  '/api/v1/health',
];

@Injectable()
export class ReadOnlyModeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(ReadOnlyModeInterceptor.name);

  constructor(private readonly prisma: PrismaService) {}

  async intercept(ctx: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const req  = ctx.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;

    // Reads always allowed.
    if (SAFE_METHODS.has((req.method ?? '').toUpperCase())) return next.handle();

    // Path-based bypasses.
    const path = (req.originalUrl ?? req.url ?? '') as string;
    if (ALWAYS_ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return next.handle();

    // No JWT → not authenticated → other guards reject; we don't care.
    if (!user) return next.handle();

    // SUPER_ADMIN bypass — they need to unfreeze + investigate.
    if (user.isSuperAdmin || user.role === 'SUPER_ADMIN') return next.handle();

    if (!user.tenantId) return next.handle();

    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: user.tenantId },
      select: { readOnlyMode: true, readOnlyReason: true, name: true },
    });

    if (tenant?.readOnlyMode) {
      this.logger.warn(
        `[read-only] Blocked ${req.method} ${path} for tenant ${user.tenantId} (${tenant.name}) — ${tenant.readOnlyReason ?? 'no reason'}`,
      );
      throw new HttpException(
        {
          code:    'TENANT_READ_ONLY',
          message:
            tenant.readOnlyReason
              ? `This tenant is in read-only mode: ${tenant.readOnlyReason}. Contact support.`
              : 'This tenant is in read-only mode. Contact support to restore write access.',
        },
        HttpStatus.LOCKED,
      );
    }

    return next.handle();
  }
}
