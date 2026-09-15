-- Where each purchase line was bought.
--
-- The kitchen's buy list already says what was bought, how many packs and at
-- what price. What it never said is where: the palengke, Puregold, Shopee, the
-- Manila supplier. The owner asked for a history of where each item is usually
-- bought, and that needs the store on the line itself, since one trip can be
-- recorded in parts and a short delivery's balance comes from the same store.
--
-- Two nullable text columns, nothing else. Every line bought before today
-- simply has no store, and the report says how many purchases carry none.
-- sourceKind is plain text checked by the API (SOURCE_KINDS) rather than a
-- Postgres enum, so adding a kind later is a code change, not a migration.
ALTER TABLE "purchase_request_lines"
  ADD COLUMN "sourceKind" TEXT,
  ADD COLUMN "sourceName" TEXT;
