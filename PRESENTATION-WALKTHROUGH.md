# Clerque — Presentation Walkthrough (POS + Ledger)

> Live-demo script for showing the platform end-to-end. Designed for a
> 20–25 minute pitch to a prospective MSME owner / accountant.
>
> **Prep before demo (one-time):**
> 1. Sign in as `admin@demo.com / Admin1234!`
> 2. Settings → Subscription → click **"Seed Test Users"** (creates 14 role
>    accounts + customers + vendors + sample products + 12 sales orders +
>    1 open AR invoice + 1 open AP bill with WHT)
> 3. Sign out. Now you have a populated demo tenant ready to walk through.

---

## Part 1 — The Story (2 min)

### Open with the problem
> "PH MSMEs typically run their business on three disconnected things —
> a separate POS app, an Excel sheet for receivables, and an accountant
> who comes once a month to reconstruct what happened. The result: voids
> they didn't know about, customers chasing them for invoices that don't
> match, BIR filings done from memory at deadline.
>
> Clerque solves this by having one system: every sale in the POS
> automatically creates a journal entry in the books, every WHT we
> withhold from a vendor is ready to print as a 2307 at year-end, and
> the owner sees their gross profit — not just revenue — every day."

### The 3 apps
- **Counter** — point of sale at the till
- **Ledger** — the accountant's books
- **Sync** — payroll + employee self-service (in development)

---

## Part 2 — Counter Demo (8 min)

### Sign in as Cashier
- Open `clerque.hnscorpph.com/login?product=pos`
- Email `cashier@demo.test` · Password `Test1234!`
- Or use the PIN-only login: PIN `1234`

> "Cashiers can sign in with email + password, or just a 4-digit PIN —
> faster between rotations on a shared till."

### Open Shift
- A non-dismissible modal blocks the till until the float is entered
- Type `2000` (or use denomination counter)
- Tap **Open Shift**

> "The opening cash is locked in. At end-of-day the system will show
> expected cash; the cashier counts the drawer; any variance is logged."

### Make a sale
- Tap **Iced Latte 16oz** twice
- Type `3x` then tap **Bottled Water** → adds 3 in one tap

> "Multiplier shortcut. Useful when a customer orders 5 of the same item."

- Tap any item to add. Then tap **Checkout**
- Pick **Cash**, type `500`, see change auto-compute
- Tap **Confirm**
- Receipt modal opens with the BIR-compliant header (TIN, MIN, Sales Invoice number)

> "Receipt is RR No. 1-2026 compliant — proper BIR header for VAT-registered
> tenants. We can print thermal or browser, or save as PDF."

### PWD discount
- Add 1-2 food items to cart
- Tap **PWD/SC discount** in cart actions
- Pick which lines qualify (PH law: only food, medicine, certain services)
- Enter sample ID: `PWD-12345`, name `Juan Dela Cruz`, DOB `01/01/1960`
- Notice the cart now shows: VAT removed first, then 20% discount applied to net
- Confirm

> "PH law is specific: 20% discount is computed on the VAT-exclusive base.
> Our engine handles this exactly per RA 9994 / RA 7277. The ID number
> goes into the audit trail for BIR review."

### Park sale
- Add 2 items to cart
- Tap **Park** → label "Table 3"
- Cart clears; serve next customer
- Tap **Open Parked Sales** → resume Table 3

> "F&B-friendly. Multiple parked sales coexist on the device."

### Tablet view
- Hand the device to the audience (or rotate to portrait)
- Show how product tiles auto-resize to 3-column grid with prominent images
- Live PH-time clock visible in the sidebar

