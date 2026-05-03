'use client';
import { ShieldCheck } from 'lucide-react';

export default function PrivacyPolicyPage() {
  const lastUpdated = 'May 3, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <ShieldCheck className="h-3.5 w-3.5" />
          Data Privacy Act of 2012 (RA 10173) Compliant
        </div>
        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated} · Effective immediately
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. Introduction</h2>
        <p>
          HNS Corporation Philippines (&ldquo;<strong>HNS Corp PH</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>,&rdquo; or &ldquo;<strong>our</strong>&rdquo;)
          operates Clerque, a cloud-based point-of-sale, accounting, and payroll platform for Philippine
          micro, small, and medium enterprises. This Privacy Policy explains how we collect, use, disclose,
          and protect personal information you provide when you use Clerque.
        </p>
        <p className="mt-2">
          We comply with the <strong>Data Privacy Act of 2012 (Republic Act No. 10173)</strong>,
          its Implementing Rules and Regulations, and the issuances of the National Privacy Commission (NPC).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. Personal Information Controller (PIC)</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Email: <a className="text-[var(--accent)]" href="mailto:privacy@hnscorpph.com">privacy@hnscorpph.com</a></p>
          <p>Data Protection Officer (DPO): <a className="text-[var(--accent)]" href="mailto:dpo@hnscorpph.com">dpo@hnscorpph.com</a></p>
          <p className="text-xs text-muted-foreground mt-2">
            Our DPO is designated to oversee compliance with the Data Privacy Act and to handle data
            subject inquiries.
          </p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Information We Collect</h2>

        <h3 className="text-sm font-semibold mt-4 mb-1">3.1 Business Information</h3>
        <ul className="list-disc pl-6 space-y-0.5">
          <li>Business name, registered name, and business type</li>
          <li>Tax Identification Number (TIN) and BIR registration status</li>
          <li>Business address and contact details (phone, email)</li>
          <li>Subscription tier and billing identifiers</li>
        </ul>

        <h3 className="text-sm font-semibold mt-4 mb-1">3.2 Staff (Authorized User) Information</h3>
        <ul className="list-disc pl-6 space-y-0.5">
          <li>Full name, email address, and (where provided) phone number</li>
          <li>Encrypted password hash and 2FA secrets (when enabled)</li>
          <li>Assigned role, branch, and app-access permissions</li>
          <li>Login and session metadata (timestamps, IP address, device user agent)</li>
          <li>Audit-trail entries documenting actions taken in the system</li>
          <li>Time-attendance records (clock in/out timestamps and locations, where used)</li>
        </ul>

        <h3 className="text-sm font-semibold mt-4 mb-1">3.3 Customer Transaction Information</h3>
        <p className="text-xs text-muted-foreground mb-1">
          Collected only when you (the merchant) record it for legitimate business purposes:
        </p>
        <ul className="list-disc pl-6 space-y-0.5">
          <li>Customer name, TIN, and address (for B2B sales invoices and Official Receipts)</li>
          <li>Persons with Disabilities (PWD) and Senior Citizen discount card identifiers and cardholder names — collected and retained as required by Philippine tax law for discount audit purposes</li>
          <li>Order items, quantities, prices, and payment methods (we do <strong>not</strong> store full credit/debit card numbers, CVVs, or PINs)</li>
        </ul>

        <h3 className="text-sm font-semibold mt-4 mb-1">3.4 Technical Information</h3>
        <ul className="list-disc pl-6 space-y-0.5">
          <li>Browser type, operating system, and device type</li>
          <li>IP address (for security logging only)</li>
          <li>Limited cookies strictly necessary for authentication (session tokens)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Purposes of Processing</h2>
        <p>We process personal information for the following purposes:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li><strong>Service delivery</strong> — to operate Clerque and provide the features you subscribed to</li>
          <li><strong>Authentication and security</strong> — to verify identities, prevent unauthorized access, and detect fraud</li>
          <li><strong>Tax compliance</strong> — to support BIR-required reporting (Sales Invoice / Official Receipt issuance, BIR forms, audit trail)</li>
          <li><strong>Customer support</strong> — to respond to inquiries and troubleshoot issues</li>
          <li><strong>Service improvement</strong> — to monitor system reliability and fix bugs (using anonymized or aggregated data where possible)</li>
          <li><strong>Legal obligations</strong> — to comply with subpoenas, court orders, NPC directives, or other legal requirements</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Lawful Bases for Processing</h2>
        <p>Under Section 12 (personal information) and Section 13 (sensitive personal information) of the Data Privacy Act, we rely on:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li><strong>Contractual necessity</strong> — processing required to deliver the service you signed up for</li>
          <li><strong>Legal obligation</strong> — processing required by Philippine tax law (BIR), labor law (DOLE), and other applicable laws</li>
          <li><strong>Legitimate interest</strong> — processing necessary for legitimate business operations such as fraud prevention and system security, balanced against your rights</li>
          <li><strong>Consent</strong> — processing for purposes outside the above (we will obtain explicit consent before such processing)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Data Sharing and Disclosure</h2>
        <p>
          We do <strong>not</strong> sell your personal information. We share data only with:
        </p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>
            <strong>Authorized users within your tenant</strong> — based on the role-based access controls
            you configure
          </li>
          <li>
            <strong>Infrastructure service providers</strong> bound by data-processing agreements: cloud
            hosting (Railway, Inc.), application hosting (Vercel, Inc.), email delivery (Resend), and
            error tracking
          </li>
          <li>
            <strong>Government authorities</strong> when required by law, court order, or valid NPC directive
          </li>
          <li>
            <strong>External auditors</strong> assigned by you, with read-only access controlled by your
            account
          </li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Cross-Border Data Transfers</h2>
        <p>
          Our cloud infrastructure providers (Railway, Vercel) operate data centers outside the Philippines,
          principally in the United States. By using Clerque, you acknowledge that your data may be
          transmitted, stored, and processed outside the Philippines, subject to safeguards required by
          Section 21 of the Data Privacy Act, including binding contractual commitments by these providers
          to maintain protection equivalent to that required under Philippine law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. Data Retention</h2>
        <p>We retain personal information only as long as necessary for the purposes for which it was collected:</p>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs border border-border rounded-lg">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-2 border-b border-border">Data Category</th>
                <th className="text-left p-2 border-b border-border">Retention Period</th>
                <th className="text-left p-2 border-b border-border">Basis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="p-2">Books of accounts, invoices, OR, journal entries</td>
                <td className="p-2"><strong>10 years</strong> from the close of the taxable year</td>
                <td className="p-2">NIRC Section 235; BIR RR 17-2013</td>
              </tr>
              <tr>
                <td className="p-2">PWD/Senior Citizen discount records</td>
                <td className="p-2">10 years (linked to OR)</td>
                <td className="p-2">RA 9994; RA 10754</td>
              </tr>
              <tr>
                <td className="p-2">Staff time-attendance records</td>
                <td className="p-2">3 years</td>
                <td className="p-2">Labor Code, Article 109</td>
              </tr>
              <tr>
                <td className="p-2">Login and session logs</td>
                <td className="p-2">12 months rolling</td>
                <td className="p-2">Security and audit purposes</td>
              </tr>
              <tr>
                <td className="p-2">Account data after subscription cancellation</td>
                <td className="p-2">90-day grace, then anonymized</td>
                <td className="p-2">Subject to retention obligations above</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          When the retention period lapses and no legal obligation remains, we securely delete or
          anonymize the data so individuals are no longer identifiable.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">9. Your Rights as a Data Subject</h2>
        <p>Under the Data Privacy Act, you are entitled to the following rights:</p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li><strong>Right to be informed</strong> of the collection and processing of your personal data</li>
          <li><strong>Right to access</strong> your personal data and obtain a copy in a portable format</li>
          <li><strong>Right to object</strong> to processing in certain circumstances</li>
          <li><strong>Right to rectify</strong> inaccurate or incomplete data</li>
          <li>
            <strong>Right to erasure or blocking</strong> — subject to BIR retention requirements and
            other legal obligations that may prevent deletion of certain transactional records
          </li>
          <li><strong>Right to data portability</strong> — to request your data in a structured, machine-readable format</li>
          <li><strong>Right to file a complaint</strong> with the National Privacy Commission</li>
          <li><strong>Right to damages</strong> for inaccurate, incomplete, outdated, false, unlawfully obtained, or unauthorized use of personal information</li>
        </ul>
        <p className="mt-3">
          To exercise any of these rights, write to{' '}
          <a className="text-[var(--accent)]" href="mailto:dpo@hnscorpph.com">
            dpo@hnscorpph.com
          </a>
          . We will respond within 15 working days.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">10. Security Measures</h2>
        <p>We implement reasonable and appropriate security safeguards, including:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Encryption of data in transit (TLS 1.2+) and at rest</li>
          <li>Password hashing using bcrypt with industry-standard cost factors</li>
          <li>Role-based access control with Segregation of Duties enforcement</li>
          <li>Automatic account lockout after repeated failed login attempts</li>
          <li>Optional two-factor authentication for sensitive roles</li>
          <li>Append-only audit logs that cannot be modified retroactively</li>
          <li>Regular security reviews and dependency updates</li>
          <li>Restricted access to production systems on a need-to-know basis</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">11. Personal Data Breach Notification</h2>
        <p>
          In the event of a personal data breach that is likely to result in a real risk of serious harm
          to data subjects, we will notify the National Privacy Commission and affected data subjects
          within <strong>72 hours</strong> of becoming aware of the breach, in accordance with NPC
          Circular 16-03.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">12. Children&rsquo;s Data</h2>
        <p>
          Clerque is a business tool not directed at individuals under 18. We do not knowingly collect
          personal information from minors. If you believe a minor&rsquo;s data has been provided to us
          without parental consent, please contact our DPO so we can take appropriate action.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">13. Cookies and Similar Technologies</h2>
        <p>
          We use only strictly necessary cookies for authentication (session tokens) and we do not use
          third-party advertising or tracking cookies. You may disable cookies in your browser, but
          authentication will not function without them.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">14. Updates to This Policy</h2>
        <p>
          We may revise this Privacy Policy to reflect changes in law, technology, or our practices. We
          will notify users of material changes through the application or by email at least 30 days
          before the changes take effect. Continued use of Clerque after the effective date constitutes
          acceptance of the revised policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">15. Filing a Complaint with the NPC</h2>
        <p>
          If you believe your privacy rights have been violated, you may file a complaint with the
          National Privacy Commission:
        </p>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm mt-2">
          <p className="font-medium">National Privacy Commission</p>
          <p>5th Floor, Philippine International Convention Center (PICC), Pasay City</p>
          <p>Email: <a className="text-[var(--accent)]" href="mailto:complaints@privacy.gov.ph">complaints@privacy.gov.ph</a></p>
          <p>Website: <a className="text-[var(--accent)]" target="_blank" rel="noopener noreferrer" href="https://privacy.gov.ph">privacy.gov.ph</a></p>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">16. Contact Us</h2>
        <p>
          For any questions, concerns, or requests regarding this Privacy Policy or our data-handling
          practices, please contact:
        </p>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm mt-2">
          <p>Data Protection Officer, HNS Corporation Philippines</p>
          <p>
            Email: <a className="text-[var(--accent)]" href="mailto:dpo@hnscorpph.com">dpo@hnscorpph.com</a>
          </p>
          <p>
            General inquiries: <a className="text-[var(--accent)]" href="mailto:privacy@hnscorpph.com">privacy@hnscorpph.com</a>
          </p>
        </div>
      </section>
    </article>
  );
}
