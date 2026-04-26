# ─────────────────────────────────────────────────────────────────────────────
#  Clerque API — Railway Docker build (single-stage)
#  Context: repo root
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# ── Workspace manifests first (better layer caching) ─────────────────────────
COPY package.json ./
COPY packages/db/package.json                   ./packages/db/
COPY packages/shared-types/package.json         ./packages/shared-types/
COPY packages/typescript-config/                ./packages/typescript-config/
COPY apps/api/package.json                      ./apps/api/

# Install ALL workspace deps (hoisted to /app/node_modules)
RUN npm install --workspaces --include-workspace-root

# ── Copy source ───────────────────────────────────────────────────────────────
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

# ── Build ─────────────────────────────────────────────────────────────────────
# 1. Compile @repo/shared-types → packages/shared-types/dist/
RUN cd packages/shared-types && npm run build

# 2. Generate Prisma client
RUN npx prisma generate --schema=packages/db/prisma/schema.prisma

# 3. Compile NestJS API → apps/api/dist/
RUN cd apps/api && npm run build

EXPOSE 3001

# Run migrations then start the server
CMD ["sh", "-c", "npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma && node apps/api/dist/main"]
