# When ingredients count as used: at the sale, or when the kitchen or bar marks it ready

> KJ, 2026-09-15: "recognition of the usage of the ingredients is as per confirmed order ... ready to
> serve ... as a set on stone rule for ingredients usage, on inventory and on ledger, once confirmed by
> kitchen or bar, that's the time quantity will be deducted." And: "we have already the void system that
> returns the quantity of the ingredients right? or do we treat it as waste?"

Study: 4 code readers, 1 design, 1 adversarial critique (read-only, no database touched). Citations are
to the code on master 51b85b1. Full notes: session scratchpad `deduct_study.txt`.

## Today, from the code

- **Everything is used at the sale.** One transaction in `OrdersService.create` walks each line's recipe
  (size recipe, modifier ingredients), takes the stock off, stamps `ingredientsDeductedAt`, and queues the
  cost of goods entry (orders.service.ts:561-1549). The kitchen and bar screens only change the ticket's
  status; they never touch stock or the books (kds.service.ts:101-191).
- **A void does NOT return ingredients.** Not even for an order the kitchen never started: void accepts
  PAID orders and never looks at the ticket's status (orders.service.ts:1663-1668, 1711-1740). An item refund
  is forced not to restock recipe items (1952-1953). So today every voided recipe item is waste.
- **The books keep that waste as cost of goods sold** (5010), not as 5070 Spoilage & Waste
  (journal.service.ts:719-741). The P&L page groups 5070 under cost of goods anyway (pl-statement page:36-56).
- **The void dialogs say the opposite:** "restocks inventory" (ReceiptModal.tsx:740), "restore inventory"
  (orders/page.tsx:453). False for recipe items.

## What "used when ready" would take, literally

1. Items that never reach a kitchen or bar screen (bottled drinks, cake slices, a station with no tablet,
   any category not routed) never get a "ready" tap, so they must still be used at the sale.
2. While tickets wait, the till's "N left", the out-of-stock refusal, the buy list and the prep board
   would all think the milk is still there. Every one of about 27 places that reads ingredient stock must
   subtract waiting tickets, or the till sells the last portion twice.
3. A ticket nobody taps would never post its cost: a nightly auto-confirm is needed, plus a rule for
   orders it leaves stuck.
4. Accounting still has to put the cost on the SALE's day (revenue and its cost in the same day and
   month). So the books end up exactly as they are today -- only written later and backdated.
5. Unbump would have to give stock and cost back; a count taken during service double-counts drinks
   poured but not tapped; a database change (3 columns on order lines) is needed.

## Recommended instead: same money result, no database change

Keep using ingredients at the sale (a drink being made has already used the milk), and make void and
refund follow what the kitchen or bar did:

- **Voided or refunded BEFORE it was marked ready** (routed to a screen station, still waiting): the
  ingredients go back to stock and the cost is reversed.
- **Voided or refunded AFTER it was marked ready**, or an item made at the counter: it was made, so it
  stays used, and it is shown as waste.

End-of-day stock and cost come out the same as KJ's rule, with no overselling risk, no nightly job, no
backdating, and no migration.

## Worth fixing whichever way (found on the way, no database change)

- Orders routed to a station that has no tablet stay "Preparing" forever, which also blocks the BIR
  e-invoice (orders.service.ts:590-603; bir.service.ts:755-757). Template layouts create exactly this.
- Kitchen screen: a refunded item still shows at full quantity; a voided order's item can still be bumped
  through the API; two tablets bumping at once can both win (kds.service.ts:45-75, 101-115).
- Two lines of the same product with different sizes or add-ons both get the last line's cost in the books
  (orders.service.ts:1294-1295, 1527-1531) -- to verify before fixing.
- A void after a partial refund reverses the refunded part a second time (journal.service.ts:686-694).
- The cost of goods entry of an offline sale is dated to when it synced, not the sale day
  (orders.service.ts:1497-1510; journal.service.ts:463-471).
- The void dialog wording.

## Decision (KJ, 2026-09-15)

- [x] **A. Used when ready, literally.** Chosen over the recommended B, knowing it needs a database change,
      a hold on every stock reader and a nightly auto-confirm.
- [x] **Fix the bugs found too.**

Settled with it (tell KJ, change if asked): the cost is dated to the SALE's Manila business day, so a
day's revenue and its cost stay in the same day and month even when the ready tap or the nightly confirm
comes later.

