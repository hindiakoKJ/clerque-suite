# ─────────────────────────────────────────────────────────────────────────────
#  Clerque API — Railway Docker build
#  Context: repo root
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# ── Workspace manifests (layer caching) ──────────────────────────────────────
COPY package.json ./
COPY packages/db/package.json                   ./packages/db/
COPY packages/shared-types/package.json         ./packages/shared-types/
COPY packages/typescript-config/                ./packages/typescript-config/
COPY apps/api/package.json                      ./apps/api/

# --ignore-scripts skips the postinstall `prisma generate` that fires during
# npm install — the schema file isn't copied yet at this layer, so it would fail.
# We run prisma generate manually below after copying all source files.
RUN npm install --workspaces --include-workspace-root --ignore-scripts

# ── Copy all source ───────────────────────────────────────────────────────────
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# ── Build ─────────────────────────────────────────────────────────────────────
# 1. Compile @repo/shared-types → packages/shared-types/dist/
RUN cd packages/shared-types && npm run build

# 2. Generate Prisma client (now the schema exists)
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# 3. Compile NestJS API → apps/api/dist/
RUN cd apps/api && npm run build

EXPOSE 3001

# Run migrations then start the server.
#
# migrate resolve --applied is safe to call even if the migration is already
# applied (it will print an error we suppress, then exit 0 via "|| true").
# Purpose: the two migrations below were applied to Railway via "db push" before
# their migration files were created, so Prisma never tracked them.  Without
# this step they show as "failed" and block every subsequent migrate deploy.
CMD ["sh", "-c", \
  "npx prisma migrate resolve --applied 20260426035055_tax_compliance_and_audit --schema=packages/db/prisma/schema.prisma 2>/dev/null || true && \
   npx prisma migrate resolve --applied 20260426120000_payroll_time_entries --schema=packages/db/prisma/schema.prisma 2>/dev/null || true && \
   npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma && \
   node apps/api/dist/main"]
