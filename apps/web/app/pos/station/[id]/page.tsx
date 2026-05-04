'use client';
import { use, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock, ChefHat, Coffee, Snowflake, Cake, Store } from 'lucide-react';
import { api } from '@/lib/api';
import { useFloorLayout } from '@/hooks/useFloorLayout';

interface QueueItem {
  id:           string;
  orderId:      string;
  orderNumber:  string;
  branchId:     string;
  productName:  string;
  quantity:     number;
  modifiers:    string[];
  notes:        string | null;
  prepStatus:   'PENDING' | 'READY' | 'SERVED';
  orderedAt:    string | null;
  readyAt:      string | null;
  waitSeconds:  number;
}

const STATION_ICON: Record<string, React.ElementType> = {
  COUNTER:     Store,
  BAR:         Coffee,
  KITCHEN:     ChefHat,
  HOT_BAR:     Coffee,
  COLD_BAR:    Snowflake,
  PASTRY_PASS: Cake,
};

function fmtElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

export default function StationKdsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: stationId } = use(params);
  const qc = useQueryClient();
  const { layout } = useFloorLayout();
  const station = layout?.stations.find((s) => s.id === stationId);

  // Audio chime on new order — accumulated count drives the playback decision.
  const lastCountRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Inline beep via WebAudio (no asset required) — hosted in a small data URL
      // would be cleaner; using a synth fallback in playChime() for portability.
    }
  }, []);

  function playChime() {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch { /* no-op — audio context might not be available */ }
  }

  const { data: items = [], isFetching } = useQuery<QueueItem[]>({
    queryKey: ['kds-queue', stationId],
    queryFn:  () => api.get(`/kds/stations/${stationId}/queue`).then((r) => r.data),
    enabled:  !!stationId,
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });

  // Chime when the pending count grows — fresh ticket arrived.
  useEffect(() => {
    const pendingCount = items.filter((i) => i.prepStatus === 'PENDING').length;
    if (pendingCount > lastCountRef.current) {
      playChime();
    }
    lastCountRef.current = pendingCount;
  }, [items]);

  async function bump(orderItemId: string) {
    try {
      await api.post(`/kds/items/${orderItemId}/bump`);
      qc.invalidateQueries({ queryKey: ['kds-queue', stationId] });
    } catch {
      /* poll will retry */
    }
  }

  async function unbump(orderItemId: string) {
    try {
      await api.post(`/kds/items/${orderItemId}/unbump`);
      qc.invalidateQueries({ queryKey: ['kds-queue', stationId] });
    } catch {
      /* ignore */
    }
  }

  // Group by orderNumber so a multi-item order shows together
  const grouped = items.reduce<Record<string, QueueItem[]>>((acc, it) => {
    (acc[it.orderNumber] ??= []).push(it);
    return acc;
  }, {});
  const orderNumbers = Object.keys(grouped).sort((a, b) => {
    const aTs = grouped[a][0].orderedAt ? new Date(grouped[a][0].orderedAt).getTime() : 0;
    const bTs = grouped[b][0].orderedAt ? new Date(grouped[b][0].orderedAt).getTime() : 0;
    return aTs - bTs;
  });

  const Icon = station ? STATION_ICON[station.kind] ?? ChefHat : ChefHat;
  const stationName = station?.name ?? 'Station';

  return (
    <div className="min-h-screen flex flex-col bg-stone-950 text-white">
      {/* Header */}
      <header className="px-8 py-5 flex items-center justify-between border-b-2 border-amber-500/50 bg-stone-900">
        <div className="flex items-center gap-3">
          <Icon className="h-8 w-8 text-amber-400" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{stationName}</h1>
            <p className="text-xs text-stone-400 uppercase tracking-wider mt-0.5">
              Kitchen Display · {items.filter((i) => i.prepStatus === 'PENDING').length} pending
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-2xl tabular-nums font-semibold">
            {new Date().toLocaleTimeString('en-PH', {
              hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Manila',
            })}
          </p>
          <p className="text-[10px] text-stone-500 uppercase tracking-wider mt-0.5">
            {isFetching ? 'Refreshing…' : `Updates every 3s`}
          </p>
        </div>
      </header>

      {/* Queue grid */}
      <main className="flex-1 overflow-y-auto p-6">
        {orderNumbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-stone-500">
            <Check className="h-16 w-16 opacity-30 mb-4" />
            <p className="text-2xl font-semibold">All caught up</p>
            <p className="text-sm mt-1">Waiting for new orders…</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {orderNumbers.map((orderNumber) => {
              const orderItems = grouped[orderNumber];
              const allReady = orderItems.every((i) => i.prepStatus === 'READY');
              const oldestWait = Math.max(...orderItems.map((i) => i.waitSeconds));
              const tone =
                oldestWait > 600 ? 'border-red-500    bg-red-500/10'    :    // > 10 min
                oldestWait > 300 ? 'border-amber-400  bg-amber-500/10'  :    // > 5 min
                                   'border-emerald-500 bg-emerald-500/10';   // < 5 min
              return (
                <div
                  key={orderNumber}
                  className={`rounded-2xl border-2 ${tone} p-4 transition-colors ${allReady ? 'opacity-60' : ''}`}
                >
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="text-3xl font-bold tracking-tight">#{orderNumber.replace(/^ORD-/, '')}</span>
                    <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                      <Clock className="h-3.5 w-3.5" />
                      {fmtElapsed(oldestWait)}
                    </span>
                  </div>

                  <div className="space-y-2">
                    {orderItems.map((item) => {
                      const isReady = item.prepStatus === 'READY';
                      return (
                        <button
                          key={item.id}
                          onClick={() => isReady ? unbump(item.id) : bump(item.id)}
                          className={`w-full text-left rounded-xl px-3 py-3 transition-all active:scale-95 ${
                            isReady
                              ? 'bg-emerald-700/40 line-through opacity-70'
                              : 'bg-stone-800 hover:bg-stone-700'
                          }`}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-xl font-bold tabular-nums text-amber-300 shrink-0">{item.quantity}×</span>
                            <span className="flex-1 text-lg font-medium">{item.productName}</span>
                            {isReady ? (
                              <Check className="h-5 w-5 text-emerald-400 shrink-0" />
                            ) : (
                              <span className="text-[10px] uppercase tracking-wider text-stone-400">tap to bump</span>
                            )}
                          </div>
                          {item.modifiers.length > 0 && (
                            <p className="text-xs text-stone-400 mt-1 ml-8">
                              {item.modifiers.join(' · ')}
                            </p>
                          )}
                          {item.notes && (
                            <p className="text-xs text-amber-300 mt-1 ml-8 italic">★ {item.notes}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
