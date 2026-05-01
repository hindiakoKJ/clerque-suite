'use client';
import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, Info, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

type Kind = 'INFO' | 'WARNING' | 'ERROR' | 'SUCCESS';

interface Notif {
  id:        string;
  kind:      Kind;
  title:     string;
  body?:     string | null;
  link?:     string | null;
  readAt?:   string | null;
  createdAt: string;
}

const ICONS: Record<Kind, React.ElementType> = {
  INFO:    Info,
  WARNING: AlertTriangle,
  ERROR:   AlertCircle,
  SUCCESS: CheckCircle2,
};
const COLORS: Record<Kind, string> = {
  INFO:    'text-sky-500',
  WARNING: 'text-amber-500',
  ERROR:   'text-red-500',
  SUCCESS: 'text-emerald-500',
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)        return 'just now';
  if (ms < 3_600_000)     return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)    return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

export function NotificationBell() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Unread count — polled every 60s
  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ['notif-count'],
    queryFn:  () => api.get('/notifications/count').then((r) => r.data),
    enabled:  !!user,
    refetchInterval: 60_000,
  });
  const count = countData?.count ?? 0;

  // List — fetched on dropdown open
  const { data: list = [] } = useQuery<Notif[]>({
    queryKey: ['notif-list'],
    queryFn:  () => api.get('/notifications?limit=20').then((r) => r.data),
    enabled:  !!user && open,
    staleTime: 10_000,
  });

  // Outside click closes
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  async function handleClick(n: Notif) {
    if (!n.readAt) {
      await api.patch(`/notifications/${n.id}/read`);
      qc.invalidateQueries({ queryKey: ['notif-count'] });
      qc.invalidateQueries({ queryKey: ['notif-list'] });
    }
    setOpen(false);
    if (n.link) router.push(n.link);
  }
  async function markAll() {
    await api.patch('/notifications/read-all');
    qc.invalidateQueries({ queryKey: ['notif-count'] });
    qc.invalidateQueries({ queryKey: ['notif-list'] });
  }

  if (!user) return null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        title={count > 0 ? `${count} unread notification${count === 1 ? '' : 's'}` : 'Notifications'}
      >
        <Bell className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-[70vh] rounded-lg border border-border bg-background shadow-2xl z-50 flex flex-col">
          <div className="px-3 py-2 border-b border-border flex items-center justify-between">
            <span className="text-sm font-semibold">Notifications</span>
            {count > 0 && (
              <button onClick={markAll} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                <CheckCheck className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {list.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No notifications yet. We&apos;ll alert you about low stock, overdue invoices, period close reminders, and SOD events here.
              </div>
            ) : (
              list.map((n) => {
                const Icon = ICONS[n.kind];
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={`w-full text-left px-3 py-2.5 border-b border-border last:border-0 hover:bg-muted/50 transition-colors flex gap-2 items-start ${
                      !n.readAt ? 'bg-[var(--accent-soft)]/20' : ''
                    }`}
                  >
                    <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${COLORS[n.kind]}`} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm leading-tight ${!n.readAt ? 'font-semibold' : 'font-medium'}`}>
                        {n.title}
                      </div>
                      {n.body && (
                        <div className="text-xs text-muted-foreground mt-0.5 leading-snug line-clamp-2">{n.body}</div>
                      )}
                      <div className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.createdAt)}</div>
                    </div>
                    {!n.readAt && <span className="w-2 h-2 rounded-full bg-[var(--accent)] shrink-0 mt-1" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
