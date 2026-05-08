#!/bin/sh
# Clerque API — startup script (used by Railway nixpacks)
#
# Handles three DB states:
#   A) Fresh DB — migrate deploy applies all migrations cleanly.
#   B) Pre-pushed DB — tables already exist from `prisma db push`;
#      migrate deploy fails on the first migration (objects exist).
#      We mark all historical migrations as applied, then the post-
#      deploy `db push` reconciles the schema additively.
#   C) Recovery from a previously-failed migration — `_prisma_migrations`
#      has a row with `finished_at IS NULL` (P3009). We mark it as
#      applied (since `db push` keeps the schema in sync regardless),
#      then continue.
#
# Strategy: every migration in `prisma/migrations/` is treated as a
# "should already be applied either via real migrate deploy OR via the
# additive db push catch-up at the end." On any deploy failure, walk the
# entire list and force-mark each as applied (P3008 means already applied
# → swallow). Then retry deploy + run db push to fill any schema gaps.
#
# Why this is safe:
# - All historical migrations through Sprint 13 are either trivially
#   idempotent (ADD VALUE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS) or
#   represent already-deployed schema state.
# - `db push` (without --accept-data-loss) is the safety net: it adds
#   missing tables/columns/indexes/enum values to match schema.prisma. It
#   will refuse a destructive change, forcing a real migration to be
#   captured before the next deploy.

set -e

SCHEMA="packages/db/prisma/schema.prisma"

echo "[Clerque] ── Running database migrations ────────────────────────────"

if npx prisma migrate deploy --schema="$SCHEMA"; then
  echo "[Clerque] Migrations up to date (fresh deploy or already applied)"
else
  echo "[Clerque] migrate deploy failed — recovering migration history…"
  echo "[Clerque] Marking every known migration as applied (db push will sync schema)…"

  # Walk every migration folder under prisma/migrations and force-mark it
  # as applied. P3008 (already applied) and P3007 (already rolled back)
  # are no-ops we swallow. For a FAILED migration, --applied also works:
  # Prisma updates finished_at on the existing row.
  MIGRATIONS_DIR="packages/db/prisma/migrations"
  if [ -d "$MIGRATIONS_DIR" ]; then
    for dir in "$MIGRATIONS_DIR"/*/; do
      [ -d "$dir" ] || continue
      migration=$(basename "$dir")
      # Skip the lockfile (not a migration).
      case "$migration" in
        migration_lock.toml) continue ;;
      esac
      if npx prisma migrate resolve \
        --applied "$migration" \
        --schema="$SCHEMA" 2>/dev/null
      then
        echo "[Clerque]   marked applied: $migration"
      else
        # P3008 / P3007 — already tracked. Continue silently; resolve
        # exits non-zero on these but it's the expected state.
        echo "[Clerque]   already tracked: $migration"
      fi
    done
  fi

  echo "[Clerque] ── Retrying migrate deploy ──────────────────────────────"
  # Should now report nothing to apply (everything resolved). If a NEW
  # migration was added in this deploy and its SQL fails on already-
  # existing objects, the post-deploy db push catches up.
  npx prisma migrate deploy --schema="$SCHEMA" || \
    echo "[Clerque] WARN: deploy still reported a problem; relying on db push catch-up."
fi

# ── Catch-up sync (additive schema reconciliation) ──────────────────────
# Prisma `db push` is forward-only and idempotent for additive changes.
# Every deploy ensures the prod DB matches the current schema.prisma even
# if the delta wasn't captured as a versioned migration. This prevents
# schema drift from silently breaking auth.service / admin queries
# between sprints.
#
# Safety: this is `db push` WITHOUT `--accept-data-loss`. If a future
# schema change requires dropping a column, this command fails loudly and
# the deploy stops — forcing the operator to capture a real migration
# with the destructive step explicit. For all the additive changes
# through Sprint 13 this is safe.
echo "[Clerque] ── Catch-up schema sync (idempotent additive db push) ─────"
npx prisma db push --schema="$SCHEMA" --skip-generate || {
  echo "[Clerque] WARN: db push failed (likely a destructive change pending)."
  echo "[Clerque]       Capture a versioned migration before redeploying."
  exit 1
}

echo "[Clerque] ── Starting API server ────────────────────────────────────"
exec node apps/api/dist/main
