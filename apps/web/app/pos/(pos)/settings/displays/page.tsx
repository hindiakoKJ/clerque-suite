'use client';
/**
 * Sprint 25 — Displays & screens settings page.
 *
 * Lets the cashier generate a 4-digit pairing code for a secondary device
 * (customer-facing TV, second tablet, KDS) and walk them through redeeming it
 * at /pair?code=...&tenant=<slug>. The remote device gets a long-lived
 * deviceToken back; no second login needed.
 *
 * Below the per-role "Generate code" cards is a live table of paired +
 * pending devices with last-seen status and a Revoke action.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Monitor,
  ChefHat,
  Coffee,
  Snowflake,
  Cake,
  Store,
  Trash2,
  Copy,
  Check,
  Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { isFnbType } from '@repo/shared-types';
import type { PairedDeviceRole } from '@/lib/pos/device-token';

interface PairingRow {
  id:         string;
  code:       string | null;
  role:       PairedDeviceRole;
  stationId:  string | null;
  label:      string | null;
  expiresAt:  string;
  redeemedAt: string | null;
  lastSeenAt: string | null;
  createdAt:  string;
}

interface CreateCodeResponse {
  id:         string;
  code:       string;
  role:       PairedDeviceRole;
  stationId:  string | null;
  label:      string | null;
  expiresAt:  string;
  redeemedAt: string | null;
  lastSeenAt: string | null;
  createdAt:  string;
}

interface TenantProfile {
  id:   string;
  slug: string;
  name: string;
}

const ROLE_LABEL: Record<PairedDeviceRole, string> = {
  CUSTOMER_DISPLAY: 'Customer-facing display',
  KDS_KITCHEN:      'Kitchen Display (KDS)',
  KDS_BAR:          'Bar Display (KDS)',
  KDS_COLD_BAR:     'Cold Bar Display (KDS)',
  KDS_HOT_BAR:      'Hot Bar Display (KDS)',
  KDS_PASTRY_PASS:  'Pastry Pass (KDS)',
  KDS_GENERIC:      'Generic Station Display (KDS)',
};

const ROLE_ICON: Record<PairedDeviceRole, React.ElementType> = {
  CUSTOMER_DISPLAY: Monitor,
  KDS_KITCHEN:      ChefHat,
  KDS_BAR:          Coffee,
  KDS_COLD_BAR:     Snowflake,
  KDS_HOT_BAR:      Coffee,
  KDS_PASTRY_PASS:  Cake,
  KDS_GENERIC:      Store,
};

// The cards we show by default. F&B tenants get Kitchen + Bar KDS; every
// other vertical sees only the customer-facing display (laundry shops,
// pharmacies, retail, etc. don't have kitchen stations). Other KDS
// sub-roles are still issuable via the station-bound flow.
const FB_ROLES: PairedDeviceRole[] = ['CUSTOMER_DISPLAY', 'KDS_KITCHEN', 'KDS_BAR'];
const NON_FB_ROLES: PairedDeviceRole[] = ['CUSTOMER_DISPLAY'];

export default function DisplaysSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();
  const { layout } = useFloorLayout();

  const canRevoke =
    user?.role === 'BUSINESS_OWNER' ||
    user?.role === 'SUPER_ADMIN' ||
    user?.role === 'BRANCH_MANAGER';

  // Pull tenant slug from /tenant/profile — JWT only carries businessName, not
  // the URL slug. Cached aggressively since it doesn't change.
  const tenantQuery = useQuery<TenantProfile>({
    queryKey: ['tenant-profile'],
    queryFn:  () => api.get('/tenant/profile').then((r) => r.data),
    enabled:  !!user?.tenantId,
    staleTime: 5 * 60_000,
  });
  const tenantSlug = tenantQuery.data?.slug ?? '';

  // Paired + pending list. Polled every 5 s so lastSeenAt feels live.
  const listQuery = useQuery<PairingRow[]>({
    queryKey: ['display-pairings'],
    queryFn:  () => api.get('/display-pairing').then((r) => r.data),
    enabled:  !!user?.tenantId,
    refetchInterval: 5_000,
  });

  const createMut = useMutation({
    mutationFn: (body: { role: PairedDeviceRole; stationId?: string; label?: string }) =>
      api.post<CreateCodeResponse>('/display-pairing/codes', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['display-pairings'] }),
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to generate pairing code.';
      toast.error(Array.isArray(msg) ? msg.join(' ') : msg);
    },
  });

  const revokeMut = useMutation({
    mutationFn: (id: string) => api.delete(`/display-pairing/${id}`).then((r) => r.data),
    onSuccess: () => {
      toast.success('Device unpaired.');
      qc.invalidateQueries({ queryKey: ['display-pairings'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message
        ?? 'Failed to revoke.';
      toast.error(Array.isArray(msg) ? msg.join(' ') : msg);
    },
  });

  const [modalCode, setModalCode] = useState<CreateCodeResponse | null>(null);

  const kdsStations = useMemo(
    () => (layout?.stations ?? []).filter((s) => s.hasKds),
    [layout?.stations],
  );

  async function generateForRole(role: PairedDeviceRole, stationId?: string, label?: string) {
    const result = await createMut.mutateAsync({ role, stationId, label });
    setModalCode(result);
  }

  return (
    <div className="px-6 py-6 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1
          className="text-3xl font-bold text-foreground tracking-tight"
          style={{ fontFamily: 'var(--font-display, "Plus Jakarta Sans"), system-ui, sans-serif' }}
        >
          Displays &amp; screens
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Pair a TV, second tablet, or kitchen monitor without a second login.
        </p>
      </header>

      {/* ── Generate code cards ─────────────────────────────────────────── */}
      {/*  Vertical-aware: F&B sees Customer + Kitchen + Bar; laundry,
           pharmacy, retail, services see only Customer-facing. Kitchen /
           Bar are F&B-only concepts. */}
      {(() => {
        const isFnb = isFnbType(layout?.tenant?.businessType);
        const primaryRoles = isFnb ? FB_ROLES : NON_FB_ROLES;
        const gridClass = isFnb ? 'grid gap-4 md:grid-cols-3 mb-10' : 'grid gap-4 md:grid-cols-1 max-w-2xl mb-10';
        return (
      <section className={gridClass}>
        {primaryRoles.map((role) => {
          const Icon = ROLE_ICON[role];
          // For KDS_BAR / KDS_KITCHEN we let the cashier pick a specific
          // station if any are configured — otherwise a generic role-only
          // code (the device just listens to all stations of that kind).
          const stationOptions = (() => {
            if (role === 'KDS_KITCHEN') return kdsStations.filter((s) => s.name.toLowerCase().includes('kitchen') || (layout?.stations.find((x) => x.id === s.id)?.kind === 'KITCHEN'));
            if (role === 'KDS_BAR')     return kdsStations.filter((s) => {
              const kind = layout?.stations.find((x) => x.id === s.id)?.kind;
              return kind === 'BAR' || kind === 'HOT_BAR' || kind === 'COLD_BAR';
            });
            return [];
          })();

          return (
            <RoleCard
              key={role}
              icon={Icon}
              title={ROLE_LABEL[role]}
              stations={stationOptions.map((s) => ({ id: s.id, name: s.name }))}
              busy={createMut.isPending}
              onGenerate={(stationId) => generateForRole(role, stationId)}
            />
          );
        })}
      </section>
        );
      })()}

      {/* ── Paired device list ─────────────────────────────────────────── */}
      <section className="rounded-2xl border border-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-foreground">Paired devices</h2>
          <span className="text-xs text-muted-foreground">
            {listQuery.data?.length ?? 0} total
          </span>
        </div>
        <DeviceTable
          rows={listQuery.data ?? []}
          isLoading={listQuery.isLoading}
          canRevoke={canRevoke}
          revokingId={revokeMut.isPending ? revokeMut.variables ?? null : null}
          onRevoke={(id) => {
            if (!window.confirm('Unpair this device? It will be kicked on its next refresh.')) return;
            revokeMut.mutate(id);
          }}
          stationNameById={Object.fromEntries(
            (layout?.stations ?? []).map((s) => [s.id, s.name]),
          )}
        />
      </section>

      {/* ── Code reveal modal ──────────────────────────────────────────── */}
      <PairingCodeModal
        open={!!modalCode}
        code={modalCode}
        tenantSlug={tenantSlug}
        onClose={() => setModalCode(null)}
      />
    </div>
  );
}

