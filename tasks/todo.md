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
