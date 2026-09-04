# Open work — Clerque

## Kitchen-readiness fixes (2026-08-30) — ALL FOUR FIXED

Found by adding a real food menu to a real tenant and running it: 11 kitchen
ingredients, a sub-recipe, an 8-line rice bowl, and one ticket carrying a bar
drink and a kitchen dish together. The mechanics held — every recipe line
deducted, the sub-recipe costed to the centavo, COGS posted `Dr 5010 / Cr 1051`,
trial balance footed. Four things did not.

- [x] **1. "Nothing is below its reorder level" when nobody is watching.**
      `getLowStock` filters `lowStockAlert != null`
      (`inventory.service.ts:404`), and Procure's Check stock reads exactly that
      list (`procure.service.ts:160`). The reorder level is optional in the app
      AND in the onboarding workbook, so a shop can load 60 ingredients with no
      reorder level on any of them and the buy list stays permanently empty —
      while the toast says *"Nothing is below its reorder level right now."*
      **Proven:** 11 kitchen ingredients created, 0 returned by `getLowStock`.
      Fix: report how many ingredients are unmonitored. Do not invent a default
      reorder level — a guessed threshold is worse than a stated absence.

- [x] **2. Units do not convert in the app's Add-ingredient form.**
      `RawMaterial.unit` is a display label; `conversionFactor` is used nowhere
      outside the UoM module. Buy in kg, write the recipe in grams, and the
      recipe costs 1000x. **Proven:** ₱48,000 cost on a ₱220 dish, −21,718%
      margin, 0 producible.
      The failure is LOUD, not silent — which is why this is a setup problem,
      not a corruption. And the conversion already exists: the onboarding
      workbook does buy-unit → recipe-unit with a pack size
      (`import.service.ts:2157`). It simply is not reachable from the app form.
      Fix: extract the conversion, and let the form take the same two units.

- [x] **3. The importer does not net input VAT; the receive form does.**
      `receiveRawMaterial` divides by 1.12 for a VAT tenant on a non-
      OWNER_FUNDED receipt (`inventory.service.ts:1472`). The spreadsheet path
      has no `taxStatus` lookup at all. A workbook row marked CASH or CREDIT
      capitalises gross while every later receive is net, so the WAC blends two
      bases and the input tax on opening stock is never claimed.
      Blank payment method defaults to OWNER_FUNDED, where both agree — so this
      bites only the shop that filled the column in honestly.

- [x] **4. The AP bill records net while the GL records gross.**
      A CREDIT receive credits `2010` with `grossValue`
      (`journal.service.ts`), but the AP Bill it creates alongside sets
      `subtotal: totalValue` (net), `vatAmount: 0`, `totalAmount: totalValue`
      (`inventory.service.ts:1692`). A ₱112 delivery becomes a ₱100 payable:
      the sub-ledger and the GL disagree by the VAT on every credit purchase,
      and the shop pays ₱112 against a bill that says ₱100.

### Verified working, same run — do not re-investigate
Sub-recipe batches drain their components (soy 2000 → 1500 for 2 × 250 ml) and
cost at inputs ÷ yield. An 8-line recipe containing a sub-recipe costs
correctly (₱87.47 computed = ₱87.47 by hand). One ticket spanning bar and
kitchen deducts all 12 lines. COGS carries `RECIPE_WAC` and credits 1051. The
supply guard refuses a kitchen supply from a recipe. 1048 tests green.

### How each was closed, and proved

Fixed in one pass, then verified against the real database rather than argued
from the code. 36 new tests; 1084 API tests green; web build green.

1. `createRawMaterial` was **dropping the reorder level entirely** — the form
   sent it, the DTO carried it, the create wrote name/unit/category/cost and
   nothing else. So every ingredient added in the app was unmonitored by
   construction, which is why the kitchen items were invisible. It is now
   written, and `pullLowStock` returns `unmonitored` so an empty buy list says
   which of the two things it means. No default reorder level is invented.
   *Live:* reorder level 2000 persisted, item found "short by 2000 g", and the
   real tenant reported **55 ingredients nobody is watching**.

2. The importer's buy-unit conversion moved to
   `inventory/unit-conversion.ts`, and the app's Add-ingredient form now takes
   the same two units plus a pack size. One table, two doors.
   *Live:* 1 kg at ₱320 with recipes in g stored as ₱0.32/g; 1 pc at ₱150
   holding 750 ml stored as ₱0.20/ml; "sack" → g refused with
   *"Add a Pack Size saying how many g are in one sack"* and nothing written.
   Only on create — re-scaling an existing ingredient would move stock that is
   already counted on a shelf.

3. The importer now resolves `tenant.taxStatus` once per sheet and nets the
   cost on the same rule as `receiveRawMaterial`, so the lot, the WAC and the
   ledger share one basis. OWNER_FUNDED — the default for a blank column — is
   excluded on both paths, so nothing changes for a shop that left it blank.

4. The AP bill now carries `subtotal` net, `vatAmount` the input tax and
   `totalAmount`/`balanceAmount` the gross, which is what the supplier will
   actually collect and what the journal already credits to 2010.
   *Live:* a ₱1,120 delivery books as 1000 + 120 = 1120, was 1000 + 0 = 1000.

Trial balance after all of it: **Dr ₱31,514.62 / Cr ₱31,514.62**, no negative
stock.

---

## Must-fix list — ALL TEN CLOSED (2026-08-31)

From `tasks/three-app-review.md`. Each verified against the real database, not
just unit-tested.

- [x] **1. You could not pay a supplier.** Seven `journal.create` call sites
      omitted the `source` argument, so AP and AR posted as MANUAL and were
      refused by the posting-control guard that exists to protect those
      accounts FROM manual entries. Hidden because `seedDefaultAccounts` only
      INSERTS missing codes and never updates `postingControl` — older tenants
      are grandfathered OPEN and work by accident; a fresh tenant gets the
      restriction. *Live:* the exact 403, then `JE-202608-0062` bill posted and
      `JE-202608-0063` supplier paid.
- [x] **2. AP bill written net with zero VAT** (closed in the previous batch).
- [x] **3. A promotion 500'd the Charge button.** `'PROMOTION'` is not one of
      the five `DiscountType` values, so Prisma rejected the write and took the
      whole ticket with it. `as const` made TypeScript agree it was fine.
- [x] **4. A count undid the sales made while counting.** `expectedQty` is a
      snapshot from when the count STARTED; the counted figure was written
      straight over live stock. The variance is still measured against the
      snapshot — that IS what the counter found — but it is now APPLIED to live
      stock. *Live:* counted 4800 with 300 g sold during the count → shelf 4500,
      where the old code wrote 4800.
- [x] **5. Nothing ever wrote a Z-Read.** Now generated when the LAST open
      shift at a branch closes — the shop's day ends when the shop says so, not
      at a clock. Fire-and-forget: a cashier must be able to close her drawer
      whether or not the report builds. *Live:* silent on the first of two
      closes, written on the last, still one after closing again.
- [x] **6. A refund was booked as the cashier being short.** Refunds were read
      nowhere. Attributed by when the cash LEFT the drawer, not when the sale
      happened.
- [x] **7. The owner's sales were invisible to the drawer.** Now impossible:
      cash without a till is refused. See the answered question below.
- [x] **8. An opening count was booked as a write-off.** The screen never sent
      `isOpeningBalance`, so a shop's first count credited 5060 — a negative
      expense. Posting now asks which kind of count it is, in words.
- [x] **9. One mistyped cost re-costed the whole menu.** Refused at an order of
      magnitude from the cost on file, naming both prices and pointing at the
      unit, with a deliberate override for a real price move.
- [x] **10. "Send to kitchen" sent nothing.** Removed rather than wired: the
      KDS reads `OrderItem` directly, so a ticket arrives when the ORDER is
      created. There was never anything for it to do.
