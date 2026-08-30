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
- [x] **7. The owner's sales were invisible to the drawer.** Supervisors bypass
      the shift gate, so his cash goes in the same till with no shiftId and she
      counts over. **Reported, not folded into expected cash** — see the open
      question below.
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

### One question for KJ

**Should the owner have to open a shift like everyone else?** Right now
supervisors bypass the gate. Either policy is defensible, and with several
shifts open per branch there is no unambiguous shift to attach a stray order
to — so the amount is now reported rather than guessed at. Say the word and it
becomes a hard gate; until then the overage at least has a name.

### Note on existing tenants
`seedDefaultAccounts` never updates `postingControl` on accounts that already
exist, so tenants created before a control was added keep the old one. The demo
tenant's `2010` was OPEN and has been set to `AP_ONLY` to match the seed. Worth
a one-off sync before onboarding anyone whose books already exist.
