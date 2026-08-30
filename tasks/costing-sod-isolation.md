# Counter / Ledger / Procure — costing, SOD, isolation

**Scope (KJ, 2026-08-30):** Counter is the POS, Ledger is the books, Procure is
inventory management. Sync/payroll is parked. Make stock, materials and
cleaning supplies account correctly — some costed, some expensed — and settle
RLS and SOD.

Mapped by four readers over the real code, then ruled on by a PH accounting
pass, an operations pass and a security pass.

---

## 1. Costing vs expense — the ruling

**The dividing line is not edible-vs-not. It is: is this consumed with each
unit sold, or consumed by the shop?**

| Category | Debit on receipt | Treatment |
|---|---|---|
| `INGREDIENT` | **1051** Raw Materials Inventory | Capitalise. Relieved to 5010 COGS by the recipe on each sale. |
| `KITCHEN_SUPPLY` | **6210** Tools and Supplies Expense | Expense on receipt. Never COGS. |
| `BAR_SUPPLY` | **6210** Tools and Supplies Expense | Expense on receipt — **but see packaging below.** |
| `OFFICE_SUPPLY` | **6070** Office Supplies Expense | Expense on receipt. |

Credit side unchanged: `1010` cash / `2010` AP / `3010` owner's capital.

**Mandatory addition — input VAT.** Every receipt must split it:
`Dr 1051 or 6210/6070` (VAT-exclusive) + `Dr 1040 Input VAT` (12%) `Cr 1010/2010`
(gross). Today the gross is capitalised whole and the auto-created APBill
hard-codes `vatAmount: 0`. NIRC Sec 110 gives the credit only where invoiced
**and recorded** — so this is money currently being left with the BIR.

### Packaging is the exception, and the data proves it

The accounting pass put cups and lids in opex, reasoning that charging
packaging to COGS "without a per-sale consumption event makes gross margin
lurch with purchase timing".

**That reasoning does not hold here — the consumption event exists.** Checked
against the database: `CH Cold Cup 16oz`, `CH Strawless Lid ( Cold )` and
`E2E Cup 8oz` each carry a `bomItem`. They are relieved per drink by the same
recipe walk that relieves milk. Margin cannot lurch, because purchase timing
never touches COGS.

- [ ] **DECISION FOR KJ:** packaging stays `INGREDIENT` (capitalised, relieved
      per drink — accurate margins, works today), or gains its own category
      that is recipe-eligible and capitalised. What it must NOT be is a supply,
      because supplies are barred from recipes.
      Guard shipped in the meantime: an item used in a recipe cannot be
      reclassified as a supply.

### Sequencing

- [x] **Before go-live.** ~~Supplies stop debiting 1050 and start debiting
      6210/6070. Split `1040` Input VAT out of every receipt.~~ **DONE**
      (25ee77a). Verified on real data: bleach `Dr 6070 500.00 / Dr 1040 60.00
      / Cr 1010 560.00`; sugar `Dr 1051 100.00 / Dr 1040 12.00 / Cr 1010 112.00`.
- [ ] **After go-live.** Ingredient receipts move `1050` → `1051`, and the COGS
      relief leg must credit 1051 for recipe-costed lines. Both are current
      assets, so no total moves — only the inventory note and the RMC 57-2015
      breakdown. Real value, no urgency.
- [ ] **Blocker first.** `1051` and `1054` are seeded `postingControl: OPEN`,
      `isSystem: false`. Flip both to SYSTEM_ONLY before either is load-bearing,
      or a tenant can delete the account the posting code depends on.
- [ ] **Year-end true-up.** Expense-on-receipt is only defensible with a
      Dec 31 count-and-defer of any material unconsumed supply balance.
      Without it the policy has a hole an auditor writes up.
- [ ] `1053` Finished Goods and `1052` WIP: leave dead. A made-to-order cafe
      does not need them; WIP for sub-recipes is over-engineering.

### The value-flow defects behind all this

- [x] ~~**Cycle counts post NOTHING to the books.**~~ **DONE** (0c35fbc). Emits
      an ordinary INVENTORY_ADJUSTMENT per line, so it inherits the category
      routing. A count GAIN reverses into 5060 rather than crediting Owner's
      Capital, and claims no input VAT — no supplier, no invoice.
- [x] ~~**There is no way to write off a raw material.**~~ **DONE** (0c35fbc +
      ba4b484). `POST /inventory/raw-materials/:id/write-off` plus a screen.
      Refusing to over-write-off points at the cycle count instead.
- [x] ~~`5060` and `5070` are seeded and dead~~ **DONE**. Reason now routes:
      expiry/damage → 5070, theft/count correction → 5060, otherwise 5010.
