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
