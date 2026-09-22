'use client';
import { use, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Clock, ChefHat, Coffee, Snowflake, Cake, Store, AlertTriangle, Bell, BellOff, Maximize, Printer, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import { useKitchenChime } from '@/hooks/pos/useKitchenChime';
import { useKioskMode } from '@/hooks/pos/useKioskMode';
import { buildStationTicket, sendViaRawBt, isLikelyAndroid } from '@/lib/pos/printer-dispatch';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { StationPrepLevels } from '@/components/pos/StationPrepLevels';
import { StationInventorySheet } from '@/components/pos/StationInventorySheet';
import { StationRequestButton } from '@/components/pos/StationRequestButton';
import { StationScreenLayout, STATION_VIEWS, stationRootHeight, type StationView } from '@/components/pos/StationScreenLayout';
import { useAuthStore } from '@/store/auth';
import {
  readDeviceToken,
  verifyDeviceToken,
  clearDeviceToken,
} from '@/lib/pos/device-token';
import { queueProblem, screenLabel, stationTitle, waitLabel } from './station-screen';

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

/** One empty list, so "no orders" is the same value on every render. */
const NO_ITEMS: QueueItem[] = [];

const STATION_ICON: Record<string, React.ElementType> = {
  COUNTER:     Store,
  BAR:         Coffee,
  KITCHEN:     ChefHat,
  HOT_BAR:     Coffee,
  COLD_BAR:    Snowflake,
  PASTRY_PASS: Cake,
};

export default function StationKdsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: stationId } = use(params);
  const router = useRouter();
  const qc = useQueryClient();
  const { layout } = useFloorLayout();
  const station = layout?.stations.find((s) => s.id === stationId);
  const loggedInUserId = useAuthStore((s) => s.user?.sub ?? null);

  // ── Sprint 25 — Paired-device gate ──────────────────────────────────────
  // This page accepts EITHER a logged-in cashier OR a paired-device token.
  // Paired flow:
  //   1. Read localStorage['clerque.deviceToken']
  //   2. Call /whoami — confirms token is still valid + tells us the bound
  //      stationId.
  //   3. If the bound stationId mismatches the URL param, refuse to load
  //      the queue and show a "Re-pair" message — the cashier paired this
  //      tablet to a DIFFERENT station, and we don't want to silently start
  //      bumping someone else's tickets.
  //   4. If no token AND no logged-in session → bounce to /pair.
  // The /kds/* endpoints still require a JWT today — when running in pure
  // paired mode the polling query below will 401. That's accepted scope; the
  // backend KDS guard pickup is a parallel agent's task. This component is
  // wired to flip on as soon as the backend supports device-token auth.
  type PairCheck = 'checking' | 'ok' | 'mismatch' | 'no-auth';
  const [pairState,      setPairState]      = useState<PairCheck>('checking');
  const [pairedStationId, setPairedStationId] = useState<string | null>(null);
  const heartbeatTokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = readDeviceToken();
      if (stored) {
        const who = await verifyDeviceToken(stored.deviceToken);
        if (cancelled) return;
        if (who) {
          heartbeatTokenRef.current = stored.deviceToken;
          setPairedStationId(who.stationId);
          if (who.stationId && who.stationId !== stationId) {
            setPairState('mismatch');
          } else {
            setPairState('ok');
          }
          return;
        }
        // Token revoked / invalid → drop it and fall through.
        clearDeviceToken();
      }
      if (loggedInUserId) {
        setPairState('ok');
      } else {
        setPairState('no-auth');
      }
    })();
    return () => { cancelled = true; };
  }, [stationId, loggedInUserId]);

  // Bounce to /pair when there's no auth source at all.
  useEffect(() => {
    if (pairState === 'no-auth') router.replace('/pair');
  }, [pairState, router]);

  // Heartbeat (paired mode only) keeps the cashier's Settings → Displays
  // table showing this tablet as Active.
  useEffect(() => {
    if (!heartbeatTokenRef.current) return;
    const id = setInterval(() => {
      const token = heartbeatTokenRef.current;
      if (token) void verifyDeviceToken(token);
    }, 30_000);
    return () => clearInterval(id);
  }, [pairState]);

  // Kitchen bell. The hook owns the browser-audio awkwardness: one reused
  // AudioContext, unlocked on first touch, resumed before every ring.
  const chime = useKitchenChime();

  /*
    Orders and prep levels side by side (the default: three quarters and one),
    orders only, or prep levels only. The orders keep polling underneath every
    view, so the bell still rings for a new ticket. Remembered per station on
    this tablet.
  */
  const viewKey = `clerque.station.view.${stationId}`;
  const [view, setView] = useState<StationView>('split');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(viewKey);
      if (saved && (STATION_VIEWS as string[]).includes(saved)) setView(saved as StationView);
    } catch { /* storage blocked: start side by side */ }
  }, [viewKey]);
  const chooseView = (v: StationView) => {
    setView(v);
    try { localStorage.setItem(viewKey, v); } catch { /* not remembered, still switched */ }
  };

  // Today's inventory sheet, full screen over the orders. The orders keep polling underneath, so the bell still rings.
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);

  // Kiosk: fullscreen (a kitchen tablet has no business showing a URL bar),
  // wake lock so it never sleeps mid-service, pinned against pinch/pull.
  const kiosk = useKioskMode();

  /**
   * Print one order's ticket FROM THIS TABLET, through its own paired RawBT
   * printer. This is what makes two physical printers work without a print
   * server: the bar tablet pairs with the bar printer, the kitchen tablet
   * with the kitchen printer, the till with the receipt printer — each
   * device's RawBT drives exactly one machine, and every ticket prints where
   * the person who needs it is standing.
   */
  const canPrintHere = isLikelyAndroid();
  function printTicket(orderNumber: string, orderItems: QueueItem[]) {
    const escpos = buildStationTicket({
      orderNumber,
      stationName,
      completedAt: orderItems[0]?.orderedAt ?? new Date().toISOString(),
      items: orderItems.map((i) => ({
        productName: i.productName,
        quantity:    i.quantity,
        modifiers:   (i.modifiers ?? []).map((m) => ({ optionName: m })),
        notes:       i.notes ?? undefined,
      })),
    });
    sendViaRawBt(escpos);
  }

  const { data: queued, isFetching, isError: queueFailed, error: queueError } = useQuery<QueueItem[]>({
    queryKey: ['kds-queue', stationId],
    queryFn:  () => api.get(`/kds/stations/${stationId}/queue`).then((r) => r.data),
    // Hold off until we've confirmed the device is authorised for this station;
    // firing the query during pair-check would 401 in paired mode and spin
    // the global axios refresh interceptor for no reason.
    enabled:  !!stationId && pairState === 'ok',
    refetchInterval: 3_000,
    refetchIntervalInBackground: true,
  });
  /*
    A queue that failed to load is said, never shown as "All caught up": a
    signed-out or unpaired screen looked finished while tickets waited. Signed
    out also hides the last list it had, which can no longer change.
  */
  const problem = queueFailed ? queueProblem(queueError) : null;
  const signedOut = problem?.kind === 'unpaired';
  const items = signedOut ? NO_ITEMS : (queued ?? NO_ITEMS);

  /*
    The station's name for the title and the printed ticket. The floor layout
    needs a login, so a paired tablet takes it from the prep levels, which
    answer with their station. The same query (same key) the prep column
    polls, so it is one request.
  */
  const { data: prepInfo } = useQuery<{ station?: { id: string; name: string; kind: string } }>({
    queryKey: ['kds-prep', stationId],
    queryFn:  () => api.get(`/kds/stations/${stationId}/prep`).then((r) => r.data),
    enabled:  !!stationId && pairState === 'ok',
    refetchInterval: 60_000,
    refetchIntervalInBackground: true,
  });

  // Ring for genuinely NEW tickets.
  //
  // This used to compare pending COUNTS, which silently missed the most common
  // case in a busy kitchen: a chef bumps one ticket in the same three-second
  // poll window that another arrives. Count unchanged, no bell, order missed.
  // Tracking ids is exact.
  //
  // The first load seeds the set without ringing, so opening the screen on a
  // full rail does not set off a fanfare.
  const seenTicketIds = useRef<Set<string> | null>(null);
  useEffect(() => {
    const pendingIds = items.filter((i) => i.prepStatus === 'PENDING').map((i) => i.id);

    if (seenTicketIds.current === null) {
      seenTicketIds.current = new Set(pendingIds);
      return;
    }

    const seen = seenTicketIds.current;
    const isNew = pendingIds.some((id) => !seen.has(id));
    // Rebuild rather than only adding, so bumped tickets are forgotten and a
    // re-opened (un-bumped) ticket rings again.
    seenTicketIds.current = new Set(pendingIds);
    if (isNew) chime.ring();
  }, [items, chime]);

  /*
    A refusal is said on screen. A dropped connection is not: the next poll
    shows the ticket as it really is. An un-bump was silently swallowed when a
    tablet (which cannot un-bump) tried it, so the cook believed it had worked.
  */
  const refusal = (e: unknown): { status?: number; message?: string } | null => {
    const r = (e as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
    if (!r) return null;
    const m = r.data?.message;
    return { status: r.status, message: Array.isArray(m) ? m.join(' ') : m };
  };

  async function bump(orderItemId: string) {
    try {
      await api.post(`/kds/items/${orderItemId}/bump`);
    } catch (e) {
      const r = refusal(e);
      if (r) toast.error(r.message ?? 'Could not mark it ready.');
    } finally {
      qc.invalidateQueries({ queryKey: ['kds-queue', stationId] });
    }
  }

  async function unbump(orderItemId: string) {
    try {
      await api.post(`/kds/items/${orderItemId}/unbump`);
    } catch (e) {
      const r = refusal(e);
      if (r) {
        toast.error(r.status === 403
          ? 'Only a supervisor or manager can undo a bump. Ask them to undo it while logged in on this screen.'
          : (r.message ?? 'Could not undo the bump.'));
      }
    } finally {
      qc.invalidateQueries({ queryKey: ['kds-queue', stationId] });
    }
  }

  // Group by orderNumber so a multi-item order shows together.
  const grouped = items.reduce<Record<string, QueueItem[]>>((acc, it) => {
    (acc[it.orderNumber] ??= []).push(it);
    return acc;
  }, {});
  // Hide fully-ready orders so the screen clears as soon as the last item
  // in an order is bumped. Previously these orders stayed on-screen at
  // opacity-60 forever — looked busy + cashiers couldn't tell what was
  // actually still cooking. If a cashier needs to undo a bump, they have
  // the /pos/orders page for that.
  const orderNumbers = Object.keys(grouped)
    .filter((on) => grouped[on].some((i) => i.prepStatus !== 'READY'))
    .sort((a, b) => {
      const aTs = grouped[a][0].orderedAt ? new Date(grouped[a][0].orderedAt).getTime() : 0;
      const bTs = grouped[b][0].orderedAt ? new Date(grouped[b][0].orderedAt).getTime() : 0;
      return aTs - bTs;
    });

  const stationKind = station?.kind ?? prepInfo?.station?.kind ?? null;
  const Icon = STATION_ICON[stationKind ?? ''] ?? ChefHat;
  const stationName = stationTitle(station, prepInfo?.station);

  // ── Mismatch guard — paired to a different station than the URL ──────────
  if (pairState === 'mismatch') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-stone-950 text-white p-8">
        <div className="max-w-md w-full text-center">
          <AlertTriangle className="h-14 w-14 mx-auto text-amber-400 mb-4" />
          <h1 className="text-2xl font-bold mb-2">Wrong station</h1>
          <p className="text-stone-400 text-sm mb-6">
            This display is paired to a different station
            {pairedStationId ? <> (id <span className="font-mono text-xs">{pairedStationId.slice(0, 8)}…</span>)</> : null}.
            Re-pair it to use this screen.
          </p>
          <button
            onClick={() => {
              clearDeviceToken();
              router.replace('/pair');
            }}
            className="px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold transition-colors"
          >
            Re-pair this device
          </button>
        </div>
      </div>
    );
  }

  // Initial pair-check splash — short. Avoids a flash of an empty queue while
  // we wait for /whoami.
  if (pairState === 'checking' || pairState === 'no-auth') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-stone-950 text-stone-400 text-sm">
        Checking pairing…
      </div>
    );
  }

  return (
    <>
    {/* Side by side on a tablet: a fixed height, so the orders and the prep column each scroll on their own.
        Never printed: Print on the inventory sheet prints the sheet alone. */}
    <div className={`${stationRootHeight(view)} flex flex-col bg-stone-950 text-white print:hidden`}>
      {/* Header */}
      <header className="px-4 sm:px-8 py-5 flex flex-wrap items-center justify-between gap-3 border-b-2 border-amber-500/50 bg-stone-900">
        <div className="flex flex-wrap items-center gap-3">
          <Icon className="h-8 w-8 text-amber-400" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{stationName}</h1>
            <p className="text-xs text-stone-400 uppercase tracking-wider mt-0.5">
              {screenLabel(stationKind)} · {items.filter((i) => i.prepStatus === 'PENDING').length} pending
            </p>
          </div>
          <div className="sm:ml-4 flex overflow-hidden rounded-xl border border-stone-700 text-sm font-semibold">
            {([['split', 'Orders + prep'], ['orders', `Orders (${items.filter((i) => i.prepStatus === 'PENDING').length})`], ['prep', 'Prep levels']] as const).map(([v, label]) => (
              <button key={v} onClick={() => chooseView(v)}
                className={`px-4 py-2 transition-colors ${view === v ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Wraps on a phone, so the extra buttons never push the page sideways. */}
        <div className="flex flex-wrap items-center gap-4">
          {/* The daily sheet the kitchen used to fill in by hand. The server names the station, so a
              paired tablet (which has no floor layout of its own) still gets a titled sheet. */}
          <button
            onClick={() => setSheetOpen(true)}
            title="Today's inventory: beginning, in, waste, used and ending for each item"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-800 text-stone-100 hover:bg-stone-700 text-sm font-semibold"
          >
            <ClipboardList className="h-4 w-4" />
            <span className="hidden sm:inline">Today&apos;s inventory</span>
          </button>
          {/* Puts what is running low on the branch's buy list and sends it to the owner.
              Self-contained (its own panel); off until the screen is known to be paired to this station. */}
          <StationRequestButton stationId={stationId} enabled={pairState === 'ok'} />
          {/* Kitchen bell. Browsers refuse to start audio without a gesture, so
              when it is still locked we say so plainly rather than letting the
              chef believe the bell is on when it is silent. */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const next = !chime.enabled;
                chime.setEnabled(next);
                if (next) chime.test();      // doubles as the unlock gesture
              }}
              title={chime.enabled ? 'Bell is on — tap to mute' : 'Bell is off — tap to turn on'}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                chime.enabled
                  ? 'bg-amber-500 text-stone-950 hover:bg-amber-400'
                  : 'bg-stone-800 text-stone-400 hover:bg-stone-700'
              }`}
            >
              {chime.enabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              <span className="hidden sm:inline">{chime.enabled ? 'Bell on' : 'Bell off'}</span>
            </button>
            {chime.enabled && (
              <button
                onClick={() => chime.test()}
                title="Play the bell now"
                className="px-2.5 py-2 rounded-xl bg-stone-800 text-stone-300 hover:bg-stone-700 text-xs transition-colors"
              >
                Test
              </button>
            )}
            {kiosk.isSupported && !kiosk.isFullscreen && (
              <button
                onClick={() => void kiosk.enter()}
                title="Hide the browser bar — full screen"
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-stone-800 text-stone-300 hover:bg-stone-700 text-xs font-semibold transition-colors"
              >
                <Maximize className="h-4 w-4" />
                <span className="hidden sm:inline">Full screen</span>
              </button>
            )}
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
        </div>
      </header>

      {/* Audio stays blocked until the browser sees a touch. Say so, because a
          silent bell that looks switched on is worse than no bell.

          Laid over the screen, never in its flow: the first touch unlocks the
          bell and this notice goes, and when it sat above the tickets they
          all jumped up under the finger mid-tap, so the tap landed on nothing
          and the first ticket had to be tapped twice. Taps pass through it. */}
      {chime.enabled && !chime.unlocked && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex items-center gap-2 border-t border-amber-500/30 bg-amber-950/90 px-6 py-2 text-xs text-amber-200 print:hidden">
          <Bell className="h-3.5 w-3.5 shrink-0" />
          <span>Tap anywhere on this screen once to let the bell ring — your tablet blocks sound until then.</span>
        </div>
      )}

      <StationScreenLayout
        view={view}
        // Always mounted, so prep levels keep watching (and ring) while only the orders are showing.
        prep={<StationPrepLevels stationId={stationId} enabled={!!stationId && pairState === 'ok'} visible={view !== 'orders'}
          compact={view === 'split'} onNewRed={() => { if (chime.enabled) chime.ring(); }} />}
        orders={signedOut ? (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <AlertTriangle className="h-14 w-14 text-amber-400 mb-4" />
            <p className="text-2xl font-semibold text-white">This screen is signed out or unpaired</p>
            <p className="text-base text-stone-300 mt-2 max-w-md">
              Orders cannot show here. Pair it again from Settings &gt; Displays.
            </p>
            {problem?.detail && <p className="text-sm text-stone-500 mt-2 max-w-md">{problem.detail}</p>}
            <button
              onClick={() => {
                clearDeviceToken();
                router.replace('/pair');
              }}
              className="mt-6 min-h-11 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold transition-colors"
            >
              Pair this screen again
            </button>
          </div>
        ) : problem && !queued ? (
          <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
            <AlertTriangle className="h-14 w-14 text-amber-400 mb-4" />
            <p className="text-2xl font-semibold text-white">Could not load the orders</p>
            <p className="text-base text-stone-300 mt-2 max-w-md">
              {problem.detail ?? 'Check the Wi-Fi. This screen tries again every few seconds.'}
            </p>
          </div>
        ) : orderNumbers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-stone-500">
            {problem && (
              <p className="mb-6 rounded-lg bg-amber-500/15 px-3 py-2 text-sm text-amber-200">
                Could not refresh the orders. Check the Wi-Fi.
              </p>
            )}
            <Check className="h-16 w-16 opacity-30 mb-4" />
            <p className="text-2xl font-semibold">All caught up</p>
            <p className="text-sm mt-1">Waiting for new orders…</p>
          </div>
        ) : (
          // Three quarters of the width when side by side: one fewer column at each size.
          <div className={view === 'split' ? 'grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'}>
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
                    <span className="flex items-center gap-2">
                      {canPrintHere && (
                        <button
                          onClick={() => printTicket(orderNumber, orderItems)}
                          title="Print this ticket on this station's printer"
                          className="p-1.5 rounded-lg text-stone-400 hover:text-white hover:bg-stone-700 transition-colors"
                        >
                          <Printer className="h-4 w-4" />
                        </button>
                      )}
                      <span className="flex items-center gap-1 text-sm font-semibold tabular-nums">
                        <Clock className="h-3.5 w-3.5" />
                        {waitLabel(oldestWait)}
                      </span>
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
      />
    </div>
    <StationInventorySheet stationId={stationId} open={sheetOpen} onClose={closeSheet} />
    </>
  );
}