- [x] **Bonus (should-fix #17).** The close screen listed opening cash and
      sales, then a total with refunds, paid-outs and drops subtracted
      invisibly. All three now show when non-zero.

### The shift question — ANSWERED (KJ, 2026-08-31)

> "owners should have no shift. cashier should be the only one with cash."

Which turns the fix inside out. It is not "make the owner open a shift" — he
keeps none, deliberately. It is that **cash cannot be taken without a drawer to
put it in**, so a POS cash sale carrying no `shiftId` is refused outright
(`CASH_WITHOUT_SHIFT`). Non-cash is untouched: a GCash sale opens no drawer, so
an owner can still ring one, and the till hides the Cash and Split tabs rather
than letting him count the money first and fail at Charge.

Deliberately NOT requiring the shift to be open *now*: the Counter app queues
sales offline and syncs them later, sometimes after the cashier has gone home.
The cash was in a drawer when it was taken. Presence is the control; openness
is a timing accident.

`unattributedCashSales` survives as a backstop rather than the defence — it
should now read zero for anything rung under the guard, so a non-zero value
means an order predating the rule or something that got past it.

### Note on existing tenants
`seedDefaultAccounts` never updates `postingControl` on accounts that already
exist, so tenants created before a control was added keep the old one. The demo
tenant's `2010` was OPEN and has been set to `AP_ONLY` to match the seed. Worth
a one-off sync before onboarding anyone whose books already exist.

---

## Week-one list — ALL CLOSED (2026-08-31)

Everything remaining from `tasks/three-app-review.md`, plus the three kitchen
defects found by hand. 1177 API tests, 105 suites; web build green.

### The books
- [x] **Cash Flow called every current asset "cash."** The band ran 1000–1099,
      sweeping in AR, Digital Wallet Receivable, Input VAT and both inventory
      accounts. It still reconciled, which is what made it convincing. Cash is
      1010–1025; 1030–1099 now lands in operating so nothing is dropped.
      *Live:* ending cash ₱-388,995 = the 1010 balance exactly, with 1031,
      1040, 1050 and 1051 all in the operating section.
- [x] **The Sales Book printed senior and PWD sales as taxable.** The
      VAT-Exempt and Zero-Rated columns were hard-coded to zero while the till
      already recorded `taxType` and posted no output VAT — so the book
      contradicted the ledger and overstated the output-tax base.
- [x] **The Purchase Book had no stock in it.** It read `expenseEntry` only, so
      the 2550Q input-tax claim had no supporting book behind its largest
      component. Sourced from the lots, on the same net basis and the same
      OWNER_FUNDED exclusion as the receive path.
- [x] **A failed accounting event was a dead end.** Re-queued every ten minutes
      up to five attempts; the ones that give up are logged loudly every pass.
- [x] **Closing a period could lock out work already on its way** — which grew
      teeth the moment failed events began retrying. Now refuses while anything
      up to the period end is unposted, and says how many.
- [x] **Expense claims never reached the ledger at all.** DRAFT → SUBMITTED →
      APPROVED → PAID, the employee got their money, and the expense appeared
      nowhere. Posted on PAID as `PAID_OUT`, one per line so the category
      detail survives.
- [x] **The trial balance was a day behind the statements it proves.**

### Stock
- [x] **Two tills erased each other.** Every deduction and receipt wrote an
      absolute quantity from a stale read. Relative now, with one floor
      statement after — keeping both the concurrency safety and the
      no-negative-stock invariant.
- [x] **A Large cost the same as a Regular.** `variantBomItem` was written and
      never read. *(The write endpoint still has no screen — worth a UI before
      anyone relies on it.)*
- [x] **An ingredient with no stock row was free forever.**
- [x] **A count could restate a closed month**, and **a batch could too.**
- [x] **Batch prep had an API and no screen** — `/procure/batches` now exists,
      with a list endpoint that resolves every recipe's remaining batches in
      one stock read.
- [x] **Batches could be recorded twice, and left their components' lot layers
      untouched.**

### Reports
- [x] **The dashboard and the income statement disagreed about cost.** The
      resolved waterfall cost is now written back to the order line.
- [x] **The X-Read dropped the lunch rush** — COMPLETED only, where the Z-Read
      counts PAID and COMPLETED.

### Still open, deliberately
- Variant recipes have no editing screen. The consumption side is correct now,
  so this is latent rather than dangerous — but nobody can define one yet.
- `postingControl` never syncs to existing tenants, so a tenant created before
  a control was added keeps the old one. Worth a one-off sync before onboarding
  anyone whose books already exist.
- `1053` Finished Goods and `1052` WIP remain dead, on purpose.

---

## Cafe Carolina — the operational walkthrough (2026-08-31)

KJ's list, run in his order, on a **fresh NON_VAT tenant** with three branches
(Stockroom / Bar / Kitchen). Every step against the real database.

| # | Step | Result |
|---|---|---|
| 1 | Order ingredients | `REQ-20260831-001` sent, 3 lines. **Nothing posted** — an order is a commitment |
| 2 | Receive | 3/3 posted. `JE-0001  Dr 1051 9,000 / Cr 1010 9,000` — **no 1040**, she is not VAT-registered |
| 3 | Weighted average | 5,000 g at ₱1.80 + 5,000 g at ₱2.20 → **₱2.00/g**, 10,000 g on hand |
| 4 | Count the shelf | system 10,000, counted 9,850 → corrected, and the 150 g shortfall hit **5060 write-off**, not COGS |
| 5 | Sauces, 3 levels | L1 ₱0.02/ml → L2 ₱0.13/ml → L3 **₱0.21/ml**. Each level consumed the level below it (400 g sugar → 1,000 ml L1 → 600 ml L2) |
| 6 | Move stock | Stockroom → Bar 3,000 g; Stockroom → Kitchen 400 ml sauce. Total unchanged at 9,850 g — **nothing created or lost** |
| 7 | Operating supplies | 2,000 ml bleach → `Dr 6210 300 / Cr 1010 300`. **Expensed, never capitalised** |
| 8 | Sell | 2 × Sauced Latte, ₱360 cash. `Dr 1010 360 / Cr 4010 360` — **no output VAT** |
| 9 | Recipe COGS | ₱53.62/cup hand-checked; `RECIPE_WAC`, `Dr 5010 107.23 / Cr 1051 107.23` |
| 10 | Stock moving | beans 3,000 → 2,964 (2×18) · milk 20,000 → 19,700 (2×150) · **sauce 200 → 160 (2×20)** |

Books after: trial balance **Dr ₱27,957.23 / Cr ₱27,957.23**, 0 unbalanced,
0 negative stock, 0 stuck in the queue.

### The one thing that is not what it looks like

**"Stockroom / Bar / Kitchen" are BRANCHES in this run, not rooms.** The
transfer mechanics are proven and correct — quantity moves, nothing is created
or lost — but they are branch-to-branch, which is the model that exists today.
Rooms inside one branch (`StockLocation`) is the migration we deliberately
parked. Using branches for rooms works for stock but gives each room its own
Z-read, its own shifts and its own line in every report, which is wrong for one
shop. See the transfer decision in `procure.md`.

---

## The 3-level prep pipeline, in Procure (2026-09-01)

KJ's rotation, stated in his words: **L1** ready to use on the line (partly
consumed daily), **L2** prepared and parked, **L3** raw ingredients ready. When
L1 runs down, L2 becomes L1, L3 becomes L2, and the stockroom refills L3.

The mechanism for this already existed — a sub-recipe moves quantity and cost
between levels — so nothing here is a new engine. Four things were missing, and
all four are what a shop actually touches.

- [x] **A prep is MADE, not BOUGHT.** A prepared item is a `RawMaterial` like
      any other, so a low sauce landed on the grocery slip next to the milk.
      Worse for a rotation: the parked batch is empty by design half the time,
      so it would have nagged nightly. `getLowStock` now tags each row
      `PREP | INGREDIENT` (having a recipe is what decides it); the buy list
      filters preps out and returns them as `toMake`; the nightly alert routes
      them to a "To prep" line instead of "out of stock"; and the Purchase
      request screen says *"… need making, not buying"* with a link to the prep
      board rather than silently dropping them.
- [x] **A prepared batch has a clock.** `makeBatch` left `expirationDate` null,
      so a tub thawed today and one thawed three weeks ago were the same row —
      FEFO had nothing to sort by and the expiry warnings never fired for
      anything the shop made itself. The record form now asks *"Good for how
      many days?"* (optional), counted forward from when it was made, and shows
      the date back. **No migration** — `RawMaterialLot.expirationDate` already
      existed.
- [x] **A screen to define a prep.** `PUT /inventory/sub-recipes/:id` had
      existed all along and nothing in the web app ever called it, so a prep
      could only be set up through the API by hand. That was the blocker under
      everything else. New: `/procure/batches/setup` — name, unit, what one
      batch makes, what goes into it, and the par level. Owner/MDM only, gated
      to match the API.
- [x] **Par levels.** Zero is the wrong trigger for anything prepped ahead: the
      backup is empty by design, and waiting for the READY one to hit zero
      means waiting for the shortage. The board now shows *"Down to 400 g —
      time to make the next batch"* while there is still stock to serve from,
      and says out loud when a prep has **no** level set, because that one fails
      silently.

### The question KJ asked about a partly-used L1

As stock it needs no special treatment — it carries over, and the WAC blend
already handles a half tub plus a fresh batch. What it needed was the two
things above: a **par level** (the promote trigger) and a **shelf life** (its
clock). Both now exist.

### Verified

| What | How |
|---|---|
| API unit suites | 1,254 passed, 0 failed (113 suites) |
| Nightly alert | had **no test at all** — 10 written, incl. the rotation case: an empty parked batch with no par level stays silent |
| Real Postgres | `prep-pipeline.e2e-check.spec.ts`, 6/6 — setup → batch with expiry → par level → make-list vs buy-list |
| Lot expiry | batch made 01:26:51 → `expirationDate 2026-09-06T01:26:51Z`, exactly 5 days. Pre-existing lots still null |
| Setup screen | prep created through the UI landed as `batchYield 2000, lowStockAlert 400, Ketchup 1500 g` |
| Board | *"Down to 400 g — time to make the next batch"* at 400 g against a par of 500, while ready-now still read 11 |
| Buy list | 6 lines, **no preps**; toast read *"Demo Spag Sauce, White Sugar Syrup need making, not buying."* |
| Console | no errors |

### One bug this caught that no test would have

The ingredient picker on the setup screen rendered as a **bare chevron**. The
shared input class carried `w-full`, and Tailwind resolves two width utilities
by stylesheet order rather than the order they are written — so the quantity
box, also `w-full` and `shrink-0`, took the whole row. Width is no longer part
of that shared class; every field states its own.

### Not done

- **A default shelf life per prep.** Would need a column on `RawMaterial`, and
  schema changes are not made without KJ saying so. Entered per batch today,
  which is honest and works.
- The 16 findings in `procure-stockout-review.md` are still open — separate
  from this rotation work.

---

## One click, and where the ingredients went (2026-09-01)

KJ: *"the cook will just click that and it will update the level 3 raw ingredients …
directly accounted in the raw mats in the kitchen … there should be option there
where to trans in because some of the ingredients are both being used in the bar
and in the kitchen."*

### What shipped

- [x] **One tap.** The card button now reads **"Made 2000 g"** — the batch size
      decided at setup, on the button — and records it. It used to open a dialog
      asking how many batches with `1` already filled in, so the ordinary case
      cost two taps and a read, on a phone, mid-service. The dialog is still
      there behind a second button for three-at-once or a shelf life.
- [x] **Which side of the shop used it.** Every prep now stamps a station on the
      record. Inferred where the prep only feeds one side; a **"Who made it?
      Bar / Kitchen"** sheet where it genuinely feeds both. Stock Movements reads
      *"Used to prepare White Sugar Syrup · Bar"*.
- [x] **Promote is the same one tap** — a MOVE reads "Move 2000 g to the line".

### The decision KJ needs to make, and why I did not just build it

He asked for a real **trans-in**: move the stock out of the stockroom and into
the kitchen or bar. I did not split the stock, because splitting it causes the
exact failure he told me to prevent — *"the owner doesnt want the staff to say
that their ordered menu is out of stock or unavailable."*

