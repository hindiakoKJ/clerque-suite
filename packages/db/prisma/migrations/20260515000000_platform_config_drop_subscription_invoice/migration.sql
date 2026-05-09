-- ──────────────────────────────────────────────────────────────────────────
-- 2026-05-15 — Platform-config singleton + drop SubscriptionInvoice
--
-- Architectural pivot: HNS Corp PH operates as its own Clerque tenant. The
-- SubscriptionInvoice table from Sprint 14 (one-day-old) is dropped in
-- favor of regular Orders + AR/AP between HNS's tenant and customer
-- tenants. PlatformConfig is added as a singleton holding HNS's master
-- data (TIN, address, taxStatus, OR series, cron toggles).
--
-- Idempotent — uses IF EXISTS / IF NOT EXISTS so prod's self-healing
-- start.sh can replay safely.
-- ──────────────────────────────────────────────────────────────────────────

-- Drop SubscriptionInvoice (table + FK + enum) safely.
ALTER TABLE IF EXISTS "subscription_invoices" DROP CONSTRAINT IF EXISTS "subscription_invoices_tenantId_fkey";
DROP TABLE IF EXISTS "subscription_invoices";
DROP TYPE  IF EXISTS "SubscriptionInvoiceStatus";

-- Add PlatformConfig.
CREATE TABLE IF NOT EXISTS "platform_config" (
    "id" TEXT NOT NULL DEFAULT 'platform',
    "companyName" TEXT NOT NULL DEFAULT 'HNS Corp PH',
    "tin" TEXT,
    "address" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "taxStatus" "TaxStatus" NOT NULL DEFAULT 'UNREGISTERED',
    "isBirRegistered" BOOLEAN NOT NULL DEFAULT false,
    "subscriptionAutoIssue" BOOLEAN NOT NULL DEFAULT true,
    "subscriptionDueDays" INTEGER NOT NULL DEFAULT 7,
    "hnsTenantId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_config_pkey" PRIMARY KEY ("id")
);
