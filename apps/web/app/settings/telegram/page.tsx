'use client';

/**
 * Telegram alerts: each owner or branch manager links their OWN Telegram
 * from here. Clerque makes a one-time link for the signed-in person; opening
 * it in Telegram and pressing Start ties that chat to this person in this
 * shop. Nobody types a chat number, so one shop's alerts cannot land with
 * another shop's owner by mistake.
 */

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, Send, Loader2, CheckCircle2, Info } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

interface StatusResp {
  enabled: boolean;
  botUsername: string | null;
  canLink: boolean;
  blockedReason: string | null;
  link: { telegramUsername: string | null; alertSales: boolean; alertBuying: boolean; linkedAt: string } | null;
}
interface LinkResp { url: string; expiresAt: string }

const errText = (e: any, fallback: string) => e?.response?.data?.message ?? fallback;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

export default function TelegramAlertsPage() {
  const router = useRouter();
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const [pending, setPending] = useState<LinkResp | null>(null);

  const waiting = !!pending && new Date(pending.expiresAt).getTime() > Date.now();
  const { data: status, isLoading, isError, error, refetch } = useQuery<StatusResp>({
    queryKey: ['telegram-status'],
    queryFn: () => api.get('/telegram/me').then((r) => r.data),
    enabled: !!user?.sub,
    retry: 1,
    refetchOnWindowFocus: true,
    // While a link is out, look every few seconds for the person pressing Start.
    refetchInterval: (q) => (waiting && !q.state.data?.link ? 3000 : false),
  });
  const linkedNow = !!status?.link;
  useEffect(() => {
    if (pending && linkedNow) {
      setPending(null);
      toast.success('Telegram linked.');
    }
  }, [pending, linkedNow]);
  // An expired link is taken off the screen, so nobody taps a dead one.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), Math.max(0, new Date(pending.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(t);
  }, [pending]);

  const makeLink = useMutation({
    mutationFn: () => api.post<LinkResp>('/telegram/link').then((r) => r.data),
    onSuccess: (data) => setPending(data),
    onError: (e: any) => toast.error(errText(e, 'Could not make a link. Try again.')),
  });

  const save = useMutation({
    mutationFn: (body: { alertSales?: boolean; alertBuying?: boolean }) => api.patch('/telegram/me', body).then((r) => r.data),
    onSuccess: (data) => qc.setQueryData(['telegram-status'], data),
    onError: (e: any) => toast.error(errText(e, 'Could not save.')),
  });

  const unlink = useMutation({
    mutationFn: () => api.delete('/telegram/me').then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telegram-status'] }); toast.success('Unlinked. No more alerts to that chat.'); },
    onError: (e: any) => toast.error(errText(e, 'Could not unlink.')),
  });

  const test = useMutation({
    mutationFn: () => api.post('/telegram/test').then((r) => r.data),
    onSuccess: () => toast.success('Test alert sent. Check Telegram.'),
    onError: (e: any) => toast.error(errText(e, 'Could not send a test alert.')),
  });

  const link = status?.link ?? null;

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        {/* router.back(), never a push to /settings: pushing traps Back in a two-page loop. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window !== 'undefined' && window.history.length > 1) router.back();
            else router.push('/settings');
          }}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
        >
          <ChevronLeft className="h-3 w-3" /> Settings
        </button>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Send className="h-5 w-5" style={{ color: 'var(--accent)' }} />
          Telegram alerts
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Every sale and every step of buying, on your phone, for this shop only.
        </p>
      </div>

      <div className="flex-1 p-4 sm:p-6 max-w-2xl space-y-6">
        {isError ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 flex items-center gap-3">
            <Info className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-sm text-foreground flex-1">{errText(error, 'Could not load Telegram alerts.')}</p>
            <button type="button" onClick={() => refetch()} className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted">
              Try again
            </button>
          </div>
        ) : isLoading || !status ? (
          <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Loading…</span>
          </div>
        ) : !status.enabled ? (
          <div className="rounded-xl border border-border bg-card p-4 flex gap-3">
            <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-sm text-muted-foreground">Telegram alerts are not switched on for Clerque yet.</p>
          </div>
        ) : !status.canLink ? (
          <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex gap-3">
              <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm text-muted-foreground">{status.blockedReason ?? 'Only the owner or a branch manager can get Telegram alerts.'}</p>
            </div>
            {/* A link made before a change of role is still yours to remove. */}
            {link && (
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <p className="text-xs text-muted-foreground">
                  Still linked to {link.telegramUsername ? `@${link.telegramUsername}` : 'a Telegram chat'}. No alerts are sent to it.
                </p>
                <button
                  type="button"
                  onClick={() => unlink.mutate()}
                  disabled={unlink.isPending}
                  className="px-3 py-2 rounded-lg border border-red-500/40 text-red-600 text-sm hover:bg-red-500/10 disabled:opacity-50"
                >
                  Unlink
                </button>
              </div>
            )}
          </div>
        ) : link ? (
          <>
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex gap-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-semibold text-foreground">
                  Linked to {link.telegramUsername ? `@${link.telegramUsername}` : 'your Telegram'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Since {new Date(link.linkedAt).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })}.
                  Not you? Unlink now, then link again from your own phone.
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <h2 className="font-semibold text-foreground">What to send me</h2>
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={link.alertSales}
                  disabled={save.isPending}
                  onChange={(e) => save.mutate({ alertSales: e.target.checked })}
                />
                <span>
                  <span className="font-medium text-foreground">Every sale</span>
                  <span className="block text-xs text-muted-foreground">Laid out like the receipt: items, total, how it was paid, who rang it up.</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={link.alertBuying}
                  disabled={save.isPending}
                  onChange={(e) => save.mutate({ alertBuying: e.target.checked })}
                />
                <span>
                  <span className="font-medium text-foreground">Buying</span>
                  <span className="block text-xs text-muted-foreground">
                    When a buy list is sent, when it is bought (with prices), receipt photos as they are filed, and when it goes into stock.
                  </span>
                </span>
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => test.mutate()}
                  disabled={test.isPending}
                  className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-50"
                >
                  Send a test alert
                </button>
                <button
                  type="button"
                  onClick={() => unlink.mutate()}
                  disabled={unlink.isPending}
                  className="px-3 py-2 rounded-lg border border-red-500/40 text-red-600 text-sm hover:bg-red-500/10 disabled:opacity-50"
                >
                  Unlink
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <h2 className="font-semibold text-foreground">Link your Telegram</h2>
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
              <li>Tap <b>Make my link</b>, then <b>Open Telegram</b> on the phone that should get the alerts.</li>
              <li>In Telegram, press <b>Start</b>. The bot replies with this shop&rsquo;s name.</li>
            </ol>
            <p className="text-xs text-muted-foreground">
              The link is yours alone and works once, for 10 minutes. Do not share it or post a screenshot of it.
            </p>
            {!waiting ? (
              <button
                type="button"
                onClick={() => makeLink.mutate()}
                disabled={makeLink.isPending}
                className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'var(--accent)' }}
              >
                {makeLink.isPending ? 'Making link…' : 'Make my link'}
              </button>
            ) : (
              <div className="space-y-2">
                {/* A real link the person taps: opening a window after a network call is blocked on phones. */}
                <a
                  href={pending!.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block px-4 py-2 rounded-lg text-sm font-medium text-white"
                  style={{ background: 'var(--accent)' }}
                >
                  Open Telegram
                </a>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Waiting for you to press Start in Telegram. The link works until {timeOf(pending!.expiresAt)}.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card p-4 flex gap-3">
          <Info className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Alerts are sent through Telegram, outside Clerque. Sale alerts leave out PWD and senior ID numbers and customer
            details. Buying alerts show what the shop paid, so they only go to the owner and branch managers who link here.
            To stop at any time, unlink here or send /stop to the bot.
          </p>
        </div>
      </div>
    </div>
  );
}
