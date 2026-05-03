'use client';
import { FileText } from 'lucide-react';

export default function TermsOfServicePage() {
  const lastUpdated = 'May 3, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <FileText className="h-3.5 w-3.5" />
          Governed by Philippine Law
        </div>
        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated} · Effective immediately
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. Agreement to Terms</h2>
        <p>
          These Terms of Service (&ldquo;<strong>Terms</strong>&rdquo;) constitute a legally binding
          agreement between you (&ldquo;<strong>Customer</strong>,&rdquo; &ldquo;<strong>you</strong>&rdquo;)
          and HNS Corporation Philippines (&ldquo;<strong>HNS Corp PH</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo;
          &ldquo;<strong>us</strong>&rdquo;) governing your access to and use of Clerque, including the
          web application, mobile applications, APIs, and associated services (collectively, the
          &ldquo;<strong>Service</strong>&rdquo;).
        </p>
        <p className="mt-2">
          By creating an account, accessing, or using the Service, you agree to be bound by these Terms.
          If you do not agree, you must not use the Service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. The Service</h2>
        <p>
          Clerque is a cloud-based business management platform comprising:
        </p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li><strong>Counter (POS)</strong> — point-of-sale terminal, inventory management, and shift management</li>
          <li><strong>Ledger</strong> — chart of accounts, journal entries, financial statements, period-close, and BIR tax estimation</li>
          <li><strong>Sync (Payroll)</strong> — staff records, time attendance, and payroll workflows</li>
          <li><strong>Console</strong> — platform administration tools (super-admin only)</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Eligibility</h2>
        <p>
          You must be at least 18 years old and legally authorized to enter into contracts under
          Philippine law to use the Service. By using the Service, you represent that you meet these
          requirements and that all registration information you provide is accurate and complete.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Account Registration and Security</h2>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
          <li>You must immediately notify us of any unauthorized access or breach.</li>
          <li>You are responsible for all activity that occurs under your account.</li>
          <li>Each authorized user (staff member) must use their own unique account; sharing credentials is prohibited.</li>
          <li>We reserve the right to suspend accounts showing suspicious activity pending investigation.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Subscription, Fees, and Billing</h2>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>The Service is offered in tiered subscription plans (TIER_1 through TIER_6) with different feature sets and staff capacity.</li>
          <li>Fees are billed in advance on a monthly or annual basis at the rate published at the time of subscription.</li>
          <li>All fees are exclusive of applicable taxes (VAT) which will be added where required by law.</li>
          <li>Payment is due upon receipt of invoice. Accounts unpaid for more than 30 days may be moved to GRACE status; accounts unpaid for more than 60 days may be SUSPENDED.</li>
          <li>Subscription tier upgrades take effect immediately with prorated charges; downgrades take effect at the next billing cycle.</li>
          <li>Subject to applicable consumer protection law, fees paid are non-refundable except as expressly provided in writing.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Customer Responsibilities</h2>
        <p>You acknowledge and agree that you are solely responsible for:</p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li>The accuracy, completeness, and legality of all data you input into the Service (products, prices, transactions, customer data, payroll data, etc.)</li>
          <li>Compliance with all applicable Philippine tax laws, including but not limited to BIR registration, accreditation of any Computerized Accounting System or POS as required, issuance of Sales Invoices and Official Receipts, and timely filing of tax returns</li>
          <li>Compliance with the Data Privacy Act of 2012 (RA 10173) regarding the personal data you collect from your customers and staff</li>
          <li>Compliance with labor and employment laws for the staff members you create accounts for</li>
          <li>Maintaining your own backup of business records as required by law</li>
          <li>Configuring access controls (roles, permissions, branch assignments) appropriate to your business operations</li>
          <li>Ensuring you have authority to provide any third-party data (employee, customer, vendor) you upload to the Service</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Acceptable Use</h2>
        <p>You agree NOT to:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Use the Service for any illegal purpose or in violation of any law</li>
          <li>Submit false, fraudulent, or misleading data (including falsified BIR records or fictitious transactions)</li>
          <li>Reverse-engineer, decompile, or attempt to derive source code of the Service</li>
          <li>Probe, scan, or test the vulnerability of the Service except as authorized in writing</li>
          <li>Circumvent authentication, authorization, or access controls</li>
          <li>Use the Service to transmit malicious code, spam, or harmful content</li>
          <li>Resell, sublicense, or provide the Service to third parties as a service of your own</li>
          <li>Use automated tools to scrape data or place excessive load on the Service</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. Intellectual Property</h2>
        <h3 className="text-sm font-semibold mt-3 mb-1">8.1 Our IP</h3>
        <p>
          The Service, including all software, designs, trademarks (Clerque, Counter, Ledger, Sync,
          HNS Corp PH), logos, and content authored by us, is owned by HNS Corporation Philippines and
          protected by Philippine copyright, trademark, and intellectual property laws. We grant you a
          limited, non-exclusive, non-transferable, revocable license to use the Service solely for your
          internal business operations during the subscription term.
        </p>
        <h3 className="text-sm font-semibold mt-3 mb-1">8.2 Your Data</h3>
        <p>
          You retain ownership of all business data you upload to the Service. You grant us a limited
          license to host, store, process, and transmit such data solely for the purpose of providing
          the Service to you, and as required by law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">9. Service Availability</h2>
        <p>
          We aim for 99.5% monthly uptime, excluding scheduled maintenance windows announced in advance.
          The Service may be subject to interruption due to events beyond our reasonable control,
          including network outages, hosting-provider failures, or force majeure. Offline mode is
          provided in the POS terminal to mitigate connectivity disruptions, but you accept the
          inherent risk of cloud-based services.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">10. Disclaimer of Warranties</h2>
        <p className="uppercase text-xs">
          Except as expressly stated in these Terms, the Service is provided &ldquo;<strong>as is</strong>&rdquo; and
          &ldquo;<strong>as available</strong>,&rdquo; without warranty of any kind, whether express,
          implied, or statutory, including warranties of merchantability, fitness for a particular
          purpose, accuracy, or non-infringement, to the maximum extent permitted by law.
        </p>
        <p className="mt-2">
          Clerque is a record-keeping and computational tool. We do not provide tax, accounting, legal,
          or financial advice. Reports, BIR-form data extractions, payroll computations, and other
          outputs of the Service should be reviewed by a qualified professional before reliance or
          submission to government authorities.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">11. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by Philippine law, in no event shall HNS Corp PH, its
          officers, employees, or agents be liable for any indirect, incidental, special,
          consequential, or punitive damages, including but not limited to loss of profits, revenue,
          data, business opportunity, or goodwill, arising out of or relating to your use of the
          Service, regardless of the legal theory.
        </p>
        <p className="mt-2">
          Our total cumulative liability for any claim arising under these Terms shall not exceed the
          fees you actually paid us for the Service during the 12 months immediately preceding the
          event giving rise to the claim.
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing in these Terms limits liability that cannot be limited under applicable Philippine
          law, such as liability arising from gross negligence, willful misconduct, or fraud.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">12. Indemnification</h2>
        <p>
          You agree to defend, indemnify, and hold harmless HNS Corp PH and its officers, employees,
          and agents from any claims, damages, losses, liabilities, and expenses (including reasonable
          attorneys&rsquo; fees) arising out of or related to: (a) your violation of these Terms;
          (b) your violation of any law or third-party right; (c) your data or business records;
          (d) any tax assessment, penalty, or surcharge imposed on you by any government authority.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">13. Suspension and Termination</h2>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>You may cancel your subscription at any time from the in-app subscription page or by writing to support.</li>
          <li>We may suspend or terminate your access immediately, without notice, if you breach these Terms, fail to pay overdue fees, or engage in conduct we reasonably believe is harmful to our Service or users.</li>
          <li>Upon termination, your access to the Service ends. We will retain your data for a 90-day grace period during which you may export it; after this period, data will be deleted or anonymized except as required by retention obligations under our Privacy Policy.</li>
          <li>Provisions of these Terms that by their nature should survive termination (including IP, indemnity, limitation of liability, governing law) will survive.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">14. Modifications to Service and Terms</h2>
        <p>
          We may modify or discontinue features of the Service at any time. We will give reasonable
          advance notice of material changes that adversely affect existing customers. We may also
          amend these Terms; we will notify you of material changes at least 30 days in advance via
          email or in-app banner. Continued use of the Service after the effective date constitutes
          acceptance of the amended Terms.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">15. Governing Law and Dispute Resolution</h2>
        <p>
          These Terms are governed by the laws of the Republic of the Philippines without regard to
          conflict-of-law principles. Any dispute arising out of or relating to these Terms or the
          Service shall be exclusively resolved by the proper courts of Pasig City, Metro Manila,
          Philippines, to the exclusion of all other venues.
        </p>
        <p className="mt-2">
          Before filing a lawsuit, the parties agree to first attempt good-faith resolution through
          written notice and a 30-day negotiation period. Nothing in this section prevents either
          party from seeking injunctive relief in any competent court to protect intellectual-property
          rights or confidential information.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">16. Force Majeure</h2>
        <p>
          Neither party is liable for failure or delay in performance caused by events beyond
          reasonable control, including acts of God, natural disasters, pandemics, war, civil unrest,
          government action, internet or telecommunication failures, or hosting-provider outages.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">17. Severability and Entire Agreement</h2>
        <p>
          If any provision of these Terms is held invalid or unenforceable, the remaining provisions
          remain in full force. These Terms, together with the Privacy Policy and any subscription or
          order form, constitute the entire agreement between the parties and supersede prior
          agreements on the same subject matter.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">18. Contact</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Customer support: <a className="text-[var(--accent)]" href="mailto:support@hnscorpph.com">support@hnscorpph.com</a></p>
          <p>Legal inquiries: <a className="text-[var(--accent)]" href="mailto:legal@hnscorpph.com">legal@hnscorpph.com</a></p>
          <p>Privacy: <a className="text-[var(--accent)]" href="mailto:privacy@hnscorpph.com">privacy@hnscorpph.com</a></p>
        </div>
      </section>
    </article>
  );
}
