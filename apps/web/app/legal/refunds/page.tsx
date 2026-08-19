'use client';
import { Receipt } from 'lucide-react';

export default function RefundPolicyPage() {
  const lastUpdated = 'July 31, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <Receipt className="h-3.5 w-3.5" />
          Governed by Philippine Law
        </div>
        <h1 className="text-3xl font-bold mb-2">Refund &amp; Cancellation Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated} · Effective immediately
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. Scope</h2>
        <p>
          This Refund &amp; Cancellation Policy explains how subscription cancellations and refunds work for
          Clerque (the &ldquo;<strong>Service</strong>&rdquo;), operated by HNS Corporation Philippines
          (&ldquo;<strong>HNS Corp PH</strong>,&rdquo; &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>&rdquo;).
          It forms part of, and is incorporated into, our{' '}
          <a className="text-[var(--accent)]" href="/legal/terms">Terms of Service</a>, and expands on the fees
          and billing provisions there. If there is any conflict, the Terms of Service prevail. Nothing in this
          policy limits rights you may have under the Consumer Act of the Philippines (RA 7394) or other
          applicable law.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. How Billing Works</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>Clerque is a subscription service billed <strong>in advance</strong> on a monthly or annual cycle at the rate published when you subscribe or renew.</li>
          <li>Fees are stated exclusive of applicable taxes (VAT), which are added where required by law.</li>
          <li>Your subscription renews automatically for successive cycles until you cancel, unless your plan or order form states otherwise.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Cancelling Your Subscription</h2>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>You may cancel at any time from the in-app subscription page, or by writing to <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a>.</li>
          <li>Cancellation stops the <strong>next</strong> automatic renewal. Your subscription remains active until the end of the cycle you have already paid for, and you keep access until then.</li>
          <li>Cancelling does not, by itself, trigger a refund of fees already paid for the current cycle, except where a refund is required under Section 4, Section 5, or applicable law.</li>
          <li>You are responsible for exporting your data before access ends. As described in the Terms of Service, we retain your data for a limited grace period after termination during which you may export it.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Refunds — General Rule and Exceptions</h2>
        <p>
          Subscription fees are <strong>generally non-refundable</strong>, including for partial billing
          periods, periods of non-use, or downgrades, except in the following cases:
        </p>
        <ul className="list-disc pl-6 space-y-1 mt-2">
          <li><strong>Statutory rights.</strong> Where a refund is required under RA 7394 or other applicable Philippine law — for example, where the Service is found to be defective or not as described in a material respect and we are unable to remedy it within a reasonable time.</li>
          <li><strong>Duplicate or erroneous charges.</strong> If you are charged more than once for the same period, or charged in error, we will refund the excess.</li>
          <li><strong>Failure to deliver.</strong> If, after you subscribe, we are unable to provide the Service at all for the period paid and cannot restore it within a reasonable time, you may request a pro-rated refund for the affected period.</li>
          <li><strong>Written commitments.</strong> Any refund we expressly agree to in writing.</li>
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Refunds are not provided for downtime already addressed by service credits under our{' '}
          <a className="text-[var(--accent)]" href="/legal/sla">Recovery SLA</a>, for suspension or termination
          resulting from your breach of the Terms of Service or{' '}
          <a className="text-[var(--accent)]" href="/legal/acceptable-use">Acceptable Use Policy</a>, or for
          dissatisfaction that does not amount to a defect in the Service.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Upgrades, Downgrades, and Proration</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li><strong>Upgrades</strong> take effect immediately. The difference in fees is prorated and charged for the remainder of the current cycle.</li>
          <li><strong>Downgrades</strong> take effect at the start of the next billing cycle. We do not refund the difference for the current cycle; you keep the higher tier until the cycle ends.</li>
          <li>Add-ons (such as additional staff seats) follow the same proration approach as upgrades and downgrades.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Setup and One-Time Fees</h2>
        <p>
          One-time fees — such as onboarding, setup, data-migration, or accreditation-assistance fees — cover
          work performed for you and are <strong>non-refundable</strong> once the corresponding work has begun,
          except where required by law or expressly agreed in writing.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Free Trials and Promotional Offers</h2>
        <p>
          If we offer a free trial or promotional discount, the specific terms of that offer apply. Unless
          stated otherwise, no fee is charged during a free trial, and no refund is due for a trial. If you do
          not cancel before a trial converts to a paid subscription, the applicable fee becomes due for the
          first paid cycle in accordance with this policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. How to Request a Refund</h2>
        <ol className="list-decimal pl-6 space-y-1 mt-2">
          <li>Email <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a> with your account name, the charge date, the amount, and the reason for the request.</li>
          <li>We aim to acknowledge refund requests within 5 business days and to decide within 15 business days of receiving the information needed to assess the request.</li>
          <li>Approved refunds are issued to the original payment method through our payment provider. The time for the funds to appear depends on your bank or provider and is outside our control.</li>
          <li>Refunds are made in Philippine Pesos (PHP). Any currency-conversion differences applied by your bank or card issuer are not our responsibility.</li>
        </ol>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">9. Chargebacks</h2>
        <p>
          If you believe a charge is incorrect, please contact us first so we can resolve it quickly. Initiating
          a chargeback or payment dispute without contacting us may result in suspension of your account pending
          resolution. We reserve the right to contest chargebacks we believe are invalid and to recover amounts
          wrongfully charged back.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">10. Changes to This Policy</h2>
        <p>
          We may update this policy from time to time. Material changes will be notified in accordance with the
          amendment procedure in our Terms of Service and will apply to billing cycles beginning after the
          change takes effect.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">11. Contact</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Billing: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Customer support: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
        </div>
      </section>
    </article>
  );
}
