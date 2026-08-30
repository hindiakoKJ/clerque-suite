# Clerque — open UX / correctness findings

---

## Open findings from the 2026-08-30 sweep

Six auditors across every app surface, then an adversarial pass that confirmed
89 of 91 and refuted 2. The critical and high ones already fixed are in the git
log; these are what remains. Each was verified against the cited line, not
guessed.

- [ ] **L-01** (critical) — `apps/web/app/ledger/(ledger)/layout.tsx:157`  
      The Vendor dropdown at app/ledger/(ledger)/ap/bills/new/page.tsx:363 contains only `<option value="">— Select vendor —</option>`. Validation then blocks save with 'Vendor is required'. The screen that creates vendors, app/ledger/(ledger)/ap/vendors/page.tsx, is not in the sidebar and is not linked f
- [ ] **vendor-create-screen-unreachable** (critical) — `apps/web/app/ledger/(ledger)/ap/vendors/page.tsx:117`  
      The vendor <select> at app/ledger/(ledger)/ap/bills/new/page.tsx:363 only lists vendors already in the database ('— Select vendor —' plus nothing on a fresh tenant), validation at :167 says 'Vendor is required.', and there is no "add vendor" affordance. /ledger/ap/vendors is not in the Ledger sideba
- [ ] **VOID-APPROVAL-DEADEND** (critical) — `apps/web/app/settings/page.tsx:1919`  
      apps/api/src/orders/orders.service.ts:1329 throws 'This void requires maker-checker approval. Submit a void approval request and have a Branch Manager or Business Owner approve before retrying.' But the only approval UI in the repo is apps/web/app/admin/(admin)/void-approvals/page.tsx, and middlewar
- [ ] **L-02** (high) — `apps/web/app/ledger/(ledger)/ar/billing/page.tsx:39`  
      That banner holds the ONLY link to /ledger/ar/customers in the whole app (there is no nav entry for it). Once dismissed it never returns, so the Customers screen — and therefore customer creation — becomes unreachable. /ledger/ar/billing/new then shows a Customer dropdown with only '— Select custome
- [ ] **L-05** (high) — `apps/web/app/ledger/(ledger)/ar/billing/page.tsx:508`  
      There is no way to. The screen that does it — app/ledger/(ledger)/ar/invoices/[id]/page.tsx, with 'Download PDF' (line 109) and 'Email to Customer' (line 115) wired to GET /ar/invoices/:id/pdf and POST /ar/invoices/:id/email — is never linked from anywhere. The AR Billing list opens the drawer inste
- [ ] **L-06** (high) — `apps/web/app/ledger/(ledger)/ar/customers/page.tsx:108`  
      The request 403s silently, `priceLists` stays [], so the <select> at line 264 has only one option and displays 'Default pricing (uses Product price)' even for a customer who genuinely has a wholesale price list assigned — the screen shows a price basis that isn't the customer's. They also cannot ass
- [ ] **L-11** (high) — `apps/web/app/ledger/(ledger)/bank-recon/page.tsx:403`  
      The form wipes itself, and the saved IN_PROGRESS row in the history table (lines 433-461) is inert — its only control is a paperclip for attachments; the row has no onClick and nothing calls GET /bank-recon/:id, which the API does expose (bank-recon.controller.ts:45). The half-finished reconciliatio
- [ ] **L-03** (high) — `apps/web/app/ledger/(ledger)/dashboard/page.tsx:385`  
      Every one of those targets is stripped from the sidebar in SIMPLE mode (layout.tsx:206-223 drops items whose disabledReason is 'Upgrade to full accounting to unlock this') and its API is 403'd by PlanFeatureGuard (advancedAccounting=false, auth.service.ts:772). The route itself is NOT blocked, so th
- [ ] **L-07** (high) — `apps/web/app/ledger/(ledger)/dashboard/page.tsx:436`  
      middleware.ts:188 `if (pathname.startsWith('/pos') && !POS_ROLES.has(user.role))` throws every ACCOUNTANT, BOOKKEEPER, FINANCE_LEAD, AR_ACCOUNTANT, AP_ACCOUNTANT and EXTERNAL_AUDITOR (all of whom this card is rendered for) completely out of Ledger to /select?reason=pos-restricted, losing the page th
- [ ] **L-09** (high) — `apps/web/app/ledger/(ledger)/periods/page.tsx:227`  
      GET /accounting-periods is @Roles('ACCOUNTANT','BRANCH_MANAGER','BUSINESS_OWNER') (apps/api/src/accounting-periods/accounting-periods.controller.ts:37) — no FINANCE_LEAD. The 403 is swallowed, `periods` stays [], and the page tells them the business has NO accounting periods and that they should cre
