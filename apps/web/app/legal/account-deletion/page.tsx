'use client';
import { Trash2, Mail, Clock, AlertTriangle, FileCheck2, Phone } from 'lucide-react';

/**
 * /legal/account-deletion — Google Play required URL.
 *
 * Play Store policy requires every app that allows user accounts to publish
 * a dedicated URL explaining (1) how to request deletion, (2) what gets
 * deleted vs retained, and (3) how long it takes. This page does all three.
 *
 * Linked from:
 *   • Play Console → App content → Data safety → Delete account URL
 *   • Privacy policy footer (Section 14 — Your Rights)
 *   • In-app More tab → "Delete my account" (future Counter screen)
 */
export default function AccountDeletionPage() {
  const lastUpdated = 'May 20, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <Trash2 className="h-3.5 w-3.5" />
          Data Privacy Act of 2012 (RA 10173) Compliant
        </div>
        <h1 className="text-3xl font-bold mb-2">Account & Data Deletion</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. What this page covers</h2>
        <p>
          This page tells you exactly how to request deletion of your Clerque
          account and the data we hold about you. We are <strong>HNS Corporation
          Philippines</strong> (&ldquo;HNS Corp PH&rdquo;), the operator of
          Clerque — a cloud point-of-sale, accounting, and payroll platform for
          Philippine small and medium businesses.
        </p>
        <p className="mt-2">
          The Clerque ecosystem is made up of:
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
          <li><strong>Clerque Cloud</strong> — the web application at{' '}
            <a href="https://clerque.hnscorpph.com" className="text-[var(--accent)]">clerque.hnscorpph.com</a>
          </li>
          <li><strong>Clerque Counter</strong> — the Android companion app on the Google Play Store</li>
        </ul>
        <p className="mt-2">
          Both surfaces share the same account and data; deleting your account removes
          you from both.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Mail className="h-5 w-5 text-[var(--accent)]" />
          2. How to request deletion
        </h2>
        <p>Send an email from the address registered on your Clerque account to:</p>
        <div className="bg-muted/30 border border-border rounded-lg p-4 mt-3">
          <p className="font-semibold text-[var(--accent)]">
            <a href="mailto:dpo@hnscorpph.com">dpo@hnscorpph.com</a>
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Data Protection Officer, HNS Corporation Philippines
          </p>
        </div>
        <p className="mt-3">Subject line (template):</p>
        <pre className="bg-muted/30 border border-border rounded p-3 text-xs mt-2 whitespace-pre-wrap">
{`Subject: Account deletion request — <your tenant slug>

Body:
Please delete my Clerque account and all associated personal data.

Tenant: <your tenant slug, e.g. "my-coffee-shop">
Account email: <the email on file>
Reason (optional): <e.g. closing the business / privacy preference>

I confirm I am the account holder or its authorized representative.`}
        </pre>
        <p className="mt-3 text-sm">
          If you cannot send from the registered email (lost access, employee
          left, etc.), we will verify your identity through a video call with
          an officer of the business. This is to protect against malicious
          deletion requests by competitors or former staff.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Clock className="h-5 w-5 text-[var(--accent)]" />
          3. How long it takes
        </h2>
        <ul className="space-y-2 text-sm">
          <li>
            <strong>Within 24 hours</strong> — we acknowledge receipt of your
            request and confirm the steps to verify your identity.
          </li>
          <li>
            <strong>Within 7 calendar days</strong> — your sign-in is
            disabled. You can no longer log in to web or Counter mobile from
            any device.
          </li>
          <li>
            <strong>Within 30 calendar days</strong> — all deletable personal
            data described below is purged from production systems and
            backups. We send you a final confirmation email.
          </li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          This timeline complies with the Data Privacy Act of 2012 (RA 10173)
          and the IRR of the National Privacy Commission, which require data
          controllers to respond to deletion requests within thirty (30) days.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <FileCheck2 className="h-5 w-5 text-green-700 dark:text-green-500" />
          4. What gets DELETED
        </h2>
        <p>The following data is purged within 30 days:</p>
        <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
          <li>Your user profile — name, email, password hash, login history</li>
          <li>Sessions and trusted-device records</li>
          <li>Your role assignments and permissions</li>
          <li>Notification preferences and any non-business personal data linked to your user record</li>
          <li>If you are the sole owner of a tenant business that you are also closing — the tenant&apos;s customer database, product catalogue, employees, branches, and configuration</li>
          <li>Marketing and analytics events tied to your user ID</li>
          <li>Cached data on the Counter mobile app (signing out + uninstalling clears local storage)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          5. What we are LEGALLY REQUIRED to RETAIN
        </h2>
        <p>
          By law (BIR, SEC, Anti-Money Laundering Act, and various tax codes)
          we cannot delete certain records even when you request it. We keep
          these in restricted-access archives for the legally required period
          and delete them on schedule:
        </p>
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-lg p-4 mt-3 text-sm space-y-2">
          <p>
            <strong>BIR-mandated records</strong> (sales receipts, OR / AR
            entries, Z-read logs, journal entries, audit logs) — retained for{' '}
            <strong>10 years</strong> per Section 235 of the National Internal
            Revenue Code (NIRC) as amended.
          </p>
          <p>
            <strong>Anti-Money Laundering Act records</strong> (payments above
            ₱500,000 covered transactions) — retained for <strong>5
            years</strong> after the transaction or relationship ends, per RA
            9160 and BSP Circular 950.
          </p>
          <p>
            <strong>Payroll and labour records</strong> (Time entries, payslips,
            13th-month, tax withholding) — retained for <strong>3 years</strong>{' '}
            after employment ends, per the Labor Code.
          </p>
          <p>
            <strong>Tax authority correspondence</strong> — retained for <strong>10
            years</strong> per NIRC.
          </p>
        </div>
        <p className="mt-3 text-sm">
          These records are removed from active production systems, kept in
          encrypted cold storage with no end-user access, and permanently
          destroyed at the end of the legally required retention period. They
          are <strong>not used</strong> for any purpose other than complying
          with regulatory requests.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. If you are not the tenant owner</h2>
        <p>
          You may be using Clerque as an employee, cashier, or invited user
          of a business that is not yours. In that case:
        </p>
        <ul className="list-disc pl-6 mt-2 space-y-1 text-sm">
          <li>You can request deletion of <strong>your personal user record</strong> (name, email, login history) using the process above.</li>
          <li>The <strong>business&apos;s</strong> records (the tenant&apos;s products, customers, sales) are <strong>not yours to delete</strong> — only the business owner can request that. We will reply to your request confirming what was removed and what remains.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Reversing a deletion</h2>
        <p>
          During the 7-day window between your sign-in being disabled and
          the actual data purge, you can <strong>cancel</strong> the deletion
          by replying to the acknowledgement email. After the 30-day mark,
          deletion is irreversible — we cannot recover deleted data even by
          court order, because it no longer exists on our systems.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Phone className="h-5 w-5 text-[var(--accent)]" />
          8. Questions or escalations
        </h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm mt-2 space-y-1">
          <p><strong>Data Protection Officer</strong></p>
          <p>HNS Corporation Philippines</p>
          <p>Email: <a className="text-[var(--accent)]" href="mailto:dpo@hnscorpph.com">dpo@hnscorpph.com</a></p>
          <p>General inquiries: <a className="text-[var(--accent)]" href="mailto:privacy@hnscorpph.com">privacy@hnscorpph.com</a></p>
        </div>
        <p className="mt-3 text-sm">
          If you are dissatisfied with our response, you may file a complaint
          with the National Privacy Commission of the Philippines:
        </p>
        <p className="mt-1 text-sm">
          <a className="text-[var(--accent)]" target="_blank" rel="noopener noreferrer" href="https://privacy.gov.ph">privacy.gov.ph</a>
        </p>
      </section>

      <section className="mb-8 border-t border-border pt-6">
        <p className="text-xs text-muted-foreground">
          For the full privacy framework — what we collect, how we use it,
          your rights as a data subject — see our{' '}
          <a className="text-[var(--accent)]" href="/legal/privacy">Privacy Policy</a>.
        </p>
      </section>
    </article>
  );
}
