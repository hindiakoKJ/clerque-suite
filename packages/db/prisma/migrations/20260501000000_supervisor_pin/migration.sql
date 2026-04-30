-- Supervisor PIN for till-side void overrides.
-- Bcrypt-hashed 4-6 digit PIN. Only honoured for users whose role is in
-- VOID_DIRECT_ROLES (SALES_LEAD, BRANCH_MANAGER, BUSINESS_OWNER) — see
-- apps/api/src/auth/auth.service.ts verifySupervisorPin().

ALTER TABLE "users" ADD COLUMN "supervisorPinHash" TEXT;
