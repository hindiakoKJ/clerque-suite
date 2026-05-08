'use client';
/**
 * Public claim-stub page — UNAUTHENTICATED.
 *
 * Customer scans the QR on their paper ticket (or taps an SMS link) and lands
 * here. Shows order status, claim number, promised time, total, and (if the
 * customer is logged in their own way — they're not, this is anonymous)
 * loyalty progress. No login required.
 *
 * Uses the global axios client so it doesn't accidentally pull a token from
 * localStorage; falls back to a vanilla fetch if axios is configured to
 * inject Authorization headers.
 */
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2, Clock, Package, Sparkles, WashingMachine, Wind, Combine,
} from 'lucide-react';

interface PublicStub {
  claimNumber:    string;
  status:         'RECEIVED' | 'WASHING' | 'DRYING' | 'FOLDING' | 'READY_FOR_PICKUP' | 'CLAIMED' | 'CANCELLED';
  receivedAt:     string;
  promisedAt:     string | null;
  readyAt:        string | null;
  claimedAt:      string | null;
  totalAmount:    string;
  isDelivery:     boolean;
  deliveryStatus: string | null;
  tenant:   { name: string };
  branch:   { name: string };
  customer: { name: string; loyaltyVisits: number } | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function fetchStub(token: string): Promise<PublicStub> {
  // Bypass the auth-injecting axios client — this endpoint must be reachable
  // even when the visitor isn't logged in.
  const res = await fetch(`${API_URL}/stub/${encodeURIComponent(token)}`);
  if (!res.ok) {
    if (res.status === 404) throw new Error('STUB_NOT_FOUND');
    throw new Error('STUB_ERROR');
  }
  return res.json();
}

const STAGES = [
  { key: 'RECEIVED',         label: 'Received',  icon: Sparkles      },
  { key: 'WASHING',          label: 'Washing',   icon: WashingMachine },
  { key: 'DRYING',           label: 'Drying',    icon: Wind          },
  { key: 'FOLDING',          label: 'Folding',   icon: Combine       },
  { key: 'READY_FOR_PICKUP', label: 'Ready',     icon: Package       },
  { key: 'CLAIMED',          label: 'Claimed',   icon: CheckCircle2  },
] as const;

function fmtPeso(s: string | number) {
  return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(s));
}

export default function PublicStubPage() {
  const params = useParams<{ token: string }>();
  const token  = params?.token ?? '';

  const { data, isLoading, error } = useQuery<PublicStub>({
    queryKey: ['public-stub', token],
    queryFn:  () => fetchStub(token),
    enabled:  !!token,
    refetchInterval: 60_000, // tick every minute so a customer can leave the page open
    retry: 1,
  });

  if (isLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center text-muted-foreground text-sm">Loading your order…</div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <h1 className="text-lg font-semibold text-foreground">Stub not found</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This claim stub link is invalid or has expired. Ask the laundry counter for a reissue.
          </p>
        </div>
      </main>
    );
  }

  const cancelled = data.status === 'CANCELLED';
  const reachedIndex = cancelled
    ? -1
    : STAGES.findIndex((s) => s.key === data.status);

  return (
    <main className="min-h-screen bg-background">
      <div className="max-w-md mx-auto px-4 py-8">
        <header className="text-center mb-6">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{data.tenant.name}</p>
          <h1 className="text-2xl font-bold mt-1">{data.branch.name}</h1>
          <p className="font-mono text-sm text-muted-foreground mt-2">{data.claimNumber}</p>
          {data.customer && (
            <p className="text-sm text-foreground mt-1">{data.customer.name}</p>
          )}
        </header>

        {/* Stage tracker */}
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3">
          {cancelled ? (
            <div className="text-center py-4">
              <p className="text-sm font-semibold text-red-600">CANCELLED</p>
              <p className="text-xs text-muted-foreground mt-1">This order has been cancelled.</p>
            </div>
          ) : (
            <>
              {STAGES.map(({ key, label, icon: Icon }, i) => {
                const past   = reachedIndex > i;
                const here   = reachedIndex === i;
                return (
                  <div
                    key={key}
                    className={`flex items-center gap-3 px-2 py-2 rounded-lg transition-colors ${
                      here ? 'bg-[var(--accent-soft)]'
                          : past ? 'opacity-50'
                                  : 'opacity-30'
                    }`}
                  >
                    <Icon className={`w-5 h-5 ${here ? 'text-[var(--accent)]' : ''}`} />
                    <span className={`text-sm flex-1 ${here ? 'font-semibold text-foreground' : ''}`}>{label}</span>
                    {past && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    {here && <span className="text-[10px] uppercase tracking-wider font-bold text-[var(--accent)]">Now</span>}
                  </div>
                );
              })}
            </>
          )}
        </section>

        {/* Details */}
        <section className="rounded-2xl border border-border bg-card p-4 mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Total</span>
            <span className="font-semibold">{fmtPeso(data.totalAmount)}</span>
          </div>
          {data.promisedAt && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" /> Promised
              </span>
              <span>
                {new Date(data.promisedAt).toLocaleString('en-PH', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          )}
          {data.readyAt && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Ready since</span>
              <span>
                {new Date(data.readyAt).toLocaleString('en-PH', {
                  month: 'short', day: 'numeric',
                  hour: '2-digit', minute: '2-digit',
                })}
              </span>
            </div>
          )}
          {data.isDelivery && data.deliveryStatus && (
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Delivery</span>
              <span>{data.deliveryStatus.replace(/_/g, ' ').toLowerCase()}</span>
            </div>
          )}
        </section>

        {/* Loyalty punch-card */}
        {data.customer && data.customer.loyaltyVisits > 0 && (
          <section className="rounded-2xl border border-amber-300/60 bg-amber-50/60 dark:bg-amber-950/30 dark:border-amber-700 p-4 mt-4 text-center">
            <p className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-300 font-semibold">Loyalty</p>
            <p className="text-sm text-amber-900 dark:text-amber-200 mt-1">
              You've completed <strong>{data.customer.loyaltyVisits}</strong> visit{data.customer.loyaltyVisits === 1 ? '' : 's'}.
            </p>
            <div className="flex items-center justify-center gap-1 mt-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <span
                  key={i}
                  className={`w-3 h-3 rounded-full ${
                    i < (data.customer!.loyaltyVisits % 10)
                      ? 'bg-amber-500'
                      : 'border border-amber-400/40'
                  }`}
                />
              ))}
            </div>
            {data.customer.loyaltyVisits >= 10 && (data.customer.loyaltyVisits % 10 === 0) && (
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300 mt-2">
                🎉 Free wash unlocked! Show this screen at the counter.
              </p>
            )}
          </section>
        )}

        <p className="text-center text-[10px] text-muted-foreground mt-6">
          Refreshes every minute · Powered by Clerque
        </p>
      </div>
    </main>
  );
}