- [ ] **L-10** (high) — `apps/web/app/ledger/(ledger)/reports/page.tsx:68`  
      GET /export/trial-balance and /export/pl-summary carry no per-route @Roles, so they inherit the class-level `@Roles('BUSINESS_OWNER','ACCOUNTANT','SUPER_ADMIN')` (export.controller.ts:57); ar-aging/ap-aging exclude BOOKKEEPER and EXTERNAL_AUDITOR (export.controller.ts:172,184). downloadAuthFile thro
- [ ] **movements-rows-not-clickable** (high) — `apps/web/app/pos/(pos)/inventory/movements/page.tsx:134`  
      Nothing. The row at line 218 is `<tr className="hover:bg-muted/40 transition-colors">` with no onClick and no Link — the only onClick handlers in the file are Refresh (139), Export CSV (147) and the kind filter (172). The hover highlight makes it look interactive, so the user taps repeatedly and con
- [ ] **receive-modal-no-scroll** (high) — `apps/web/app/pos/(pos)/inventory/page.tsx:535`  
      I measured the panel by rendering its exact markup at a 343px content width in the running app: 701px tall with the CREDIT vendor/terms row shown (~630px without it). The fixed layer centres it with items-center and has no overflow-y, and the page behind it is overflow-hidden (line 236), so nothing
- [ ] **ledger-vendors-nav-missing** (high) — `apps/web/app/pos/(pos)/inventory/page.tsx:623`  
      There is no 'Vendors' item in the Ledger nav. app/ledger/(ledger)/layout.tsx:140-185 lists Vendor Bills (/ledger/ap/bills), Expense Claims and Vendor Advances under Payables — the /ledger/ap/vendors route exists on disk but is not linked from anywhere. The empty state points at a nav item that does
- [ ] **cyclecounts-table-clipped** (high) — `apps/web/app/pos/(pos)/warehouse/cycle-counts/page.tsx:63`  
      Measured at a 343px container: the table needs 385px inside a 341px section with computed overflow-x: hidden. The trailing action cell (line 84) is cut off, so the 'Post variances' button (line 93-100) — and part of the 'Count' link — are clipped away with no way to scroll to them.
- [ ] **transfers-table-clipped** (high) — `apps/web/app/pos/(pos)/warehouse/transfers/page.tsx:88`  
      Measured in the running app at a 343px container: the table's intrinsic width is 488px inside a section whose computed overflow-x is `hidden` and whose client width is 341px. The last cell (line 113, `whitespace-nowrap`, holding Send/Receive/Cancel) has its right edge at 488px — 147px past the clip.
- [ ] **procure-bought-edits-discarded** (high) — `apps/web/app/procure/requests/page.tsx:466`  
      At BOUGHT the only button offered is 'Add it all to stock' (line 527). The edited value lives only in local `bought` state and is never posted — receive() re-reads the server row, so the old price is what becomes the ingredient's unit cost and the inventory journal entry. The correction is silently
- [ ] **PROCURE-REASON-SILENT** (high) — `apps/web/app/(portal)/select/page.tsx:67`  
      middleware.ts redirects to /select?reason=procure-restricted, but the effect has no branch for that value, so the user is silently dumped on the app picker with no toast and no explanation. The URL cleanup at lines 74-77 is also nested inside the ledger branch only, so a pos-restricted `?reason=` st
- [ ] **ADMIN-ORPHAN-ROUTES** (high) — `apps/web/app/admin/(admin)/layout.tsx:46`  
      /admin/payments-pending — the page that confirms the payment and issues the BIR OR — is not in the nav and has no inbound link anywhere in apps/web. Neither do /admin/void-approvals, /admin/api-keys, /admin/auto-backup, /admin/loyalty-pro, /admin/inventory-reports, /admin/reports/advanced, /admin/re
- [ ] **ledger-customers-links-into-pos** (high) — `apps/web/app/ledger/(ledger)/ar/customers/page.tsx:275`  
      AR_ROLES (layout.tsx:56 -> AR_TEAM :33) includes AR_ACCOUNTANT, ACCOUNTANT, BOOKKEEPER and FINANCE_LEAD; none are in middleware POS_ROLES. It is a plain <a>, so it is a full page load straight into the /select?reason=pos-restricted ejection — the half-filled customer form is lost.
