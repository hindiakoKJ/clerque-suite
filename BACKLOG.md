# Clerque — Backlog

> Last updated: 2026-04-30
>
> Tracks features that have been scoped but not yet shipped, and known
> issues with no immediate fix. Items are tagged by app and priority.

---

## High Priority — POS

### POS-1 · Cloudinary file upload for product images
**Status:** Stub only (URL paste works today; no file picker).
**Why deferred:** Requires creating a Cloudinary account, adding
`CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET` to Railway env, and a
small server-side signed-upload endpoint. The frontend file picker is
~30 lines of code — the gating item is the cloud account.
**Acceptance:** owner uploads a JPG/PNG from the products form; image
appears on the cashier grid; URL is stored in `Product.imageUrl`.
**Estimate:** 1 afternoon once Cloudinary credentials are provisioned.

### POS-2 · Moving-Average Cost (WAC) for inventory
**Status:** Not started. Current model is "specific cost" — every sold
line uses whatever `Product.costPrice` is set to at the moment of sale.
**Problem:** for tenants with volatile input costs (fresh produce,
FX-imported goods, seasonal supplies), recorded COGS doesn't reflect
actual cost flow. The Trial Balance shows the latest set price applied
to all earlier sales.
**Solution:** track a moving-average per `(branchId, productId)` in
`InventoryItem.avgCost Decimal(12,4)`. Update on every receipt
(StockAdjustment INCREASE):
```
newAvg = (oldQty × oldAvg + receivedQty × receivedCost) / (oldQty + receivedQty)
```
At sale time, COGS event payload uses `inventoryItem.avgCost` instead of
`product.costPrice`. Stockouts (qty=0) reset avg to next receipt's cost.
**Estimate:** 1-2 days. Schema change + receipt flow update + COGS
calculation update + migration script for existing inventory rows.

### POS-3 · Tablet/touch-first POS layout
**Status:** Not started. Current layout assumes 1280px+ desktop.
**Problem:** on a 10" tablet (768-1024px), tiles are small, search bar
takes too much vertical space, side-cart is cramped.
**Solution:**
- Larger product tiles (min 120×120px) with prominent image area
- Simplified header (collapse cashier name + clock to icons)
- Bottom-sheet cart on portrait tablets instead of side panel
- 2-thumb keypad for quantity entry on payment screen
- 56px+ touch targets for primary actions
**Estimate:** 1 full session of CSS + responsive logic.

---

## High Priority — Ledger

### LED-1 · Bank Reconciliation
**Status:** Not started. Settlement page covers digital wallet
reconciliation but not bank-statement matching.
**Problem:** owner can't reconcile a printed bank statement against
posted JE lines for accounts 1010/1020. Required for monthly close.
**Solution:** new `/ledger/bank-recon` page:
- Upload bank statement (CSV / Excel)
- Match each statement line to JE journal-line(s) by amount + date
- Mark matched, flag unmatched as "outstanding deposits/checks"
- Generate Bank Reconciliation Statement PDF
**Estimate:** 1 day.

### LED-2 · Cash Flow Statement
**Status:** Not started.
**Problem:** required for BIR audit. Must show Operating, Investing,
Financing activities with reconciliation to net change in cash.
**Solution:** indirect method — derive from P&L + Balance Sheet
movements. Group account-code changes:
- Operating: net income + non-cash adjustments + working capital changes
- Investing: changes in PPE + intangibles
- Financing: changes in long-term debt + equity
**Estimate:** half day.

### LED-3 · BIR Form 2307 (Certificate of Creditable Tax Withheld)
**Status:** WHT amounts captured on AP bills (commit `5539e4b`); 2307
form not generated.
**Problem:** at year-end, vendors expect a 2307 from us showing the
total WHT we withheld on their behalf so they can claim it as a tax
credit. BIR mandates this.
**Solution:**
- Aggregate `APBill.whtAmount` per `vendorId` per quarter/year
- Generate Excel form matching BIR 2307 layout (12 lines per quarter)
- Group by ATC code (WC158, WC160, WI160 etc.)
- Export PDF for printing + signing
**Estimate:** half day.

### LED-4 · BIR Forms — 2551Q, EWT Summary, SAWT
**Status:** Only 2550Q (VAT) + 1701Q (income tax) are estimated today.
**Problem:** non-VAT MSMEs file 2551Q (percentage tax). EWT-paying
businesses need EWT summary + SAWT (Summary Alphalist of Withholding
Tax). All required for BIR filings.
**Solution:** mirror the existing `bir.service.ts` pattern. Each form
gets an endpoint + a download view in `/ledger/bir`.
**Estimate:** half day per form.