Order deduction reads stock for **the order's branch only**
(`orders.service.ts:1055`) and hard-refuses with `NOT_ENOUGH_INGREDIENTS`
**before payment** (`orders.service.ts:1308`). So sauce booked to a "Kitchen"
pool is invisible to the till, and a rice bowl is refused at the counter with
sauce sitting ten feet away. Three room-branches would also mean three Z-reads a
day (`ZReadLog @@unique([branchId, date])`), "Stockroom" printed on payslips
(`payroll.service.ts:27`), and ₱0 rows in every report.

So the station is recorded as a **label on the movement, not a second balance**.
That answers "what did the kitchen use this week" without breaking a sale. If KJ
wants true per-room balances, that is `StockLocation` inside one branch — a
migration, and his call.

### One bug I shipped and caught

Removing the dialog removed the throttle. My first guard disabled the button on
React state, which does not apply within the same tick — **three rapid taps made
three batches**, verified in the browser (three toasts, three events 150 ms
apart). Re-done as a synchronous `useRef` lock keyed per prep. Five taps in one
frame now make one batch; a deliberate second batch three seconds later still
goes through.

### Verified

| What | How |
|---|---|
| API suite | 1,262 passed, 0 failed (114 suites) |
| Station attribution | 8 new specs, incl. "leaves it blank rather than guessing" and "attribution changes no quantity" |
| Live browser | one tap → `stationName: "Bar"` on the event; movement log reads "· Bar" |
| Double-tap | 5 taps in one frame → 1 batch; +3 s → 2 batches |
| Demo seed | 8 test batches and 7 lots deleted, stock restored to 8000/15200/36000 |

### Gap, stated plainly

**`apps/web` has no test runner at all** — no jest, no vitest, no test script. So
the tap lock, the one-tap path and the station sheet have **no regression guard**;
they are verified by hand only. Adding a runner is a new dependency and therefore
KJ's call.

---

## Levels standardised, station-scoped roles, and Carolina in a test account (2026-09-01)

### 1. The levels are now fixed vocabulary

| | | replenished from |
|---|---|---|
| **Level 1** | ready to use, on the line | Level 2 |
| **Level 2** | frozen, ready to thaw | Level 3 |
| **Level 3** | raw ingredients already in the kitchen | stockroom |

**Derived, not configured.** A prep that a *product* consumes is L1; a prep that
only feeds another prep is L2; the raw components are L3 and are already the
component list on each card. No column, no migration, nothing for the shop to
fill in — and the numbers cannot drift out of step with the recipes.

Shown as an `L1` / `L2` badge and as "Ready to use · " / "Parked · " on the card.

### 2. Baristas prep the bar, cooks prep the kitchen

No `COOK` or `BARISTA` role exists, and `User` has no station column. But
`personaKey` does — an existing column, already written by the Staff screen,
already in the JWT. Two new personas:

- **Barista** — `baseRole: CASHIER` (at Carolina the barista *is* the cashier),
  scoped to `BAR / HOT_BAR / COLD_BAR`
- **Line cook** — `baseRole: GENERAL_EMPLOYEE`, scoped to `KITCHEN`

Enforced on the **server**, not just the board — a stale tab or the tablet app
posting straight to the API would sail past a filtered list. The filter and the
rule share one derivation (`stationOfPrep`) and one predicate
(`canPrepAtStation`), so they cannot disagree.

**Two deliberate softenings**, both tested:
- A prep with **no station** stays visible to everyone. Null means the menu was
  never routed, or the prep genuinely feeds both sides — a setup gap, not a
  boundary. Hiding it would hand a half-configured shop a blank board.
- Every **existing** persona and every account with **no** persona keeps seeing
  everything. Nothing narrows until an owner deliberately hires a barista.

Also fixed while here: `stationId` on a batch was caller-supplied and blank by
default, so attribution depended on someone answering a question. It now
defaults to the prep's own station — correct by construction.

### 3. Cafe Carolina's real data, in a local test account

Tenant **`carolina-test`** (`isDemoTenant: true`, NON-VAT, COFFEE_SHOP), loaded
through the **real importer**, not by hand:

| Import | Result |
|---|---|
| Kitchen ingredients | **283** imported, 0 errors |
| Bar ingredients | 48 imported, 5 updated, 0 errors |
| Kitchen recipe ingredients | 29 imported |
| Menu products (from the Recipe Costs pack, with real prices) | **63** imported |
| Menu recipes | **400** lines, 0 errors |
| Ube Series | 4 products + 27 recipe lines |
| Opening stock | 47 receipts |

Logins (local only): `owner@carolina.test / Owner1234!`,
`barista@carolina.test / Barista1234!`, `cook@carolina.test / Cook1234!`

**Live proof, on their own data.** Breve Milk is a genuine Carolina prep — their
note reads *"200 g Milk Essence Powder + 200 g hot water + 1 L Emborg full cream
milk = PHP 137.40, yields 1,400 ml."* Set up as an L1 prep with a 400 ml par:

- Barista sees it: `L1 Breve Milk | station: Bar | par: 400`
- Line cook sees **0 preps** — correctly scoped out
- Cook posting to it is refused: *"Breve Milk is a Bar prep. Ask the Bar to record this batch."*
- Barista records it: 1,400 ml, station auto-attributed to Bar, unit cost
  **₱0.09814/ml** — which is 137.40 ÷ 1400 exactly. **The recipe costing matches
  Carolina's own arithmetic.**

### Verified

API suite **1,278 passed**, 0 failed (115 suites). 16 new specs for the levels
and the station scope, including "leaves every existing persona unscoped" and
"never hides the unrouted prep from anyone".

### Open, and needing KJ

1. **7 kitchen menu items have no price anywhere.** Buffalo Wings, Garlic
   Chicken, Garlic Parmesan, Herbed Honey Garlic, Honey Sriracha, Sweet & Spicy
   BBQ, Teriyaki Wings — 51 recipe lines blocked on a price list. Every workbook
   has bar prices only (`Recipe Costs (Bar)`). I did not invent them.
2. **`carolina-kitchen.e2e-check.spec.ts` proves nothing.** It advertises a dry
   run of "283 ingredients none of which exist yet" and cites Chicken Wings at
   ₱250/kg, but loads `master-fixture.json` — 53 *bar* rows, all already live,
   so its assertion resolves to `53 − 53 = 0` creates. The real 283-row file,
   `kitchen-fixture.json`, is referenced by nothing. It passes green and
   exercises no create path.
3. All three Carolina specs hardcode tenant `cmt1bvufw001bp501ci2zoqw2`, which
   the scratchpad export identifies as **production** (`isDemoTenant False`). I
   did not connect to it.

---

## Kitchen menu loaded with sample prices, and the L2 scoping hole (2026-09-01)

KJ: *"i dont have that since they dont have it as well, so i think we should just
put a placeholder on it or just sample price for the test account."*

### Sample prices — plausible, and unmistakably labelled

The 7 kitchen items are loaded at **₱150–₱175**, each carrying the description:

> SAMPLE PRICE - placeholder for the TEST account only. Cafe Carolina has not set
> a kitchen price list. Do not quote.

Derived at roughly 3× the real recipe cost so margin arithmetic is actually
exercised, rather than a flat fake number that tests nothing.

### But the costs were garbage first — a 16x error, found on the way

Pricing off the recipe cost meant computing it, and the first pass produced
**Garlic Chicken at ₱13,583 a plate**. Three ingredients had a RECIPE unit that
differed from the STORED unit:

| Ingredient | Bought | Used | Was | Now |
|---|---|---|---|---|
| Knorr Liquid Seasoning | L | ml | ₱339.50 a line | ₱0.3395/ml |
| Brown Sugar | kg | g | — | ₱0.085/g |
| Chicken Wings | kg | pc | ₱250 for 2 pc | ₱12.50/pc |

The first two are pure arithmetic and the importer already does them — they were
wrong only because `Clerque Import (Ingredients).xlsx` has **no Recipe Unit
column**, so 283 kitchen ingredients were stored in their buying units. Re-imported
through the real importer with Recipe Unit set: `{"imported":0,"updated":3}`.

The third is **not** arithmetic — only Carolina knows how heavy a wing is. Loaded
as a labelled sample (20 pc/kg, 50 g a wing) and flagged in the ingredient note.

**Buffalo Wings went from ₱506.46 to ₱31.46 a plate.** This is the exact trap
`carolina-kitchen.e2e-check.spec.ts` claims to guard and does not.

⚠ **17 kitchen ingredients still have no cost at all** (Flour, Butter, Salt,
Paprika, Soy sauce, Sriracha, Ginger, Garlic powder, …) because Carolina's
purchase history has no price for them. Left at zero rather than invented.

### The L2 scoping hole, found by running it

With the full rotation set up, the cook's board was right but the **barista could
still see and record the kitchen's frozen sauce**. Cause: station is derived from
the *products* a prep feeds, and a **Level 2 tub feeds no product** — only the L1
tub in front of it. So every parked batch came back stationless, and stationless
is deliberately permissive.

Fixed by inheriting one hop: a parked tub takes the station of the tub it feeds,
and only when the parents agree. Applied in **both** `list()` and
`stationOfPrep()`, so the board and the server enforcement cannot disagree.

Before: barista saw 2 preps. After: barista sees 1; posting to the frozen tub
returns *"Teriyaki Sauce (frozen) is a Kitchen prep. Ask the Kitchen to record
this batch."*

### The rotation, run end to end as the cook

Real Carolina teriyaki, standardised levels:

- **L3 → L2** cook records 2,000 ml frozen sauce → ₱0.054864/ml, auto-attributed Kitchen
- **L2 → L1** cook thaws it onto the line → ₱0.0549/ml — **cost conserved across the move**
- Board then reads exactly KJ's state: L1 *"Ready to use · 2,000 ml"*, L2 *"Parked · 0 ml"*,
  *"Make Teriyaki Sauce (frozen) first — then you can do 5"*, 66 servings of Teriyaki Wings

