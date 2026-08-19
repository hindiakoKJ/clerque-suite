'use client';
import { Cookie } from 'lucide-react';

export default function CookiePolicyPage() {
  const lastUpdated = 'July 31, 2026';

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <header className="mb-8">
        <div className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--accent)] bg-[var(--accent-soft)] rounded-full px-3 py-1 mb-3">
          <Cookie className="h-3.5 w-3.5" />
          Governed by Philippine Law
        </div>
        <h1 className="text-3xl font-bold mb-2">Cookie Policy</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: {lastUpdated} · Effective immediately
        </p>
      </header>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">1. About This Policy</h2>
        <p>
          This Cookie Policy explains how HNS Corporation Philippines (&ldquo;<strong>HNS Corp PH</strong>,&rdquo;
          &ldquo;<strong>we</strong>,&rdquo; &ldquo;<strong>us</strong>&rdquo;) uses cookies and similar
          technologies when you use Clerque (the &ldquo;<strong>Service</strong>&rdquo;). It supplements, and
          should be read together with, our <a className="text-[var(--accent)]" href="/legal/privacy">Privacy
          Policy</a>. Any personal data processed through these technologies is handled in accordance with the
          Privacy Policy and the Data Privacy Act of 2012 (RA 10173).
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">2. What Cookies and Similar Technologies Are</h2>
        <p>
          Cookies are small text files placed on your device by a website. &ldquo;Similar technologies&rdquo;
          include browser <em>local storage</em> and <em>session storage</em>, which the Service uses to store
          small amounts of information in your browser. We refer to all of these together as
          &ldquo;<strong>cookies</strong>&rdquo; in this policy.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">3. Our Approach: Essential Only</h2>
        <p>
          Clerque is a business tool, not an ad-supported website. We use only the cookies and storage
          necessary to sign you in, keep your session secure, and remember your in-app preferences. We do{' '}
          <strong>not</strong> use third-party advertising cookies, cross-site tracking, or advertising or
          analytics SDKs that build a profile of you for marketing.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">4. Categories of Cookies We Use</h2>

        <h3 className="text-sm font-semibold mt-3 mb-1">4.1 Strictly Necessary</h3>
        <p>
          Required for the Service to function. They enable authentication, keep your session active, protect
          against cross-site request forgery, and maintain security. The Service will not work correctly
          without them, so they cannot be switched off from within the app.
        </p>

        <h3 className="text-sm font-semibold mt-3 mb-1">4.2 Preferences</h3>
        <p>
          Remember choices you make to improve your experience — for example, your light/dark theme, your
          selected branch or terminal display, and similar interface settings. These are not used to track you
          across other sites.
        </p>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-xs border border-border rounded-lg">
            <thead className="bg-muted/40">
              <tr>
                <th className="text-left p-2 border-b border-border">Cookie / storage</th>
                <th className="text-left p-2 border-b border-border">Category</th>
                <th className="text-left p-2 border-b border-border">Purpose</th>
                <th className="text-left p-2 border-b border-border">Retention</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="p-2 border-b border-border align-top">Authentication / session token</td>
                <td className="p-2 border-b border-border align-top">Strictly necessary</td>
                <td className="p-2 border-b border-border align-top">Keeps you signed in and authorizes your requests</td>
                <td className="p-2 border-b border-border align-top">Session / until sign-out or expiry</td>
              </tr>
              <tr>
                <td className="p-2 border-b border-border align-top">Security / CSRF protection</td>
                <td className="p-2 border-b border-border align-top">Strictly necessary</td>
                <td className="p-2 border-b border-border align-top">Protects your session against cross-site request forgery</td>
                <td className="p-2 border-b border-border align-top">Session</td>
              </tr>
              <tr>
                <td className="p-2 border-b border-border align-top">Theme preference</td>
                <td className="p-2 border-b border-border align-top">Preferences</td>
                <td className="p-2 border-b border-border align-top">Remembers your light/dark mode choice</td>
                <td className="p-2 border-b border-border align-top">Persistent (local storage)</td>
              </tr>
              <tr>
                <td className="p-2 align-top">Branch / display selection</td>
                <td className="p-2 align-top">Preferences</td>
                <td className="p-2 align-top">Remembers the branch or terminal you last worked on</td>
                <td className="p-2 align-top">Persistent (local storage)</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Exact cookie and storage-key names may change as the Service evolves; the categories and purposes
          above describe how we use them.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">5. Third-Party Providers</h2>
        <p>
          We do not run third-party advertising or marketing trackers. Our infrastructure and error-monitoring
          providers (listed on our <a className="text-[var(--accent)]" href="/legal/subprocessors">Sub-processors</a>{' '}
          page) may set strictly-necessary cookies or collect limited technical information required to deliver
          and secure the Service. They are bound by data-processing agreements and do not use this information
          for their own advertising.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">6. Managing Cookies</h2>
        <ul className="list-disc pl-6 space-y-0.5 mt-2">
          <li>You can delete or block cookies through your browser settings. Most browsers also let you clear local and session storage.</li>
          <li>Because our cookies are strictly necessary or preference-based, blocking them may sign you out, prevent sign-in, or reset your preferences — but it will not expose you to advertising tracking, because we do not use it.</li>
          <li>We honor your browser&rsquo;s privacy controls where technically applicable. We do not sell personal information and do not track you across other websites, so &ldquo;Do Not Track&rdquo; signals do not change our behavior.</li>
        </ul>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">7. Changes to This Policy</h2>
        <p>
          We may update this Cookie Policy from time to time to reflect changes in the technologies we use or
          in the law. We will post the updated version here and revise the &ldquo;Last updated&rdquo; date
          above.
        </p>
      </section>

      <section className="mb-8">
        <h2 className="text-lg font-semibold mb-2">8. Contact</h2>
        <div className="bg-muted/30 border border-border rounded-lg p-4 text-sm">
          <p className="font-medium">HNS Corporation Philippines</p>
          <p>Privacy: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
          <p>Customer support: <a className="text-[var(--accent)]" href="mailto:devsupport@hnscorpph.com">devsupport@hnscorpph.com</a></p>
        </div>
      </section>
    </article>
  );
}
