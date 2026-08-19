'use client';
import { FileLock2 } from 'lucide-react';

export default function DataProcessingAgreementPage() {
  const lastUpdated = 'July 31, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <FileLock2 className="h-3.5 w-3.5" />
          RA 10173 · Controller–Processor
        </div>
        <h1 className="text-3xl font-bold mb-2">Data Processing Agreement</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated} · Effective immediately
        </p>
      </header>

      <section className="mb-8">
        <p>
          This Data Processing Agreement (&ldquo;<strong>DPA</strong>&rdquo;) forms part of, and is incorporated
          by reference into, the <a className="text-[var(--accent)]" href="/legal/terms">Terms of Service</a>{' '}
          between you (&ldquo;<strong>Customer</strong>,&rdquo; &ldquo;<strong>you</strong>&rdquo;) and HNS
          Corporation Philippines (&ldquo;<strong>HNS Corp PH</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo;
          &ldquo;<strong>us</strong>&rdquo;) governing the Service known as Clerque. It applies to the extent we
          process Personal Data on your behalf in providing the Service. By accepting the Terms of Service, you
          accept this DPA. If there is any conflict between this DPA and the Terms of Service regarding the
          processing of Personal Data, this DPA prevails.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. Definitions</h2>
        <p>
          Terms used in this DPA have the meaning given in the Data Privacy Act of 2012 (Republic Act No. 10173,
          the &ldquo;<strong>DPA Act</strong>&rdquo;) and its Implementing Rules and Regulations (&ldquo;<strong>IRR</strong>&rdquo;),
          including <em>Personal Information</em>, <em>Sensitive Personal Information</em>, <em>Processing</em>,
          <em> Personal Information Controller</em> (&ldquo;<strong>PIC</strong>&rdquo;), and
          <em> Personal Information Processor</em> (&ldquo;<strong>PIP</strong>&rdquo;).
          &ldquo;<strong>Personal Data</strong>&rdquo; means Personal Information and Sensitive Personal
          Information together. &ldquo;<strong>Data Subject</strong>&rdquo; means the individual to whom Personal
          Data relates. &ldquo;<strong>Personal Data Breach</strong>&rdquo; has the meaning in NPC Circular
          16-03. &ldquo;<strong>NPC</strong>&rdquo; means the National Privacy Commission.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. Roles of the Parties</h2>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li>For Personal Data you or your authorized users enter into the Service about your own staff, customers, vendors, and other individuals (&ldquo;<strong>Customer Personal Data</strong>&rdquo;), <strong>you are the PIC</strong> and <strong>we act as your PIP</strong>, processing Customer Personal Data only to provide the Service on your behalf.</li>
          <li>For Personal Data we determine the purposes of ourselves — such as your account-administrator contact details, billing information, and Service usage logs — <strong>we act as PIC</strong>, and our handling of that data is governed by our <a className="text-[var(--accent)]" href="/legal/privacy">Privacy Policy</a>, not this DPA.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Subject Matter and Details of Processing</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li><strong>Subject matter:</strong> our processing of Customer Personal Data to provide the Clerque Service (Counter/POS, Ledger, Sync/Payroll, and related modules).</li>
          <li><strong>Duration:</strong> for the term of your subscription, plus the post-termination retention window in Section 11.</li>
          <li><strong>Nature and purpose:</strong> hosting, storage, computation, transmission, backup, and support necessary to operate the Service and follow your instructions.</li>
          <li><strong>Types of Data Subjects:</strong> your staff/employees, your customers, your vendors, and other individuals whose data you choose to enter.</li>
          <li><strong>Categories of Personal Data:</strong> as determined by you — typically names, contact details, roles, employment and payroll details, transaction and account records; and any Sensitive Personal Information you choose to enter (which you should minimize).</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Our Obligations as Processor</h2>
        <p>When acting as your PIP, we will:</p>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>Process Customer Personal Data only on your documented instructions, including the Terms of Service, this DPA, and your configuration and use of the Service, unless required otherwise by Philippine law (in which case we will inform you before processing, unless the law prohibits it);</li>
          <li>Ensure that personnel authorized to process Customer Personal Data are bound by confidentiality obligations;</li>
          <li>Implement and maintain reasonable and appropriate organizational, physical, and technical security measures as required by Sections 20–22 of the DPA Act and NPC Circular 16-01, as described in Section 6;</li>
          <li>Not sell Customer Personal Data, and not use it for our own marketing or for any purpose other than providing and supporting the Service;</li>
          <li>Assist you, taking into account the nature of the processing, in responding to Data Subject requests and in meeting your own security, breach-notification, and privacy-impact-assessment obligations, as described in Sections 5 and 7;</li>
          <li>Make available information reasonably necessary to demonstrate compliance with this DPA, as described in Section 9.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Data Subject Rights</h2>
        <p>
          The Service provides features that let you access, correct, export, and delete Customer Personal Data
          in your tenant, so that you can respond to Data Subjects exercising their rights under the DPA Act
          (including the rights to be informed, to access, to rectification, to erasure or blocking, to object,
          to data portability, and to damages). If we receive a request directly from one of your Data Subjects,
          we will not respond to it ourselves (except to confirm the request relates to you) and will refer it
          to you or forward it to you without undue delay.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Security Measures</h2>
        <p>Our security measures include, at a minimum:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Encryption of Personal Data in transit (TLS) and encryption of data at rest at the infrastructure layer;</li>
          <li>Logical tenant isolation and role-based access controls so that each Customer&rsquo;s data is separated and access is limited to authorized users;</li>
          <li>Authentication controls, least-privilege internal access, and audit logging of significant actions;</li>
          <li>Regular backups and a documented recovery process (see our <a className="text-[var(--accent)]" href="/legal/sla">Recovery SLA</a>);</li>
          <li>Vendor due diligence and data-processing agreements with sub-processors.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Security is a shared responsibility. You are responsible for configuring roles, permissions, and
          access within your tenant, for safeguarding user credentials and API keys, and for the security of
          the devices your users use to access the Service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Personal Data Breach</h2>
        <p>
          We maintain procedures to detect and respond to Personal Data Breaches affecting Customer Personal
          Data. On becoming aware of a Personal Data Breach involving Customer Personal Data, we will notify you
          without undue delay and, where feasible, within seventy-two (72) hours, providing the information
          reasonably available to help you assess the breach and meet your own notification obligations to the
          NPC and affected Data Subjects under NPC Circular 16-03. As the PIC, you are responsible for
          determining whether the breach is notifiable and for making any required notifications, with our
          reasonable assistance. Our notification of a breach is not an acknowledgment of fault or liability.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. Sub-processing</h2>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>You give us general authorization to engage sub-processors to help provide the Service. Our current sub-processors are listed on our <a className="text-[var(--accent)]" href="/legal/subprocessors">Sub-processors</a> page.</li>
          <li>We impose data-protection obligations on each sub-processor by written contract that are no less protective than those in this DPA, and we remain responsible to you for each sub-processor&rsquo;s performance of those obligations.</li>
          <li>We will give reasonable advance notice of any new sub-processor that will process Customer Personal Data. You may object on reasonable, good-faith data-protection grounds using the process on the Sub-processors page.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">9. Audit and Compliance</h2>
        <p>
          On reasonable written request, no more than once per year (unless required more frequently by the NPC
          or following a Personal Data Breach), we will make available information reasonably necessary to
          demonstrate our compliance with this DPA, such as summaries of our security measures and relevant
          third-party certifications or reports where available. Any on-site audit must be pre-arranged, conducted
          during business hours, subject to confidentiality, and carried out so as not to disrupt the Service or
          compromise the security or data of our other customers.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">10. Cross-Border Transfers</h2>
        <p>
          Some sub-processors operate outside the Philippines, principally in the United States. Where Customer
          Personal Data is transferred outside the Philippines, we ensure appropriate safeguards consistent with
          Section 21 of the DPA Act, including binding contractual commitments requiring protection comparable to
          that under Philippine law. Details are in Privacy Policy §7 and on the Sub-processors page.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">11. Return and Deletion of Data</h2>
        <p>
          On expiry or termination of your subscription, you may export Customer Personal Data using the
          Service&rsquo;s export features during the post-termination grace period stated in the Terms of Service.
          After that period, we will delete or anonymize Customer Personal Data in our production systems, except
          to the extent retention is required by law or is necessary for the establishment, exercise, or defense
          of legal claims. Residual copies in routine backups are deleted in accordance with our backup rotation
          schedule.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">12. Liability</h2>
        <p>
          Each party&rsquo;s liability arising out of or related to this DPA is subject to the exclusions and
          limitations of liability set out in the Terms of Service, and any reference to a party&rsquo;s
          liability means the aggregate liability of that party under the Terms of Service and this DPA together.
          Nothing in this DPA limits any liability that cannot be limited under applicable Philippine law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">13. Duration, Precedence, and Governing Law</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>This DPA remains in effect for as long as we process Customer Personal Data on your behalf.</li>
          <li>In the event of conflict, the order of precedence is: (1) this DPA, for matters concerning the processing of Personal Data; then (2) the Terms of Service; then (3) the Privacy Policy.</li>
          <li>This DPA is governed by the laws of the Republic of the Philippines, and disputes are subject to the governing-law and venue provisions of the Terms of Service.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">14. Contact</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Data Protection Officer: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Privacy: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Legal inquiries: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
        </div>
      </section>
    </article>
  );
}
