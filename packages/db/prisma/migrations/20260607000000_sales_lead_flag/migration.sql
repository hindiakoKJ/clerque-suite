-- Sprint 25 Phase 2A — Sales Lead delegation flag on users.
-- Reused supervisor-PIN authority on a non-BRANCH_MANAGER user. Gated by
-- PLAN_FEATURES[planCode].salesLeadDelegation: 0 = disabled, N = at most N
-- per tenant, -1 = unlimited.
ALTER TABLE "users" ADD COLUMN "isSalesLead" BOOLEAN NOT NULL DEFAULT false;
