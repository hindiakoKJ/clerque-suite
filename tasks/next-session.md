# Next session: where things stand (written 29 Sept 2026, evening)

KJ works from a laptop and his phone through cloud sessions from 30 Sept.
Start every cloud session with `bash scripts/cloud-session-setup.sh`, and
read `docs/OPERATIONS.md` (section 7 covers cloud sessions: the environment,
the Railway CLI, and how changes reach master as a pull request).

## KJ's priorities (7 Oct)

Recipe-based costing and reporting first, then the kitchen/bar/customer
displays, then "what to buy". Coffee shops first; the second coffee shop must
be plug and play. Reorder levels get filled on site. Parked until the test
shop is complete: one import file with everything for the real Carolina
shop (Copy setup does the same in one step). Later: one "E-wallet" payment
for GCash/Maya/MariBank/other wallets, QR Ph kept separate.

## Security check against the 19-item sign-up list (13 Oct)

The full report (with exploit paths, so NOT in this public repo) is on KJ's
desktop: `E:\AI Projects\Clerque - Security check (19 items) - 2026-10-13.md`.
The list itself is in KJ's global CLAUDE.md for every app with a login.

Shipped 13 Oct: `00ddd66` (published demo passwords refused at sign-in and
when setting a password; platform admin walled off from shop owners and PIN
sign-in; pharmacist PIN check no longer leaks PINs; 2FA codes count toward
lockout), `76b5090` (NestJS 11.2.7 / multer 2.4.0 / compression 1.8.2),
`3129d46` (Next.js 16.3.8). Dependabot vulnerability alerts switched on.

Open, in this order:
1. **KJ changes the platform admin's password** (Settings > Security >
   Change Password), then set `PLATFORM_ADMIN_MAY_USE_SEEDED_PASSWORD` to
   false in `apps/api/src/auth/published-passwords.ts` and push. 2FA for that
   account when he is at a computer (QR scan), and save the backup codes:
   its .test address cannot receive a reset link.
2. **Till prices** (done 13 Oct, KJ's yes): the server still books a till
   line as sent, but after every till sale it compares each line with the
   owner's prices (product or size + add-ons) and any promo discount with
   the shop's active promos (orders/price-check.ts). A line below menu goes
   to the audit log (PRICE_ADJUSTED on the Order), each owner's bell and
   the Telegram sales chat. Nothing is refused: an offline till that missed
   a price change still sends the old price, and the alert says so.
3. Then: cross-shop ids accepted on bank reconciliation, pre-orders,
   laundry, rentals, modifiers and manual journals; tokens in localStorage
   (move to httpOnly cookies); email verification at sign-up; Sentry
   scrubbing; CSP without unsafe-inline/eval.

## Clerque Inventory, phase 1 (live 13 Oct)

Plan: `tasks/inventory-and-mobile-plan.md`; API contract:
`tasks/inventory-phase1-api.md`; the shop it is for:
`tasks/surplus-autoparts-plan.md`. Shipped `a3397c4` (API) and `462575a`
(web): tags on one-of-a-kind parts (printed 6-digit labels, photos, owner
costs each piece), sold once by number at the retail till at their own cost,
with the theft rules. The Inventory card shows at RETAIL shops only (the
token now carries businessType; older sessions see it after re-login).
Cafes are unchanged. Checked end to end on a local copy, books included.
Local test shop: `surplus-local` (accounts in the gitignored apps/api/.env).

## Web finished before the Play app (13 Oct, KJ: "finish first everything on the web app")

No migration. Checked on the local copy, books included:
- **Theft checks** (`tags/tag-checks.service.ts`, Inventory screens Roll call
  and Return a part): roll call by tag number, blind (staff see only "sent";
  results, with when each missing part was last found, are the owner's
  alone, in the bell and on the owner's Telegram, never a manager's);
  a part brought back that was never sold alerts the owner at once, with
  whose drawers were open since (names to the owner only); owner-only tag
  write-off with a photo (damage to 5070, lost/stolen to 5060, at the
  tag's own cost; a part waiting for cost is only retired); printed label
  numbers never used, on Print labels.
- **Product write-offs** (Adjust Stock): reason code reaches the books,
  valued at the shelf's average cost, approver on the log, audit row, PIN
  through the shared lock-out, and nobody approves their own.
- **Sales on account** now work from the web till (they never did: the till
  always sent a payment, which the server refuses for CHARGE, and opening
  the B2B panel silently switched a cash sale to CHARGE). Pick a customer
  account; nothing is paid; receipt says "On account, to collect". Credit
  limits (set in Ledger > Customers) refuse a sale over the limit, except
  the owner's. The day's report shows "On account" among the ways of paying.
- **VAT line**: owner's dashboard card for a non-VAT shop from ₱2.4M of the
  ₱3M in the last 12 months.
- **Daily close on Telegram** at 21:30 Manila per branch (sales by method,
  tagged parts, discounts, voids, refunds, drawers, flags); the owner's copy
  has tag costs and margins, the managers' does not.

**KJ to decide:** product write-offs now always need a second person's PIN,
the owner's included, so a shop whose only PIN holder is the owner cannot
write off a broken item. Letting the owner sign for their own write-off was
refused by the session's safety check as loosening a security rule; it is
KJ's call (`inventory.service.ts`, `adjust`).

Next: the Play app (phases 3-4 of the inventory plan), after KJ's word.

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