### Verified

API suite **1,281 passed**, 0 failed. 4 new specs including "gives the parked tub
the station of the tub it feeds" and "so a barista does not see the kitchen's
parked tub". Screenshot of the cook's board confirms the L1/L2 badges.

Test account totals: 360 ingredients · 70 products · 452 recipe lines · 57 stock
receipts · 3 preps · 3 logins.

---

## Hardcoding audit (2026-09-01)

15 agents across six lenses, then adversarial verification of the top findings.
**6 confirmed, 3 dismissed, 58 flagged but not individually verified.**

### Fixed this pass

**1. The nightly alert fired at 7pm, not 3am.** `notifications.scheduler.ts:38`
was `@Cron('0 19 * * *', { timeZone: 'Asia/Manila' })` with a comment reading
"3am Manila — UTC+8, so 19:00 UTC". The offset was applied **twice**: 3am was
hand-converted to 19:00 UTC, and then `timeZone` converted it again. The whole
point of "these ingredients are running low" is that it lands before the shop
opens; it was arriving mid evening service, a full trading day late. Now
`'0 3 * * *'` with the timezone doing the one conversion.
*(`journal-templates.scheduler.ts:27` is also timezone-pinned at 8pm but states
no intent to contradict, so it is flagged, not changed.)*

**2. An item sitting EXACTLY on its reorder level was skipped, and the screen
then said everything was fine.** `procure.service.ts:180` used `shortBy > 0`
while `getLowStock` and the nightly alert both use `onHand <= lowStockAlert`.
One shop, one night, three answers: email *"Straws — 6 pcs left"*, printed slip
*"SHORT 0 pcs"*, Check stock *"Nothing is below its reorder level right now."*
A gram-weighing cafe rarely lands on equality — **a shop counting cups, lids and
sachets lands on it constantly, and Carolina counts cups and lids in pieces.**
Now `>= 0`, with the quantity falling back to the reorder level itself.
The spec that pinned the old behaviour had the fixture labelled `// not short`,
which was the bug: `getLowStock` never returns a healthy item.

**3. My own station scope was written for a floor plan that does not exist.**
Checked against `COFFEE_SHOP_LAYOUTS`:

| tier | stations created |
|---|---|
| CS_1 / CS_2 | **COUNTER only** |
| CS_3 | BAR |
| CS_4 | BAR + KITCHEN |
| CS_5 | BAR + KITCHEN + **PASTRY_PASS** |

I had scoped BARISTA to `BAR / HOT_BAR / COLD_BAR` — **no tier creates HOT_BAR
or COLD_BAR at all**, and the two smallest tiers create only a COUNTER. A
barista at a one-counter shop would have opened a blank board and been refused
every batch. LINE_COOK missed PASTRY_PASS, so a bakery's pastry preps were
refused to the people who make them.

Fixed three ways: BARISTA now includes COUNTER, LINE_COOK includes PASTRY_PASS,
and — the durable one — **a scope is not applied when it does not overlap the
shop's real stations at all**. A rule that would hide everything was written for
a different shop. Applied in `list()` and in `makeBatch`, from one predicate.

**4. The board's station picker hardcoded the same four kinds**, which was worse
than hiding: filtering a station out made `stations.length` read 1, so the
"Who made it?" question stopped being asked and every batch was silently booked
to whichever station survived. Now it lists whatever the shop has.

### Dismissed after verification

- Reorder quantity as a fixed 2× multiplier — documented, owner-overridable on the line
- 32-column thermal width — matches the configured printer field
- Bake list dividing by 7 days — a week is a week

### Not fixed, ranked by what I would do next

1. **`tenant.timezone` exists and is honoured in exactly one service** — 58 places hardcode Asia/Manila / en-PH
2. **Three separate hand-rolled peso formatters** bypass `formatPeso`
3. **The role list is written out four times** (schema enum, shared-types, DTO `STAFF_ROLES`, staff page) and has already drifted — `AR_ACCOUNTANT` / `AP_ACCOUNTANT` are valid in the DB and in the permission matrix but **cannot be assigned through the UI**
4. **`UNITS` written three times**, copies already disagree
5. **Four `*.e2e-check.spec.ts` files marked TEMPORARY were never deleted**, three keyed to one machine's absolute path and a **production tenant id**
6. **Stations only exist for `businessType: COFFEE_SHOP`** — the whole prep-station layer is inert for a restaurant or bakery
7. **The prep board has no nav entry for CASHIER or GENERAL_EMPLOYEE** — the two personas it was built for
8. `notifications.service` accepts a `dedupeKey` and ignores it

### Verified

API **1,289 passed**, 0 failed. Web typecheck clean. Live tenant re-checked:
barista sees 1 prep, cook sees 2, both correctly scoped.

---

## The rest of the audit, cleared (2026-09-01)

All eight remaining items done. **1,293 tests pass, 0 fail.** Both apps typecheck.

### 1. A production tenant id was sitting in three test files
`carolina-kitchen` / `carolina-recipes` / `carolina-upload` `.e2e-check.spec.ts`
each hardcoded `cmt1bvufw001bp501ci2zoqw2` — Cafe Carolina's **live** tenant —
and keyed their fixtures to one machine's session-temp path, so they were
permanently skipped on every other machine while carrying that id in the repo.
Their job (pre-import dry runs) was finished. **Deleted.** No production id
remains anywhere in `apps/` or `packages/`.

`prep-pipeline.e2e-check.spec.ts` is KEPT and re-headed as permanent: it is
localhost-guarded, creates and destroys its own tenant, and covers shipped
behaviour.

### 2. Four copies of the role list, and 107 endpoints gated to nobody
`AR_ACCOUNTANT` / `AP_ACCOUNTANT` are valid in the Prisma enum, hold
`ledger:view` in `PERMISSION_MATRIX`, and are named in **107 `@Roles`
decorators** — but were missing from the users DTO **and** from the only UI
that assigns roles. So a hundred-odd endpoints were guarded against roles no
shop could ever hire into.

One list now: `HIREABLE_ROLES` in shared-types, imported by the DTO and the
Staff screen; AR Clerk and AP Clerk added to the role catalog. The new spec
**"can assign every role the permission matrix actually grants something to"**
is the guard that would have caught this originally.

### 3. `UNITS` written twice, and the copies must agree
An ingredient created with a unit the other screen does not offer becomes
uneditable there. Now `INGREDIENT_UNITS` in shared-types, with a note on why it
is deliberately narrower than the API's `UNIT_FACTORS` parsing table.

### 4. Two hand-rolled peso formatters
Both hardcoded `₱` and `en-PH`, bypassing the tenant currency that
`setDisplayCurrency` exists to honour. But the prep board's **four decimals were
legitimate** — a unit cost is ₱0.0549/ml and rounding to ₱0.05 is a 9% error on
the number recipe costing rests on. So the precision moved into the shared
helper as `formatUnitCost` rather than being dropped, and both pages now use
the shared ones.

### 5. The prep board had no link for the cook or the barista
The tile was gated on `canStock` (STOCK_ROLES), which **excludes CASHIER and
GENERAL_EMPLOYEE** — the barista and the cook. The API admits them, the route
admits them, the screen exists for them; only the link was missing, so the two
people it was built for could reach it by typing the URL and no other way.
**This is what KJ hit in his screenshot.**

### 6. `dedupeKey` was accepted and ignored
`create()` searched for an earlier notification whose **body contained** the
key — but the key is never written into the body. Callers pass
`low-ingredient-3-2-1` while the body reads "OUT: Beans · Low: Fresh Milk". No
row could ever match, so every caller that asked to be deduplicated silently
was not, and alerts repeated. Nothing crashed, which is why it survived.

Now matches the message itself (title + body + link) within the hour — which is
**sharper** than the intended key match, since `low-ingredient-3-2-1` would
collapse two different sets of three shortages and the body does not.

### 7. `Asia/Manila` written out 16 times
Correct today — `Tenant.timezone` defaults to exactly this — so not a live bug,
but a bug waiting for its first non-PH tenant, when finding all sixteen is the
whole job. Consolidated to `PH_TIMEZONE`, with `tenantTimezone()` alongside as
the starting point for per-tenant work later. **Behaviour-preserving by
construction: the constant's value is the literal it replaced.**

Deliberately NOT wired to `Tenant.timezone` yet — that means auditing what a
changed day boundary does to Z-read numbering, payroll weeks and BIR period
cutoffs. Real risk, no benefit until a non-PH tenant exists.

### 8. Stations existed for coffee shops and nobody else
`applyCoffeeShopTier` is the **only** code path that creates a Station, and it
refused anything not literally `COFFEE_SHOP`. A restaurant, bakery, bar or
caterer could never have one — so every prep derived `station: null` and the
whole layer above it quietly did nothing for them. Nothing errored, which is
why it would never have been reported.

Gated on `FNB_BUSINESS_TYPES` now — the same set that already unlocks
recipe-based inventory, which is the right gate because a shop with no recipes
has no preps to route. Non-F&B still refused.

### Verified

API **1,293 passed / 0 failed** (115 suites). Web typecheck clean. Live tenant
re-checked after every change: barista sees 1 prep, cook sees 2, both scoped.

### Still open, honestly

- **`apps/web` has no test runner at all** — every screen fix this session is
  verified by hand only. Adding one is a new dependency: KJ's call.
- **17 kitchen ingredients have no cost**, so kitchen COGS is understated.
- The ~45 remaining low/medium audit findings were not individually verified —
  mostly further locale pinning, truncation caps, and duplicated role arrays
  across `@Roles` decorators.

---

## A full day, run end to end (2026-09-01)

Not more code reading — an actual trading day on `carolina-test`, through the
real API, as the real accounts. **1,299 tests pass.**

### The chain works

