# DOCKET — Clerque Worklist

> Single source of truth for all outstanding work. When the user says
> **"docket"**, Claude reads this file, syncs it with current reality,
> and replies with the up-to-date version.
>
> **Vocabulary:**
> - **PENDING** — scoped work, queued, not yet built
> - **PARKED** — built but needs revision / cleanup
> - **BACKLOG** — new features identified, not yet scoped in detail
> - **KNOWN BUGS** — found in audits, not yet fixed
>
> Updates: when an item ships, move it to the SHIPPED section at the
> bottom with the commit hash. When a new feature/bug is identified,
> add to the right bucket. Don't delete entries — keep history.

---

## 🟡 PENDING (queued, not started)

| ID | Item | Why deferred |
|---|---|---|
| **POS-1** | Cloudinary file upload for product images | Needs your Cloudinary account credentials before I can wire signed-upload endpoint |
| **POS-4** | Tablet kiosk mode polish | 56px-everywhere touch sizing; primary buttons hidden-scrollbar polish |
| **POS-5** | Customer e-receipt via email/SMS | Needs email transport — same dependency as CC-3 |
| **CC-3** | End-user password reset flow | Needs email transport (Resend / SendGrid / AWS SES) — pick one and provide API key |
| **CC-5** | 10-year data archival / retention | Needs storage-strategy decision (S3 cold storage? Railway volume?) — research first |
| **Payroll module** | Full payroll engine + PH gov tables + payslip PDF + bank file + 2316 + employee/timesheet imports | 2-3 week dedicated sprint |

---

## 🔵 PARKED (built, needs revision)

| Item | What |
|---|---|
| **AP Bills modal — dead code** | Old `CreateBillModal` is still in `apps/web/app/ledger/(ledger)/ap/bills/page.tsx`. New users go to Oracle-style form at `/ap/bills/new`. Modal can be deleted once we've confirmed the new form works in prod for a week |
| **CC-2 branch scoping propagation** | Helper `effectiveBranchId()` is wired into `GET /orders` only. Needs to also be applied to: `/inventory` listing, `/products` listing, `/reports/daily`, `/reports/shift`. Small sweep across 4 files |
| **Mobile responsiveness sweep** | Drawer footer fixed (commit 93453bc), but I haven't audited every page for tablet/phone layout. Pages worth checking: report pages, the AP bill grid, the bank-recon two-column layout |

---

## ⚪ BACKLOG (new features identified, not scoped yet)

### Compliance & PH-specific
- **2FA enrollment + verify UI** — schema fields `User.enable2fa`, `User.twoFactorSecret` already exist
- **Live BIR e-filing API** — currently we estimate forms; manual submission still required
- **PWD/SC ID database integration** — DOH integration to verify cards in real time
- **External Auditor invitation flow** — time-bound EXTERNAL_AUDITOR access for BIR audit visits
- **Multi-currency / FX engine** — schema has currency stub fields but no FX rate or conversion engine

### Power-user features
- **T&E OCR / WhatsApp integration** — submit expense via chat
- **Promotions engine** — `Promotion` model exists in schema; no controller / UI / cart logic
- **POS-side PIN reset for cashiers** — cashier locked out → supervisor PIN-resets at the till

### Platform / admin
- **Counter as a standalone Android app (Play Store)** — strategic priority,
  not yet started.

  **What user wants:** Clerque Counter as its own native Android app on
  Google Play, operable independent of the web Suite. PWA-on-Android works
  today via "Add to Home Screen", but a real Play Store presence is the
  long-term target.

  **Two product paths to pick from when we resume:**

  *Path A — Cloud-tethered wrapper.* Capacitor wraps the existing
  Next.js POS, same multi-tenant cloud backend, same login. Easiest
  build (~1 week + Google review). Owner uses the same Clerque tenant
  on web and mobile interchangeably.

  *Path B — Standalone freemium with local SQLite.* A simpler product,
  no login required, runs entirely on the device. Free tier capped at
  N sales/month; Pro tier unlocks unlimited + cloud sync to a Clerque
  Suite tenant if/when the operator graduates to web. Different schema
  (no multi-tenancy), different binary, separate Play Store listing
  ("Clerque Counter Lite" or similar). Higher-impact for the backyard
  / sari-sari segment that doesn't need accounting.

  **Estimate** *if Path A*: 1 week build + 3-7 day Google review.
  **Estimate** *if Path B*: 2-3 weeks (separate codebase + freemium gate
  + sync-on-upgrade flow).

  **Blockers to start:**
  1. Decision: Path A or Path B (or both as separate SKUs?)
  2. $25 Google Play Developer account
  3. Privacy policy hosted on a public URL
  4. App icon + store-listing screenshots
  5. Native plugins to wire (Bluetooth printer, camera barcode scanner,
     local notifications)
