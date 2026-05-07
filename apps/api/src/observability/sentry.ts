import * as Sentry from '@sentry/node';
import { logger } from './logger';

/**
 * Initialize Sentry error tracking. Graceful no-op if SENTRY_DSN is not set,
 * so dev environments don't need Sentry to run.
 *
 * Call this once at app startup BEFORE NestFactory.create.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry not configured (SENTRY_DSN unset) — error tracking disabled.');
    return;
  }

  Sentry.init({
    dsn,
    environment:        process.env.NODE_ENV ?? 'development',
    release:            process.env.RAILWAY_GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? undefined,
    tracesSampleRate:   Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Don't ship PII unless explicitly opted in. Keep PH BIR-sensitive fields
    // out of error reports unless we add explicit scrubbing per release.
    sendDefaultPii:     false,
    // Filter known noise.
    beforeSend(event) {
      // Skip 4xx client errors — they're not actionable.
      const status = event.contexts?.response?.status_code;
      if (typeof status === 'number' && status >= 400 && status < 500) return null;
      return event;
    },
  });

  logger.info({ env: process.env.NODE_ENV }, 'Sentry initialized.');
}

/** Capture an exception with optional tenant context. Safe no-op if Sentry isn't initialized. */
export function captureException(err: unknown, ctx?: { tenantId?: string; userId?: string }): void {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (ctx?.tenantId) scope.setTag('tenantId', ctx.tenantId);
    if (ctx?.userId)   scope.setTag('userId', ctx.userId);
    Sentry.captureException(err);
  });
}