## Plan

### Stage 1 -- no database change, master
- [x] 1a Kitchen screen and routing: an order waits at "Preparing" only for a station with a screen; bump
      refuses voided/refunded/non-paid orders and is atomic (two tablets cannot both win); the queue hides
      refunded quantity; serve without bump goes through bump; unbump rolls the order back only when right;
      the station page shows a refused unbump.
- [x] 1b One recipe-usage function for the sale and Recipe Catch-Up (size recipes, add-on ingredients);
      cost per order line, not per product; lot drains written relative and guarded.
- [x] 1c Voids and refunds: no double reversal after a partial refund; no restock value without a stock
      row; restock only what was not refunded; the void window on the Manila calendar; the cost of goods
      entry dated to the sale day; the void dialog says what really happens.

- [x] Review fixes on top of Stage 1:
      a refund then a void: the void entry reverses revenue/VAT to zero and hands back only what the
      refunds left, per payment account (cash refunded on a GCash sale stays out of the drawer); it waits
      for a refund entry that has not posted; the shift close and the daily report count it once; the void
      dialog shows what is handed back. Bump, un-bump, serve, refund and void take the order's row lock
      first. A nightly 02:30 job (kds/stuck-orders.scheduler.ts) releases orders from before today left at
      "Preparing" with nothing to make -- its first production run releases the old backlog; Stage 2g
      extends this job. Un-bump refuses a fully refunded line and reopens the order only from READY. A
      refund or void books stock value back only for a line costed from its own stock, not from a recipe.
      Catch-up lists size-recipe products as having a recipe. FIFO shelf cost averages over all lines of
      a product. Verified: 1870 API tests, live_stage1.js 18/18 on local carolina-test.
- [ ] Not done, noted: orders completed by a refund or by the nightly release carry a readyAt that is
      not a kitchen time, so the lead-time figure (readyAt - paidAt) counts them; it should skip orders
      with no bumped line.

### Stage 2 -- design as built (2026-09-15, KJ AFK: "finish all phases and stages ... push")

Map of the current code: 4 readers + 1 checker (workflow wf_ce067fe5-894). Decisions taken, tell KJ:

- **Which lines wait.** A live till sale (channel POS, not an offline replay -- a new `replayedOffline` option,
  set by the replay header and by /orders/sync), recipe deduction not paused, the line's category waits at an
  active station with a screen, and the line actually uses ingredients. Everything else is used at the sale as
  today. `USAGE_ON_READY=off` on Railway stops marking new lines; lines already waiting still confirm.
- **Only ingredients wait.** A shelf item (InventoryItem) in a routed category still comes off the shelf at the
  sale; void and refund restock it as today. A product that keeps a shelf row at the branch (even at zero) and is
  not itself marked RECIPE_BASED never waits: a void or restocking refund reverses the cost of its unit, so the
  sale must book it (review fix). A waiting line is never restocked by a void or refund.
- **Confirm** (bump, serve, or the 02:30 nightly job for lines paid before today): once, guarded on
  `usagePostedAt IS NULL`, under the order lock. Recipe x (quantity - refunded) comes off stock (relative
  decrement, floor 0, lots drained when FIFO/lot-tracked) unless deduction is paused; cost by the sale's own
  waterfall; one COGS event per confirmed line dated to the sale (completedAt = paidAt), carrying orderItemId,
  lineKey, the ingredients and lots taken. Recipe edits between sale and ready are read live by both the hold
  and the confirm, so they agree with each other.
- **Hold.** `heldUsage()` = recipe usage of waiting lines (PAID/COMPLETED, net qty > 0) per branch. Subtracted
  wherever stock decides availability or an expectation (till N-left and refusal, buy list and menu ceiling,
  low-stock and alerts, prep board and batches, transfers, project issues, cycle-count start, depletion,
  variance). Not subtracted where stock is a physical record (write-off cap, receiving WAC, count posting,
  valuation, exports).
- **Unbump** of a confirmed line: same Manila day as the confirm, sale's period open, and no refund on the line
  since the confirm; gives back exactly the confirm's ingredients and lots, and posts a new COGS_ADJUSTMENT
  USAGE_RETURNED (Dr 1051 or 1050 / Cr 5010) dated to the sale. Never through the VOID handler.
