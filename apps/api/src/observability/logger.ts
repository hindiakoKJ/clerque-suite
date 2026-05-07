import pino from 'pino';

/**
 * Structured logger for Clerque API.
 *
 * Replaces ad-hoc console.log calls with a JSON-structured pino logger that
 * production tooling (Datadog, Loggly, CloudWatch) can parse natively.
 *
 * In dev, output goes through pino-pretty for human readability.
 * In prod, output is one-JSON-object-per-line to stdout.
 *
 * Usage:
 *   import { logger } from './observability/logger';
 *   logger.info({ tenantId, orderId }, 'order_created');
 *   logger.error({ err, tenantId }, 'order_create_failed');
 */
const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug'),
  base:  {
    service: 'clerque-api',
    env:     process.env.NODE_ENV ?? 'development',
    // Railway sets RAILWAY_GIT_COMMIT_SHA / Vercel sets VERCEL_GIT_COMMIT_SHA
    sha:     process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  },
  formatters: {
    level: (label) => ({ level: label }),
  },
  // Redact sensitive fields anywhere they appear in log payloads.
  redact: {
    paths: [
      'password', 'passwordHash', '*.password', '*.passwordHash',
      'token', 'refreshToken', '*.token', '*.refreshToken',
      'creditCard', 'tin', 'tinNumber',
      'authorization', 'cookie',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd ? {} : {
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname,service,env,sha' },
    },
  }),
});

/**
 * Convenience: child logger scoped to a tenant. Use for per-tenant log lines
 * so log aggregators can filter by tenantId effortlessly.
 */
export function loggerFor(tenantId: string | null | undefined) {
  return logger.child({ tenantId: tenantId ?? null });
}
