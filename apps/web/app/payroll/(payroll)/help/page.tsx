'use client';
import { HelpPage, type HelpSection } from '@/components/help/HelpPage';

const SECTIONS: HelpSection[] = [
  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'guide',
    description: 'Sync is currently focused on time tracking, attendance, and expense claims. Full payroll computation is on the roadmap.',
    items: [
      {
        q: 'What is Sync for today?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Clock in/out</strong> — every employee tracks their hours.</li>
            <li><strong>My Attendance</strong> — review your own time entries.</li>
            <li><strong>My Expenses</strong> — submit reimbursement claims (food, transport, supplies).</li>
            <li><strong>Payslips</strong> — view your pay history (HR-generated).</li>
            <li><strong>Dashboard / Timesheets / Staff / Pay Runs</strong> — HR / Payroll Master view of all employees.</li>
            <li><strong>Contributions</strong> — SSS / PhilHealth / Pag-IBIG tracking (HR view).</li>
          </ul>
        ),
      },
      {
        q: 'What\'s NOT in Sync yet?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Automatic payroll computation (gross → deductions → net) — coming.</li>
            <li>PH government contribution tables (SSS, PhilHealth, Pag-IBIG) — coming.</li>
            <li>13th-month and leave computation — coming.</li>
            <li>Payslip PDF generation — coming.</li>
            <li>Bank disbursement file (BDO/BPI/Metrobank format) — coming.</li>
            <li>BIR 2316 (annual ITR for employees) — coming.</li>
            <li>Employee / TimeEntry / Salary import templates — coming after the engine lands.</li>
          </ul>
        ),
      },
      {
        q: 'Why are some menu items showing &ldquo;Coming Soon&rdquo;?',
        a: (
          <p>
            The schema is in place but the calculation engine isn&apos;t built. We&apos;re prioritizing Counter and
            Ledger to production-grade first. Payroll is the next major sprint after that.
          </p>
        ),
      },
      {
        q: 'Who can use which features?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Every employee</strong> — Clock In/Out, My Attendance, My Expenses, Payslips (own only).</li>
            <li><strong>Branch Manager</strong> — view their branch&apos;s timesheets.</li>
            <li><strong>Payroll Master</strong> — full HR view: timesheets, staff salaries, pay runs, contributions, reports.</li>
            <li><strong>Business Owner</strong> — same as Payroll Master plus override capability.</li>
            <li>Cashiers and other staff see only the staff-facing items (clock, attendance, payslips, expenses).</li>
          </ul>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'clock',
    title: 'Clock In / Out',
    icon: 'how-to',
    description: 'Daily attendance — used by everyone.',
    items: [
      {
        q: 'How do I clock in for the day?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>Sign in to Sync (or your default app — cashiers may auto-land here for clocking).</li>
            <li>Tap the <strong>Clock In</strong> button. Your start time is stamped.</li>
            <li>The button now reads <strong>Clock Out</strong>. The session is active.</li>
          </ol>
        ),
      },
      {
        q: 'How do I clock out?',
        a: (
          <p>
            Tap <strong>Clock Out</strong> at the end of your shift. The session closes; total hours are computed and
            shown. The entry appears in My Attendance for review.
          </p>
        ),
      },
      {
        q: 'I forgot to clock out yesterday.',
        a: (
          <p>
            The system auto-closes sessions at midnight to avoid impossible &gt;24h shifts. The end time is set to
            midnight, which means your reported hours may be wrong. Tell your manager — they can adjust the entry on
            the HR view.
          </p>
        ),
      },
      {
        q: 'Can I clock in from any device?',
        a: (
          <p>
            Yes — phone, tablet, or laptop. Whichever you sign into Sync from. Some businesses lock the clock to a
            specific tablet at the entrance — that&apos;s a configuration choice (geofencing / device pinning is on the
            roadmap).
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'attendance',
    title: 'My Attendance',
    icon: 'guide',
    items: [
      {
        q: 'What does My Attendance show?',
        a: (
          <p>
            All your past clock entries — date, time in, time out, total hours. Filter by month or date range. Useful
            for reviewing your own logged hours before a pay run.
          </p>
        ),
      },
      {
        q: 'I think an entry is wrong. Can I edit it?',
        a: (
          <p>
            Employees can&apos;t edit their own time entries — that would defeat the point. Tell your manager. The
            Payroll Master can correct entries on your behalf, and the change is logged.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'my-expenses',
    title: 'My Expenses',
    icon: 'how-to',
    description: 'Submit reimbursement claims for work-related expenses you paid for.',
    items: [
      {
        q: 'When should I file an expense claim?',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>You paid for something work-related from your own pocket (food during overtime, transport for an errand, supplies).</li>
            <li>You have a receipt to back it up.</li>
            <li>It&apos;s within your company&apos;s policy (ask manager for limits).</li>
          </ul>
        ),
      },
      {
        q: 'How do I submit a claim?',
        a: (
          <ol className="list-decimal pl-5 space-y-1">
            <li>My Expenses → <strong>+ New Claim</strong>.</li>
            <li>Snap or upload a photo of the receipt.</li>
            <li>Enter amount, category (Transport, Food, Office Supplies, etc.), and a brief reason.</li>
            <li>Submit. Status starts as PENDING.</li>
          </ol>
        ),
      },
      {
        q: 'How long does approval take?',
        a: (
          <p>
            Up to your approver. Branch Managers / Owners / Finance Lead can approve. They see your claim in Ledger
            → Expense Approvals. Approved claims are reimbursed via the next pay run (or sooner if your business
            pays them out separately). Rejected claims come back to you with a reason; you can edit and resubmit.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'payslips',
    title: 'Payslips',
    icon: 'guide',
    items: [
      {
        q: 'Where are my payslips?',
        a: (
          <p>
            Payslips page lists all your historical payslips. Tap one to view the breakdown (basic pay, deductions,
            contributions, net). PDF download is on the roadmap once the payroll engine ships.
          </p>
        ),
      },
      {
        q: 'I think my pay is wrong.',
        a: (
          <p>
            Review your time entries first — a missed clock-out can shave hours. If your hours are right but the pay
            is wrong, talk to HR / Payroll Master. They can show you the exact computation and correct it if needed.
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'hr-view',
    title: 'HR View — Dashboard, Timesheets, Staff, Pay Runs',
    icon: 'how-to',
    description: 'Visible only to Payroll Master + Business Owner. Most features stub-only today.',
    items: [
      {
        q: 'Dashboard',
        a: (
          <p>
            Headcount, total payroll cost forecast for the period, attendance summary, claim volume. Live-data
            wireframe; full computation pending the engine.
          </p>
        ),
      },
      {
        q: 'Timesheets',
        a: (
          <p>
            All employees&apos; clock entries for the period in one grid. Filter by employee or branch. Click a row
            to edit (corrections logged with reason). Will eventually drive pay-run computation.
          </p>
        ),
      },
      {
        q: 'Staff',
        a: (
          <p>
            Employee directory with salary master fields (basic, allowances, status). Salary columns visible only to
            Payroll Master + Owner (SOD enforced). Will support import / bulk-edit once template lands.
          </p>
        ),
      },
      {
        q: 'Pay Runs',
        a: (
          <p>
            Where you create a run for a period (semi-monthly, monthly, etc.), pull timesheets, compute, review,
            approve, and disburse. Currently scaffolded — engine to land in the next sprint.
          </p>
        ),
      },
      {
        q: 'Contributions',
        a: (
          <p>
            Per-employee tracking of SSS, PhilHealth, Pag-IBIG contributions. Will pull from PH government tables
            (currently outdated tables; need refresh before live use).
          </p>
        ),
      },
    ],
  },

  // ─────────────────────────────────────────────────────────────────────────
  {
    id: 'tips',
    title: 'Tips',
    icon: 'tip',
    items: [
      {
        q: 'Clock in / out reliably',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Bookmark Sync on your phone&apos;s home screen for one-tap access.</li>
            <li>If your shop has shared tablets, pin the Sync URL in the browser tab so anyone walking up can clock.</li>
            <li>Set a phone alarm 5 minutes before your normal clock-out — the auto-midnight close will mess up your hours otherwise.</li>
          </ul>
        ),
      },
      {
        q: 'Speeding up expense claims',
        a: (
          <ul className="list-disc pl-5 space-y-1">
            <li>Submit weekly, not monthly — easier to track receipts and remember reasons.</li>
            <li>Use clear receipt photos (good lighting, no glare).</li>
            <li>Be specific in the reason (&ldquo;dinner for OT 2026-04-29&rdquo; vs &ldquo;food&rdquo;).</li>
            <li>Keep the original receipt — your business may need it for BIR audit.</li>
          </ul>
        ),
      },
    ],
  },
];

export default function PayrollHelpPage() {
  return (
    <HelpPage
      appName="Sync"
      appTagline="Time tracking, attendance, expense claims, and (soon) payroll. This app is partially built — see Getting Started for what works today."
      sections={SECTIONS}
    />
  );
}
