-- Sprint 18 — Sync (Payroll) employee self-service requests.
-- One polymorphic table covers COA / SCHEDULE / OB / OT / UT.
-- LeaveRequest stays separate (different semantics + leave-credit math).

-- Enums (idempotent)
DO $$ BEGIN
  CREATE TYPE "EmployeeRequestKind" AS ENUM ('COA', 'SCHEDULE', 'OB', 'OT', 'UT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "EmployeeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Table
CREATE TABLE IF NOT EXISTS "employee_requests" (
  "id"              TEXT NOT NULL,
  "tenantId"        TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "kind"            "EmployeeRequestKind" NOT NULL,
  "status"          "EmployeeRequestStatus" NOT NULL DEFAULT 'PENDING',
  "forDate"         DATE NOT NULL,
  "reason"          TEXT NOT NULL,
  "payload"         JSONB NOT NULL DEFAULT '{}'::jsonb,
  "approvedBy"      TEXT,
  "approvedAt"      TIMESTAMP(3),
  "rejectionReason" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_requests_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX IF NOT EXISTS "employee_requests_tenantId_status_kind_idx"
  ON "employee_requests" ("tenantId", "status", "kind");

CREATE INDEX IF NOT EXISTS "employee_requests_userId_forDate_idx"
  ON "employee_requests" ("userId", "forDate");

-- Foreign keys (no FK on tenantId — convention in this schema is app-level scoping)
DO $$ BEGIN
  ALTER TABLE "employee_requests"
    ADD CONSTRAINT "employee_requests_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "employee_requests"
    ADD CONSTRAINT "employee_requests_approvedBy_fkey"
    FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
