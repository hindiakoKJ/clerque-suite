'use client';
import { ShieldCheck } from 'lucide-react';

/**
 * Public-facing Data Recovery SLA — the rendered view of docs/RECOVERY_SLA.md.
 * The markdown file in docs/ is the canonical source. Keep this page in sync
 * when the markdown changes (D2-03).
 */
export default function RecoverySlaPage() {
  const lastUpdated = 'May 12, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <ShieldCheck className="h-3.5 w-3.5" />
          Operational commitment
        </div>
        <h1 className="text-3xl font-bold mb-2">Data Recovery SLA</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated}
        </p>
      </header>

      <section className="mb-8">
        <p>
          This is Clerque&apos;s public commitment for restoring your tenant&apos;s data after an
          incident — accidental deletion, database corruption, ransomware, or a failed deploy.
          It is intentionally short so you can hand it to your accountant or compliance officer
          without translation.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Our targets</h2>
        <div className="not-prose overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Term</th>
                <th className="text-left px-3 py-2 font-semibold">Target</th>
                <th className="text-left px-3 py-2 font-semibold">Plain English</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-3 py-2 align-top"><strong>RPO</strong> (Recovery Point Objective)</td>
                <td className="px-3 py-2 align-top">up to <strong>24 hours</strong></td>
                <td className="px-3 py-2 align-top">
                  You may lose up to one business day of data. The off-box snapshot runs nightly at
                  02:00 UTC (10:00 AM Manila). Anything entered after that is at risk until the
                  next snapshot.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top"><strong>RTO</strong> — support-mediated restore</td>
                <td className="px-3 py-2 align-top"><strong>4 hours</strong> (business-conservative)</td>
                <td className="px-3 py-2 align-top">
                  From the time we acknowledge your email, your data is back in the live database
                  within 4 business hours. Uses the JSON backup.
                </td>
              </tr>
              <tr>
                <td className="px-3 py-2 align-top"><strong>RTO</strong> — admin self-service restore</td>
                <td className="px-3 py-2 align-top"><strong>1 hour</strong></td>
                <td className="px-3 py-2 align-top">
                  Once the post-Object-Lock self-service restore endpoint ships, business owners can
                  trigger a restore themselves and be back online in under an hour.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">What we retain</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li><strong>30 days</strong> of nightly snapshots in Cloudflare R2 (off-box, region-isolated).</li>
          <li>
            <strong>30 days</strong> of pre-destructive <code>TenantDataSnapshot</code> rows in the live
            database — captured automatically before any bulk delete, schema migration, or
            owner-initiated wipe.
          </li>
        </ul>
        <p className="mt-2">
          Anything older than 30 days is purged. If you need a longer retention window
          (e.g. BIR demands 10-year retention), download the JSON snapshot from
          <strong> Settings → Data Backups</strong> and keep it on your own cold storage.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">What is NOT covered</h2>
        <ul className="list-disc pl-6 space-y-1">
          <li>
            <strong>User credentials.</strong> <code>passwordHash</code> and 2FA secrets are not
            restored — every staff member re-sets their password on next login. Deliberate: a
            compromised credential is the most common reason a restore is needed.
          </li>
          <li>
            <strong>Tenant-side custom integrations.</strong> Webhooks, third-party API keys, and
            custom scripts you wired into Clerque are your responsibility to re-apply.
          </li>
          <li>
            <strong>Data generated AFTER the snapshot you restore from.</strong> Restore is a
            point-in-time recovery, not a merge.
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">How to invoke a restore</h2>
        <ol className="list-decimal pl-6 space-y-1">
          <li>Email <a className="text-[var(--accent)]" href="mailto:support@clerque.ph">support@clerque.ph</a></li>
          <li>Subject line: <code>URGENT — restore from backup</code></li>
          <li>
            Body must include:
            <ul className="list-disc pl-6 mt-1 space-y-0.5">
              <li>Your tenant slug (e.g. <code>acme-coffee</code>)</li>
              <li>The date of the last known good state (the snapshot we restore from)</li>
              <li>A one-line description of what happened</li>
            </ul>
          </li>
          <li>We acknowledge within <strong>1 business hour</strong>.</li>
          <li>Restore is typically complete within <strong>4 business hours</strong> of acknowledgement.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Communication during an incident</h2>
        <p>
          Live status is published at <strong>status.clerque.ph</strong>{' '}
          <em>(placeholder — page goes live in the next sprint)</em>. Until then, the
          business-owner email on file receives updates every 30 minutes during an active
          restore.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">Caveat lector</h2>
        <p>
          This SLA describes our operational targets, not a contractual liability ceiling. Refer
          to the Terms of Service for liability terms. Real-world restore time depends on
          snapshot size and whether the incident affects the underlying cloud provider; in a
          Cloudflare R2 or Railway regional outage we defer to our Disaster Recovery Plan.
        </p>
      </section>
    </article>
  );
}
