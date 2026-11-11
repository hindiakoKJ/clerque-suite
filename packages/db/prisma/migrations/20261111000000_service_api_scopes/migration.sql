-- The service API that AIBA (or any machine caller a shop's owner trusts)
-- uses under /api/v1/service: scoped API keys, draft-only writes.
--
-- Written by `prisma migrate diff --from-schema-datamodel <master schema>
-- --to-schema-datamodel packages/db/prisma/schema.prisma --script`, offline;
-- never run against a database from a session. What it changes:
--
--   1. AuditAction gains SERVICE_DRAFT_CREATED: the audit row an API key's
--      draft writes (performedBy "apikey:<id>", the key's label in `after`).
--   2. JournalSource gains AIBA: a journal entry an API key drafted. Always
--      created DRAFT; a person posts it.
--   3. cycle_count_lines.countedById (nullable): who entered the count on the
--      counts screen, so posting can be refused to that same person
--      (segregation of duties). Existing rows stay NULL and are not checked.
--   4. api_keys.scopes (text[], default empty): named scopes. Every existing
--      key gets an empty list and keeps working exactly as before.
--   5. service_drafts: one row per draft reference, unique per tenant, so a
--      retried request returns the first draft instead of making a second.
--
-- Additive only: no existing row is changed, nothing is dropped.

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'SERVICE_DRAFT_CREATED';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'AIBA';

-- AlterTable
ALTER TABLE "cycle_count_lines" ADD COLUMN     "countedById" TEXT;

-- AlterTable
ALTER TABLE "api_keys" ADD COLUMN     "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "service_drafts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "targetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_drafts_tenantId_reference_key" ON "service_drafts"("tenantId", "reference");

-- AddForeignKey
ALTER TABLE "service_drafts" ADD CONSTRAINT "service_drafts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

