import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request, Response } from 'express';

/**
 * HTTP request/response logger.
 *
 * Logs every inbound request and its outcome using NestJS's built-in Logger
 * so no additional npm packages are required.
 *
 * Format (success):  → POST /api/v1/orders          200  43ms  tenant:abc123
 * Format (error):    → GET  /api/v1/users/xyz        404  12ms  tenant:abc123
 *
 * Sensitive routes (login, refresh) are logged without body content.
 * Health checks (GET /health) are suppressed to avoid log noise.
 */
@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  /** Routes that generate too much noise — skip logging entirely. */
  private readonly SUPPRESSED_PATHS = ['/api/v1/health'];

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp();
    const req  = ctx.getRequest<Request>();
    const res  = ctx.getResponse<Response>();

    // Skip health check noise
    if (this.SUPPRESSED_PATHS.some((p) => req.url.startsWith(p))) {
      return next.handle();
    }

    const { method, url } = req;
    const tenantId = (req as Request & { user?: { tenantId?: string } }).user?.tenantId ?? '—';
    const startMs  = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const ms     = Date.now() - startMs;
          const status = res.statusCode;
          const level  = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'log';
          this.logger[level](
            `${method.padEnd(6)} ${url.padEnd(50)} ${status}  ${ms}ms  tenant:${tenantId}`,
          );
        },
        error: (err: { status?: number }) => {
          const ms     = Date.now() - startMs;
          const status = err?.status ?? 500;
          this.logger.error(
            `${method.padEnd(6)} ${url.padEnd(50)} ${status}  ${ms}ms  tenant:${tenantId}`,
          );
        },
      }),
    );
  }
}