- [ ] **ledger-dashboard-links-into-pos** (high) — `apps/web/app/ledger/(ledger)/dashboard/page.tsx:436`  
      DASHBOARD_ROLES for Ledger is AUDITOR_VIEW (layout.tsx:43 -> :37) = ACCOUNTANT, BOOKKEEPER, FINANCE_LEAD, AR_ACCOUNTANT, AP_ACCOUNTANT, EXTERNAL_AUDITOR + owner/manager. None of the six accounting roles are in middleware POS_ROLES, so the click ejects them to /select?reason=pos-restricted and their
- [ ] **ATTENDANCE-REGULAR-IS-GROSS** (high) — `apps/web/app/payroll/(payroll)/attendance/page.tsx:139`  
      grossHours is TOTAL worked hours including overtime (apps/api/src/payroll/payroll.service.ts:241-242 sets grossHours = worked, otHours = grossHours − 8). The page labels it 'Regular Hours' and shows 'Overtime Hours' beside it, so a 10-hour day reads as 10h regular + 2h overtime — implying 12 hours.
- [ ] **CONTRIB-RATES-WRONG** (high) — `apps/web/app/payroll/(payroll)/contributions/page.tsx:118`  
      The engine actually deducts SSS at 5% (apps/api/src/payroll/ph-tax-tables.ts:50 `const SSS_EE_RATE = 0.05;`) and Pag-IBIG up to ₱200/month (PAGIBIG_MMC_CAP 10,000 × 2%, ph-tax-tables.ts:127-134) — double what the box states. The heading also says '2024' while the tables are the 2025 schedule. The ow
- [ ] **DASHBOARD-9PCT-INVENTED** (high) — `apps/web/app/payroll/(payroll)/dashboard/page.tsx:125`  
      With no payslips the API invents deductions as a flat 9% of gross, and NET = gross − that guess. The dashboard prints the guess as the hero figure in bold 4xl and as the 'Deductions (MTD)' KPI captioned 'Tax + SSS + PhilHealth + Pag-IBIG' (line 163) — with no 'estimated' qualifier anywhere. The owne
