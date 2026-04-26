-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('OPEN', 'CLOSED', 'APPROVED', 'REJECTED');

-- AlterTable — add phone, position to users
ALTER TABLE "users"
  ADD COLUMN "phone"    TEXT,
  ADD COLUMN "position" TEXT;

-- CreateTable
CREATE TABLE "time_entries" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "clockIn"    TIMESTAMP(3) NOT NULL,
    "clockOut"   TIMESTAMP(3),
    "breakMins"  INTEGER NOT NULL DEFAULT 0,
    "status"     "TimeEntryStatus" NOT NULL DEFAULT 'OPEN',
    "notes"      TEXT,
    "grossHours" DECIMAL(6,2),
    "otHours"    DECIMAL(6,2),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "time_entries_tenantId_clockIn_idx"        ON "time_entries"("tenantId", "clockIn");
CREATE INDEX "time_entries_tenantId_userId_clockIn_idx" ON "time_entries"("tenantId", "userId", "clockIn");
CREATE INDEX "time_entries_userId_status_idx"           ON "time_entries"("userId", "status");

-- CreateIndex (users role index)
CREATE INDEX "users_tenantId_role_idx" ON "users"("tenantId", "role");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
