-- Who may see what the shop paid for a delivery.
--
-- Procure is deliberately one screen for the whole shop: the cook adds what is
-- short, the owner records what was bought. The cost therefore sat in front of
-- everyone who could open the request. For Cafe Carolina that is correct --
-- the same people unpack the bags and read the receipt -- but it should be the
-- owner's call, not the software's.
--
-- Defaults TRUE rather than FALSE. Every shop on this schema today shows costs
-- to everyone, so defaulting true says the thing that is already true and
-- changes nothing until an owner decides otherwise. Defaulting false would
-- silently take a screen people use every day and make it less useful
-- overnight, which is not a migration's job.
ALTER TABLE "tenants"
  ADD COLUMN "showPurchaseCostsToStaff" BOOLEAN NOT NULL DEFAULT true;
