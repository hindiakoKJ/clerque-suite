'use client';
/**
 * Sprint 25 Phase 2A — Receipt Customization (tier-gated).
 *
 * Reads the tenant's `receiptCustomization` plan feature (one of 'none' |
 * 'headerFooter' | 'full') and renders one of three views:
 *
 *   'none'         → upsell card pointing to Settings → Subscription.
 *   'headerFooter' → editable header + footer text fields; logo upload hidden.
 *   'full'         → header + footer text. The logo is NOT set here any more:
 *                    it used to be saved as an inline data: image, which rode
 *                    in the login token and could overflow the session cookie.
 *                    The business owner uploads it in Settings → Business
 *                    Profile (POST /tenant/logo), and the API now refuses a
 *                    data: logo on this route.
 *
 * Writes go to PATCH /tenant/receipt-config which enforces the same tier
 * defense-in-depth on the server.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type { JwtPayload } from '@repo/shared-types';

type Tier = 'none' | 'headerFooter' | 'full';

interface TenantProfile {
  receiptHeaderNote?: string | null;
  receiptFooterNote?: string | null;
}

const HEADER_MAX = 200;
const FOOTER_MAX = 300;

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function ReceiptCustomizationPage() {
  const user = useAuthStore((s) => s.user) as JwtPayload | null;
  const qc = useQueryClient();
  const tier: Tier = (user?.planFeatures?.receiptCustomization as Tier | undefined) ?? 'none';

  const { data: profile, isLoading } = useQuery<TenantProfile>({
    queryKey: ['tenant-profile-receipt'],
    queryFn: () => api.get('/tenant/profile').then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      setHeader(profile.receiptHeaderNote ?? '');
      setFooter(profile.receiptFooterNote ?? '');
    }
  }, [profile]);

  async function handleSave() {
    setSaving(true);
    try {
      // Header and footer only. Leaving logoUrl out keeps the uploaded logo.
      const body: { headerNote?: string | null; footerNote?: string | null } = {
        headerNote: header.trim() || null,
        footerNote: footer.trim() || null,
      };
      await api.patch('/tenant/receipt-config', body);
      toast.success('Receipt customization saved.');
      qc.invalidateQueries({ queryKey: ['tenant-profile-receipt'] });
      qc.invalidateQueries({ queryKey: ['tenant-profile'] });
    } catch (err: unknown) {
      const data = (err as { response?: { data?: { code?: string; message?: string | string[] } } })?.response?.data;
      // Validation errors come back as a list of messages; show the first one.
      const message = Array.isArray(data?.message) ? data?.message[0] : data?.message;
      toast.error(message || 'Failed to save receipt customization.');
    } finally {
      setSaving(false);
    }
  }

  // ── 'none' tier — upsell card ────────────────────────────────────────────
  if (tier === 'none') {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <h1 className="text-xl font-semibold text-foreground mb-4">Receipt Customization</h1>
        <div className="rounded-2xl border border-border bg-muted/30 p-6 text-center">
          <Lock className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <h2 className="font-semibold text-foreground mb-1">Not included on your plan</h2>
          <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
            Your current plan prints the default Clerque receipt. Upgrade to Solo Standard for header + footer text, or
            Solo Pro for full customization including your logo.
          </p>
          <a
            href="/settings/subscription"
            className="inline-flex items-center gap-2 text-white rounded-lg px-4 py-2 text-sm font-medium"
            style={{ background: 'var(--accent)' }}
          >
            <Sparkles className="h-3.5 w-3.5" />
            View upgrade options
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-foreground">Receipt Customization</h1>
        <span
          className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
          title="Your current receipt customization tier"
        >
          {tier === 'full' ? 'Full (header + footer + logo)' : 'Header + footer only'}
        </span>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-5">
          {/* Header text */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Receipt header (printed above the line items)
            </label>
            <textarea
              rows={2}
              value={header}
              maxLength={HEADER_MAX}
              onChange={(e) => setHeader(e.target.value)}
              className={INPUT_CLS}
              placeholder="e.g. Thank you for choosing Bean &amp; Brew Café"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">{header.length}/{HEADER_MAX}</p>
          </div>

          {/* Footer text */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Receipt footer (printed below the totals)
            </label>
            <textarea
              rows={3}
              value={footer}
              maxLength={FOOTER_MAX}
              onChange={(e) => setFooter(e.target.value)}
              className={INPUT_CLS}
              placeholder="e.g. Open daily 7am–9pm · Follow us @beanandbrew"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">{footer.length}/{FOOTER_MAX} · multi-line OK</p>
          </div>

          {/* Logo — uploaded by the business owner in Settings, not here. */}
          {tier === 'full' && (
            <p className="text-xs text-muted-foreground">
              The receipt logo is uploaded by the business owner in Settings → Business Profile → Business Logo.
            </p>
          )}

          <div className="pt-2 flex gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="hover:opacity-90 disabled:opacity-60 text-white rounded-lg px-4 py-2 text-sm font-medium transition-opacity"
              style={{ background: 'var(--accent)' }}
            >
              {saving ? 'Saving…' : 'Save Receipt Customization'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
