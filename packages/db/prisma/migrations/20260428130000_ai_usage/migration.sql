-- AI usage telemetry — one row per LLM call.
-- Drives per-tenant cost tracking + budget caps + audit trail.

CREATE TABLE "ai_usage" (
    "id"            TEXT          NOT NULL,
    "tenantId"      TEXT          NOT NULL,
    "userId"        TEXT,
    "action"        TEXT          NOT NULL,
    "provider"      TEXT          NOT NULL DEFAULT 'anthropic',
    "model"         TEXT          NOT NULL,
    "inputTokens"   INTEGER       NOT NULL DEFAULT 0,
    "outputTokens"  INTEGER       NOT NULL DEFAULT 0,
    "costUsd"       DECIMAL(12,6) NOT NULL DEFAULT 0,
    "success"       BOOLEAN       NOT NULL DEFAULT true,
    "errorMessage"  TEXT,
    "durationMs"    INTEGER       NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_usage_tenantId_createdAt_idx"
    ON "ai_usage"("tenantId", "createdAt");

CREATE INDEX "ai_usage_tenantId_action_createdAt_idx"
    ON "ai_usage"("tenantId", "action", "createdAt");
