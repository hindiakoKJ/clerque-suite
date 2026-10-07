# Next session: where things stand (written 29 Sept 2026, evening)

KJ works from a laptop and his phone through cloud sessions from 30 Sept.
Start every cloud session with `bash scripts/cloud-session-setup.sh`, and
read `docs/OPERATIONS.md` (section 7 covers cloud sessions: the environment,
the Railway CLI, and how changes reach master as a pull request).

## Waiting on KJ, in this order

0. **Railway auto-deploy:** pushes after 29 Sept did not deploy; KJ ran
   "Deploy Latest Commit" (Ctrl+K) on 7 Oct and `064f0e6` went live with
   the add-on swap migration. Cause: the Railway GitHub App's repository
   access had been narrowed to yms-platform only; KJ set it to All
   repositories on 7 Oct. If a push again shows no Railway status on GitHub,
   check github.com/settings/installations -> Railway App first.
   **Milk add-ons are live on the test shop:** Milk (Hot) on 19 drinks and
   Milk (Iced) on 36 (Oatmilk +30, Breve +40; swap out Emborg Fresh Milk and
   the other milk, swap in Oatside or Breve Milk; no-milk amount = the regular
   dose, 200 ml hot / 150 ml iced). The Oatmilk and Breve products are
   hidden. Proof: ORD-2026-000162 costed Cafe Latte (Hot)+Oatmilk 54.30
   (200 ml Oatside, no fresh milk), Americano (Hot)+Oatmilk 54.90, Cafe Latte
   (Iced)+Breve 39.15.
1. **Backup secrets.** The nightly workflow is switched off (6 Oct, KJ's
   ask, `gh workflow disable`); switch it on again with
   `gh workflow enable "Nightly backup" -R hindiakoKJ/clerque-backups`
   once he sets `DATABASE_PUBLIC_URL` and `BACKUP_PASSPHRASE`
   in `hindiakoKJ/clerque-backups` (Settings → Secrets and variables →
   Actions). When he says they are set, confirm the next nightly run (or a
   manual run he starts from the Actions tab) produced a dump. A session
   attached only to clerque-suite may not be able to read that repository
   through the GitHub proxy; if so, ask him to look at the Actions tab.
2. **Then move Postgres to Singapore** (`asia-southeast1`, where the API
   runs). Today it is in `europe-west4`: 165 ms per round trip, 8–12 s per
   sale, half the sales lost when eight devices save at once (stress test,
   OPERATIONS.md section 12). Walk KJ through it in the Railway dashboard,
   outside shop hours; read Railway's current docs on changing a service's
   region with a volume first, and expect downtime. After the move, rerun
   `apps/api/scripts/probes/db-latency.js` and `books-check.js`.
3. **Approve the cloud SessionStart hook** (optional). A hook in
   `.claude/settings.json` would run `scripts/cloud-session-setup.sh`
   on every cloud session start. The auto-mode safety check refused to add
   it without his explicit OK.
4. **MariBank** (below): build it on a branch when he says go.

## MariBank as a till payment method (sized, not started)

KJ, 29 Sept: most small shops take cash, GCash, Maya, MariBank and QR Ph,
rarely card. No card settlement or fee work. MariBank is not a till method
today (it appears only in how shops pay their Clerque subscription).

- The Prisma enum needs `MARIBANK`: one migration,
  `ALTER TYPE "PaymentMethod" ADD VALUE 'MARIBANK';` (copy
  `migrations/20260623000000_payment_method_card`). Branch, PR, KJ's word.
- `packages/shared-types/src/pos.ts:1` has already drifted from Prisma: it
  has no `CARD`, so the web till's Card tab records `QR_PH`
  (`apps/web/components/pos/PaymentModal.tsx`, `tabToMethod`). Fix both.
- A dormant table, `PaymentChannelConfig` (schema.prisma, one row per
  tenant and method: `isEnabled`, `isBusiness`, `mdrRate`), exists and
  nothing reads it. It can hold "which methods this shop takes" (hide Card,
  GCash personal or business) with no migration. Existing shops must keep
  every method they have now; copy-setup should copy the rows.
- Books: MariBank goes like the wallets, to 1031 Digital Wallet
  Receivable, cleared through Settlement. Make one shared list of digital
  methods: `settlement.service.ts` has two hand-written copies, and one of
  them throws for a method it does not know.
- Every place it touches, with what to do: `tasks/maribank-touchpoints.md`.

Found by the same map, wrong today with or without MariBank:
- The laundry screens map any method they do not list to CASH.
- `accounting/journal.service.ts` fallback void (used only when the SALE
  entry is missing) credits 1010 Cash whatever the tender.
- The customer display relay drops `paymentMethod`, so a second tablet
  always shows Cash.

## Cafe Carolina (KJ's data work before copying the test shop)

- Kitchen recipes: on 7 Oct, Anne's recipe cost cards were loaded into the
  test shop through Settings -> Import Templates: 72 ingredients, 19 batch
  recipes (sauces, breading, breaded chicken, cooked pasta and rice) and the
  recipes of 13 plates (6 starters, 7 wing flavours), 0 import errors. The
  workbook and its "Questions for Anne" tab are kept outside this repository
  (client prices); KJ has them. Still without recipes: the pasta and rice
  meal plates, breakfast, salads, sandwiches, pastries, add-ons, and 12
  counter items.
- Reorder levels: none yet on the 72 kitchen ingredients and the 19 batch
  recipes, plus 9 drinks ingredients.
- Close the 3 open August cashier shifts and the old buy list
  REQ-20260923-002 on the test shop.
- On the real shop: supervisor PIN, hide costs from staff, ledger mode,
  staff accounts, stations, reorder levels, prep items.
- Telegram: he links his phone (Settings → Telegram alerts).