- **Void / refund.** A waiting line gives nothing back and books no waste. A used line (at sale, or confirmed)
  that is not restocked is waste: COGS_ADJUSTMENT WASTE, Dr 5070 / Cr 5010 at the cost the COGS entry booked,
  dated to the void or refund; the handler waits for the order's COGS entries to post first.
- **Books.** New enum value COGS_ADJUSTMENT with its handler; confirm uses the plain COGS handler.
- **Period close** refuses while lines from the period wait (Manila end of day) or while the period's COGS /
  usage-returned entries are unposted; same in the checklist and year close.
- **Also fixed on the way:** write-off and cycle-count post write stock relatively (a bump is now a concurrent
  writer); a customer-display tablet cannot bump or serve; serve takes the order lock; the SALE event no longer
  copies a pharmacist's attest PIN; lead time counts only orders a kitchen or bar bumped.

### Stage 2 -- adversarial review fixes (2026-09-16, workflow wf_ecbea91f-954: 10 confirmed = 4 distinct)
- Void/refund of a waiting line that has a shelf row reversed a cost never booked -> rule above.
- A ready tap and a sale could deadlock (stock row and lot rows taken in opposite orders) -> confirm and un-bump
  first take the shop's POS order counter row, which every sale takes first (`queueBehindSales`).
- The 02:30 job paged with cursor + skip 1 over a filter it changes, stepping over a line per page -> pages by
  `id > last`. Same in the stuck-order release. Fully refunded tickets are stamped but not reported as made.
- Count post clamps stock at zero; a count posts back the holds voided or refunded since it started.
- Also: the confirm records only what really came off (floor after a concurrent write); un-bump refused when the
  tap was made while paused and Recipe Catch-Up took the ingredients since; `USAGE_ON_READY` accepts
  off/false/0/no/disabled; WASTE entries hold the period close; legacy waste with two lines of one product uses
  the line's own cost; lead time skips orders finished by the nightly job; web reports say "cost still to come".

### Stage 2 -- deploy is forward-only (runbook)
The migration adds columns and an enum value. The previous build cannot boot on it (`prisma db push` in start.sh
would drop the columns and refuses), and old code never confirms lines already marked to wait. So never roll
back by redeploying master-before-Stage-2. If something is wrong in service:
1. Railway env `USAGE_ON_READY=off` on the API service -> new sales are used at the sale again; lines already
   waiting still confirm on the tap or at 02:30.
2. Fix forward. Only if the code must truly go back: wait until no line waits
   (`usageOnReady AND usagePostedAt IS NULL` on PAID/COMPLETED orders = 0) and every COGS_ADJUSTMENT event is
   SYNCED, then write a down-migration -- do not rely on db push.

### Stage 2 -- the rule, branch `procure-deduct-on-ready` with the migration (KJ merges)
- [x] 2a Migration: OrderItem.usageOnReady (default false), usagePostedAt, readyById. Existing rows read
      as "used at sale", which is true.
- [x] 2b Sale: a live POS line routed to an active station with a screen is marked to wait; its stock,
      lots and cost are not taken. Everything else as today (counter items, offline sales at sync, API).
- [x] 2c Confirm on bump or serve: the line's recipe (net of refunds) comes off stock at the order's
      branch, lots drain, cost posts dated to the sale day, stamps set -- once, atomically.
- [x] 2d Unbump (same Manila business day only, open period only) gives back exactly what was used, with
      its own journal event -- never through the VOID handler, which would wipe the sale.
- [x] 2e Void or refund: a waiting line gives nothing back and books no waste; a used line is waste
      (5070), valued at its booked cost.
- [x] 2f Hold: every reader of ingredient stock that decides availability uses on hand minus waiting
      tickets (till N-left, sale refusal, buy list, prep board and station screen, batches, transfers,
      write-off, low-stock and 03:00 alerts, cycle count start, depletion forecast).
- [x] 2g Nightly auto-confirm at 02:30 Manila (before the 03:00 stock alert): confirms and promotes
      yesterday's untapped tickets, logged, count shown to the owner. Queue hides waiting lines older than
      today once confirmed.
- [x] 2h Recipe Catch-Up skips waiting lines; period close refuses while tickets from the period wait
      (Manila end of day, not UTC midnight); cycle counts expect on hand minus held.
- [x] 2i Reports: ingredient usage and variance count what actually left; margin/daily reports say
      "cost pending" for waiting lines.
- [x] 2j Kill-switch env: turning it off stops MARKING new lines; lines already waiting still confirm.
