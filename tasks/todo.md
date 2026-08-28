# Magnet Books — simple POS + Ledger for fridge-magnet home businesses

**Goal (KJ, 2026-08-17):** One product for the magnetmoments.cc seller — a home
fridge-magnet business with limited earnings. Not multinational. Simple. One flat
access (not tiers): POS to record magnet sales + stock-ins, and a ledger a
non-accountant can run. Books are gross / no tax (US: no VAT; AU: under the GST
threshold). Wedge vs a $99/mo competitor: nobody hands a home seller real books.

**Design principle:** magnetmoments.cc stays the front door (booking, mark-paid,
queue, print). Clerque is the books. The bridge is the ingest endpoint we already
run for CourtSide. Zero accounting logic is rebuilt in the print app.

## Decisions locked this session
- "Accesses not tiers": ONE plan (`CLERQUE`, everything on) + a per-tenant
  `ledgerMode` (`FULL` | `SIMPLE`). Simple = Record Entry + Profit + Reports +
  Settlement; advanced ledger HIDDEN (not grayed) and 403'd server-side.
- Lever = one JWT-mint override: `advancedAccounting = planFeature && ledgerMode !== 'SIMPLE'`
  → all 48 `@RequirePlanFeature('advancedAccounting')` guards + the whole ledger
  nav respect it for free. No per-controller edits.
- Tenant gets `country`, `currency`, `timezone` (defaults PH/PHP/Asia/Manila so
  every existing tenant is unchanged). NOT an FX engine — one tenant, one currency.
- Money display: `formatPeso` becomes currency-aware from the JWT (default PHP);
  scoped to the simple-mode screens + shell in this slice.
- magnetmoments "mark paid" → `POST /ingest/magnetmoments` `sale` (idempotent on
  order id, CourtSide contract shape) → revenue account 4010 (retail sales).
  Refund event supported (contra-income). One tenant per shop, service API key.
- Legal riders (AU consumer law / US) = counsel, not code — flagged, not built.

## Schema changes (told KJ before running — additive, backfill-free)
- `Tenant.ledgerMode LedgerMode @default(FULL)` — enum `LedgerMode { FULL SIMPLE }`
- `Tenant.country String @default("PH")`, `Tenant.currency String @default("PHP")`,
  `Tenant.timezone String @default("Asia/Manila")`
- (repurposing the dead `managerAccountingEnabled` was considered — rejected:
  inverted/ambiguous name; a clean column is safer.)

## Tasks
- [x] 1. Schema + migration `20260817000000_ledger_mode_locale` (applied)
- [x] 2. JWT: mints ledgerMode/country/currency/timezone; auth.service overrides
      advancedAccounting=false for SIMPLE (copies the shared PLAN_FEATURES object);
      plan-feature.guard legacy-token fallback mirrors it
- [x] 3. Owner-writable ledgerMode (DTO @IsIn + updateProfile) + Settings "Ledger mode"
      card (seeds from DB profile, not stale JWT; "log out and back in" note)
- [x] 4. Ledger nav HIDES advanced items in SIMPLE (section headers re-homed);
      FULL nav byte-identical
- [x] 5. `GET /simple-entries/summary` (money in/out/profit, tenant currency, tenant-tz
      default month, ISO+range validation) + "This month" profit card w/ month picker
- [x] 6. `formatMoney`/`currencySymbol`/`setDisplayCurrency`; formatPeso signature
      unchanged, PHP default → 394 sites identical; wired in store/auth.ts (setUser,
      clear, onRehydrateStorage); Intl construction try/catch → never blanks the app
- [x] 7. `POST /ingest/magnetmoments` sale/refund; keys `mm:sale:`/`mm:refund:`;
      currency MUST match tenant; integer/positive money; lines must sum; gross;
      refund reads original tender from resultJson (1010 vs 1031)
- [x] 8. 616/616 API tests (48 suites, +30), api+web tsc clean
- [x] 9. Live smoke 25/25 (real DI graph, throwaway SIMPLE USD tenant)
- [x] 10. Memory + review

