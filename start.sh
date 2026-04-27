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

echo "[Clerque] ── Starting API server ────────────────────────────────────"
exec node apps/api/dist/main
