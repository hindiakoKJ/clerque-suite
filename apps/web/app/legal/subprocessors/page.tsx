'use client';
import { Network } from 'lucide-react';

export default function SubprocessorsPage() {
  const lastUpdated = 'July 31, 2026';

  const subprocessors = [
    {
      name: 'Railway Corporation',
      purpose: 'Managed database and backend application hosting (PostgreSQL, API compute)',
      data: 'All tenant business data at rest, including personal data of your staff and customers',
      location: 'United States',
      safeguard: 'Data-processing agreement; contractual safeguards under Sec. 21, RA 10173',
    },
    {
      name: 'Vercel Inc.',
      purpose: 'Web application hosting and content delivery for the Clerque frontend',
      data: 'Requests and technical logs; data in transit while you use the web app',
      location: 'United States (global edge network)',
      safeguard: 'Data-processing agreement; contractual safeguards under Sec. 21, RA 10173',
    },
    {
      name: 'Resend (Plus Five Five, Inc.)',
      purpose: 'Transactional email delivery (verification, password reset, notifications)',
      data: 'Recipient email address and message content of transactional emails',
      location: 'United States',
      safeguard: 'Data-processing agreement; contractual safeguards under Sec. 21, RA 10173',
    },
    {
      name: 'Error-monitoring provider (Sentry)',
      purpose: 'Application error and performance monitoring to keep the Service reliable',
      data: 'Diagnostic and technical data; may incidentally include identifiers present in an error context',
      location: 'United States',
      safeguard: 'Data-processing agreement; data minimization and scrubbing of sensitive fields',
    },
    {
      name: 'Payment provider (activated only if you enable online payments)',
      purpose: 'Processing of card / e-wallet / online payments where a tenant turns on online payment collection',
      data: 'Transaction and payer details necessary to process the payment',
      location: 'Philippines / as disclosed by the provider',
      safeguard: 'PCI-DSS compliant provider; data-processing / merchant agreement',
    },
  ];

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <Network className="h-3.5 w-3.5" />
          Governed by Philippine Law
        </div>
        <h1 className="text-3xl font-bold mb-2">Sub-processors</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated}
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. What This Page Is</h2>
        <p>
          To provide Clerque (the &ldquo;<strong>Service</strong>&rdquo;), HNS Corporation Philippines
          (&ldquo;<strong>HNS Corp PH</strong>&rdquo;) engages a small number of third-party providers
          (&ldquo;<strong>sub-processors</strong>&rdquo;) that process personal data on our behalf. This page is
          the current, authoritative list of those sub-processors. It supports our{' '}
          <a className="text-[var(--accent)]" href="/legal/dpa">Data Processing Agreement</a> and{' '}
          <a className="text-[var(--accent)]" href="/legal/privacy">Privacy Policy</a>, and may be more current
          than the summary in those documents.
        </p>
        <p className="mt-2">
          Each sub-processor is engaged under a written agreement that binds it to confidentiality and to
          data-protection obligations no less protective than those in our own DPA, consistent with the Data
          Privacy Act of 2012 (RA 10173).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. Current Sub-processors</h2>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs border border-border rounded-lg">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-2 border-b border-border">Sub-processor</th>
                <th className="text-left p-2 border-b border-border">Purpose</th>
                <th className="text-left p-2 border-b border-border">Data processed</th>
                <th className="text-left p-2 border-b border-border">Location</th>
                <th className="text-left p-2 border-b border-border">Safeguard</th>
              </tr>
            </thead>
            <tbody>
              {subprocessors.map((s) => (
                <tr key={s.name}>
                  <td className="p-2 border-b border-border align-top font-medium">{s.name}</td>
                  <td className="p-2 border-b border-border align-top">{s.purpose}</td>
                  <td className="p-2 border-b border-border align-top">{s.data}</td>
                  <td className="p-2 border-b border-border align-top">{s.location}</td>
                  <td className="p-2 border-b border-border align-top">{s.safeguard}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Our infrastructure sub-processors operate data centers outside the Philippines, principally in the
          United States. By using the Service you acknowledge these cross-border transfers, which are subject to
          the safeguards required by Section 21 of RA 10173. See Privacy Policy §7 (Cross-Border Data Transfers).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Changes and Advance Notice</h2>
        <p>
          We may add or replace sub-processors as the Service evolves. When we intend to engage a new
          sub-processor that will process personal data in your tenant, we will update this page and, where you
          have subscribed to notifications, give reasonable advance notice by email or in-app notice before the
          new sub-processor begins processing.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Objecting to a Sub-processor</h2>
        <p>
          If you have a reasonable, good-faith data-protection objection to a new sub-processor, email us at{' '}
          <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a>{' '}
          within 30 days of the notice. We will work with you in good faith to address the concern. If we cannot
          reasonably resolve it and the sub-processor is essential to the Service, you may, as your sole remedy,
          terminate the affected subscription in accordance with the Terms of Service and Data Processing
          Agreement.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Contact</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Data protection: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Data Protection Officer: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
        </div>
      </section>
    </article>
  );
}