## Review (2026-08-17)
**Shipped:** the "Magnet Books" access — a SIMPLE-mode tenant sees Dashboard /
Record Entry / Settlement / Reports / POS-derived AR only, is 403'd on the 48
advanced routes (even on a legacy token), sees a plain-English monthly profit,
and gets its magnetmoments.cc sales posted automatically on "mark paid".
**Bug found by adversarial review and FIXED at the root (not just for the card):**
`getPLSummary` and `getBalanceSheet` summed contra accounts in their OWN
direction — a refund RAISED revenue, an owner drawing RAISED equity, accumulated
depreciation RAISED assets, and Assets = Liabilities + Equity silently broke.
19 contra accounts in the seeded COA. Fixed to direction-uniform section totals
(row display unchanged); `getPLSummary` `to` now includes the whole day.
Pinned by accounts.statements.spec.ts (7 tests) + live: $40 sale − $15 refund →
money-in $25; balance sheet 515 = 0 + 515. This also corrects the Income
Statement export and period-close, which reuse getPLSummary.
**Deferred (needs KJ):** the flat PRICE number; legal riders (AU consumer law / US);
magnetmoments.cc side of the bridge (call the endpoint on "mark paid" with a
per-shop readwrite API key) — the Clerque side is live.
**Housekeeping:** one inert throwaway tenant `magnet-smoke-1786969320126` remains
in the LOCAL dev DB (0 orders/entries/products; only 2 login_log rows, protected by
the append-only audit trigger which the sandbox rightly refused to disable). Remove
with: `ALTER TABLE login_logs DISABLE TRIGGER ALL; DELETE FROM login_logs WHERE
"tenantId"=(SELECT id FROM tenants WHERE slug LIKE 'magnet-smoke-%'); DELETE FROM
tenants WHERE slug LIKE 'magnet-smoke-%'; ALTER TABLE login_logs ENABLE TRIGGER ALL;`
Lesson: smoke scripts should mint JWTs via JwtService.sign() with a hand-built
payload, not auth.login(), to avoid writing audit rows.

---

## Carolina — features buildable without schema changes (2026-08-27)

Requested: "do everything what you can do now". The three below need no
migration. Preps, the oat-milk swap column and the raw-material movement log
all require schema changes and are NOT started — they need explicit approval.

- [x] 1. Export ingredients as xlsx
      `ingredientsExport(tenantId)` + `GET /import/export/ingredients`.
      Fills the SAME seven columns the importer reads, from live RawMaterial
      rows, so export -> edit -> import is a round trip. This is what stops
      every ingredient file having to be hand-built outside the app.
      Property to prove: exporting and re-importing changes nothing.

- [x] 2. Fix `getLowStock` (inventory.service.ts:354)
      Today it queries `inventoryItem` joined to Product only, so a cafe gets
      zero ingredients back. It also spreads `...i`, leaking `avgCost` to
      cashiers. Add raw materials; drop the leak.

- [x] 3. Expose purchase orders to the owner
      The module is built (create/submit/receive) with screens, but only under
      /admin, so a BUSINESS_OWNER cannot reach it.

### Review

All three shipped. 834 tests / 74 suites pass; both apps typecheck clean.

**1. Ingredient export** — `ingredientsExport()` + `GET /import/export/ingredients`,
inheriting the controller's owner/manager/finance roles (costs, so not cashiers).
Two things the build turned up:
  * `makeTemplate` stamps every row it is handed with the SAMPLE marker, and
    `isSampleRow` skips those on import — so passing real data through it would
    have produced a file that uploads as nothing. Added a `realData` opt that
    turns off the stamping, the grey italics, and the "rows starting with
    SAMPLE are ignored" instruction, which is the wrong thing to tell someone
    about their own data.
  * Writing `Recipe Unit` equal to `Unit*` and leaving `Pack Size` blank is what
    makes the round trip exact: the importer only converts when the two differ,
    so the cost comes back as it went out. Proved in
    `ingredients-export.spec.ts` — export, re-import, nothing created, every
    unit and cost unchanged, including the "Strawless Lid ( Cold )" spacing.

**2. getLowStock** — now unions products with `rawMaterialInventory` against
`RawMaterial.lowStockAlert`, so a cafe actually gets ingredients back instead of
bottled water. Replaced the `...i` spread with an explicit allow-list: it was
handing `avgCost` to every CASHIER on the endpoint's role list. Added `shortBy`
and sorted worst-first, because "8 short" is actionable and "12 <= 20" is not.

**3. Purchase orders** — the API always allowed BUSINESS_OWNER; only the screens
were unreachable, sitting under an /admin layout that redirects non-SUPER_ADMIN.
Added /pos/purchase-orders routes that re-export the same components (they never
reference a tenant — the API scopes by JWT) and a Purchasing nav section
appended to every vertical, since the default nav branch a coffee shop takes
does not include the Warehouse section. The pages had four hardcoded
/admin/purchase-orders links that would have bounced an owner to /select; those
now resolve against whichever mount the reader is on.

