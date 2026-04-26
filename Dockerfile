# ─────────────────────────────────────────────────────────────────────────────
#  Clerque API — Railway Docker build
#  Context: repo root  (docker build -f Dockerfile .)
#
#  Build order:
#    1. Install all workspace deps (hoisted to /app/node_modules)
#    2. Build @repo/shared-types  → packages/shared-types/dist/
#    3. Generate Prisma client    → node_modules/@prisma/client/
#    4. Compile NestJS API        → apps/api/dist/
#
#  Runtime:
#    - Run pending migrations
#    - Start the server
# ─────────────────────────────────────────────────────────────────────────────

# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first — better Docker layer caching.
# Changes to source code won't bust the npm install layer.
COPY package.json ./
COPY packages/db/package.json        ./packages/db/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json           ./apps/api/

# Install all workspace deps (npm hoists to /app/node_modules)
RUN npm install --workspaces --include-workspace-root

# Copy all source
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# 1. Compile shared-types (TypeScript → dist/)
RUN cd packages/shared-types && npm run build

# 2. Generate Prisma client binary
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# 3. Compile NestJS API
RUN cd apps/api && npm run build


# ── Stage 2: runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

# Copy workspace manifests for prod dep install
COPY package.json ./
COPY packages/db/package.json           ./packages/db/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json              ./apps/api/

# Prod-only deps (saves ~150 MB vs full install)
RUN npm install --workspaces --include-workspace-root --omit=dev

# Prisma schema + migrations (needed for `prisma migrate deploy` at startup)
COPY --from=builder /app/packages/db/prisma ./packages/db/prisma/

# Compiled packages
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist/
COPY --from=builder /app/apps/api/dist              ./apps/api/dist/

# Regenerate Prisma client for the correct OS binary (alpine → linux-musl)
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

EXPOSE 3001

# Run migrations then boot the server.
# `migrate deploy` is safe to run on every start — it's a no-op when up-to-date.
CMD ["sh", "-c", "npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma && node apps/api/dist/main"]
