-- Each branch's usual closing time.
--
-- "HH:mm", 24-hour, Manila wall-clock time (e.g. "21:00"). At this time Clerque
-- sends the owner the day's ingredient usage report, and later tomorrow's buy
-- list. Nullable with no default: no branch has a closing time until the owner
-- sets one, so no existing row needs touching.

-- AlterTable
ALTER TABLE "branches" ADD COLUMN "closesAt" TEXT;