- [ ] Purchase-order receipt posts no journal entry, no WAC blend, no recost.
- [ ] Sub-recipe batches never reduce the components' lot quantities, yet
      create a lot for the output.
- [ ] Branch transfers move quantity with no accounting event and no lot moves.
- [ ] WAC divides by the BRANCH quantity but writes to the tenant-wide
      `RawMaterial.costPrice`.

---

## 2. SOD — build almost nothing

**Verdict: at four people almost every duty pair is unseparable, and the code
already enforces every separation that IS achievable, via `@Roles` and the
supervisor-PIN checks.** The correct go-live list is a few small fixes and
*zero new controls*.

- [ ] **Delete or relabel the SOD tile on the Ledger dashboard.** It is the
      single most dangerous artifact in the suite: a permanently-green control
      tile that reports clean because it is **not wired**, not because the shop
      is clean. `User.sodOverrides` is written and read nowhere, and the
      frontend never sends it. `/settings/sod-violations` will say "no overrides
      recorded" forever.
- [ ] **Permission check bug:** `users.service.ts:341` evaluates only the custom
      override array and never unions the role's own defaults — so a CASHIER
      granted `order:void_direct` is checked against a one-element set and
      passes clean. The frontend evaluates the correct union and warns. Backend
      and frontend disagree, and the backend is the lenient one.
- [ ] The JE approval threshold is ₱50k; a one-branch cafe will never hand-key
      one that large and no system-posted entry can reach it. Lower it to a few
      thousand so it catches a real correcting entry, or stop calling it a
      control.
- [ ] Do **not** promote a barista to cover the 6am void gap. Set
      `voidApprovalThresholdCents` so it queues instead.

---

## 3. RLS — do not build it

**Verdict: not before go-live, and not for this client.** The evidence: 1,667
Prisma calls on tenant-scoped models audited, and the manual `where: { tenantId }`
discipline is holding.

RLS would be a second wall behind a forgotten `where` — a real but narrow
benefit. It does **not** touch what the owner is actually worried about: a
barista is *inside* the tenant, so the policy evaluates true for her on every
payroll row and every journal line. Payroll confidentiality is an app-access
and role problem; branch isolation is a request-parameter-trust problem.
Neither is a row-security problem.

Note RLS would not have caught either hole actually found — one was an
unauthenticated endpoint, the other an ordering bug.

- [ ] **Cheaper control worth having instead:** a test or lint that fails any
      Prisma query on a tenant-scoped model with no tenant filter. Catches the
      class continuously, costs days not weeks.
- [ ] Branch scoping: check every place a `branchId` comes from the request
      rather than the JWT.

**Fixed already** (commit 2d3cc9f): the unauthenticated `_diagnostics`
endpoint, and the Z-Read/X-Read idempotency-before-tenant-check that let one
tenant read another's figures and permanently squat on their Z-Read slot.

---

## AI receipt capture — decided, not yet built

**Provider: Gemini**, funded by the $2,000 Google-for-Startups credit.

⚠ **It must be a PAID key, not the free tier.** The free Gemini tier trains on
submitted data. These documents are supplier receipts carrying vendor names,
prices and volumes — for the shop, and for every shop once this is sold on. The
GFS credit exists precisely to cover this, so the paid tier costs nothing extra
in practice.

**Pattern: copy Sangguni** (`E:\AI Projects\Sangguni`), which already does this
well:
- `pdf-parse` for PDFs, `tesseract.js` for image OCR, both on a BullMQ queue
- a worker (`ocr.processor.ts`) that extracts text, then hands it to the model
  for structured extraction
- Sangguni uses `claude-haiku-4-5` for that step; swap the provider, keep the shape

**Telegram is dropped.** Procure with camera + upload keeps the receipt attached
to the request line it belongs to. A photo in a chat thread is attached to
nothing, and "show me the receipt for REQ-20260830-001-04" has to be one click
three weeks later. Telegram remains fine as a *notification* channel later —
a webhook, not an ingress.

**Meantime notification (KJ):** email to an assigned list, plus a generated PDF
that can be dropped into a group chat.

### The one part that is not like Sangguni

Sangguni parses a document into a **summary**, where being approximately right
is acceptable. Receiving has to resolve "MILK 1L x3" to a specific
`rawMaterialId` and move stock, where being approximately right corrupts
inventory. This project has already been bitten once by fuzzy ingredient
matching — `Ice` matched "Iced 16oz" and would have booked 2,375 cups.

So: **AI proposes, the control number anchors, a person confirms.** Never
auto-post a receive from an extraction.
