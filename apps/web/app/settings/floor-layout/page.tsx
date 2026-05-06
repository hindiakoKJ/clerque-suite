'use client';
import { useState } from 'react';
import {
  ArrowLeft, Layout, Pencil, Save, X, Printer, Coffee, ChefHat, Snowflake,
  Cake, Store, Monitor, AlertCircle, Bluetooth, Wifi, Cable,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { useFloorLayout } from '@/hooks/useFloorLayout';
import { isFnbType } from '@repo/shared-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATION_ICON: Record<string, React.ElementType> = {
  COUNTER:     Store,
  BAR:         Coffee,
  KITCHEN:     ChefHat,
  HOT_BAR:     Coffee,
  COLD_BAR:    Snowflake,
  PASTRY_PASS: Cake,
};

const INTERFACE_ICON: Record<string, React.ElementType> = {
  BLUETOOTH_RAWBT:  Bluetooth,
  BLUETOOTH_NATIVE: Bluetooth,
  USB:              Cable,
  NETWORK:          Wifi,
};

const INTERFACE_LABEL: Record<string, string> = {
  BLUETOOTH_RAWBT:  'Bluetooth (via RawBT)',
  BLUETOOTH_NATIVE: 'Bluetooth (native — Android app)',
  USB:              'USB',
  NETWORK:          'Network (TCP/IP)',
};

// ── Component ────────────────────────────────────────────────────────────────