### LED-5 · Drill-down from aging bucket to per-invoice list
**Status:** Partial — clicking a bucket now filters the list to overdue
(commit pending). True bucket-precise drill-down (e.g. "show me only
invoices 31-60 days past due") not yet wired.
**Solution:** add `dueBucket` query param to `/ar/invoices` and
`/ap/bills` list endpoints; backend filters by computed days-past-due.
**Estimate:** 2-3 hours.

---

## High Priority — Cross-cutting

### CC-1 · In-app Notifications (no email yet)
**Status:** Not started.
**Why:** owners need alerts for low-stock, overdue invoices,
period-close reminders, SOD violations, expense approvals. Email is the
common channel; in-app is the MVP.
**Solution:**
- Schema: `Notification { id, tenantId, userId, type, payload, readAt, createdAt }`
- API: `GET /notifications` (paginated, with unread count), `PATCH /:id/read`
- Frontend: bell icon in AppShell header, dropdown on click, redirect to
  source on item click
- Producers: low-stock check (cron), AR/AP aging cron, period-close
  reminder cron, SOD-override audit hook
**Estimate:** 1 day.

### CC-2 · Multi-branch User Scoping
**Status:** Not started. All staff are tenant-wide.
**Problem:** for multi-branch tenants (Tier 4+), Owner wants
`Cashier-A` to only sell at Branch 1, not Branch 2.
**Solution:** add `User.branchId` (already exists) into the auth chain:
- JWT carries `allowedBranchIds: string[]` (one or more)
- Middleware blocks `/pos?branch=X` if `X` not in list
- POS page reads from `allowedBranchIds[0]` if user has only one
**Estimate:** 1 day.

### CC-3 · End-user Password Reset
**Status:** Only admin reset works today.
**Solution:**
- "Forgot password?" link on login page
- `POST /auth/request-password-reset { email, tenantSlug }` → emails
  one-time token (30 min TTL)
- `/reset-password?token=…` page consumes token + new password
**Estimate:** half day. Requires email transport (Resend / SendGrid).

### CC-4 · Tenant Data Export (one-click backup)
**Status:** Not started.
**Problem:** owner can't pull a complete data dump for backup or
audit handover.
**Solution:** `POST /tenant/export` runs a job that:
- Streams every table (orders, products, invoices, bills, journal
  entries, accounts, users, etc.) into a single zipped Excel workbook
- Returns a signed download URL valid for 24h
- Job runs in BullMQ background (large tenants > 100k rows)
**Estimate:** 1 day.

### CC-5 · 10-year Data Retention / Archival
**Status:** Not started.
**Problem:** BIR requires 10 years of records. Production DB cost grows
unbounded.
**Solution:** monthly @Cron archival job — moves orders + journal
entries older than 5 years to S3-backed cold storage. Keeps an index
table with metadata so the audit log remains queryable.
**Estimate:** research first (1 day) + 2 days build.

---

## Highest Priority — Payroll (entire module)

### PAY-1 · Payroll Computation Engine
**Status:** Schema exists (User, TimeEntry, PayRun, PayRunLine,
Salary, GovtContribution); zero service code.
**Required for production:**
- PH SSS, PhilHealth, Pag-IBIG, BIR EWT contribution tables
- Gross → deductions → net per employee per pay period
- 13th-month accrual + leave + OT computation
- Payslip PDF generation
- Bank disbursement file (BDO/BPI/Metrobank format)
- DTR (Daily Time Record) generation
- BIR 2316 (annual income tax return for employees)
**Estimate:** 2-3 weeks dedicated sprint.

### PAY-2 · Employee / Salary / TimeEntry Import Templates
**Status:** Not started. Zero payroll templates today.
**Solution:** mirror Customer/Vendor template pattern:
- Employees template (name, position, hire date, base salary, etc.)
- TimeEntry template (employee, date, hours, OT, etc.)
- Salary master template (base, allowances, deductions)
**Estimate:** 1 day after PAY-1 lands.

---

## Medium Priority

### MED-1 · 2FA Enrollment + Verify
Schema fields exist (`User.enable2fa`, `User.twoFactorSecret`); no UI.

### MED-2 · External Auditor Invitation Flow
Generate time-bound EXTERNAL_AUDITOR access tokens for BIR audit
visits. Out-of-band email or QR code.

### MED-3 · Capacitor / Play Store standalone POS app
Mobile freemium tier with local SQLite. Conversion path to Clerque
Suite.

### MED-4 · Promotions Engine
`Promotion` model exists in schema; no controller / UI.

### MED-5 · POS-side Forgot Password (PIN-based)
Cashier PIN reset via supervisor over the till.

---

## Known Bugs (from older audit; not yet addressed)

| ID | Severity | File | Issue |
|----|----------|------|-------|
| BUG 2 | High | `apps/web/app/(pos)/layout.tsx` | Misleading "Shift closed" toast when EOD report fetch fails |
| BUG 3 | High | `apps/web/lib/pos/sync.ts` | Failed offline sync orders retry indefinitely with no max threshold |
| BUG 4 | High | `apps/api/src/auth/auth.controller.ts` | JWT refresh uses `decode()` instead of `verify()` |
| BUG 5 | Medium | `apps/api/src/prisma/prisma.service.ts` | Silent DB startup failure — health endpoint returns ok regardless |
| BUG 6 | Medium | `apps/api/src/users/users.service.ts` | Role changes don't invalidate existing sessions (mitigated for MDM toggle only) |
| BUG 7 | Medium | `apps/api/src/orders/orders.controller.ts` | Missing try-catch on `GET /orders` and `GET /orders/:id` |
| BUG 8 | Low | `apps/web/app/(pos)/orders/page.tsx` | Void missing user feedback on failure |
