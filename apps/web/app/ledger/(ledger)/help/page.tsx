'use client';
import { HelpPage, type HelpSection } from '@/components/help/HelpPage';

const SECTIONS: HelpSection[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'guide',
    description: 'How the Ledger fits into the rest of Clerque.',
    items: [
      {
        q: 'What is the Ledger app for?',
        a: (
          <p>
            The Ledger is your books — the official record of every peso that flows in and out. Sales from Counter
            automatically generate journal entries here. You also enter bills, invoices, expense claims, and manual
            adjustments. At month-end you close the period; at year-end you produce statements for BIR filing.
          </p>
        ),
      },
      {
        q: 'What roles can use Ledger?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Business Owner / Super Admin</strong> — full access to everything.</li>
            <li><strong>Accountant</strong> — same as owner except payroll-related items.</li>
            <li><strong>Bookkeeper</strong> — Journal Entries + Trial Balance, no period close, no reports.</li>
            <li><strong>Finance Lead</strong> — Settlement, reports, period close, no journal entry creation.</li>
            <li><strong>AR / AP Accountant</strong> — only their sub-ledger (customer invoices or vendor bills).</li>
            <li><strong>External Auditor</strong> — read-only access to dashboard, accounts, trial balance, audit log.</li>
          </ul>
        ),
      },
      {
        q: 'Why is some menu item grayed out with a lock icon?',
        a: (
          <p>
            Your role doesn&apos;t have access. Hover for the reason. Ask the business owner to grant the role you
            need. Tax Estimation has an extra requirement: the tenant must be marked BIR-registered in Settings → BIR
            &amp; Tax.
          </p>
        ),
      },
      {
        q: 'How is data flowing between Counter and Ledger?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Counter completes a sale → creates an <strong>AccountingEvent</strong> with status PENDING.</li>
            <li>A background process (runs every minute) picks up PENDING events and creates the journal entry.</li>
            <li>JE goes to status POSTED. You see it in Journal Entries with a green badge.</li>
            <li>If something goes wrong (e.g. period locked), the event goes to FAILED — visible in Event Queue.</li>
            <li>You don&apos;t need to do anything for normal sales — the system handles it.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'guide',
    description: 'High-level KPIs for the period.',
    items: [
      {
        q: 'What does the dashboard show?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Total revenue, expenses, gross profit, net income for the selected period.</li>
            <li>AR aging summary (open receivables by overdue bucket).</li>
            <li>AP aging summary (open payables by overdue bucket).</li>
            <li>Cash position (sum of all cash GL accounts).</li>
            <li>Top customers and top vendors by activity.</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'chart-of-accounts',
    title: 'Chart of Accounts',
    icon: 'how-to',
    description: '186 PH-standard accounts auto-seeded; customise per tenant.',
    items: [
      {
        q: 'What\'s in the seeded chart of accounts?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>1xxx Assets</strong> — Cash, Receivables, Inventory, Prepayments, PPE.</li>
            <li><strong>2xxx Liabilities</strong> — AP, Tax payables (VAT, WHT), Accrued, Long-term debt.</li>
            <li><strong>3xxx Equity</strong> — Owner&apos;s capital, retained earnings, drawings.</li>
            <li><strong>4xxx Revenue</strong> — Sales, services, other income.</li>
            <li><strong>5xxx COGS</strong> — Cost of goods sold variants.</li>
            <li><strong>6xxx Operating Expenses</strong> — Utilities, rent, salaries, supplies.</li>
            <li><strong>7xxx Other Operating</strong> — Bank charges, depreciation, etc.</li>
            <li><strong>8xxx Non-Operating</strong> — Interest, FX gains/losses.</li>
            <li>Total ~186 accounts. You can add more or deactivate unused ones (Super Admin only).</li>
          </ul>
        ),
      },
      {
        q: 'Can I edit the chart of accounts?',
        a: (
          <p>
            Editing is restricted to Super Admin to protect COA integrity. You can add new accounts, edit names, or
            mark unused accounts inactive. <strong>You cannot delete</strong> accounts that already have transactions —
            they must be deactivated instead. Some accounts are flagged <strong>SYSTEM_ONLY</strong> (e.g. 4010 Sales,
            5010 COGS, 1050 Inventory) — only POS and the journal processor can post to these, never humans.
          </p>
        ),
      },
      {
        q: 'How do I import a chart of accounts from another system?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Chart of Accounts → <strong>Import</strong>.</li>
            <li>Download the template — read the instructions carefully.</li>
            <li>Map your existing codes to the template structure. Accounts already in the seed will be skipped.</li>
            <li>Upload. Errors are returned per row.</li>
          </ol>
        ),
      },
      {
        q: 'What is &ldquo;Posting Control&rdquo; on each account?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>OPEN</strong> — humans and the system can post to this account.</li>
            <li><strong>SYSTEM_ONLY</strong> — only POS / cron processors can post. Humans see it on Trial Balance but can&apos;t pick it in a manual JE.</li>
            <li><strong>CLOSED</strong> — no new postings allowed (used for accounts being phased out).</li>
            <li><strong>AR_ONLY / AP_ONLY</strong> — restricted to specific sub-ledgers.</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'journal',
    title: 'Journal Entries',
    icon: 'how-to',
    description: 'Manual journal entries + AI-assisted drafting.',
    items: [
      {
        q: 'How do I create a manual journal entry?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sidebar → <strong>Journal Entries</strong> → <strong>+ New Entry</strong>.</li>
            <li>Set the date, posting date (defaults to today), description, and reference.</li>
            <li>Add at least 2 lines: each line picks an account and either a debit or credit amount.</li>
            <li>The total Debit must equal total Credit. The system blocks save if unbalanced.</li>
            <li>Save as DRAFT first to review, then <strong>Post</strong> to commit to the GL.</li>
          </ol>
        ),
      },
      {
        q: 'What\'s the AI Drafter and how does it work?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>On the New Entry form, tap <strong>Draft with AI</strong>.</li>
            <li>Describe the transaction in plain English — e.g. &ldquo;Paid ₱5,000 rent for May from BPI&rdquo;.</li>
            <li>Claude (Opus 4.7) reads your COA + recent entries and proposes balanced lines.</li>
            <li>Review every line. Edit if needed. Tap Save when satisfied.</li>
            <li>Each draft uses 1 AI prompt from your monthly quota. See Settings → Subscription.</li>
            <li>Available for OWNER, SUPER_ADMIN, ACCOUNTANT only (the people who post JEs).</li>
          </ol>
        ),
      },
      {
        q: 'What does Validate (JE Guide) do?',
        a: (
          <p>
            Before posting, tap <strong>Validate</strong>. The JE Guide checks: balanced totals, period not closed,
            account hierarchy consistent (e.g. don&apos;t debit a Revenue account), no SYSTEM_ONLY accounts misused,
            valid posting date. It returns warnings or errors with one-tap fixes where possible. AI-powered, free
            (doesn&apos;t consume your prompt quota).
          </p>
        ),
      },
      {
        q: 'How do I bulk-import journal entries from Excel?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Journal Entries → <strong>Import</strong>.</li>
            <li>Download template. Each row is a single line; group lines into one JE by sharing the same Reference.</li>
            <li>Fill the template, save as .xlsx, upload.</li>
            <li>Each JE imports atomically — if one line fails, the whole entry is rolled back. Errors are reported per JE.</li>
          </ol>
        ),
      },
      {
        q: 'How do I reverse a posted journal entry?',
        a: (
          <p>
            Open the JE → tap <strong>Reverse</strong> → enter reason. A new JE is created with debits and credits
            flipped, dated today. The original entry stays in the audit trail untouched. Required for clean BIR
            traceability.
          </p>
        ),
      },
      {
        q: 'Can I edit a posted journal entry?',
        a: (
          <p>
            No. Once POSTED, a JE is immutable — that&apos;s a fundamental accounting rule. To correct it, reverse it
            (creating a contra-entry) and post the correct one. DRAFT entries can be edited freely.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'event-queue',
    title: 'Event Queue',
    icon: 'guide',
    description: 'Background queue of POS events being turned into journal entries.',
    items: [
      {
        q: 'What is the Event Queue?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Every POS sale, void, expense, etc. creates an &ldquo;accounting event&rdquo;.</li>
            <li>A cron processor runs every minute, picks up PENDING events, and creates the journal entry.</li>
            <li>Most events go straight to <strong>SYNCED</strong> — no action needed from you.</li>
            <li>Events that fail (period locked, missing account, etc.) go to <strong>FAILED</strong> with an error message — these need investigation.</li>
          </ul>
        ),
      },
      {
        q: 'A POS event is stuck in FAILED. What do I do?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the failed event — the error message tells you why.</li>
            <li>Common: &ldquo;Period closed&rdquo; → reopen the period (if appropriate) and retry.</li>
            <li>Common: &ldquo;Account not found&rdquo; → check the COA mapping for this transaction type.</li>
            <li>After fixing, tap <strong>Retry</strong> on the event. It moves back to PENDING and the cron picks it up.</li>
            <li>If you don&apos;t want to retry (e.g. duplicate), mark it as IGNORED.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ar-billing',
    title: 'Receivables — Customer Billing',
    icon: 'how-to',
    description: 'Formal AR invoices for B2B and credit-terms customers.',
    items: [
      {
        q: 'How do I create a customer invoice?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Receivables → <strong>Customer Billing</strong> → <strong>+ New Invoice</strong>.</li>
            <li>Pick the customer (must already exist in Customers; create one first if new).</li>
            <li>Set invoice date, terms (Net 30 / 60 / etc.), reference, optional description.</li>
            <li>Add line items: each picks a revenue account, qty, unit price, and optional VAT amount.</li>
            <li>Save as DRAFT to review. The system computes subtotal, VAT, total, due date.</li>
          </ol>
        ),
      },
      {
        q: 'What\'s the difference between DRAFT and OPEN status?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>DRAFT</strong> — editable, no GL impact. You can cancel without consequence.</li>
            <li><strong>OPEN</strong> — posted to the GL (DR AR / CR Revenue + VAT). Customer owes you. You can&apos;t edit, only void.</li>
            <li><strong>PARTIALLY_PAID</strong> — some payment received but balance &gt; 0.</li>
            <li><strong>PAID</strong> — fully paid, balance = 0.</li>
            <li><strong>VOIDED</strong> — reversed after posting. The voiding JE shows in Journal Entries.</li>
            <li><strong>CANCELLED</strong> — DRAFT cancelled before posting. No GL impact.</li>
          </ul>
        ),
      },
      {
        q: 'How do I record a payment against an open invoice?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the invoice → tap <strong>Record Payment</strong>.</li>
            <li>Enter amount (defaults to balance), method, reference (OR# / GCash ref / check#).</li>
            <li>Confirm. The payment is allocated to this invoice; balance updates; status moves to PARTIALLY_PAID or PAID.</li>
            <li>JE posted: DR Cash / CR AR.</li>
          </ol>
        ),
      },
      {
        q: 'I clicked an aging bucket — what does &ldquo;Showing overdue only&rdquo; mean?',
        a: (
          <p>
            The list filtered to only invoices past their due date. Use this to chase overdue customers. Tap{' '}
            <strong>Clear filter</strong> to show all invoices again. (Bucket-precise drill-down — e.g. only 60-90 days
            past due — is on the roadmap.)
          </p>
        ),
      },
      {
        q: 'Can I void a posted invoice?',
        a: (
          <p>
            Yes — Owner or Accountant only. Open the invoice → Void → enter reason. The original JE is reversed via a
            new JE; the invoice goes to VOIDED. Any payments allocated to it are unallocated and become floating
            credits on the customer (which you can then re-allocate to other invoices).
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'pos-collections',
    title: 'Receivables — POS Collections',
    icon: 'how-to',
    description: 'Charge-tab orders awaiting payment.',
    items: [
      {
        q: 'What is POS Collections?',
        a: (
          <p>
            When a cashier sells via &ldquo;Charge to Account&rdquo;, the order is marked OPEN and the customer&apos;s
            outstanding balance grows. POS Collections shows all such open charge orders with totals, dates, and
            customer balances. Used by the AR clerk to chase payment.
          </p>
        ),
      },
      {
        q: 'How do I record a payment for a charge-tab order?',
        a: (
          <p>
            Same as a formal invoice — tap the order, tap Record Payment. The payment posts to the GL and the order
            moves to COMPLETED. Customer balance reduces.
          </p>
        ),
      },
      {
        q: 'What\'s the difference between Customer Billing and POS Collections?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Customer Billing</strong> — formal invoices created back-office (e.g. monthly retainers, B2B contracts).</li>
            <li><strong>POS Collections</strong> — informal charge tabs from till sales. Less paperwork, more &ldquo;suki&rdquo; pattern.</li>
            <li>Both create AR; both eat into the customer&apos;s credit limit.</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'customers',
    title: 'Customers',
    icon: 'how-to',
    description: 'AR master — who you sell to on credit.',
    items: [
      {
        q: 'When do I need to add a customer?',
        a: (
          <p>
            For B2B sales, credit-terms customers, anyone who&apos;s charged on account, or anyone you need to issue a
            BIR-compliant invoice with their TIN. Walk-in cash customers don&apos;t need a record.
          </p>
        ),
      },
      {
        q: 'How do I bulk-import customers?',
        a: (
          <p>
            Customers page → <strong>Import</strong> → download the template, fill rows, upload. Existing customers
            (matched by exact Name) are updated; new names are created. TIN, Address, Credit Term Days, Credit Limit
            are optional but recommended for B2B.
          </p>
        ),
      },
      {
        q: 'What does Credit Limit do?',
        a: (
          <p>
            Soft limit — system warns when an open invoice + new sale would push the customer over their limit. Doesn&apos;t
            block, just alerts. Set to 0 to disable.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'ap-bills',
    title: 'Payables — Vendor Bills',
    icon: 'how-to',
    description: 'Formal AP bills with WHT 2307 support.',
    items: [
      {
        q: 'How do I record a vendor bill?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Payables → <strong>Vendor Bills</strong> → <strong>+ New Bill</strong>.</li>
            <li>Pick the vendor. If it&apos;s a withholding-tax vendor, the default ATC + WHT rate auto-fills.</li>
            <li>Enter bill date, vendor SI / OR number, terms, optional description.</li>
            <li>Add line items: each picks an expense account (or asset for capex), qty, unit price, VAT amount.</li>
            <li>If WHT applies, enter the WHT amount in the highlighted block. Pick the BIR ATC code (WC158, WI160, etc.).</li>
            <li>Save DRAFT, review, then <strong>Post</strong>.</li>
          </ol>
        ),
      },
      {
        q: 'What journal entry does posting a bill create?',
        a: (
          <p>
            For a VAT-registered tenant on a vat-able line:<br />
            <code>DR Expense (line totals)</code><br />
            <code>DR Input VAT</code><br />
            <code>CR AP Payables (gross − WHT)</code><br />
            <code>CR Withholding Tax Payable (if WHT &gt; 0)</code>
          </p>
        ),
      },
      {
        q: 'When I pay the vendor, what happens?',
        a: (
          <p>
            The cash outflow = total − WHT. The WHT stays on your books as a payable to BIR until you remit it. At
            year-end, you issue the vendor a 2307 form showing the total WHT you withheld on their behalf so they can
            claim it as a tax credit. (2307 PDF generation is on the roadmap.)
          </p>
        ),
      },
      {
        q: 'How do I record a vendor payment?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Open the bill → tap <strong>Pay Vendor</strong>.</li>
            <li>Amount defaults to net payable (total − WHT). Adjust if partial.</li>
            <li>Pick method (Cash / GCash / bank transfer), reference (check# or GCash ref).</li>
            <li>Confirm. Bill status → PARTIALLY_PAID or PAID.</li>
            <li>JE posted: DR AP Payables / CR Cash.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'vendors',
    title: 'Vendors',
    icon: 'how-to',
    description: 'AP master — who you buy from.',
    items: [
      {
        q: 'How do default ATC and WHT rate work?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Set on the vendor record (e.g. landlord = WI160 / 5% rentals).</li>
            <li>When you create a new bill for that vendor, both fields pre-fill — saves time.</li>
            <li>You can still override per-bill if a particular transaction is different.</li>
            <li>BIR ATC codes (most common): <strong>WC158</strong> goods 1%, <strong>WC160</strong> services 2%, <strong>WI160</strong> rentals 5%, <strong>WI010</strong> professionals 10%, <strong>WI011</strong> professionals 15%.</li>
          </ul>
        ),
      },
      {
        q: 'How do I bulk-import vendors?',
        a: (
          <p>
            Vendors page → Import → download template → fill rows → upload. Same upsert pattern as Customers.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'expense-claims',
    title: 'Expense Claims',
    icon: 'how-to',
    description: 'Employee reimbursements — submission and approval.',
    items: [
      {
        q: 'Who creates an expense claim?',
        a: (
          <p>
            Any employee with the &ldquo;My Expenses&rdquo; access can submit. They go to the Sync app → My Expenses
            → New Claim. They attach a receipt photo, enter amount, category, and reason.
          </p>
        ),
      },
      {
        q: 'How does approval work?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Submitted claim goes to PENDING status.</li>
            <li>Approver (Branch Manager / Owner / Finance Lead) sees it in Ledger → <strong>Expense Approvals</strong>.</li>
            <li>Approver reviews receipt + amount + reason. Tap Approve or Reject.</li>
            <li>Approved → moves to APPROVED, JE posted (DR Expense / CR Cash or AP).</li>
            <li>Rejected → notification to employee with reason; they can edit and resubmit.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'settlement',
    title: 'Cash & Bank — Settlement',
    icon: 'how-to',
    description: 'Reconciling digital wallet payments to actual deposits.',
    items: [
      {
        q: 'What is Settlement?',
        a: (
          <p>
            When customers pay via GCash or Maya, the money sits in your e-wallet until it&apos;s transferred to your
            bank. Settlement matches each day&apos;s digital sales (per cashier shift) against the actual amount that
            landed in the wallet/bank. Discovers fee deductions, missing transfers, or fraud.
          </p>
        ),
      },
      {
        q: 'How do I run a settlement?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Settlement → pick the date and payment method (GCash, Maya, etc.).</li>
            <li>The system shows the expected total from POS sales for that day/method.</li>
            <li>Enter the actual amount that hit the wallet/bank.</li>
            <li>Difference = fees + adjustments. Pick a reason and an offset GL account.</li>
            <li>Confirm. JE posted: DR Cash in Bank / DR Fees / CR e-Wallet receivable.</li>
          </ol>
        ),
      },
      {
        q: 'Bank reconciliation (full bank statement matching) — when?',
        a: (
          <p>
            Currently Settlement covers digital wallet reconciliation. Full bank-statement reconciliation (matching
            line items in your BPI/BDO statement to JE lines on accounts 1010/1020) is on the roadmap as LED-1 in
            BACKLOG.md.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'periods',
    title: 'Accounting Periods',
    icon: 'how-to',
    description: 'Open / close monthly and yearly periods.',
    items: [
      {
        q: 'What is a period?',
        a: (
          <p>
            A finite span (typically a calendar month, sometimes a quarter or year) during which transactions can be
            posted. After period-end, the period is <strong>CLOSED</strong> — no new postings. This locks the books so
            financial statements stay frozen for audit.
          </p>
        ),
      },
      {
        q: 'How do I close a period?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Make sure all expected transactions for the period are posted (sales, bills, expenses, salaries).</li>
            <li>Run Trial Balance — verify it balances.</li>
            <li>Periods → pick the month → tap <strong>Close</strong>.</li>
            <li>Enter a brief description of any adjustments made.</li>
            <li>Confirm. Status → CLOSED. Any attempt to post in this period now fails.</li>
            <li>Sales in Counter for this period also fail to sync — they go to FAILED in the Event Queue. This is intentional.</li>
          </ol>
        ),
      },
      {
        q: 'I closed a period by mistake. Can I reopen it?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Yes — but it&apos;s an audit-tracked event (SAP OB52 style).</li>
            <li>Periods → pick the closed period → tap <strong>Reopen</strong>.</li>
            <li>You must enter a reason (minimum 10 characters). The reopen + reason are logged in the audit log.</li>
            <li>The period&apos;s reopen count increments. After reopening, post any corrections, then close again.</li>
            <li>Frequent reopens are flagged for the auditor — use sparingly.</li>
          </ol>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'reports',
    title: 'Reports — Trial Balance, P&L, Balance Sheet',
    icon: 'how-to',
    description: 'The three foundational financial statements.',
    items: [
      {
        q: 'What is the Trial Balance?',
        a: (
          <p>
            The Trial Balance lists every active GL account with its debit or credit balance as of a chosen date.
            Total debits must equal total credits — if they don&apos;t, the books are out of balance and you have a
            problem to investigate (most often a one-sided JE or import error).
          </p>
        ),
      },
      {
        q: 'What\'s in the Income Statement (P&L)?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Revenue (4xxx accounts) for the selected period</li>
            <li>− Cost of Goods Sold (5xxx)</li>
            <li>= Gross Profit + Gross Margin %</li>
            <li>− Operating Expenses (6xxx)</li>
            <li>− Other Operating (7xxx)</li>
            <li>= Operating Income</li>
            <li>− Non-Operating / Other (8xxx+)</li>
            <li>= Net Income + Net Margin %</li>
          </ul>
        ),
      },
      {
        q: 'What\'s in the Balance Sheet?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Assets</strong> — Cash, Receivables, Inventory, Prepayments, PPE, Intangibles.</li>
            <li><strong>Liabilities</strong> — Trade Payables, Tax Payables, Accrued, Long-term Debt.</li>
            <li><strong>Equity</strong> — Owner&apos;s capital + Retained Earnings (auto-derived from sum of P&amp;L since inception).</li>
            <li>Equation: Assets = Liabilities + Equity. If they don&apos;t match, a banner warns you.</li>
          </ul>
        ),
      },
      {
        q: 'How do I export reports to Excel?',
        a: (
          <p>
            Each report has a <strong>Download .xlsx</strong> button. The exported file has frozen panes,
            currency-formatted columns, and your business name in the header — ready for printing or attaching to
            email.
          </p>
        ),
      },
      {
        q: 'Cash Flow Statement — when?',
        a: (
          <p>
            On the roadmap (LED-2 in BACKLOG.md). Required for BIR audit. Will derive Operating / Investing /
            Financing activities from P&amp;L + Balance Sheet movements.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'tax',
    title: 'Tax Estimation (BIR)',
    icon: 'how-to',
    description: 'Quarterly BIR forms and EIS invoice generation.',
    items: [
      {
        q: 'Why is Tax Estimation locked?',
        a: (
          <p>
            Your tenant must be marked BIR-registered. Settings → BIR &amp; Tax → set Tax Status (VAT or NON_VAT),
            enter TIN, business name, registered address. After saving, sign out and back in — Tax Estimation is now
            unlocked.
          </p>
        ),
      },
      {
        q: 'What forms are supported today?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>2550Q</strong> — Quarterly VAT return. Pulls Output VAT (sales) and Input VAT (purchases) from posted JEs.</li>
            <li><strong>1701Q</strong> — Quarterly Income Tax. Pulls revenue and expense for the quarter.</li>
            <li><strong>EIS Invoice JSON</strong> — per-order BIR Electronic Invoicing System format. Download for manual upload to BIR.</li>
          </ul>
        ),
      },
      {
        q: 'Other BIR forms (2551Q, EWT, SAWT, 2307)?',
        a: (
          <p>
            On the roadmap (LED-3 and LED-4 in BACKLOG.md). 2307 is highest priority — vendors expect their
            withholding tax certificates at year-end.
          </p>
        ),
      },
      {
        q: 'Does Clerque file with BIR for me automatically?',
        a: (
          <p>
            No. The system <strong>estimates</strong> the values that go into the form. You (or your accountant) still
            need to enter them in BIR&apos;s e-FPS or eBIRForms portal and pay the tax. Direct API filing is not
            implemented (BIR&apos;s API is sandboxed and unstable).
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'audit',
    title: 'Audit Log',
    icon: 'guide',
    description: 'Immutable record of sensitive actions.',
    items: [
      {
        q: 'What gets logged?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Permission changes (e.g. promoting a user to MDM)</li>
            <li>Tax setting edits (changing tax status, TIN)</li>
            <li>Order voids (with reason and supervisor)</li>
            <li>Period reopens (with reason)</li>
            <li>SOD override grants (when an owner overrides a Segregation of Duties warning)</li>
            <li>JE reversals</li>
          </ul>
        ),
      },
      {
        q: 'Can audit log entries be deleted?',
        a: (
          <p>
            No. The schema is INSERT-only. This guarantees the trail is unbroken — required for BIR audit and
            internal forensic review.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    icon: 'troubleshoot',
    items: [
      {
        q: 'My Trial Balance doesn\'t balance.',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Check Event Queue for FAILED events — they may have left orphan one-sided lines.</li>
            <li>Look for recent imports that may have errored partially.</li>
            <li>Use Account Ledger drill-down on the most-changed account to find the suspect entry.</li>
            <li>If found, reverse the bad entry and post a corrected one.</li>
          </ol>
        ),
      },
      {
        q: 'Sales from yesterday aren\'t showing in the Trial Balance.',
        a: (
          <p>
            Check the Event Queue. If events are PENDING, the cron will pick them up shortly (runs every minute). If
            FAILED, fix the underlying issue (period closed, missing account, etc.) and retry.
          </p>
        ),
      },
      {
        q: 'I see a JE I didn\'t create.',
        a: (
          <p>
            Most likely auto-generated by POS (sale, void, COGS) or by the journal processor. Open the JE — it shows
            the source order or event ID. If you see a manually-created JE you don&apos;t recognize, check the audit
            log for who posted it.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'tips',
    title: 'Tips & Best Practices',
    icon: 'tip',
    items: [
      {
        q: 'Month-end close checklist',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>All cashier shifts closed for the month.</li>
            <li>All vendor bills entered.</li>
            <li>All employee expense claims approved or rejected.</li>
            <li>Run Settlement for each digital wallet for the last day of the month.</li>
            <li>Review Event Queue — clear all PENDING and FAILED.</li>
            <li>Check Trial Balance — balanced.</li>
            <li>Run P&amp;L and Balance Sheet — eyeball for sanity.</li>
            <li>Close the period.</li>
            <li>Archive the period&apos;s reports (Excel exports) to your records.</li>
          </ol>
        ),
      },
      {
        q: 'Year-end checklist',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Close every monthly period of the year first.</li>
            <li>Run all 4 quarters of 2550Q and 1701Q forms — file each by deadline (25th of the month after quarter-end).</li>
            <li>For WHT vendors: aggregate WHT and prepare 2307 for each (manually for now).</li>
            <li>Generate annual income statement + balance sheet — these go in your annual ITR (1701).</li>
            <li>Don&apos;t close the December period until your annual ITR is filed and any audit adjustments are posted.</li>
          </ol>
        ),
      },
      {
        q: 'AI prompt budget — how to make it last',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Smart Account Picker is free (no LLM call) — use it freely.</li>
            <li>JE Guide validation is also free — run it before every post.</li>
            <li>JE Drafter costs 1 prompt per draft — use it for novel / complex transactions, not boring repeats.</li>
            <li>Receipt OCR is 1 prompt per snap — only use for non-handwritten receipts where typing is slower.</li>
            <li>See your usage at Settings → Subscription.</li>
          </ul>
        ),
      },
    ],
  },
];

export default function LedgerHelpPage() {
  return (
    <HelpPage
      appName="Ledger"
      appTagline="Double-entry accounting guide for accountants, bookkeepers, finance leads, and owners. Search any topic or browse by section."
      sections={SECTIONS}
    />
  );
}
