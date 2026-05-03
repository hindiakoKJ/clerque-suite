'use client';
import { useState } from 'react';
import { ArrowLeft, Check, Coffee, ChefHat, Monitor, Store, Snowflake, Cake, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { COFFEE_SHOP_LAYOUTS, type CoffeeShopTier } from '@repo/shared-types';

const STATION_ICONS: Record<string, React.ElementType> = {
  COUNTER:     Store,
  BAR:         Coffee,
  KITCHEN:     ChefHat,
  HOT_BAR:     Coffee,
  COLD_BAR:    Snowflake,
  PASTRY_PASS: Cake,
};

export default function FloorLayoutSetupPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();

  const [selectedTier, setSelectedTier] = useState<CoffeeShopTier | null>(null);
  const [cs1WithDisplay, setCs1WithDisplay] = useState(false);
  const [applying, setApplying] = useState(false);

  const canManage = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  if (!canManage) {
    return (
      <div className="flex items-center justify-center min-h-[70vh] text-sm text-muted-foreground">
        Only the business owner can configure the floor layout.
      </div>
    );
  }

  async function applyTier() {
    if (!selectedTier) return;
    setApplying(true);
    try {
      await api.post('/layouts/coffee-shop-tier', {
        tier: selectedTier,
        ...(selectedTier === 'CS_1' ? { customerDisplayOverride: cs1WithDisplay } : {}),
      });
      toast.success(`Layout set to ${COFFEE_SHOP_LAYOUTS[selectedTier].name}.`);
      qc.invalidateQueries({ queryKey: ['floor-layout'] });
      router.push('/settings/floor-layout');
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to apply layout.');
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      <div className="border-b border-border px-4 sm:px-6 py-4">
        <Link
          href="/settings/floor-layout"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </Link>
        <h1 className="text-lg font-semibold text-foreground">Choose your floor layout</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          We&rsquo;ll provision your stations, printers, and customer display from this template. You can rename them after.
        </p>
      </div>

      <div className="px-4 sm:px-6 py-6 space-y-3">
        {(Object.values(COFFEE_SHOP_LAYOUTS)).map((layout) => {
          const isSelected = selectedTier === layout.tier;
          return (
            <button
              key={layout.tier}
              onClick={() => setSelectedTier(layout.tier)}
              className={`w-full text-left rounded-2xl border p-4 sm:p-5 transition-all ${
                isSelected
                  ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                  : 'border-border bg-card hover:bg-muted/30'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {isSelected ? (
                    <div className="h-5 w-5 rounded-full flex items-center justify-center text-white" style={{ background: 'var(--accent)' }}>
                      <Check className="h-3 w-3" />
                    </div>
                  ) : (
                    <div className="h-5 w-5 rounded-full border border-border" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground">{layout.name}</h3>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {layout.tier}
                    </span>
                    {layout.queueStrategy === 'SHARED_FIFO' && (
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600">
                        SHARED FIFO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{layout.tagline}</p>

                  {/* Stations chip strip */}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {layout.stations.map((s) => {
                      const Icon = STATION_ICONS[s.kind] ?? Store;
                      return (
                        <span
                          key={s.kind}
                          className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-background border border-border text-foreground"
                        >
                          <Icon className="h-2.5 w-2.5" />
                          {s.defaultName}
                        </span>
                      );
                    })}
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      🖨 Receipt
                    </span>
                    {layout.cashierTablets > 1 && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        {layout.cashierTablets}× POS
                      </span>
                    )}
                    {layout.hasCustomerDisplay && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600">
                        <Monitor className="h-2.5 w-2.5" />
                        Customer Display
                      </span>
                    )}
                  </div>

                  {/* Examples */}
                  <p className="text-[11px] text-muted-foreground italic mt-3">
                    Examples: {layout.examples.join(' · ')}
                  </p>

                  {/* CS-1 customer display toggle (only on selected CS_1) */}
                  {isSelected && layout.tier === 'CS_1' && (
                    <div className="mt-4 pt-3 border-t border-border/50">
                      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                        <input
                          type="checkbox"
                          checked={cs1WithDisplay}
                          onChange={(e) => setCs1WithDisplay(e.target.checked)}
                          className="h-3.5 w-3.5"
                        />
                        Add a customer-facing display anyway
                      </label>
                      <p className="text-[10px] text-muted-foreground mt-1 ml-5">
                        Optional for solo counters. Helps if you want customers to see their cart in real time.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </button>
          );
        })}

        <div className="pt-4 flex gap-2">
          <Link
            href="/settings/floor-layout"
            className="flex-1 text-center py-2.5 text-sm font-medium border border-border rounded-xl text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancel
          </Link>
          <button
            onClick={applyTier}
            disabled={!selectedTier || applying}
            className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            {applying ? (
              'Applying…'
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Apply layout
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
