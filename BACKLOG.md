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

### LED-1 · Bank Reconciliation ✅ SHIPPED
Page at `/ledger/bank-recon` lets accountants pick a cash/bank GL
account + period, see all posted JE lines, paste/upload statement
rows, manually match each statement row to a JE line, save as draft
or mark complete. Schema: `BankReconciliation` + `BankReconciliationItem`.
History of past reconciliations listed at the bottom of the page.
PDF export deferred — the data is captured and reportable from Excel.

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

### CC-1 · In-app Notifications (no email yet) ✅ SHIPPED
Schema `Notification { tenantId, userId?, kind, title, body, link, readAt }`
plus full API (`GET /notifications`, `/count`, `PATCH /:id/read`,
`/read-all`). Bell icon with unread badge in every app's header,
dropdown lists last 20, click marks read + navigates to deep link.
Polls `/count` every 60 seconds. Producers (cron jobs for low-stock /
AR/AP overdue / period-close reminders) are stubs — wire as needed.

### CC-2 · Multi-branch User Scoping ⚠️ PARTIAL
Helper `effectiveBranchId(user, requestedBranchId)` in
`apps/api/src/common/branch-scope.ts` — branch-scoped roles (CASHIER,
SALES_LEAD, BRANCH_MANAGER, MDM, WAREHOUSE_STAFF, GENERAL_EMPLOYEE)
get auto-forced to their own `User.branchId`; cross-branch query
attempts → 403. Owner-tier roles (BUSINESS_OWNER, SUPER_ADMIN,
ACCOUNTANT, FINANCE_LEAD, EXTERNAL_AUDITOR) bypass.

Wired into: `GET /orders`. **Still to wire:** `/inventory`, `/products`
listing, `/reports/daily`, `/reports/shift`. Each uses its own service
method — propagation is a small sweep but spread across files.

### CC-3 · End-user Password Reset
**Status:** Only admin reset works today.
**Solution:**
- "Forgot password?" link on login page
- `POST /auth/request-password-reset { email, tenantSlug }` → emails
  one-time token (30 min TTL)
- `/reset-password?token=…` page consumes token + new password
**Estimate:** half day. Requires email transport (Resend / SendGrid).

### CC-4 · Tenant Data Export ✅ SHIPPED
`GET /export/tenant-all` (Owner only) returns a single .xlsx with one
sheet per table — Tenant, Branches, Users, AppAccess, Customers,
Vendors, Categories, Products, Inventory, RawMaterials, ProductBOM,
Orders, OrderItems, OrderPayments, Accounts, JournalEntries,
JournalLines, AccountingPeriods, ARInvoices, ARInvoiceLines,
ARPayments, APBills, APBillLines, APPayments, ExpenseClaims,
ExpenseClaimItems, Settlements, AuditLog, AccountingEvents. Sensitive
fields stripped (passwordHash, refreshTokenHash, twoFactorSecret,
supervisorPinHash, passwordResetToken). Synchronous (fast for MSME);
async/BullMQ deferred until first 100k+ row tenant. Button on Settings
→ Profile tab → "Download all my data".

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
