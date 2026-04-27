#!/bin/sh
# Clerque API — startup script (used by Railway nixpacks)
# Runs on every container start; all steps are idempotent.
set -e

echo "[Clerque] ── Database migration pre-check ──────────────────────────"

# Migrations 1-5 were applied via 'prisma db push' before migration files
# were created.  Mark them as applied so 'migrate deploy' does not try to
# re-run them (which would fail because the objects already exist).
# The '|| true' makes each resolve a no-op if the migration is already
# tracked (already applied) — safe to run on every start.

for migration in \
  "20260425014738_init" \
  "20260425040054_phase1_modifiers_uom" \
  "20260425055445_phase2_settlement_accounting_periods" \
  "20260426035055_tax_compliance_and_audit" \
  "20260426120000_payroll_time_entries"
do
  npx prisma migrate resolve \
    --applied "$migration" \
    --schema=packages/db/prisma/schema.prisma \
    2>/dev/null \
    && echo "[Clerque]   resolved: $migration" \
    || echo "[Clerque]   already tracked (ok): $migration"
done

echo "[Clerque] ── Running pending migrations ──────────────────────────────"
npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma

echo "[Clerque] ── Starting API server ────────────────────────────────────"
exec node apps/api/dist/main
