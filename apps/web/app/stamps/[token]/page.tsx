'use client';
/**
 * Sprint 19 — Public stamp card page (UNAUTHENTICATED).
 *
 * Customer scans the QR on a printed receipt-card or follows an SMS link,
 * and sees their digital stamp card on any phone — no login required.
 * Same source-of-truth as the in-app card; the printed paper card and the
 * digital pull-up are interchangeable.
 *
 * URL forms:
 *   /stamps/<token>            → mobile-friendly digital card
 *   /stamps/<token>?print=1    → 80mm thermal-receipt-shaped print layout
 *                                (used by the "Print card" button in the
 *                                 staff modal — opens in a new window;
 *                                 staff prints from browser print dialog)
 */
import { useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Stamp as StampIcon, CheckCircle2 } from 'lucide-react';

interface PublicCard {
  templateName:        string;
  rewardLabel:         string;
  requiredStamps:      number;
  stamps:              number;
  redemptionCount:     number;
  lastEarnedAt:        string | null;
  customerName:        string;
  tenantBusinessName:  string | null;
  tenantLogoUrl:       string | null;
  tenantId:            string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

async function fetchCard(token: string): Promise<PublicCard> {
  // Bypass the auth-injecting axios client — anonymous endpoint.
  const res = await fetch(`${API_URL}/stamps/${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Card not found.' : 'Failed to load card.');
  return res.json();
}

export default function PublicStampCardPage() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const token        = String(params.token ?? '');
  const printMode    = searchParams.get('print') === '1';

  const { data, isLoading, error } = useQuery<PublicCard>({
    queryKey: ['public-stamp', token],
    queryFn:  () => fetchCard(token),
    enabled:  !!token,
    retry:    false,
  });

  // Auto-fire the browser print dialog when ?print=1.
  useEffect(() => {
    if (printMode && data && typeof window !== 'undefined') {
      // Slight delay so the QR/layout finishes rendering.
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [printMode, data]);

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-slate-500">Loading…</div>;
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-sm text-center space-y-2">
          <div className="text-3xl">😕</div>
          <h1 className="text-lg font-semibold">Card not found</h1>
          <p className="text-sm text-slate-500">
            This link doesn't match any active stamp card. If you think this is wrong, ask the
            shop to re-share the link.
          </p>
        </div>
      </div>
    );
  }

  const ready    = data.stamps >= data.requiredStamps;
  const cellsRow = Math.min(data.requiredStamps, 5); // visual layout; rows wrap

  // ── Print layout (thermal-receipt shaped) ──────────────────────────────
  if (printMode) {
    return (
      <div className="min-h-screen bg-white text-black flex justify-center p-4">
        <style>{`
          @page { size: 80mm auto; margin: 4mm; }
          @media print {
            body { background: white; }
            .no-print { display: none !important; }
          }
        `}</style>
        <div className="w-[72mm] py-3 font-mono text-[12px] leading-snug">
          <div className="text-center space-y-0.5">
            {data.tenantLogoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.tenantLogoUrl} alt="logo" className="h-10 mx-auto mb-1" />
            )}
            <div className="font-bold text-[14px]">{data.tenantBusinessName ?? 'Stamp Card'}</div>
            <div className="text-[10px]">— Loyalty Card —</div>
          </div>
          <div className="my-2 border-t border-dashed border-black"></div>
          <div className="text-center font-bold uppercase">{data.templateName}</div>
          <div className="text-center text-[11px]">Reward: {data.rewardLabel}</div>
          <div className="my-2 border-t border-dashed border-black"></div>

          <div className="text-[11px] mb-1">Customer: {data.customerName}</div>

          {/* Stamps grid */}
          <div className="grid grid-cols-5 gap-1 my-2 justify-items-center">
            {Array.from({ length: data.requiredStamps }).map((_, i) => (
              <div
                key={i}
                className={`h-7 w-7 rounded-full border border-black flex items-center justify-center text-[11px] ${
                  i < data.stamps ? 'bg-black text-white' : ''
                }`}
              >
                {i < data.stamps ? '★' : i + 1}
              </div>
            ))}
          </div>

          <div className="text-center text-[11px] mb-2">
            {data.stamps} / {data.requiredStamps} stamps
            {data.redemptionCount > 0 && ` · ${data.redemptionCount} reward(s) claimed`}
          </div>

          <div className="my-2 border-t border-dashed border-black"></div>

          {/* QR */}
          <div className="flex flex-col items-center gap-1 my-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(
                typeof window !== 'undefined' ? window.location.href.split('?')[0] : ''
              )}`}
              alt="QR — scan to view your stamps online"
              className="h-32 w-32"
            />
            <div className="text-[10px] text-center">Scan to view your stamps online — no app needed</div>
          </div>

          <div className="my-2 border-t border-dashed border-black"></div>
          <div className="text-center text-[10px]">Bring this card on every visit · Powered by Clerque</div>

          <div className="no-print mt-4 text-center">
            <button
              onClick={() => window.print()}
              className="rounded border border-black px-3 py-1 text-[12px]"
            >
              Print again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Mobile-friendly digital card ──────────────────────────────────────
  void cellsRow;
  return (
    <div className="min-h-screen bg-gradient-to-b from-amber-50 to-white dark:from-slate-900 dark:to-slate-950 px-4 py-8">
      <div className="max-w-sm mx-auto space-y-4">
        <div className="text-center space-y-1">
          {data.tenantLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.tenantLogoUrl} alt="" className="h-12 mx-auto mb-2" />
          ) : (
            <StampIcon className="h-10 w-10 mx-auto text-amber-600 dark:text-amber-400" />
          )}
          {data.tenantBusinessName && (
            <h1 className="text-lg font-semibold text-slate-800 dark:text-slate-100">
              {data.tenantBusinessName}
            </h1>
          )}
        </div>