/* ─── Generate-code card per role ─────────────────────────────────────────── */
function RoleCard({
  icon: Icon,
  title,
  stations,
  busy,
  onGenerate,
}: {
  icon: React.ElementType;
  title: string;
  stations: Array<{ id: string; name: string }>;
  busy: boolean;
  onGenerate: (stationId?: string) => void;
}) {
  const [selected, setSelected] = useState<string>('');

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
          <Icon className="h-5 w-5" style={{ color: 'var(--accent)' }} />
        </div>
        <h3 className="font-semibold text-foreground text-base leading-snug">{title}</h3>
      </div>

      {stations.length > 0 && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1.5">Station (optional)</label>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent"
          >
            <option value="">Any matching station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      )}

      <button
        onClick={() => onGenerate(selected || undefined)}
        disabled={busy}
        className="mt-auto py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ background: 'var(--accent)' }}
      >
        {busy ? 'Generating…' : 'Generate pairing code'}
      </button>
    </div>
  );
}

/* ─── Code modal — big number, QR, countdown ──────────────────────────────── */
function PairingCodeModal({
  open,
  code,
  tenantSlug,
  onClose,
}: {
  open: boolean;
  code: CreateCodeResponse | null;
  tenantSlug: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [remaining, setRemaining] = useState<number>(0);

  useEffect(() => {
    if (!code) return;
    const tick = () => {
      const ms = new Date(code.expiresAt).getTime() - Date.now();
      setRemaining(Math.max(0, Math.floor(ms / 1000)));
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [code]);

  if (!code) return null;

  // Use the actual site's origin so the QR works on any deployed
  // domain — clerque.hnscorpph.com (current prod), clerque.com (future),
  // staging, localhost, whatever. Falls back to clerque.com only on
  // server render where window doesn't exist (and this dialog is
  // client-only anyway, so the fallback never paints).
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://clerque.com';
  const pairUrl = `${origin}/pair?code=${code.code}&tenant=${tenantSlug}`;
  const qrSrc   = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(pairUrl)}`;

  const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
  const ss = String(remaining % 60).padStart(2, '0');

  function copy() {
    navigator.clipboard.writeText(pairUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    }).catch(() => toast.error('Copy failed.'));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pair your device</DialogTitle>
          <DialogDescription>
            Open the URL below on the secondary device, or scan the QR.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 py-2">
          <p
            className="tabular-nums text-foreground tracking-tight leading-none"
            style={{
              fontFamily: 'var(--font-display, "Plus Jakarta Sans"), system-ui, sans-serif',
              fontSize:   '80px',
              fontWeight: 700,
            }}
          >
            {code.code}
          </p>

          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={qrSrc}
            alt="Pairing QR code"
            width={240}
            height={240}
            className="rounded-xl border border-border bg-white p-2"
          />

          <div className="w-full">
            <p className="text-xs text-muted-foreground mb-1.5">Or visit on the device:</p>
            <button
              onClick={copy}
              className="w-full flex items-center justify-between gap-2 border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground hover:bg-muted transition-colors"
            >
              <span className="truncate font-mono text-xs">{pairUrl}</span>
              {copied ? <Check className="h-4 w-4 text-emerald-500 shrink-0" /> : <Copy className="h-4 w-4 text-muted-foreground shrink-0" />}
            </button>
          </div>

          <p className="text-sm text-muted-foreground text-center">
            Tap <span className="font-mono font-semibold text-foreground">{code.code}</span>{' '}
            on the secondary device after visiting the URL.
          </p>

          <p className="text-xs text-muted-foreground">
            Expires in <span className="tabular-nums font-semibold text-foreground">{mm}:{ss}</span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Paired-device table ─────────────────────────────────────────────────── */
function DeviceTable({
  rows,
  isLoading,
  canRevoke,
  revokingId,
  onRevoke,
  stationNameById,
}: {
  rows: PairingRow[];
  isLoading: boolean;
  canRevoke: boolean;
  revokingId: string | null;
  onRevoke: (id: string) => void;
  stationNameById: Record<string, string>;
}) {
  if (isLoading) {
    return (
      <div className="px-5 py-12 text-center text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 mx-auto animate-spin mb-2" />
        Loading paired devices…
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="px-5 py-12 text-center text-sm text-muted-foreground">
        No paired devices yet. Generate a code above to add one.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-border">
            <th className="px-5 py-3 font-medium">Role</th>
            <th className="px-5 py-3 font-medium">Station / label</th>
            <th className="px-5 py-3 font-medium">Last seen</th>
            <th className="px-5 py-3 font-medium">Status</th>
            <th className="px-5 py-3 font-medium text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const status = computeStatus(r);
            return (
              <tr key={r.id} className="border-b border-border last:border-b-0">
                <td className="px-5 py-3 text-foreground">{ROLE_LABEL[r.role] ?? r.role}</td>
                <td className="px-5 py-3 text-muted-foreground">
                  {r.label || (r.stationId ? stationNameById[r.stationId] ?? r.stationId : '—')}
                </td>
                <td className="px-5 py-3 text-muted-foreground tabular-nums">
                  {r.lastSeenAt ? formatRelative(r.lastSeenAt) : (r.redeemedAt ? 'just paired' : 'pending')}
                </td>
                <td className="px-5 py-3">
                  <StatusPill status={status} />
                </td>
                <td className="px-5 py-3 text-right">
                  {canRevoke ? (
                    <button
                      onClick={() => onRevoke(r.id)}
                      disabled={revokingId === r.id}
                      className="inline-flex items-center gap-1.5 text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
                      title="Revoke this device's access"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Revoke
                    </button>
                  ) : (
                    <span className="text-xs text-muted-foreground italic">view-only</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type DeviceStatus = 'pending' | 'active' | 'idle' | 'stale' | 'revoked';

function computeStatus(r: PairingRow): DeviceStatus {
  if (!r.redeemedAt) return 'pending';
  if (!r.lastSeenAt) return 'idle';
  const ageMs = Date.now() - new Date(r.lastSeenAt).getTime();
  if (ageMs <  5 * 60_000)  return 'active';
  if (ageMs < 60 * 60_000)  return 'idle';
  return 'stale';
}

function StatusPill({ status }: { status: DeviceStatus }) {
  const tone =
    status === 'active'  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'  :
    status === 'idle'    ? 'bg-amber-500/15  text-amber-600  dark:text-amber-400'      :
    status === 'stale'   ? 'bg-stone-500/15  text-stone-500  dark:text-stone-400'      :
    status === 'pending' ? 'bg-sky-500/15    text-sky-600    dark:text-sky-400'        :
                           'bg-red-500/15    text-red-600    dark:text-red-400';
  const label =
    status === 'active'  ? 'Active' :
    status === 'idle'    ? 'Idle'   :
    status === 'stale'   ? 'Stale'  :
    status === 'pending' ? 'Awaiting pairing' :
                           'Revoked';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60)         return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)         return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)         return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