| Step | Evidence |
|---|---|
| Cook makes the backup (L3→L2) | 2,000 ml @ ₱0.054864/ml, auto-attributed **Kitchen**, expires +30d |
| Cook thaws it to the line (L2→L1) | 2,000 ml @ ₱0.0549/ml — **cost conserved across the move** |
| Raw consumed exactly to recipe | soy 4400→3800 (600) · sugar 4240→3480 (760) · chicken powder 920→840 (80) |
| Sell 3 × Teriyaki Wings @ ₱150 | `ORD-2026-000001`, ₱450 |
| **The sale ate the prep** | Teriyaki Sauce (ready) 4000→3910 ml = **3 × 30 ml** |
| Every other line matched | butter 9.6 (3×3.2) · ginger 1.2 (3×0.4) · garlic 1.5 (3×0.5) · sugar 114 (3×38) |
| Servings fell | Teriyaki Wings 133 → 130 |
| Books | `Dr 1010 450 / Cr 4010 450` — **no output VAT** (NON-VAT) · `Dr 5010 22.51 / Cr 1051 22.51` |
| Negative stock | 0 |

### Three real bugs the run exposed

**1. A never-received ingredient sold forever.** `orders.service.ts:1195` had the
shortfall check INSIDE `if (hasStockRow)`. An ingredient received and then
emptied refused the sale; one that never had a row **sold without limit** — the
same empty shelf, two opposite answers, and the dangerous one reserved for the
ingredient nobody had counted. Found by selling 3 plates whose Onion powder had
no row, with `allowSaleWhenOutOfStock: false`.

Now: *"Not enough Onion powder for Teriyaki Wings. It needs 1 g and there are
0 g left — enough for 0. Change the order before taking payment."*

**2. The trial balance did not foot.** Two opening-stock receipts were off by
₱0.01 each. `totalValue` was the bare product `qty * unitCost` while
`grossValue`, the same multiplication, was `+(...).toFixed(2)` — so a value
landing on a half-centavo rounded one way on the debit and the other on the
credit:

- `5325 × 0.575 = 3061.875` → Dr **3061.88** / Cr **3061.87**
- `13939 × 0.235 = 3275.665` → Dr **3275.67** / Cr **3275.66**

Every entry still reported "balanced" under a tolerance check, which is how it
stayed invisible. Fixed in **both** copies — and the first fix went to the wrong
one: opening stock loads through the **importer's** own path, not
`receiveRawMaterial`. Post-fix receipts of the identical amounts are now
EXACTLY BALANCED. The 4 legacy entries are untouched history (₱0.04).

**3. I split an ingredient in two.** My unit-conversion pass created
`Chicken Wings` while the recipes bind to `Chicken wings` — the ingredient
importer matches **exact case**, the recipe importer **case-insensitively**. So
my ₱12.50 and 200 pc went onto a row nothing uses, and Buffalo Wings still
costed its chicken at ₱0. This is the exact trap in my own notes: *generate
names from a live export, never retype*. I retyped them.

Corrected against the live name, stock moved to the right row, duplicate
deactivated. **Correction to an earlier claim: "Buffalo Wings ₱506 → ₱31.46" was
computed in my script, not by the system.**

Still open: `Parmesan Cheese` / `parmesan cheese` is a genuine duplicate from
Carolina's own two workbooks — their call which one is real.

### Live delivery, mid-run

KJ: *"a new receipt in our gc for chicken wings, its 5.180 kg, 195 pesos per kg."*

Loaded through the real importer. The peso value is exact regardless of the
sample pack size: **5.180 kg × ₱195 = ₱1,010.10 = 103.6 pc × ₱9.75**.

- `JE-202609-0064  Dr 1051 1,010.10 / Cr 1010 Cash 1,010.10` — **exactly balanced**, CASH not owner-funded
- WAC blended **200 pc @ ₱12.50 + 103.6 pc @ ₱9.75 → ₱11.5616/pc**, matching the
  hand calculation to four decimals (₱231.23/kg)

The ₱195/kg is now real data. The 20 pc/kg is still a placeholder — the only
thing left needing Carolina.

---

## "I don't know the output of the sauce" (2026-09-01)

KJ: *"i dont have the output of the sauce they are creating and i dont know for
how many servings."*

He is right that this was a blocker, and it was **our** design fault. Setup
DEMANDED a batch yield (`setRecipe` refuses `batchYield <= 0`) and `makeBatch`
computed `produced = batchYield x batches` forever after. So a shop that had
never weighed a pot could not set the prep up at all, and the natural response —
type a round number — poisoned every future batch, because **cost per unit is
inputs ÷ output**. A wrong yield makes every dish containing the sauce wrong in
a direction nobody can see.

### What changed

**1. The cook can measure the pot.** `makeBatch` takes an optional
`actualYield`. Where a measurement exists it wins, because it is the only one of
the two numbers that was ever checked against a jug. Both figures are recorded,
so a drift survives the moment.

**2. Setup no longer demands a number nobody has.** The yield field now offers
"Use N {unit}" — the sum of what goes IN, which the shop already knows — as a
starting point, with the note that the cook corrects it on the first batch.
Offered only when the components share the prep's unit, so nothing silently adds
millilitres to pieces.

**3. The drift is said out loud.** Recording a batch that came out ≥5% off the
recipe adds *"That is 18% less than the recipe says — worth updating if it keeps
happening."*

### Proven on the live tenant

Cook records one batch of Teriyaki Sauce and measures **1,650 ml** against a
recipe that assumed 2,000:

| | |
|---|---|
| recipe says | 2,000 ml |
| cook measured | **1,650 ml** (−18%) |
| inputs | ₱109.73 |
| cost/ml, measured | **₱0.066502** |
| cost/ml, had we trusted the recipe | ₱0.054864 |

**The costing was 21% light.** That is the whole argument for measuring once.

### What Carolina actually has to answer

The two questions shrink to ones a cook can answer without a study:

1. **How much sauce goes on one plate?** — measure the ladle once.
2. **Weigh the pot next time you make it.** — one number, once.

Servings is then *derived*, not asked: the board already computes it
(`Teriyaki Wings x130`) from yield ÷ per-serving. Nobody has to count plates.

### Chicken wings in grams — yes

Buying in kg and using in g needs no pack size: the conversion is arithmetic and
is already proven on this data (**Brown Sugar ₱85/kg → ₱0.085/g**, **Knorr
₱339.50/L → ₱0.3395/ml**). ₱195/kg becomes ₱0.195/g and my 20-pc-per-kg
placeholder disappears.

The catch: the **recipe lines must change with it** — "2 pc" has to become the
gram weight of a portion. That is the number to get from the cook.

### Verified

API **1,309 passed**, 0 failed. 11 new specs including "makes the cost per unit
TRUE, not just the quantity" and "leaves measuredYield null when nobody measured,
rather than echoing the guess".

---

## 2026-09-02 — The costing sheet Carolina fills in

KJ asked for an Excel template to send Carolina: recipe name, ingredient name,
unit of measure, and something that computes.

### What the live data actually showed

Pulling `carolina-test` first changed the problem. It is not one missing number,
it is two holes, and the second is bigger:

| dish | sells | Clerque costs it | chicken in recipe? |
|---|---|---|---|
| Honey Sriracha | ₱150 | **₱0.00** | no |
| Sweet & Spicy BBQ | ₱150 | ₱1.46 | no |
| Teriyaki Wings | ₱150 | ₱7.50 | no |
| Garlic Parmesan | ₱150 | ₱15.10 | no |
| Garlic Chicken | ₱150 | ₱17.28 | no |
| Buffalo Wings | ₱150 | ₱28.48 | yes |
| Herbed Honey Garlic | ₱175 | ₱54.89 | yes |

**18 ingredients have no price at all** (soy sauce, honey, butter, salt, oil,
ketchup, sriracha…), and **five of seven dishes have no chicken in the recipe**.
`ImportResult.missingCost`'s own comment predicted this: "those products report
100% margin until a cost or a recipe exists". Honey Sriracha is that comment,
live.

So the sheet collects four things, not one: what a pack costs, what goes in a
pot, what comes out of it, and what goes on a plate.

### Built

`apps/api/scripts/gen-recipe-costing-sheet.js` — generates the workbook from a
live tenant, following the existing `gen-*.js` script convention. Nothing about
Carolina is hardcoded: the sheets are built from whichever ingredients have no
price and whichever dishes use one.

Six tabs: **Start Here**, **Ingredients**, **Sauce Batches**, **On the Plate**,
**Answers**, **Lists** (hidden).

### The decisions that mattered

**The prices tab is named `Ingredients`, not "1 Prices".** `parseFile()` falls
back to the FIRST SHEET when no sheet matches the name it wants. A prettier tab
name means an upload silently parses the instructions page as ingredient data.
Its headers and hint row are the importer's own, byte for byte — the first seven
columns are read POSITIONALLY, and the hint row is skipped only because its first
cell contains the word "required".

**Recipe Unit is prefilled and locked.** The importer writes `unit: storedUnit`
on UPDATE as well as create and never rescales stock already counted. "Butter |
kg | 320" with Recipe Unit blank flips butter from grams to kilos and 4,000 g on
the shelf silently becomes 4,000 kg. Prefilling makes that branch unreachable.

**Buy-unit dropdowns are per row, restricted to the ingredient's own family.**
Mass and volume never convert and no density is assumed, so offering "L" against
oil held in grams offers a choice that can only end in a rejected row.

**Names are written, never typed.** Ingredient import matches case-SENSITIVELY,
recipe import case-INSENSITIVELY. This tenant already carries "Chicken Wings"
beside "Chicken wings" and "parmesan cheese" beside "Parmesan Cheese" — the sheet
names all six collisions rather than asking Carolina to price a duplicate.

**Two ways to answer the plate question.** How much sauce on a plate, OR how many
plates a pot does. Either one derives the other. Servings is never asked for.

**Every formula ships with its cached value** and `fullCalcOnLoad`. exceljs emits
a bare `<f>` with no `<v>` otherwise, and a phone or Drive preview then shows a
grid of blanks. Pre-2007 functions only — exceljs never adds the `_xlfn.` prefix,
so IFS/LET/TEXTJOIN would ship as #NAME?.

### Verified