        <div className="rounded-2xl bg-white dark:bg-slate-900 shadow-lg border border-amber-200 dark:border-slate-800 p-5 space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-amber-700 dark:text-amber-400 font-semibold">
              {data.templateName}
            </div>
            <div className="text-base text-slate-700 dark:text-slate-200 mt-0.5">
              <span className="text-slate-500 dark:text-slate-400">Reward:</span> {data.rewardLabel}
            </div>
          </div>

          <div className="text-sm text-slate-600 dark:text-slate-300">
            Hello, <span className="font-semibold">{data.customerName}</span>
          </div>

          {/* Stamps grid */}
          <div className="flex flex-wrap gap-2 justify-center">
            {Array.from({ length: data.requiredStamps }).map((_, i) => (
              <div
                key={i}
                className={`h-10 w-10 rounded-full border-2 flex items-center justify-center text-xs font-semibold ${
                  i < data.stamps
                    ? 'bg-amber-500 border-amber-500 text-white'
                    : 'border-amber-200 dark:border-slate-700 text-slate-400'
                }`}
              >
                {i < data.stamps ? '★' : i + 1}
              </div>
            ))}
          </div>

          <div className="text-center text-sm text-slate-600 dark:text-slate-300">
            <span className="font-semibold text-amber-600 dark:text-amber-400">{data.stamps}</span> / {data.requiredStamps} stamps earned
          </div>

          {ready && (
            <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-3 py-2 flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              <span>Reward ready — show this card at the till to redeem.</span>
            </div>
          )}

          {data.redemptionCount > 0 && (
            <div className="text-center text-xs text-slate-500 dark:text-slate-400">
              You've claimed {data.redemptionCount} reward{data.redemptionCount === 1 ? '' : 's'} on this card.
            </div>
          )}

          {data.lastEarnedAt && (
            <div className="text-center text-[11px] text-slate-400">
              Last stamp earned {new Date(data.lastEarnedAt).toLocaleDateString()}
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-slate-400">
          Bookmark this page or save it to your home screen.
        </p>
      </div>
    </div>
  );
}
