'use client';
import { ShieldAlert } from 'lucide-react';

export default function AcceptableUsePolicyPage() {
  const lastUpdated = 'July 31, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <ShieldAlert className="h-3.5 w-3.5" />
          Governed by Philippine Law
        </div>
        <h1 className="text-3xl font-bold mb-2">Acceptable Use Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated} · Effective immediately
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. Purpose and Scope</h2>
        <p>
          This Acceptable Use Policy (&ldquo;<strong>AUP</strong>&rdquo;) sets out the rules that govern
          your use of Clerque and all associated web applications, mobile applications, APIs, and services
          (collectively, the &ldquo;<strong>Service</strong>&rdquo;) operated by HNS Corporation Philippines
          (&ldquo;<strong>HNS Corp PH</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>&rdquo;).
          This AUP forms part of, and is incorporated by reference into, our{' '}
          <a className="text-[var(--accent)]" href="/legal/terms">Terms of Service</a>. Capitalized terms not
          defined here have the meaning given in the Terms of Service. If there is any conflict between this
          AUP and the Terms of Service, the Terms of Service prevail.
        </p>
        <p className="mt-2">
          This AUP applies to every person who accesses the Service, including account owners, authorized
          staff users, administrators, and any person acting through API credentials issued to your account.
          You are responsible for ensuring that everyone who uses the Service under your account complies
          with this AUP.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. General Prohibited Conduct</h2>
        <p>You must not use the Service to:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Violate any applicable law, regulation, or ordinance of the Republic of the Philippines or of any jurisdiction that applies to you;</li>
          <li>Infringe the intellectual-property, privacy, publicity, or contractual rights of any person;</li>
          <li>Engage in fraud, deception, or misrepresentation, or facilitate any illegal scheme;</li>
          <li>Harass, threaten, defame, or harm any person, or transmit content that is unlawful, obscene, or abusive;</li>
          <li>Impersonate any person or entity, or misrepresent your affiliation with any person or entity;</li>
          <li>Interfere with any other customer&rsquo;s use and enjoyment of the Service.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Financial, Tax, and Record Integrity</h2>
        <p>
          Because Clerque is used to keep books of account, point-of-sale records, and payroll data, the
          integrity of the data you enter is critical. You must not:
        </p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Enter false, fictitious, or fraudulent transactions, sales, receipts, or expenses;</li>
          <li>Falsify, backdate, or manipulate accounting records, journal entries, inventory counts, shift reports, or tax-related figures with intent to evade tax or deceive any person or authority;</li>
          <li>Use the Service to produce records intended to misstate income, understate liabilities, or evade obligations owed to the Bureau of Internal Revenue (BIR), the Department of Labor and Employment (DOLE), or any other authority;</li>
          <li>Issue, or use the Service to issue, invoices or receipts you are not lawfully authorized to issue;</li>
          <li>Tamper with audit logs, sequence numbers, or system-generated controls designed to preserve record integrity.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Clerque is a record-keeping and computational tool and does not verify the truth of the data you
          enter. You remain solely responsible for the accuracy and legality of your records and for your own
          tax and regulatory compliance, as set out in the Terms of Service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Security and Systems Integrity</h2>
        <p>You must not:</p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Attempt to gain unauthorized access to the Service, other customers&rsquo; accounts or data, or any underlying systems, networks, or infrastructure;</li>
          <li>Circumvent, disable, or interfere with authentication, authorization, tenant-isolation, rate-limiting, or other security or access controls;</li>
          <li>Probe, scan, or test the vulnerability of the Service, or breach or otherwise defeat any security measure, except under a written authorization or a bug-bounty arrangement expressly agreed with us;</li>
          <li>Introduce or transmit any virus, worm, malware, ransomware, or other malicious or destructive code;</li>
          <li>Reverse-engineer, decompile, disassemble, or attempt to derive source code or underlying structure of the Service, except to the extent this restriction is prohibited by applicable law;</li>
          <li>Access the Service to build or benchmark a competing product, or to copy its features or user interface.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Data and Privacy Obligations</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>You must have a lawful basis and, where required, authority or consent to collect and upload any personal data of your customers, staff, or third parties into the Service.</li>
          <li>You must not upload personal data you are not authorized to process, and you must comply with the Data Privacy Act of 2012 (RA 10173) and its Implementing Rules as the Personal Information Controller for the data in your tenant.</li>
          <li>You must not use the Service to send unsolicited commercial messages (spam) or to harvest, scrape, or compile personal data in violation of law.</li>
          <li>You must not upload data that you know to be malicious, or that you are contractually or legally prohibited from disclosing to a cloud service.</li>
        </ul>
        <p className="mt-2">
          Our respective data-protection roles and obligations are set out in the{' '}
          <a className="text-[var(--accent)]" href="/legal/dpa">Data Processing Agreement</a> and{' '}
          <a className="text-[var(--accent)]" href="/legal/privacy">Privacy Policy</a>.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Fair Use, Automated Access, and APIs</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>You must not place an unreasonable or disproportionately large load on the Service, or use automated means to access the Service in a way that degrades performance for others.</li>
          <li>API access must stay within the rate limits and usage terms we publish or communicate to you. You are responsible for keeping API keys confidential and for all activity performed with them.</li>
          <li>You must not use the Service to operate a bureau, service, or platform that provides the Service&rsquo;s functionality to third parties who are not your own authorized users, except under a written reseller or partner agreement with us.</li>
          <li>You must not resell, sublicense, rent, or lease the Service, or share a single user account among multiple individuals.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Reporting Violations</h2>
        <p>
          If you become aware of any violation of this AUP, a security vulnerability, or misuse of the
          Service, please report it promptly to{' '}
          <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a>.
          We investigate reports in good faith and will not pursue action against good-faith security research
          conducted under a written authorization from us.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. Enforcement and Consequences</h2>
        <p>
          We may investigate suspected violations of this AUP and cooperate with law-enforcement or regulatory
          authorities. Where we reasonably believe a violation has occurred, or where necessary to protect the
          Service, our other customers, or any person, we may — with or without prior notice, and in our
          reasonable discretion — take any of the following actions:
        </p>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Issue a warning or require corrective action;</li>
          <li>Remove or disable access to offending content or data;</li>
          <li>Throttle, suspend, or restrict all or part of your access to the Service;</li>
          <li>Terminate your account and subscription in accordance with the Terms of Service;</li>
          <li>Report conduct to the BIR, the National Privacy Commission, law enforcement, or other authorities where required or appropriate.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Action we take under this AUP does not entitle you to any refund and does not limit any other right
          or remedy available to us under the Terms of Service or applicable law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">9. Changes to This Policy</h2>
        <p>
          We may update this AUP from time to time. Material changes will be notified in accordance with the
          amendment procedure in our Terms of Service. Your continued use of the Service after the effective
          date of a change constitutes acceptance of the updated AUP.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">10. Contact</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Abuse &amp; security: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Customer support: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Legal inquiries: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
        </div>
      </section>
    </article>
  );
}