Filled the workbook in as a cook would and evaluated every formula with a real
spreadsheet engine (`formulas`, a dev-only Python tool — **not** a project
dependency). **23/23 checks pass**, including:

- kg→g, container+pack-size, and same-unit price conversions
- Oil bought by the litre but held in grams → *"How many g in one L?"*, the same
  refusal the importer makes
- ₱95 typed against "g" → *"Did you mean one kilo, or one litre?"*
- a measured pot: 603.667 in, 1400 ml out, 30 ml a plate → **₱34.96 a plate,
  76.7% margin, 46 plates a pot**
- the other path: 2000 ml pot, "50 plates" → back-derives 40 ml a plate

It caught a real bug — a broken string concatenation in the check column.

`recipe-costing-sheet.spec.ts` (8 tests) pins the sheet to the importer so they
cannot drift, and runs filled rows through the **real** importer. API suite
**1,317 passed, 0 failed**.

### Known gaps

- Waste is assumed zero; real cost per plate is a few per cent higher. Stated on
  Start Here rather than modelled.
- **No import path exists for sub-recipes or batchYield anywhere.** Pot amounts
  and yields are typed into Procure → Prep & Batches → Set up.
- Prices alone do not recost a sauce — a sub-recipe's cost is only written inside
  `makeBatch`'s WAC blend, so each prep needs one batch recorded afterwards.
- The first stock receipt recomputes these prices as a weighted average. The sheet
  fixes the starting point, not the price forever.
- Chicken wings are still counted in `pc`. Switching to grams is a change to the
  ingredient and its recipe lines, not something this sheet can do.
- `ts-jest` warns about compiling the `.js` generator (no `allowJs`). Harmless;
  fixing it means touching shared tsconfig.

### Adversarial critique — three findings applied

The workflow's completeness critic reviewed its own spec and raised 11 blocking
items. Most were against design choices this build never made; three landed:

- **Unit aliases.** `normUnit()` lowercases, strips punctuation and drops a
  trailing "s", so the importer resolves an ingredient stored as "grams" or
  "Litre". A spreadsheet cannot call `normUnit`, and a missed lookup does not
  fail loudly — it falls through to the container branch and asks for a pack
  size that makes no sense. `UNIT_TABLE` now carries every alias. Carolina's 18
  are all plain `g`, so this was latent, not live; it matters for the next shop.
- **The double count.** The pot block was prefilled from a dish's *whole* BOM,
  which includes the chicken — and the plate sheet asks for the main item
  separately. A cook filling both would pay for the chicken twice, and every
  margin would be wrong in the flattering direction. `mainItemOf()` is now shared
  by both sheets and the main item is kept OUT of the pot block, so the ordinary
  case is unreachable. For the case a generator cannot foresee — nominating
  butter, which really is in both the sauce and the pan — a `SUMPRODUCT` tripwire
  on the plate sheet says *"This is also in the pot above — it would be paid for
  twice"*.
- **Verified `await ws.protect()`.** The critic warned it returns a Promise and a
  missed await ships an unprotected book silently. Read back from the XML:
  protection is present on Ingredients, Sauce Batches, On the Plate and Answers,
  and absent on Start Here and the hidden Lists — which is exactly right.

Two claims checked and dismissed: the ₱-per-unit sanity threshold keys off the
**buy** unit, not the stored one, so an ingredient held in kg is never falsely
flagged; and `Lists` carries all 361 live ingredients with their real costs, so
an already-priced item on a dish's BOM costs correctly instead of vanishing.

Verification re-run after the changes: **26/26 spreadsheet checks**, including
the tripwire firing when it should and staying silent when it should not, plus an
assertion that chicken is no longer a pot line. API suite **1,317 passed**.

---

## 2026-09-02 (later) — Recipe Costing export, standard in the import feature

KJ redirected: stop shaping the file around today's gaps, stop building pivot
views ("no, i will create the pivot"), make the columns right so a pivot is not
a hassle, and put it in the system's import feature like every other template.

### What the data said

The gap-shaped workbook covered 7 of **74** products. Carolina has 74 products,
**all 74 with recipes**, 361 ingredients, 479 recipe lines, 13 categories.
67 products already report a real margin; the 7 that cannot are the entire
Wings & Chicken category. 74 dishes also kills a block-per-dish layout — that is
~1,800 rows — so the recipe book has to be flat.

### Two facts that set the architecture

- **`importSetupPack` runs Products → Ingredients → Recipes in one upload**, in
  that order, deliberately. Authoring a brand-new dish from brand-new
  ingredients needs no new import path.
- **exceljs 4.4 cannot emit a PivotTable** (no pivot module exists; the only
  `pivotTables` symbol is a protection flag) — but it **can** emit a real Excel
  **Table**. Verified the round trip: a named table writes `xl/tables/table1.xml`,
  reopens in exceljs, and openpyxl sees it. That is the one-click bridge —
  Insert → PivotTable prefills its own source.

### Built

`ImportService.recipeCostingExport()` + `GET /import/export/recipe-costing` +
a row on Settings → Import Templates. Not a change to `recipesExport`:
`setupPackExport` copies only `worksheets[0]` of each bundled buffer and drops
table definitions, so editing that in place would have silently broken the
setup pack.

**Three sheets. `Recipes` (line grain), `Dish Costs` (dish grain), `Notes` last.**

| Recipes | why |
|---|---|
| `Product Name*` `Ingredient Name*` `Quantity*` `Unit` | the importer's own four, in its order, so the file uploads back |
| `Category` | the pivot axis an owner actually uses |
| `Made or Bought` | splits food cost into bought vs made in-house |
| `Cost per Unit (₱)` | snapshot from Clerque |
| `Line Cost (₱)` | formula — edit a quantity and it recosts live |
| `Priced?` | filter for what is broken |

`Dish Costs`: Category, Product Name, Sells For, Cost to Make, Margin ₱,
Margin %, Recipe Lines, Lines With No Price, Costing Complete?

**Two grains, two sheets, on purpose.** A selling price on a line-grain row gets
summed once per ingredient — Buffalo Wings at ₱150 across 11 lines reads as
₱1,650, with nothing to show it is wrong. Every column on each sheet is safe to
Sum.

Headers on row 1, no merged cells, no blank rows, no inline totals, both sheets
named tables. `endpoint` on the web `TemplateInfo` became optional: a blank
version of your own costed recipes is an empty grid nobody could fill in, so
that row offers "My data" only.

### Two real bugs the verification caught

- **`SUMPRODUCT(--(range=value))` evaluated to 0.** The `*` form worked. Switched
  the row-count column to `(range=$B2)*1` — the form Excel and every other
  reader agree on. A count silently reading zero is exactly the failure nobody
  notices.
- **SUMPRODUCT, not SUMIF/COUNTIF, everywhere.** Those treat criteria as
  patterns, so a dish named `Buffalo Wings *NEW*` would match every dish
  starting with `Buffalo Wings `. No name in this tenant has a wildcard today,
  which is the kind of thing that stops being true quietly.

### Verified

Evaluated with a real spreadsheet engine on the live 479-line export:

- Americano ( Hot ) — 17 g beans @1.1 + cup 5 + lid 1.6 + 300 ml water @0.002 →
  **₱25.90 cost, ₱54.10 margin, 67.6%**, walked by hand
- a wings dish → **margin blank, not a flattering number**; partial cost still shown
- **all 74 dishes reconcile** to the sum of their own lines
- **sum of Line Cost == sum of Cost to Make (₱4,075.66)** — a pivot by Category
  totals the same money
- nothing dish-grain leaked onto the line sheet; no later header could be
  mistaken for `Unit`

9 new specs including a **real round trip**: the exported Recipes sheet fed back
through `importRecipesFromRows` writes quantities 17, 1, 15, 30 unchanged — the
added columns shift nothing. **API suite 1,326 passed, 0 failed.** Endpoint
verified over HTTP: 200, 43,451 bytes, correct sheets and tables.

### Not verified

The Import Templates row renders — the route compiles and serves (307 to login),
and both apps typecheck, but I did not sign in to look at it. I do not enter
passwords into forms.

---

## 2026-09-02 — Procure as the one-stop shop: receipts in, stock + expenses out

KJ (AFK): "finish clerque procure… one stop shop for all inventory related,
orders, then the AI/OCR parse when uploading a receipt while doing the updates
on the paid and received ingredients, raw materials, operational expenses like
cleaning and all."

### What exists (verified by reading, not memory)
- Procure = PurchaseRequest OPEN→SENT→BOUGHT→RECEIVED; receive posts each line
  via `receiveRawMaterial` (1051 for ingredients, 6210/6070 for supplies via
  material-accounts; Cr 1010 or 3010 by paymentMethod). Line ref = idempotency.
- `POST /ai/receipt-ocr` exists but reads only the TOTAL (for POS cash-out).
  No line items, no ingredient matching, nothing in Procure.
- `AiService.call` (Anthropic, vision, budget cap, AiUsage log), `AiQuotaGuard`.
- `Document` model + `DocumentsService` (storage-backed) — attach files to any
  entity by (entityType, entityId). No receipt entity needed.
- `SimpleEntriesService` posts a balanced 2-line JE for an opex (RENT/UTILITIES/
  SUPPLIES/REPAIRS/TRANSPORT/OTHER) — the "cleaning" case.
- No ANTHROPIC_API_KEY locally → the AI call 503s here; prod has AI.
- Constraint honoured: **no schema change**. Everything below fits the models
  that exist.

### Plan
- [ ] `procure/receipt-parser.ts` — pure: line-item vision prompt, JSON salvage
      + shape validation, name normalisation, ingredient matcher (deterministic,
      scored, alternatives), pack-size derivation via shared `unitFactor`.
- [ ] `procure/procure-receipts.service.ts` — `parse()` (AI → lines → matches)
      and `confirm()` (create BOUGHT request, merge same-ingredient lines,
      receive each with receipt date + line ref, post expense lines as simple
      entries, create new ingredients on request but refuse near-duplicate
      names, attach the photo as a Document, idempotent on a client key).