export default function FloorLayoutSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const qc = useQueryClient();
  const { layout, isLoading, refetch, coffeeShopTier, hasCustomerDisplay } = useFloorLayout();

  const [editingStation, setEditingStation] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [savingStation, setSavingStation] = useState(false);

  // Only owner / super-admin can manage layout
  const canManage = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  if (isLoading || !layout) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
        Loading layout…
      </div>
    );
  }

  // Floor Layout only applies to F&B tenants — bounce non-F&B back to Settings
  // with a clear explanation. This shouldn't happen via UI clicks (the card is
  // hidden), but a leftover bookmark / typed URL could land them here.
  const businessType = layout.tenant?.businessType;
  if (!isFnbType(businessType ?? null)) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <Layout className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h1 className="text-lg font-semibold mb-2">Not applicable to your business</h1>
        <p className="text-sm text-muted-foreground max-w-md mb-6">
          Floor Layout configures stations, printers, and KDS for cafés and
          restaurants. Your business is registered as <span className="font-mono">{businessType ?? 'unknown'}</span>,
          which doesn&apos;t use station routing.
        </p>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Settings
        </Link>
      </div>
    );
  }

  // F&B tenant hasn't picked a tier yet — show CTA to setup wizard
  if (!coffeeShopTier) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-6 text-center">
        <Layout className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h1 className="text-lg font-semibold mb-2">No floor layout selected</h1>
        <p className="text-sm text-muted-foreground max-w-md mb-6">
          Pick a Coffee Shop tier in the setup wizard to provision your stations,
          printers, and customer display.
        </p>
        <div className="flex gap-2">
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          {canManage && (
            <Link
              href="/settings/floor-layout/setup"
              className="inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-lg text-white"
              style={{ background: 'var(--accent)' }}
            >
              Choose a layout
            </Link>
          )}
        </div>
      </div>
    );
  }

  // ── Station rename ───────────────────────────────────────────────────────

  function startRename(stationId: string, currentName: string) {
    setEditingStation(stationId);
    setDraftName(currentName);
  }

  async function saveRename(stationId: string) {
    const name = draftName.trim();
    if (name.length === 0 || name.length > 60) {
      toast.error('Name must be 1-60 characters.');
      return;
    }
    setSavingStation(true);
    try {
      await api.patch(`/layouts/stations/${stationId}`, { name });
      toast.success('Station renamed.');
      setEditingStation(null);
      qc.invalidateQueries({ queryKey: ['floor-layout'] });
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to rename.');
    } finally {
      setSavingStation(false);
    }
  }

  // ── CS-1 customer display toggle ─────────────────────────────────────────

  async function toggleCustomerDisplay() {
    try {
      await api.patch('/layouts/customer-display', { enabled: !hasCustomerDisplay });
      toast.success(hasCustomerDisplay ? 'Customer display disabled.' : 'Customer display enabled.');
      qc.invalidateQueries({ queryKey: ['floor-layout'] });
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update.');
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background overflow-y-auto">
      {/* Header */}
      <div className="border-b border-border px-4 sm:px-6 py-4">
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Back
        </button>
        <h1 className="text-lg font-semibold text-foreground">Floor Layout</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Tier <span className="font-mono font-semibold text-foreground">{coffeeShopTier}</span>
          {' · '}
          {layout.template != null && typeof layout.template === 'object' && 'name' in layout.template
            ? (layout.template as { name: string }).name
            : 'Custom'}
        </p>
      </div>

      {/* Sales-controlled upgrade hint */}
      <div className="mx-4 sm:mx-6 mt-4 p-3 rounded-lg bg-muted/30 border border-border flex gap-3">
        <AlertCircle className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          The structure (number of stations) is locked by your tier — you can rename
          stations and re-route categories, but adding a kitchen or splitting bars
          requires a sales-controlled upgrade. Contact your account manager.
        </p>
      </div>

      {/* Stations */}
      <section className="px-4 sm:px-6 py-6">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Stations</h2>
          {canManage && layout.stations.some((s) => s.kind === 'HOT_BAR' || s.kind === 'COLD_BAR') && (
            <button
              onClick={async () => {
                if (!window.confirm(
                  'Merge Hot Bar + Cold Bar into a single Bar?\n\n' +
                  'All categories currently routed to Hot Bar or Cold Bar will be reassigned ' +
                  'to a single Bar station, and the obsolete stations will be deactivated. ' +
                  'This is recommended — most cafés operate one bar with two baristas off the ' +
                  'same queue. You can still run a second tablet for capacity by pointing it at ' +
                  'the Bar station URL.\n\nThis action is reversible only by sales (contact us).',
                )) return;
                try {
                  const { data } = await api.post('/layouts/consolidate-bars');
                  if (data.consolidated) {
                    toast.success(data.message);
                  } else {
                    toast.info(data.message);
                  }
                  qc.invalidateQueries({ queryKey: ['floor-layout'] });
                } catch (err) {
                  toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to consolidate.');
                }
              }}
              className="text-xs px-3 py-1.5 rounded-md font-medium border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 transition-colors"
              title="Merge Hot Bar + Cold Bar into a single Bar (reroutes categories, keeps history)"
            >
              Merge into single Bar
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {layout.stations.map((s) => {
            const Icon = STATION_ICON[s.kind] ?? Store;
            const isEditing = editingStation === s.id;
            return (
              <div
                key={s.id}
                className="rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename(s.id);
                          if (e.key === 'Escape') setEditingStation(null);
                        }}
                        className="flex-1 min-w-0 border border-[var(--accent)] bg-background rounded px-2 py-1 text-sm focus:outline-none"
                      />
                    ) : (
                      <h3 className="font-semibold text-foreground truncate">{s.name}</h3>
                    )}
                  </div>
                  {canManage && !isEditing && (
                    <button
                      onClick={() => startRename(s.id, s.name)}
                      className="text-muted-foreground hover:text-[var(--accent)]"
                      title="Rename station"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {canManage && isEditing && (
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => saveRename(s.id)}
                        disabled={savingStation}
                        className="text-green-500 hover:text-green-600 disabled:opacity-50"
                        title="Save"
                      >
                        <Save className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingStation(null)}
                        className="text-muted-foreground hover:text-red-500"
                        title="Cancel"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                  Kind: <span className="font-mono">{s.kind}</span>
                </p>

                {/* Categories routed */}
                <div className="mt-2">
                  <p className="text-[11px] text-muted-foreground mb-1">
                    Categories ({s.categories.length})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {s.categories.length === 0 ? (
                      <span className="text-xs text-muted-foreground/60 italic">No categories routed</span>
                    ) : (
                      s.categories.map((c) => (
                        <span key={c.id} className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {c.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                {/* Printer assignment + toggle + rename */}
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[11px] text-muted-foreground mb-1">Printer</p>
                  {s.printer ? (
                    <PrinterRow
                      key={s.printer.id}
                      id={s.printer.id}
                      name={s.printer.name}
                      paperWidthMm={s.printer.paperWidthMm}
                      isActive={s.printer.isActive}
                      canManage={canManage}
                      onChanged={() => qc.invalidateQueries({ queryKey: ['floor-layout'] })}
                    />
                  ) : s.hasPrinter ? (
                    <p className="text-xs text-amber-600 italic">No printer assigned</p>
                  ) : (
                    <p className="text-xs text-muted-foreground/60 italic">Receipt-only (no station ticket)</p>
                  )}
                </div>

                {/* KDS flag + open-screen link */}
                {s.hasKds && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      <Monitor className="h-2.5 w-2.5" />
                      KDS Enabled
                    </span>
                    <button
                      onClick={() => {
                        window.open(
                          `/pos/station/${s.id}`,
                          `clerque-station-${s.id}`,
                          'noopener,noreferrer,width=1280,height=800',
                        );
                      }}
                      className="text-[11px] font-medium text-[var(--accent)] hover:underline"
                    >
                      Open station screen →
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Printers */}
      <section className="px-4 sm:px-6 py-6 border-t border-border">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Printers</h2>
        <div className="grid gap-2">
          {layout.printers.map((p) => {
            const InterfaceIcon = INTERFACE_ICON[p.interface] ?? Printer;
            return (
              <div key={p.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3">
                <Printer className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{p.name}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <InterfaceIcon className="h-3 w-3" />
                    {INTERFACE_LABEL[p.interface] ?? p.interface}
                    <span className="text-muted-foreground/60">· {p.paperWidthMm}mm</span>
                  </p>
                </div>
                <div className="flex flex-col items-end gap-0.5 text-[10px] text-muted-foreground">
                  {p.printsReceipts && <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">Receipts</span>}
                  {p.printsOrders && <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">Tickets</span>}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground italic mt-3">
          Bluetooth printers via RawBT need the RawBT app installed on your tablet.
          Network printer support arrives with the Android app.
        </p>
      </section>

      {/* Terminals */}
      <section className="px-4 sm:px-6 py-6 border-t border-border">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Terminals</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {layout.terminals.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{t.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{t.code}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${t.isActive ? 'bg-emerald-500/10 text-emerald-600' : 'bg-muted text-muted-foreground'}`}>
                {t.isActive ? 'ACTIVE' : 'DISABLED'}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* CS_1 customer display toggle */}
      {coffeeShopTier === 'CS_1' && canManage && (
        <section className="px-4 sm:px-6 py-6 border-t border-border">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">Customer Display</h2>
          <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Monitor className="h-4 w-4" />
                Customer-facing display
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Show the cart on a second screen so customers can verify their order.
              </p>
            </div>
            <button
              onClick={toggleCustomerDisplay}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                hasCustomerDisplay ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'
              }`}
            >
              {hasCustomerDisplay ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Printer card with rename + active toggle ───────────────────────────────

function PrinterRow({
  id, name, paperWidthMm, isActive, canManage, onChanged,
}: {
  id: string;
  name: string;
  paperWidthMm: number;
  isActive: boolean;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(name);
  const [saving, setSaving]   = useState(false);

  async function save() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || trimmed.length === name.length && trimmed === name) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/layouts/printers/${id}`, { name: trimmed });
      toast.success('Printer renamed.');
      setEditing(false);
      onChanged();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to rename.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    try {
      await api.patch(`/layouts/printers/${id}`, { isActive: !isActive });
      toast.success(isActive ? 'Printer disabled — orders won\'t print to it.' : 'Printer enabled.');
      onChanged();
    } catch (err) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to toggle.');
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Printer className={`h-3 w-3 ${isActive ? 'text-foreground' : 'text-muted-foreground/40'}`} />
      {editing ? (
        <>
          <input
            autoFocus
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') { setDraft(name); setEditing(false); }
            }}
            className="text-xs flex-1 min-w-0 border border-[var(--accent)] bg-background rounded px-2 py-1 focus:outline-none"
          />
          <button onClick={save} disabled={saving} className="text-emerald-500 hover:text-emerald-600 disabled:opacity-50" title="Save">
            <Save className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => { setDraft(name); setEditing(false); }} className="text-muted-foreground hover:text-red-500" title="Cancel">
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      ) : (
        <>
          <span className={`text-xs flex-1 ${isActive ? 'text-foreground' : 'text-muted-foreground/60 line-through'}`}>
            {name}
          </span>
          <span className="text-[10px] text-muted-foreground">{paperWidthMm}mm</span>
          {canManage && (
            <button onClick={() => setEditing(true)} className="text-muted-foreground hover:text-[var(--accent)]" title="Rename printer">
              <Pencil className="h-3 w-3" />
            </button>
          )}
          {canManage && (
            <button
              onClick={toggleActive}
              role="switch"
              aria-checked={isActive}
              title={isActive ? 'Click to disable — orders will skip this printer (no print, no error toast)' : 'Click to enable'}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                isActive ? 'bg-[var(--accent)]' : 'bg-muted-foreground/30'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow transform transition-transform ${
                  isActive ? 'translate-x-3.5' : 'translate-x-0.5'
                }`}
              />
            </button>
          )}
        </>
      )}
      {!isActive && (
        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-semibold">
          off
        </span>
      )}
    </div>
  );
}
