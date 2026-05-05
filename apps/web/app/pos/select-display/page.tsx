'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Coffee, Snowflake, ChefHat, Cake, Store, Monitor, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

/**
 * Station picker for KIOSK_DISPLAY accounts.
 *
 * These accounts are credentials for hardware tablets (Bar KDS, Kitchen KDS,
 * Customer Display) — not real employees. They sign in once, then bookmark
 * the specific URL for their station. This page is the in-between landing
 * page that lets them pick which station this tablet is for.
 *
 * After picking, the tablet typically gets bookmarked at the station's URL
 * directly so future logins land there without going through this picker.
 */

interface Station {
  id:     string;
  name:   string;
  kind:   string;
  hasKds: boolean;
}

interface LayoutResponse {
  tenant:   { hasCustomerDisplay: boolean };
  stations: Station[];
}

const STATION_ICON: Record<string, React.ElementType> = {
  COUNTER:     Store,
  BAR:         Coffee,
  KITCHEN:     ChefHat,
  HOT_BAR:     Coffee,
  COLD_BAR:    Snowflake,
  PASTRY_PASS: Cake,
};

export default function SelectDisplayPage() {
  const router = useRouter();
  const { user, accessToken, clear } = useAuthStore();

  const { data, isLoading } = useQuery<LayoutResponse>({
    queryKey: ['floor-layout-display'],
    queryFn:  () => api.get('/layouts').then((r) => r.data),
    enabled:  !!user,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!accessToken) router.replace('/login');
  }, [accessToken, router]);

  if (!user) return null;

  const kdsStations = (data?.stations ?? []).filter((s) => s.hasKds);
  const hasCustomerDisplay = data?.tenant.hasCustomerDisplay ?? false;

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Pick this tablet&apos;s display</h1>
          <p className="text-slate-400 text-sm">
            Bookmark the station after you pick it — your tablet will open straight there next time.
          </p>
        </div>

        {isLoading ? (
          <div className="text-center text-slate-500 py-12">Loading stations…</div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {kdsStations.map((station) => {
              const Icon = STATION_ICON[station.kind] ?? Store;
              return (
                <button
                  key={station.id}
                  onClick={() => router.push(`/pos/station/${station.id}`)}
                  className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-emerald-500/40 transition-colors p-5 text-left"
                >
                  <div className="w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0">
                    <Icon className="w-6 h-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-base">{station.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Kitchen Display — {station.kind.replace(/_/g, ' ').toLowerCase()}
                    </p>
                  </div>
                </button>
              );
            })}

            {hasCustomerDisplay && (
              <button
                onClick={() => router.push('/pos/customer-display')}
                className="group flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-900 hover:bg-slate-800 hover:border-blue-500/40 transition-colors p-5 text-left"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center shrink-0">
                  <Monitor className="w-6 h-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-base">Customer Display</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Customer-facing screen — order summary and total
                  </p>
                </div>
              </button>
            )}

            {kdsStations.length === 0 && !hasCustomerDisplay && (
              <div className="sm:col-span-2 text-center text-slate-500 text-sm py-12 rounded-2xl border border-dashed border-slate-800">
                No displays configured for this tenant yet. Ask the owner to set up Floor Layout in Settings.
              </div>
            )}
          </div>
        )}

        <div className="text-center pt-4">
          <button
            onClick={() => {
              clear();
              document.cookie = 'app-session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
              router.push('/login');
            }}
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