- [ ] **REQUEST-INBOX-ORPHAN** (high) — `apps/web/app/payroll/(payroll)/layout.tsx:131`  
      The fully-built approver inbox at apps/web/app/payroll/(payroll)/requests/page.tsx ('Request Inbox — Approve or reject employee self-service requests') has zero inbound links. The manager can only reach it by typing the URL. Every request sits PENDING forever, and its 'Back' button (line 107 router.
- [ ] **LEAVE-NO-CANCEL** (high) — `apps/web/app/payroll/(payroll)/me/leaves/page.tsx:28`  
      My Leave Requests renders a status pill only (line 158) — there is no Cancel button for a PENDING row, and apps/api/src/payroll/payroll.controller.ts exposes only POST /payroll/leaves, GET /payroll/leaves, approve, reject and GET /payroll/me/leaves. There is no cancel endpoint. The CANCELLED status
- [ ] **REMIT-1POINT4-INVENTED** (high) — `apps/web/app/payroll/(payroll)/reports/page.tsx:334`  
      The figure is the total EMPLOYEE deduction multiplied by a hard-coded 1.4. `totalDeductions` includes BIR withholding tax, which has no employer counterpart at all, so the multiplier is applied to the wrong base. The quoted employer rates are also wrong — the engine uses SSS employer 10% + ₱30 EC (p
- [ ] **ADD-EMPLOYEE-DEAD** (high) — `apps/web/app/payroll/(payroll)/staff/page.tsx:126`  
      Nothing at all — the button has no handler, no modal, no navigation. The onboarding path the product itself points at is a dead end. A PAYROLL_MASTER has no alternative: the Staff & Roles tab in /settings is `isOwner`-gated (settings/page.tsx:1186) and /pos/staff ejects them via POS_ROLES.
- [ ] **PROC-10** (high) — `apps/web/app/pos/(pos)/inventory/page.tsx:70`  
      canEdit omits BRANCH_MANAGER, so the entire Actions column is hidden (line 423) and with it the "Receive stock" button (line 431); "New Ingredient" (line 283) is hidden too. The tile is shown to them because STOCK_ROLES (procure/layout.tsx:33) includes BRANCH_MANAGER. The backend disagrees with the
- [ ] **pharmacy-deliveries-conditional-hooks-crash** (high) — `apps/web/app/pos/(pos)/pharmacy/deliveries/page.tsx:69`  
      useFloorLayout() returns layout undefined on the first render, so the component returns early after N hooks. When the layout query resolves and isPharmacy is true, execution falls past both returns and calls two more useState hooks (lines 72-73), so React throws "Rendered more hooks than during the
- [ ] **PROC-08** (high) — `apps/web/app/procure/page.tsx:48`  
      getLowStock (apps/api/src/inventory/inventory.service.ts:390-419) returns both PRODUCT and INGREDIENT rows and this count includes both, but pullLowStock (apps/api/src/procure/procure.service.ts:144-146) filters to `r['kind'] === 'INGREDIENT'`. The toast comes back "Nothing is below its reorder leve
- [ ] **procure-request-blank-close-loses-the-list** (high) — `apps/web/app/procure/requests/page.tsx:519`  
      receiveRequest (apps/api/src/procure/procure.service.ts:251) pushes the 2 unbought lines into `skipped` with reason 'Nothing was bought for this line.', and because `failed.length === 0` line 286-290 flips the whole request to RECEIVED. openRequest() then creates an empty new request — nothing carri
- [ ] **PROC-09** (high) — `apps/web/app/procure/requests/page.tsx:76`  
      There is no list of past requests anywhere in the web app. The screen holds exactly one request object and the only endpoint it calls is /open. GET /procure/requests (procure.controller.ts:33, supports a `status` filter and returns up to 100) and GET /procure/requests/:id (line 53) have no caller in
- [ ] **PAYROLL-MASTER-CANT-ONBOARD** (high) — `apps/web/app/settings/kiosk/page.tsx:141`  
      kioskPin is only editable on /pos/staff, and middleware POS_ROLES excludes PAYROLL_MASTER, so that link ejects them to /select?reason=pos-restricted. Settings → Staff & Roles is `isOwner`-gated (settings/page.tsx:1186), /settings/kiosk redirects non-owners away (kiosk/page.tsx:42), and Sync's own St
- [ ] **KIOSK-KEY-CLAIM-FALSE** (high) — `apps/web/app/settings/kiosk/page.tsx:313`  
      Both statements are false. GET /payroll/kiosk/terminals returns the whole KioskTerminal row including apiKey (apps/api/src/payroll/kiosk/kiosk.service.ts:96 findMany with no select), and the row's own Copy button at line 220 rebuilds the full URL: navigator.clipboard.writeText(kioskUrl(t.apiKey)). B
- [ ] **DEACTIVATE-NO-CONFIRM** (high) — `apps/web/app/settings/page.tsx:1252`  
      The account is deactivated instantly — no confirmation dialog, no name in a prompt, no undo prompt. If a cashier is mid-shift they lose their session with no warning. The button also has no `disabled={updateUserMut.isPending}`, so a double-tap can toggle twice.
- [ ] **WELCOME-PRICE-CONTRADICTION** (high) — `apps/web/app/welcome/pos/page.tsx:54`  
      The hero quotes ₱299/₱399, but priceLabel() reads PLAN_CAPS.CLERQUE.pricePhpMonthlyCents which is 0 (packages/shared-types/src/plans.ts:83), so the pricing card further down the SAME page renders 'Pricing coming soon' (line 170). The comparison table still says 'Included in Solo ₱299' / 'Solo Books
- [ ] **TRIAL-VS-PAYWALL** (high) — `apps/web/app/welcome/pos/page.tsx:63`  
      There is no trial. /signup/pos:261 makes them accept 'I understand this subscription is paid manually (Maya / Maribank / BDO) for the first month' and the submit button reads 'Create account & get payment instructions' (line 280), redirecting to /pay/<refCode> with activation only 'within 4 business
- [ ] **LOGIN-DEAD-LINK** (high) — `apps/web/components/portal/AppLoginPage.tsx:511`  
      Nothing — the anchor points at '#', so the page just jumps to the top. It is styled as a link (hover:underline, font-medium) next to a live sibling link, so it reads as actionable. This is the first screen every staff member sees.
- [ ] **modifier-option-delete-no-confirm** (high) — `apps/web/components/pos/ModifierGroupModal.tsx:256`  
      The option is deleted immediately — no confirmation, no undo, and no success toast (the mutation's onSuccess is just `invalidate`, line 134-140). Modifier groups are tenant-level objects attached to many products, so deleting "Oat milk" from the Milk group removes it from every drink that uses that
- [ ] **SELECT-CARD-EJECTS** (high) — `apps/web/lib/apps.ts:171`  
      middleware.ts POS_ROLES = BUSINESS_OWNER | BRANCH_MANAGER | CASHIER, so the navigation is immediately bounced to /select?reason=pos-restricted. The card is offered and cannot work. If that card happens to be the user's only accessible app, select/page.tsx:62 `if (onlyApp) router.replace(onlyApp.reso