- [ ] `procure/procure-receipts.controller.ts` + class-validator DTOs
      (`forbidNonWhitelisted` is on). Roles = the ones that already move money.
- [ ] Module wiring: export `SimpleEntriesService`, export `AiQuotaGuard`,
      `DocumentsService.uploadBuffer`.
- [ ] Web `/procure/receipts` — photo → read → review/correct → post → report.
      Home tile + role gate. Requests page shows the attached receipt.
- [ ] Specs: parser/matcher, confirm flow, module compiles; full suite green.
- [ ] Live: API up, confirm over HTTP on carolina-test; parse 503s cleanly
      without a key.

### Built and verified (2026-09-02, KJ AFK)

- [x] `procure/receipt-parser.ts` — prompt + JSON salvage + matcher + pack derivation. 35 specs.
- [x] `procure/procure-receipts.service.ts` — `parse()` / `confirm()`. 18 specs incl. merge
      of same-ingredient lines, owner-funded two-entry expense, near-duplicate refusal,
      idempotent replay, partial-failure stays BOUGHT.
- [x] `procure/procure-receipts.controller.ts` + class-validator DTOs.
- [x] Wiring: `receiveRequest(opts)`, `nextRequestNumber()`, `AiQuotaGuard` exported,
      `SimpleEntriesService` exported, `DocumentsService.uploadBuffer`.
- [x] Web `/procure/receipts` (photo → read → correct → post → report; hand entry works
      with AI off), home tile, role gate, filed receipt shown on the requests page.
- [x] **API suite 1,379 passed, 0 failed** (+53). Both apps typecheck. `/procure/receipts`
      compiles and serves.

**Live on carolina-test over HTTP:** parse with AI off → clean `403 AI_DISABLED` (the
screen falls back to hand entry); cook → 403; unknown body field → 400. Confirm →
`REQ-20260902-001` RECEIVED: Sugar 1,000 g @ ₱0.085 and Chicken wings 104.58 pc @ ₱10.83
posted, WAC moved (0.09→0.0886, 11.0126→10.9779), delivery fee → **JE-202609-0067**,
photo filed as a Document and downloadable (200, image/png). Replay with the same key →
`duplicate:true`, nothing posted.

**Withdrawn:** I claimed the JSON body limit was 100 kB and that the old `/ai/receipt-ocr`
was capped by it. Measured: an ordinary route accepts a 15 MB body. My scoped-limit change
to `main.ts` was unnecessary and made >12 MB a 500 instead of a 413 — reverted; `main.ts`
is back to HEAD.

**Unexplained, transient:** two `POST /auth/login → 401 "Unauthorized"` (not the
wrong-password message) at 49 s and 130 s after an API restart; all three test accounts
log in normally since. Not reproduced.

**Not done:** no browser walkthrough of the new screen — I don't sign in to forms. The route
compiles and every call it makes is proven over HTTP. Nothing committed (you didn't ask);
`git status` lists the whole day's work.

**Two gaps closed after the live run (own review, before the workflow's):**
- An expenses-only receipt (parking, delivery fee, no stock) created a request with no
  lines that sat at BOUGHT forever, asking to be added to stock. It now closes as
  RECEIVED the moment it is made — it exists to carry the photo and the expenses.
- A retry after a mid-way crash replayed the *unreceived* request as "already done" and
  its lines never posted. A replay of a BOUGHT request now runs the receive again; each
  line's reference stops a second posting, so only what never landed lands. Expenses and
  the photo are not re-attempted (nothing would stop a second copy).
Procure specs 84/84.

**Four more live proofs on carolina-test:**
- New ingredient from a receipt → `REQ-20260902-003` RECEIVED, "Chicken Breast (receipt
  test …)" created (g) and 2,000 g @ ₱0.24 posted in one call. *(Left on the test tenant,
  clearly labelled.)*
- Same name in capitals → **400** naming the existing record: the "Chicken Wings"/"Chicken
  wings" trap is closed at the receipt door.
- ₱85 typed against a per-gram ingredient → the line **fails** with the existing
  order-of-magnitude message, request stays BOUGHT, Sugar's cost untouched (0.0886).
- Replay of that key → re-runs the receive, same refusal, `duplicate:true`, nothing doubled.
  That request (`REQ-20260902-004`) then cancelled to keep the test list clean.
- Expenses-only, owner-funded → `REQ-20260902-002` RECEIVED, JE-0070 (owner contribution)
  + JE-0071 (transport expense).

Web lint: apps/web has no ESLint config (`next lint --file` gone in Next 16); typecheck is
the gate there and is clean. API lint clean.

### Adversarial review — 32 findings, 9 verified, all 9 confirmed (2026-09-02)

The verify phase first died on a session limit; resumed, every one of the nine
top-ranked findings was **confirmed** by a skeptic told to refute it. Applied:

- **JSON body limit — I was wrong.** body-parser 2.2.2 defaults to 100 kB; a
  reviewer reproduced 413 at 120 kB against the installed packages. My "15 MB
  accepted" measurement was an artefact: a path-scoped `json()` made Nest skip
  its default parser for the whole app, so nothing was parsing at all. Fixed
  with `app.useBodyParser('json', { limit: '10mb' })`, unscoped. Memory corrected.
- **Matcher:** prefix allowance limited to inflection (STRAWBERRY≠Straws,
  CREAM DORY≠Cream, CORNSTARCH≠Corn); a one-word name earns the coverage bonus
  only as the line's head noun (GARLIC POWDER≠Garlic, SALTED EGG=Egg); ties at
  the top ask instead of sorting alphabetically; the threshold is strict (0.5
  is one shared word of two — a coin flip).
- **₱0 read as free:** zero price/total now means "not read"; DTO `packCost`
  is `@IsPositive`; the screen blocks a stock line with no price.
- **Merge of unlike packs:** one pack of the whole quantity at the whole price,
  so ₱1,770 paid posts ₱1,770 (was ₱1,771 after 4-dp rounding).
- **Replay applies corrections:** a re-post under the same key writes the
  corrected numbers onto the waiting lines, adds a line the person added,
  carries "the price really changed", and reuses an ingredient it created
  last time. Lines already on the shelf are untouched.
- **Owner-funded:** expense first, then contribution; a contribution failure
  is reported, never an orphan Dr Cash / Cr Capital.
- **SUPPLIES → 6070 was SYSTEM_ONLY** — every manual Supplies entry had been
  failing (pre-existing, in simple-entries). Now 6140 (OPEN).
- **Quota:** `procure_receipt_lines` counted by `AiQuotaGuard` (was free).
- **Two-pass validation:** every line checked before any ingredient is
  created; two new lines with one name are one ingredient.
- **Requests page** can now pass "the price really changed" to Receive.
- **Public photo route** refuses document-shaped ids (`12hex_`), so a filed
  receipt under the DB storage driver is reachable only via `/documents`.
- **Web:** one idempotency key per form (hand-typed receipts were unguarded);
  "Fix and post again" from the result screen; match score shown as a
  "best guess — check" badge below 0.85; re-picking an ingredient keeps the
  receipt's printed unit and prefills kg→g; Take *or* Choose a photo; Start
  over / Read again ask first; problem numbering matches the screen; "P195"
  and "1,250" parse; branch defaults for accounts without one.
- Prompt: a size in the description is the pack, not the quantity; one money
  column is the line total; unit price vs total disagreement → total wins.

