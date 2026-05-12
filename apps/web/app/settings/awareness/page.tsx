'use client';

/**
 * Security Awareness — Staff Handbook (owner-readable).
 *
 * Renders the same content as docs/SECURITY_AWARENESS.md (D9-01).
 * The markdown file is the canonical source; this page is the in-product
 * view. Keep both in sync when content changes.
 */

import Link from 'next/link';
import { ChevronLeft, ShieldCheck, AlertTriangle, KeyRound, Smartphone, Wifi, Eye, BookOpen } from 'lucide-react';
import { useAuthStore } from '@/store/auth';

export default function SecurityAwarenessPage() {
  const { user } = useAuthStore();
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  if (!isOwner) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Only the business owner can view the security-awareness handbook.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <Link
          href="/settings"
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
        >
          <ChevronLeft className="h-3 w-3" /> Settings
        </Link>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <BookOpen className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          Security Awareness — Staff Handbook
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Hand this to every person who logs into Clerque on your behalf. Written for
          non-technical staff. You remain accountable for what your team does with the system —
          this handbook helps them not get burned.
        </p>
      </div>

      <div className="flex-1 p-4 sm:p-6 max-w-3xl mx-auto w-full space-y-6">

        <Section icon={AlertTriangle} title="1. Phishing — how to spot a fake email or message">
          <p>Filipino businesses are aggressively targeted. Watch out for:</p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>
              <strong>BIR-themed scams.</strong> &ldquo;Your TIN has been flagged&rdquo; / &ldquo;Pay BIR penalty
              via this link.&rdquo; The real BIR never collects payment by email link. If in doubt,
              log into eFPS directly.
            </li>
            <li>
              <strong>Fake Clerque emails.</strong> We only send from <code>@clerque.ph</code> and
              <code> @hnscorpph.com</code>. Anything else is fake. We will <strong>never</strong>{' '}
              ask for your password.
            </li>
            <li>
              <strong>Supplier-impersonation bills.</strong> Someone emails an &ldquo;updated bank
              account&rdquo; for a vendor you actually pay. Always confirm by phone using the number
              on the vendor&apos;s <em>previous</em> invoice, not the one in the new email.
            </li>
            <li>
              <strong>Urgency + threats</strong> are the tell. Real institutions give you days, not
              minutes.
            </li>
          </ul>
          <p className="mt-2">
            When unsure: forward to <strong>support@clerque.ph</strong> and do nothing else.
          </p>
        </Section>

        <Section icon={KeyRound} title="2. Password hygiene">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Use a passphrase, not a password.</strong> Four random words is stronger
              than <code>P@ssw0rd!</code> and easier to remember. Example: <code>mango-staple-river-eight</code>.
            </li>
            <li><strong>At least 12 characters.</strong> Anything shorter is brute-forceable.</li>
            <li>
              <strong>Never share.</strong> Not with your boss, not with &ldquo;Clerque support,&rdquo; not
              with your cousin who knows computers. Sharing a password means sharing the legal
              liability.
            </li>
            <li>
              <strong>One password per service.</strong> Use a password manager (Bitwarden,
              1Password, the built-in browser one is acceptable).
            </li>
            <li>
              <strong>Enable MFA</strong> in Settings → Security &amp; 2FA. Single biggest reduction
              in account-takeover risk.
            </li>
          </ul>
        </Section>

        <Section icon={ShieldCheck} title="3. Supervisor PIN — treat it like a key">
          <p>
            The supervisor PIN authorises voids and over-threshold discounts at the POS. It is
            4–8 digits and therefore short. Rules:
          </p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>Never write it on a sticker on the register.</li>
            <li>Never tell a cashier &ldquo;just punch in mine.&rdquo;</li>
            <li>Rotate every <strong>quarter</strong> (3 months) and any time a manager leaves.</li>
            <li>Do not use <code>1234</code>, <code>0000</code>, or your birthday.</li>
          </ul>
          <p className="mt-2">
            If you suspect the PIN is known by someone who shouldn&apos;t have it, change it the same
            day from Settings → Security.
          </p>
        </Section>

        <Section icon={Smartphone} title="4. Lost or stolen device — first 30 minutes">
          <ol className="list-decimal pl-6 space-y-1">
            <li>
              <strong>Email the business owner immediately.</strong> Mention what device, last
              location, what was logged in.
            </li>
            <li>
              <strong>Mass-revoke all sessions</strong> from Settings → Security → &ldquo;Sign out all
              devices.&rdquo; Invalidates every JWT, forcing re-login.
            </li>
            <li><strong>Change the password</strong> of every account that was signed in on that device.</li>
            <li><strong>Change the supervisor PIN</strong> if the device was a POS or had POS access.</li>
            <li>File a police blotter for insurance / liability — yes, even for a tablet.</li>
          </ol>
        </Section>

        <Section icon={Smartphone} title="5. Bring-your-own-device (personal phone / laptop)">
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Lock screen on.</strong> Auto-lock after 1 minute. PIN, fingerprint, or face.</li>
            <li>
              <strong>Full-disk encryption on.</strong> iPhone and modern Android: on by default.
              Windows: turn on BitLocker. Mac: turn on FileVault.
            </li>
            <li>
              <strong>Do not install random APKs or browser extensions.</strong> Most common
              malware vectors in PH.
            </li>
            <li><strong>No screenshots of customer data</strong> sent to personal chats.</li>
          </ul>
          <p className="mt-2">
            If a personal device is later sold, traded, or repaired: sign out of Clerque first,
            and factory-reset before handing it over.
          </p>
        </Section>

        <Section icon={Wifi} title="6. Public WiFi">
          <p>
            Avoid logging into Clerque from coffee-shop or mall WiFi. If you must:
          </p>
          <ul className="list-disc pl-6 space-y-1 mt-2">
            <li>Use your phone&apos;s <strong>hotspot</strong> instead. Almost always faster anyway.</li>
            <li>
              Or use a reputable <strong>VPN</strong> (Mullvad, ProtonVPN, the one in 1Password
              / Apple Private Relay).
            </li>
            <li>Never on an unencrypted &ldquo;Free WiFi&rdquo; with no password.</li>
          </ul>
        </Section>

        <Section icon={Eye} title="7. Sensitive data on screen">
          <ul className="list-disc pl-6 space-y-1">
            <li>
              <strong>Lock the screen when you step away.</strong> Even for a coffee run.
              Windows: <code>Win + L</code>. Mac: <code>Ctrl + Cmd + Q</code>.
            </li>
            <li><strong>Don&apos;t leave Clerque open on a shared computer.</strong> Sign out fully.</li>
            <li>
              <strong>Don&apos;t print reports to a shared printer</strong> without picking them up
              immediately. BIR books and payroll registers belong in a locked drawer.
            </li>
            <li>
              <strong>Customer TIN, names, and contact info are SENSITIVE PII</strong> under the
              Data Privacy Act (RA 10173). Treat them with the same care as cash.
            </li>
          </ul>
        </Section>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold text-foreground mb-2">When in doubt</h2>
          <p className="text-sm text-muted-foreground">
            Email <strong>support@clerque.ph</strong> before you click, share, or pay. We would
            rather answer a hundred &ldquo;is this real?&rdquo; emails than clean up one breach.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({
  icon: Icon, title, children,
}: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <section className="bg-card border border-border rounded-xl p-5 space-y-2">
      <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {title}
      </h2>
      <div className="text-sm text-muted-foreground leading-relaxed space-y-1">
        {children}
      </div>
    </section>
  );
}
