'use client';

/**
 * "Count" in the kitchen or bar screen's header: opens the weekly count.
 *
 * It reads "Count due" with an amber dot once the station has gone 7 days
 * without sending a count, or when the owner asked for a recount, and checks
 * again every 5 minutes. The words show from sm up like its neighbours'
 * ("Today's inventory" has a clipboard too, and a title means nothing to a
 * finger): measured at 1024 wide, the header's right-hand row still fits on
 * one line with "Count due", the bell, Test and Full screen all showing.
 *
 * Self-contained: the station page only mounts it, the way it mounts
 * "Request what's running low".
 */
import { useState, type JSX } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { readDeviceToken } from '@/lib/pos/device-token';
import { getStationCount, stationCountKey, type StationCountView } from '@/lib/weekly-count-api';
import { StationCountPanel } from './StationCountPanel';

export function StationCountButton({ stationId, enabled }: { stationId: string; enabled: boolean }): JSX.Element {
  const [open, setOpen] = useState(false);
  // Signed in, the server names the person; a paired tablet asks who is counting.
  const signedIn = useAuthStore((s) => !!s.user);

  const { data } = useQuery<StationCountView>({
    queryKey: stationCountKey(stationId),
    queryFn:  () => getStationCount(stationId),
    enabled:  enabled && !!stationId,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: true,
  });
  const due = !!data && (data.due.isDue || !!data.recount);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!enabled}
        title="Weekly count"
        aria-label={due ? 'Weekly count is due' : 'Weekly count'}
        className="relative flex min-h-12 items-center gap-1.5 rounded-xl bg-stone-800 px-3 py-2 text-sm font-semibold text-stone-100 transition-colors hover:bg-stone-700 disabled:opacity-60"
      >
        <ClipboardCheck className="h-4 w-4" />
        <span className="hidden sm:inline">{due ? 'Count due' : 'Count'}</span>
        {due && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-amber-400 ring-2 ring-stone-900" />}
      </button>

      {/*
        A paired tablet asks who is counting even when someone once signed in on
        it: once that login expires, the server takes the tablet's own pairing
        and needs a name. For a person still signed in the server ignores it.
      */}
      {open && <StationCountPanel stationId={stationId} askName={!signedIn || readDeviceToken() != null} onClose={() => setOpen(false)} />}
    </>
  );
}