- **Multi-tenant SUPER_ADMIN console** — manage all tenants from one screen
- **Customer self-service tier upgrades** — UI shows upgrade CTA; backend payment+tier-flip flow not built
- **Granular branch-level write scoping** — beyond CC-2 read scoping; e.g. "User X can void in Branch A but not B"

---

## 🔴 KNOWN BUGS (from older audit, not yet fixed)

| ID | Severity | File | Issue |
|---|---|---|---|
| BUG 5 | Medium | `apps/api/src/prisma/prisma.service.ts` | Silent DB startup failure — health endpoint returns ok regardless |
| BUG 6 | Medium | `apps/api/src/users/users.service.ts` | Role changes don't invalidate sessions (mitigated for MDM toggle only) |
| BUG 7 | Medium | `apps/api/src/orders/orders.controller.ts` | Missing try-catch on `GET /orders` and `GET /orders/:id` |

> BUGs 2, 3, 4, 8 verified fixed in code (warning toast on EOD fetch fail, MAX_RETRIES=5 in sync, refresh uses jwt.verify, void shows toast on error). Cleaned 2026-05-02.

---

## ✅ SHIPPED (recent → older)

| Commit | What |
|---|---|
| (this) | **Last 2% of Ledger shipped together**: FBL1N + FBL5N drill-down endpoints (vendor/customer ledger explorers); JE approval workflow (PENDING_APPROVAL status, jeApprovalThreshold per tenant, `/journal/:id/approve` + `/reject`, SOD enforced); Period-Close Checklist (CLOCO) with 9 auto-evaluated checks + 2 manual attestations at `/ledger/periods/[id]/close`; recurring/template JEs (`JournalTemplate` model + scheduler at 4am Manila daily + `/journal-templates` CRUD); per-tenant tunable severity thresholds (`Tenant.metricsThresholds` + `/tenant/ledger-thresholds`). |
| dbfeefe | AR Oracle-style power form — `/ledger/ar/billing/new` keyboard-first invoice posting. |
| 9650c8e | Notification producers wired — daily 3am Manila cron creates low-stock, AR/AP overdue, and period-close-reminder notifications. The bell now actually has things in it. |
| a9dfa08 | LED-2 Cash Flow Statement (indirect method) + LED-5 bucket-precise aging drill-down. |
| 7f5073d | POS-3 Item-level refund — OrderItem.refundedQty + OrderItemRefund audit table + POST /orders/:orderId/items/:itemId/refund. UI: Refund button per line in expanded order detail; modal with qty/reason/method/restock + supervisor PIN co-auth for cashiers. Pro-rated refund amount + proportional GL reversal event. |
| 642e889 | POS-2 Moving-Average Cost (WAC) — InventoryItem.avgCost + WAC recompute on costed receipts + COGS uses avgCost (fallback to product.costPrice). UI: unit-cost field on Stock Adjust modal. |
| dec271e | Page-level spinners + global error boundary |
| 5090f6f | DOCKET.md as the single worklist source of truth |
| 93453bc | Mobile drawer Help/Settings footer |
| f1a4ec1 | LED-1 Bank Reconciliation + CC-1 Notifications + CC-4 Tenant Export + CC-2 partial branch scoping |
| dcedb67 | Oracle EBS R12-style AP bill posting form |
| b6ab8d0 | LED-3 BIR 2307 per-vendor certificates |
| a265fdd | Process-metrics Ledger dashboard (Timeliness/Accuracy/Volume/Control) |
| e771a40 | /select hooks-order crash fix + role-based app visibility |
| 3bb5e9e | Supervisor PIN void overrides at the till |
| d942c58 | Help & Guide module (Counter / Ledger / Sync) |
| 365ad4e | Cashier sidebar clock + product image (URL paste) |
| 6a9f7f8 | Pro-forma import templates + Setup Pack |
| 22287b5 | AR Billing + AP Bills UI with aging cards |
| 5539e4b | AR/AP backbone (formal invoices/bills with WHT, payment matching) |
| 4e4feba | Pricing tiers + AI add-on packages |
| 8f9f507 | AI features (JE Drafter, Smart Account Picker, JE Guide) |
| e2f45b6 | Tablet-first POS grid |
| 187fd8e | Process-grade Ledger nav reorg + demo BIR unlock |
| 135637e | COGS hard-required + gross profit on POS dashboard |

---

*Last synced: 2026-05-02. Say "docket" to refresh.*