**Live after the review fixes (carolina-test):** login parses (parser present);
900 kB JSON on an ordinary route → **400** (parsed, then validated — was a 500 at
100 kB); 12 MB → 500 (limit still bites; the 500-not-413 mapping is the global
filter's pre-existing behaviour for any oversized body); 900 kB photo body reaches
`/procure/receipts/parse` → clean `403 AI_DISABLED`; SUPPLIES expense → **JE-202609-0073**
(`REQ-20260903-001` RECEIVED); Receive with `acceptCostChange` validates (200).
Web typecheck clean after the screen changes.

### Daily cap on AI receipt reads (2026-09-03)

KJ: "put limit as to what AI will do with this feature… or a rate limiter, like 50
times a day, we will adjust it from time to time."

**What the AI may do is fixed by construction:** it reads a photo into lines and
nothing else — it never picks an ingredient id (that is plain code), never posts,
never creates. Nothing lands until a person confirms.

**The rate limiter:** `ReceiptReadLimitGuard` on `POST /procure/receipts/parse`,
behind the monthly `AiQuotaGuard`. Counts `AiUsage` rows for
`procure_receipt_lines` per tenant since **Manila midnight** (not UTC — a UTC
reset would land at 08:00 during the morning market run). Failed reads count
(they spent tokens). The 51st read is `429 RECEIPT_READS_EXHAUSTED` with
`{limit, usedToday, resetsAt}`; the screen says so and falls back to hand entry.
`GET /procure/receipts/reads` feeds "N of M reads left today" beside the button.
No super-admin bypass: a read costs the same whoever asks.

**The knob:** `AI_RECEIPT_READS_PER_DAY` (default 50) and a per-tenant JSON map
`AI_RECEIPT_READS_PER_DAY_BY_TENANT` — env only, no deploy of code to adjust.
`0` = reading switched off, posting untouched. A broken value falls back to 50,
never to "off for everyone" and never to "unlimited".

Specs: 14 for the guard (knob parsing, Manila boundary with real dates, the 429
shape, zero = "switched off", no admin exemption). Procure suite 103/103.

**Refutation pass on the cap — 13 defects (5 distinct), all applied:**
- A blank env value coerced to **0 and switched reading off for everyone**
  (`Number("") === 0`); null in the tenant map did the same. Blank now means
  "not set"; only a real number counts; zero has to be typed.
- The count is taken before the provider answers, so a burst at the cap all
  passed — unbounded, not "fifty-one". A process-local **in-flight ledger**
  reserves a slot when the guard passes and an interceptor releases it when
  the request ends, however it ends (a body that fails validation included).
- Zero-token provider failures (outage, bad model id) burned reads and could
  lock a shop out till midnight for reads that never happened. Only rows that
  spent tokens, or succeeded, count.
- `GET /reads` sat outside the monthly gate and told a shop with no AI "50 of
  50 left". Now behind `AiQuotaGuard`; the screen shows nothing on 403.
- The screen's count went stale after a failed read; it refreshes on every
  read error. A cap of 0 says "switched off", not "0 reads are used up".
- Kept 50 as KJ chose; the arithmetic against the monthly quota and USD budget
  is written beside the knob in `.env.example` so it is tuned knowingly.
Guard specs 15/15.

---

## Procure status map (2026-09-03) — three read-only mappers, 40 gaps, all cited

KJ asked "anything pending for Procure? is it connected to Ledger, to POS?"

**Corrections to my first answer**
- Ledger: receipts, write-offs, counts and batches reach the books. **Branch-to-
  branch transfers post NOTHING** (no event, no lot, no InventoryLog) and
  **recipe catch-up deducts stock with no event** (1051 never relieved).
- Counter: it does NOT sync stock adjustments — its outbox targets
  `/inventory/adjustments`, a route that does not exist (`/inventory/adjust`),
  and nothing enqueues that kind. Dead path.

**Blocking**
- Counter **offline sales replay through POST /orders with stock refusal ON** —
  a sale that already physically happened can be refused on sync with
  NOT_ENOUGH_INGREDIENTS, against the service's own rule.
- No path from a Procure journal entry back to its source (no `reference`, list
  API strips the payload, "view source" is keyed on orderId only).

**Notable**
- Zero-cost movements post nothing and nothing flags it — a write-off of an
  unpriced ingredient, a count variance at cost 0. Carolina has 17 unpriced.
- CREDIT receipts (Stock on hand / PO receive, not Procure requests) create an
  APBill with no journalEntryId; the AP void path refuses the bill.
- Events that fail 5 retries are only logged; the request reads RECEIVED.
- The POS tile's "N left" and Procure's ceiling consider product-level BOM only;
  sale-time consumption also applies **variant BOMs, modifier scaling and
  modifier ingredient add-ons** — sizes/modifiers make the tile wrong.
- Prep availability does not reach the tile: a latte reads OUT when the syrup
  tub is empty even though a batch could be made.
- UNIT_BASED (finished-goods) products have no server-side stockout refusal.
- A purchase request cannot be cancelled from any screen.
- BRANCH_MANAGER can open /procure/stock but 403s on create/edit; WAREHOUSE_STAFF
  can preview recipe catch-up but not apply.
- FEFO lot-tracking toggle reachable from no screen.
- Receipt expense lines post gross (no VAT split) and MANUAL-source, so a JE
  threshold can hold them PENDING_APPROVAL while **my receipts page says
  "posted"** — mine, small fix: surface `status` from the simple entry.
- Low-stock notifications never reach the till or Counter.
- Dark routes: GET requests/:id, cancel, inventory logs, threshold, lot-tracking,
  transfer detail, buy-now slip/export/print (POS-only).
Full lists with file:line: the wd8bcbapl workflow output.

---

## 2026-09-03 — "Fix everything this week" (KJ AFK)

Scope: every gap from the status map that needs no schema change. Room-to-room
transfers (needs `StockLocation` migration) stays KJ's call.

### Batch 1 — money and stock
- [x] Offline sale replay is never refused for stock: `replayedOffline` in the
      POST /orders body; the server passes `skipStockCeiling` for a till caller
      only (never an API-key caller); the Counter outbox sends the flag.
- [x] Journal → source: system JEs carry `reference`; the Ledger journal page
      links `REQ-…` to /procure/requests?view=…; the requests page honours it.
      LIVE: JE-202609-0075 on carolina-test carries ref LIVE-CHECK-18F96D.
- [~] Recipe catch-up posting to the ledger: BUILT, then REVERTED the same day.
      The status map was wrong — the sale already posts Dr 5010 / Cr 1051 even
      while deduction is paused, so catch-up posting again doubled COGS. Two
      reviewers caught it. The spec now pins "posts nothing to the ledger".
- [x] Branch transfers: one STOCK_TRANSFER event per line (journal marks it
      SYNCED and skips it; Stock Movements shows OUT and IN), lots drained
      FEFO at the source on send, a lot created at the destination on receive
      at the shop's unit cost, a lot back at the source on cancel-after-send.
      LIVE: ST-2026-000001/2 on carolina-test moved 3 g between branches,
      source 1999→1996 and destination 3→6 in Stock Movements, both events
      SYNCED (skipped), no journal entry. The trail first logged 0→0 for the
      before/after columns; fixed to read the shelf and derive the other side.
- [x] CREDIT receipt: the journal links the AP bill it just credited 2010 for,
      matched on (tenant, reference, gross amount, unlinked, system-receive).
      No payload id and no schema change needed.
- [x] Zero-cost movements: receive / write-off / cycle count return `warning`;
      Procure receipts + requests, Stock on hand and Cycle counts show it.
      LIVE: both warnings returned on a no-cost test ingredient.
- [x] Events stuck after 5 retries → one WARNING notification per tenant
      (dedupe by count, link /ledger/events) next to the log line.
- [x] resolveBranch: a branch of another tenant → 400 "Branch not found in your
      organization"; no branch → the tenant's first branch. LIVE: 400 and 200.
### Batch 2 — screens and roles
- [x] Cancel a purchase request from the requests page (OPEN / SENT / BOUGHT,
      owner-manager-MDM, confirm first; a BOUGHT list warns that nothing
      bought will reach stock).
- [x] BRANCH_MANAGER may create / edit raw materials and toggle lot tracking;
      WAREHOUSE_STAFF may preview recipe catch-up (apply stays owner).
- [x] FEFO toggle on the stock edit modal — found already built earlier today.
- [x] Transfers page shows lines before Send/Receive — found already built.
- [x] Receipts page shows an expense held for approval as "waiting for
      approval" (the API now returns the entry's status).
- [x] Counter: dead outbox path `/inventory/adjustments` → `/inventory/adjust`.
- [x] POS tile ceiling over base + variant recipes — found already built.
### Decided, not built (say why in the review)
UNIT_BASED refusal (no retail client), prep availability on the tile (a tub
that is empty IS empty), VAT split on expense lines (NON-VAT tenant; v1 books
gross by decision), sub-recipe import, a read-only kitchen role, PO in Procure,
Play app, pharmacy lot selection, tingi. Room-to-room transfers still need a
`StockLocation` migration — KJ's call.

### Verified (2026-09-04)
- API suite: 1,415 passing, 6 skipped, 0 failing. New specs: warehouse.transfers
  (4), accounting.scheduler (3), journal.source-link (5), procure.branch (4),
  recipe-catchup (+2); warehouse.race mock extended for lots/events.
- `tsc --noEmit` clean in apps/api, apps/web and apps/counter.
- Live on carolina-test against the local API (scratchpad `live_check.py`):
  bogus branch 400, own ceiling 200, no-cost receive and write-off both return
  the warning, costed receive → JE-202609-0075 with its reference (cron posted
  it within a minute).
- Test-tenant leftovers: inactive ingredient "zz live-check no-cost (delete me)"
  with 1 pc on the shelf at no value; +1 g on "Chicken Breast (receipt test …)".
- Test tenant now has a second branch, "zz live-check branch (delete me)",
  holding 6 g of the chicken-breast test ingredient — made to verify transfers.
- Not verified live: the offline replay flag end to end (needs the Counter) and
  the stuck-event notification (needs a failing event). Both pinned by specs.
- Nothing committed: ~80 uncommitted paths across apps/api, apps/web,
  apps/counter and tasks/. KJ commits.

### Adversarial review (2026-09-04) — 30 findings, 15 confirmed, all handled
Five finders (money, stock, security, screens, tests), one skeptic per finding
told to refute; 35 agents.

Fixed:
- BLOCKING (x3, same defect): recipe catch-up double-posted COGS → reverted, spec pins it.
- BLOCKING: VAT receipt rounded net, VAT and gross separately, so ~10% of
  price/qty pairs posted a centavo out — unbalanced inside the tolerance, or
  failed outright and never reached the books. VAT is now the difference of the
  two rounded numbers; 5 new cases in `receipt-rounding.spec.ts`. Pre-existing,
  not from today.
- IMPORTANT: voiding an AP bill written by a stock receipt would have reversed
  the delivery's entry while the stock stayed on the shelf → refused, with a
  message pointing at the stock screen. Caused by today's bill↔JE link.
- IMPORTANT: two different-looking Cancel buttons on the requests page (I built
  one that already existed) → mine removed.
- MINOR: "waiting for approval" printed twice on one expense row → mine removed.
- MINOR: `replayedOffline` in the replayed BODY breaks the Idempotency-Key hash
  → 409 forever. Now a header (`X-Replayed-Offline`); the body field still read
  for rows queued by an older build.
- MINOR (x2): a transfer drained lots at layer cost but re-lotted at today's
  average → send now writes the realised blend onto `StockTransferLine.unitCost`
  and receive builds the lot from it. No migration; 3 new specs.
- MINOR: cycle-count success said "variances applied" and stacked a toast per
  uncosted ingredient → one summary line with the count.
- MINOR (x2): two test gaps (destination upsert unasserted; retry ceiling
  unpinned) → both pinned.
- The movement trail logged before/after as 0 → 0 (found in the live run, not
  by the review) → reads the shelf and derives the other side.

Left for KJ (schema changes — the no-migration rule):
- Transferred perishables lose their expiry date, so they sort last under FEFO
  and raise no expiry alert. Needs a nullable `expirationDate` on
  StockTransferLine.
- Room-to-room transfers need `StockLocation`.
- A sale line that resolved NO cost still relieves nothing when catch-up runs;
  telling those apart needs a per-line marker written at sale time.

Final state: 1,423 API tests passing (6 skipped), tsc clean in api/web/counter,
`next build` clean, live checks green on carolina-test (bogus branch 400, no-cost
warnings, receipt reference on JE-202609-0075, three transfers with movements
both sides and no journal entry).
