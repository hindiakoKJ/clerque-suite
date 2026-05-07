#!/bin/sh
# Clerque API — startup script (used by Railway nixpacks)
# Handles two DB states:
#   A) Fresh DB — migrate deploy applies all 6 migrations cleanly
#   B) Pre-pushed DB — tables already exist from 'prisma db push';
#      migrate deploy fails on migration 1 (objects exist), we mark
#      migrations 1-5 as applied, then retry so only migration 6 runs
#      (migration 6 uses IF NOT EXISTS throughout — always idempotent)
set -e

SCHEMA="packages/db/prisma/schema.prisma"

echo "[Clerque] ── Running database migrations ────────────────────────────"

if npx prisma migrate deploy --schema="$SCHEMA"; then
  echo "[Clerque] Migrations up to date (fresh deploy or already applied)"
else
  echo "[Clerque] migrate deploy failed — DB likely has pre-push schema."
  echo "[Clerque] Resolving baseline migrations 1-5 as applied..."

  for migration in \
    "20260425014738_init" \
    "20260425040054_phase1_modifiers_uom" \
    "20260425055445_phase2_settlement_accounting_periods" \
    "20260426035055_tax_compliance_and_audit" \
    "20260426120000_payroll_time_entries"
  do
    npx prisma migrate resolve \
      --applied "$migration" \
      --schema="$SCHEMA" \
      && echo "[Clerque]   marked applied: $migration" \
      || echo "[Clerque]   already tracked (ok): $migration"
  done

  echo "[Clerque] ── Retrying migrate deploy (should only apply migration 6) ──"
  npx prisma migrate deploy --schema="$SCHEMA"
fi

# ── Catch-up sync (Sprint 6-10 additive schema not yet in versioned migrations) ──
# Prisma `db push` is forward-only and idempotent for additive changes. Every
# deploy ensures the prod DB matches the current schema.prisma even if the
# delta wasn't captured as a versioned migration. This prevents schema drift
# from silently breaking auth.service / admin queries between sprints.
#
# Safety: this is `db push` WITHOUT `--accept-data-loss`. If a future schema
# change requires dropping a column, this command fails loudly and the deploy
# stops — forcing the operator to capture a real migration with the destructive
# step explicit. For all the additive changes through Sprint 10 this is safe.
echo "[Clerque] ── Catch-up schema sync (idempotent additive db push) ─────"
npx prisma db push --schema="$SCHEMA" --skip-generate || {
  echo "[Clerque] WARN: db push failed (likely a destructive change pending)."
  echo "[Clerque]       Capture a versioned migration before redeploying."
  exit 1
}

echo "[Clerque] ── Starting API server ────────────────────────────────────"
exec node apps/api/dist/main
