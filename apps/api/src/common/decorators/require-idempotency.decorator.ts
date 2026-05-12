import { SetMetadata } from '@nestjs/common';

/**
 * Sprint 21 — D5-06: Mark a route as requiring an `Idempotency-Key` header.
 *
 * The global IdempotencyInterceptor only acts on routes carrying this
 * metadata. Apply to financial mutation endpoints (payments, orders,
 * refunds, inventory adjusts, AR/AP posts) so a double-click during a
 * slow network can't post the same payment twice.
 *
 * Client contract: generate a uuid (crypto.randomUUID) on first attempt
 * and reuse it for any retry. Same key + same body = cached response;
 * same key + different body = 409 IDEMPOTENCY_KEY_CONFLICT.
 */
export const REQUIRE_IDEMPOTENCY_KEY = 'require-idempotency-key';
export const RequireIdempotency = () => SetMetadata(REQUIRE_IDEMPOTENCY_KEY, true);