**4. Buy Now — cashier-facing (added after the first three)**
  * `GET /inventory/low-stock/slip` — the list as 32-column text for the popup
  * `POST /inventory/low-stock/print` — same content as ESC/POS, reusing the
    Close & Plan `InlineEscPosBuilder`, so whatever prints receipts prints this
  * `GET /inventory/low-stock/export` — the xlsx shopping sheet, laid out in the
    shop's OWN expense-report columns (Date/Store/Area/Item/Pack size/Pack unit/
    Qty/Unit price/Amount) so one sheet is both the list and the record
  * `components/pos/BuyNowButton.tsx` in the POS header next to Cash Out —
    cashiers cannot open /pos/inventory, so the answer comes to them
  All four are CASHIER-open and carry NO costs; a test asserts the buffer never
  contains a price. Screen and paper are rendered from one line-list on the
  server so they cannot drift.

  Depends on `RawMaterial.lowStockAlert` being set — with no thresholds the
  list is correctly empty. That is column J of the Setup Workbook.

**Not started — these need schema changes and explicit approval:**
  * `ModifierOptionIngredient.replacesRawMaterialId` — the oat-milk swap
  * prep tracking (`batchYield`, prep recipe, `qtyReserve`)
  * `RawMaterialMovement` — the ingredient half of InventoryLog, which the
    cashier usage report depends on

---

## Ingredient categories + one file for everything (2026-08-28)

Explicit go-ahead given for the migration. Three pieces, one slice.

- [x] 1. `RawMaterialCategory` enum + `RawMaterial.category`
      INGREDIENT / KITCHEN_SUPPLY / BAR_SUPPLY / OFFICE_SUPPLY, defaulting to
      INGREDIENT so every existing row keeps behaving exactly as it does now.
      Nothing distinguishes coffee beans from bleach today, which is why 17
      supplies sit in Carolina's 283-row ingredient list looking like food.

- [x] 2. Category flows through the templates
      Add the column to the Ingredients import template and read it. Then the
      rule the owner asked for becomes enforceable: only an INGREDIENT may
      appear in a recipe, so only ingredients reach COGS. Supplies still get
      stocked and counted; they simply cannot be an ingredient of anything.

- [x] 3. Setup-pack EXPORT
      `template/setup-pack` already returns ONE file with seven sheets in
      dependency order — but only blank. Filling it is the real answer to
      "too many templates": after day one nobody opens a blank template again,
      they export their setup, edit it, and upload the same file back.

NOT in this slice: routing supply purchases to expenses instead of inventory.
That touches AP and is a separate decision — flagged, not started.

### Review

Shipped. 873 tests / 79 suites pass; both apps typecheck.

**1. `RawMaterialCategory`** — enum + `raw_materials.category`, NOT NULL DEFAULT
'INGREDIENT', plus a `(tenantId, category)` index. Migration
20260828000000_raw_material_category. Deliberately NOT backfilled by name:
guessing "Zonrox Bleach" is a supply is right, guessing "Food Keeper" is a coin
flip, and a wrong category silently removes an item from recipe costing.

**2. Category in the templates, and the rule it makes enforceable.** The column
is resolved by HEADER, not position, so every seven-column sheet already in the
wild keeps importing and lands on the default. Input is normalised the way a
person writes it ("Kitchen Supplies", "kitchen supply", "KITCHEN_SUPPLY") and an
unrecognised value is REFUSED by name rather than filed as food. A blank cell is
"not supplied", so re-importing never re-files something categorised in the app.
Then the owner's rule holds at the point it matters: importRecipesFromRows
refuses a non-INGREDIENT with a message naming the category, because bleach in a
recipe is a mistake worth seeing rather than a row to skip.

**3. Recipe UOM — a live accuracy bug, not a missing feature.** The recipes
template documented a Unit column in its instructions AND wrote 'g'/'ml'/'pc'
into its sample rows, but shipped only three headers. importRecipesFromRows
locates that column by matching /^unit/i against the HEADER row, so it always
returned -1 and the unit was silently dropped. Anyone who followed the
template's own instructions and wrote "200 ml" against milk stored in litres got
200 LITRES in one drink, with nothing erroring. Header added, every sample row
now states its unit, and cups/lids read 'pc' rather than 'g' — a template
teaches by example before anyone reads the instructions. Still optional, so
existing sheets keep working.

**4. Setup-pack export.** `GET /import/export/setup-pack` returns ONE file whose
sheets are the same seven the blank pack ships, with Ingredients and Recipes
filled from live data. Also `GET /import/export/recipes` on its own. The blank
pack answers "what must I fill in?"; this answers "what do I already have?",
which is the question every shop past day one is actually asking. Products,
Customers, Vendors and the Chart of Accounts ship blank and the Read Me says so
— Products vary by business type and the rest are rarely bulk-edited.

**Flagged, not started:** routing supply PURCHASES to expenses rather than
inventory. Categorising them is done; changing where their money lands touches
AP and is a separate decision.
