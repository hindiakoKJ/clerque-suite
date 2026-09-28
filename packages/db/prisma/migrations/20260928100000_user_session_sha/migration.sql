-- The refresh token as a SHA-256 digest: an exact, indexed lookup, so refresh
-- and logout find their own session (not the first bcrypt match in a loop over
-- every session) and a replayed, copied token can be told from a fresh one.
-- Nullable on purpose: sessions the previous build created keep only the
-- bcrypt hash and are matched the old way until they expire (seven days).
-- A new column only: no existing row is touched.

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN "refreshTokenSha" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_refreshTokenSha_key" ON "user_sessions"("refreshTokenSha");