### Voiding with supervisor PIN (the SOD demo)
- Sidebar → **Orders** → pick any completed order → **Void**
- Modal asks for **Reason** + **Supervisor PIN** (because you're a cashier)
- "Hand to manager" — type `1234`
- Confirm — toast shows "voided — authorised by Test Owner"

> "Cashiers can't void on their own. The manager walks over, types their
> PIN at the cashier's screen, and the void is logged with both names.
> This is Segregation of Duties at the operational level."

### Item-level refund (new feature)
- Open another order with multiple items
- Each line now has a **Refund** link
- Tap one — modal shows max refund qty + pro-rated peso amount
- Type qty `1`, reason `customer changed mind`, refund method `Cash`
- Toggle restock ON/OFF (off if item is damaged)
- Supervisor PIN again
- Confirm

> "Customer wants to return 1 of 5 items? No need to void the whole order.
> Pro-rated refund, inventory restocked, GL reversal proportional. Audit
> log records who/when/why/method/restocked."

### POS Dashboard
- Sidebar → **Dashboard**
- Top "Profitability" row: **Gross Profit**, **COGS booked**, **Margin %**

> "Every owner asks: 'how much did I really make today?'. This is the
> answer — not just revenue. Every sale auto-deducts the cost of goods
> sold, so the margin is real-time."

- If any product has no cost set, an amber warning banner appears
- Click "Fix products now →" — jumps to the products page

> "If the owner forgets to enter a cost price on a product, the dashboard
> warns them — that breaks profit accuracy. We don't let it slip silently."

### Close shift
- Tap **Close Shift** in the header
- Count the drawer (any number, e.g. `2500`)
- Confirm — variance computed, EOD report appears with payment method
  breakdown, top products, hourly chart
- Print or screenshot

---

## Part 3 — Ledger Demo (10 min)

### Sign in as Owner
- Sign out, sign back in as `admin@demo.com / Admin1234!`
- Tap **Ledger** card on the app picker

### Operations Health Dashboard
- Land on `/ledger/dashboard`

> "This dashboard isn't financial KPIs — those live in Trial Balance,
> P&L, Balance Sheet. This dashboard is **process health** — how fast
> events flow, whether the books balance, what needs attention."

- Walk through the 4 sections:
  - **Timeliness** — POS→JE lag, Pending events, DSO, DPO, days since last close
  - **Accuracy** — Trial Balance status (Balanced/OFF), Voids 30d + rate, Period reopens
  - **Volume** — JEs today/month, open AR/AP value
  - **Control** — Pending claims, SOD overrides, products missing cost, audit entries

### Chart of Accounts
- Sidebar → **Chart of Accounts**

> "186 accounts pre-seeded — full PH-SFRS standard. Every code from 1xxx
> assets through 8xxx non-operating expenses. Auto-seeded on first journal
> entry; can add/edit/deactivate."

### Trial Balance
- Sidebar → **Trial Balance**
- Pick today's date

> "Total debits must equal total credits. After the demo orders we just
> seeded, you'll see real numbers in 1010 Cash, 4010 Sales, 5010 COGS,
> 2020 Output VAT — all auto-posted from POS."

- Tap any account → drilldown shows the journal entries that hit it
- Tap **Export .xlsx** → Excel with frozen headers, peso formatting

### Income Statement (P&L)
- Sidebar → **Income Statement**
- Period `start of month` → today

> "Revenue from sales, minus COGS auto-deducted from inventory, equals
> Gross Profit. Then operating expenses, then net income. Margin
> percentages on the right show profitability tier."

### Balance Sheet
- Sidebar → **Balance Sheet** → as of today

> "Assets = Liabilities + Equity. Auto-segmented: cash, receivables,
> inventory, PPE on the left; trade payables, tax payables, accrued, debt,
> equity on the right. Retained earnings derived from cumulative P&L.
> If the books are out of balance, a banner fires."

### Cash Flow Statement (NEW)
- Sidebar → **Cash Flow Statement**

> "Indirect method. Net income, plus working capital changes, plus
> investing, plus financing — equals net change in cash. Required for
> BIR audit and any lender review."

### AR Billing — Customer invoices + aging
- Sidebar → **Customer Billing**
- Show the OPEN invoice we seeded (Manila Office Tower, ₱56,000)
- Aging cards at top: click **Overdue 1-30** → list filters precisely
- Click the invoice → drawer with line items
- Tap **Record Payment** → enter ₱30,000 cash
- Status moves to PARTIALLY_PAID; balance updates; JE auto-posts (DR Cash / CR AR)

> "Real receivables management. Click any aging bucket to see exactly
> who's overdue in that range. Payment recording auto-posts the
> journal entry — no double-entry needed."

### AR Oracle-style power form (new)
- Sidebar → **Customer Billing** → **+ New Invoice**
- Full-page form opens, vendor field auto-focused

> "For accountants processing a stack of invoices end-to-end. Tab between
> fields. Enter on the last cell adds a new line. F2 saves draft, F3
> validates, F4 posts. Power-user mode."

- Tab through: customer, date, terms (auto-fills due date), reference
- Add a line: pick revenue account, type qty + price + VAT
- Press Enter on VAT field → new line appears
- Press F4 → entry posts to GL

### Vendor Bills with WHT
- Sidebar → **Vendor Bills**
- Show the OPEN bill we seeded (Meralco, ₱16,800 with ₱750 WHT)
- Click the bill — note the **Net Payable** = ₱16,050 (gross minus WHT)

> "When we pay Meralco, we keep the ₱750 WHT on our books as a payable to
> BIR. At year-end, we issue Meralco a 2307 form showing the total we
> withheld so they can claim it as a tax credit."

- Tap the bill → click **Pay Vendor** → enter ₱10,000 → status moves to
  PARTIALLY_PAID

### BIR 2307 generation
- Sidebar → **Tax Estimation**
- Scroll to **BIR Form 2307 — Per-Vendor Certificates**
- Pick year + quarter
- Vendors with WHT activity appear with totals
- Tap **2307.xlsx** beside Meralco → downloads BIR-formatted Excel

> "At year-end, every vendor needs a 2307. We aggregate WHT per vendor,
> per quarter or annually, and generate the BIR form as a printable
> Excel. Owner signs and hands to the vendor."

### Bank Reconciliation
- Sidebar → **Bank Reconciliation**
- Pick GL account 1010 Cash on Hand
- Period = this month
- Right side shows posted JE lines for that account
- Left side: paste statement rows OR upload CSV
- Match each statement row to a JE line via dropdown
- Variance card shows GL vs Bank

> "Most accountants do this in Excel each month. We automate the
> matching. Statement lines come in, you click through dropdowns to
> match. Anything unmatched stays as 'outstanding cheque' or 'deposit
> in transit' for next period."

### Period Close Checklist (CLOCO — the SAP-style flow, NEW)
- Sidebar → **Accounting Periods** → expand the current period → **Close with Checklist**
- Show the 11 auto-evaluated checks across 4 groups:
  - **Transactions** (shifts closed, AP/AR drafts, expense claims)
  - **Accounting** (events PENDING/FAILED, JEs awaiting approval, TB balanced)
  - **Reconciliation** (bank rec completed)
  - **Compliance** (BIR forms, reports archived — manual attestations)
- Each check shows PASS/FAIL/MANUAL with deep links

> "Modelled after SAP's CLOCO Closing Cockpit. Before you can close the
> month, every check must pass. The system verifies what it can
> automatically; you tick the manual attestations. The Close button
> stays disabled until everything's green."

### AI Features (Owner / Accountant only)
- Sidebar → **Journal Entries** → **+ New Entry**
- Tap **Draft with AI** button
- Type plain-English: `"Paid ₱5,000 cash for office supplies"`
- Wait — Claude proposes the balanced lines (DR Office Supplies / CR Cash)
- Review, click Save

> "When an accountant gets stuck on which accounts to use, the AI Drafter
> reads your COA + recent entries and proposes a balanced JE. Powered
> by Claude Opus 4.7. Each draft uses 1 prompt from your monthly quota.
> The Smart Account Picker is free — it ranks accounts based on past
> usage. JE Guide validates entries before posting (balanced, period
> open, account hierarchy correct) — also free."

### Notifications (NEW)
- Click the bell icon top-right
- Show empty state for now (cron runs daily at 3am Manila)

> "Daily cron checks for low stock, AR/AP overdue, period-close reminders.
> If an invoice is overdue or stock dips below threshold, the bell turns
> red — owner can act before customers complain or stockouts happen."

### Tenant Data Export
- Sidebar → **Settings** → **Profile** tab
- Scroll to **Data Export**
- Tap **Download all my data (.xlsx)**

> "Owner can pull every record they have — products, customers, vendors,
> orders, invoices, bills, journal entries, audit log — as a single
> Excel workbook with 29 sheets. Sensitive fields (passwords, 2FA
> secrets) stripped automatically."

---

## Part 4 — Closing (3 min)

### What it costs
> "Pricing is staff-based. T1 Solo (owner only) — ₱2,000 setup + ₱300/mo.
> T6 Multi-branch (11+ staff) — ₱22,000 setup + ₱4,500/mo. AI features
> are an optional add-on starting at 50 prompts for ₱250/mo. Every tier
> includes the full POS + Ledger; Sync (payroll) is included from T5
> upward."

### What's coming next
> "Sync (payroll) is in active development — clock-in works today, full
> compute engine + payslip + 2316 generation in the next sprint. We're
> also evaluating a standalone Android version for the Play Store for
> tenants who want a phone-first POS."

### Q&A invitations
- "Want to see Trial Balance for a different date?"
- "Want to test how voids work between cashier and supervisor?"
- "What about your specific BIR situation — VAT or non-VAT?"
- "Multi-branch concerns?"

---

## Quick Reference — All Demo Logins

After running **Settings → Subscription → Seed Test Users**:

| Role | Email | Password | PIN |
|---|---|---|---|
| Owner | `admin@demo.com` | `Admin1234!` | — |
| Owner (alt) | `businessowner@demo.test` | `Test1234!` | `1234` |
| Cashier | `cashier@demo.test` | `Test1234!` | `1234` |
| Sales Lead | `saleslead@demo.test` | `Test1234!` | `1234` |
| Branch Manager | `branchmanager@demo.test` | `Test1234!` | `1234` |
| MDM | `mdm@demo.test` | `Test1234!` | `1234` |
| Accountant | `accountant@demo.test` | `Test1234!` | `1234` |
| Bookkeeper | `bookkeeper@demo.test` | `Test1234!` | `1234` |
| Finance Lead | `financelead@demo.test` | `Test1234!` | `1234` |
| AR Accountant | `araccountant@demo.test` | `Test1234!` | `1234` |
| AP Accountant | `apaccountant@demo.test` | `Test1234!` | `1234` |
| Payroll Master | `payrollmaster@demo.test` | `Test1234!` | `1234` |
| General Employee | `generalemployee@demo.test` | `Test1234!` | `1234` |
| External Auditor | `externalauditor@demo.test` | `Test1234!` | `1234` |

Demo customers (for AR walkthrough):
- Andoks Manila Branch · Net 30
- Manila Office Tower · Net 30 · *seeded with ₱56,000 OPEN invoice*
- BGC Coworking Hub · Net 15

Demo vendors (for AP walkthrough):
- Meralco · *seeded with ₱16,800 OPEN bill (₱750 WHT)*
- PLDT Business
- Coffee Bean Supplier Co.

Demo products (8 items): Iced Coffee, Iced Latte, Hot Americano, Bottled Water,
Tuna Sandwich, Pasta Aglio Olio, Plain Donut, Chocolate Croissant — all with
cost prices + 18-200 units of stock at the main branch.

Demo sales: 12 completed POS orders spread across the last 14 days.

---

## Tips for the Live Demo

1. **Test the connection 30 minutes before.** Railway can cold-start; load
   the dashboard once so subsequent loads are instant.
2. **Have two browser windows / two devices ready.** One for cashier, one
   for owner — speeds up SOD demos (void with supervisor PIN).
3. **Run the seeder right before the demo.** That way the dashboard shows
   "12 orders today" and the conversation feels real, not stale.
4. **If something breaks live, switch to the screenshots.** Don't try to
   debug in front of an audience. Move on; circle back later in 1:1.
5. **Don't show the AI Drafter without checking the prompt quota first.**
   If you've hit the monthly quota the toast says "AI quota exhausted" —
   awkward in front of a prospect. Demo tenant has 9999 quota; verify in
   Settings → Subscription before starting.

---

*Last updated: 2026-05-04. Update after major feature drops.*
