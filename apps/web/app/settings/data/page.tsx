'use client';

/**
 * Owner-facing data backup page.
 *
 * What this delivers:
 *   - Confirmation that nightly off-box backups are running (or warning
 *     if they're not configured on the deployment).
 *   - List of available snapshots (newest first) so the owner sees the
 *     cutoff RPO at a glance — "last night 02:00 UTC" is good news.
 *   - One-click download of any snapshot as JSON. Owner can hand the
 *     file to their accountant, keep on a USB drive for compliance, or
 *     forward to support during a forensic.
 *   - Per-snapshot preview: row counts per table so the owner can sanity-
 *     check "yes, my 12,400 orders are in there" before relying on it.
 *
 * What this does NOT do (yet):
 *   - One-click RESTORE. Wiping + rewriting a tenant's data is risky and
 *     lands in the next sprint after a staging test harness exists. For
 *     now, "restore" = download the JSON, send to support, we re-insert
 *     manually within an hour.
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, Eye, AlertTriangle, ShieldCheck, Loader2, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { downloadAuthFile } from '@/lib/utils';

interface SnapshotMeta {
  key:          string;
  date:         string;
  sizeBytes:    number;
  sizeKb:       number;
  lastModified: string | null;
}
interface MinePayload {
  tenantSlug: string;
  count:      number;
  snapshots:  SnapshotMeta[];
}
interface PreviewPayload {
  meta:        SnapshotMeta;
  generatedAt: string | null;
  tenantId:    string | null;
  rowCounts:   Record<string, number>;
}

function formatBytes(n: number): string {
  if (n < 1024)      return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(2)} MB`;
}
function formatDateNice(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-PH', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}
function formatLastModified(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function BackupDataPage() {
  const { user } = useAuthStore();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';

  const { data, isLoading, error } = useQuery<MinePayload>({
    queryKey: ['backups-mine'],
    queryFn:  () => api.get('/backups/mine').then((r) => r.data),
    enabled:  Boolean(user) && isOwner,
    staleTime: 60_000,
  });

  // Auto-select latest when data loads
  useEffect(() => {
    if (data?.snapshots?.length && !selectedDate) {
      setSelectedDate(data.snapshots[0].date);
    }
  }, [data, selectedDate]);

  if (!isOwner) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          Only the business owner can view backup data.
        </p>
      </div>
    );
  }

  const loadPreview = async (date: string) => {
    setPreviewLoading(true);
    try {
      const res = await api.get(`/backups/mine/preview?date=${date}`).then((r) => r.data);
      setPreview(res);
      setSelectedDate(date);
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Could not load preview.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const download = async (date: string) => {
    try {
      const slug = data?.tenantSlug ?? 'tenant';
      await downloadAuthFile(
        `/backups/mine/download?date=${date}`,
        `clerque-backup-${slug}-${date}.json`,
      );
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Download failed.');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="bg-background border-b border-border px-4 sm:px-6 py-5 shrink-0">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link
              href="/settings"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mb-1"
            >
              <ChevronLeft className="h-3 w-3" /> Settings
            </Link>
            <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
              <Database className="h-5 w-5" style={{ color: 'var(--accent)' }} />
              Data Backups
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Off-box cloud snapshots taken nightly at 02:00 UTC (10:00 AM Manila).
              Download any to hand to your accountant or keep as a cold copy.
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 sm:p-6 space-y-6">
        {/* Status banner */}
        {error ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-semibold">Backup destination not configured on this deployment.</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ask your administrator to set <code className="px-1 py-0.5 bg-muted rounded text-[10px]">S3_BUCKET</code> +
                {' '}<code className="px-1 py-0.5 bg-muted rounded text-[10px]">S3_ACCESS_KEY_ID</code> +
                {' '}<code className="px-1 py-0.5 bg-muted rounded text-[10px]">S3_SECRET_ACCESS_KEY</code> in the Railway env.
                Without this, no off-box backups are running — only the in-database snapshot before destructive operations.
              </p>
            </div>
          </div>
        ) : data && data.count === 0 ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-semibold">No backups yet.</p>
              <p className="text-xs text-muted-foreground mt-1">
                The nightly cron runs at 02:00 UTC. Your first backup will appear here tomorrow.
              </p>
            </div>
          </div>
        ) : data && data.count > 0 ? (
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 flex gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
            <div className="text-sm text-foreground">
              <p className="font-semibold">
                {data.count} snapshot{data.count !== 1 ? 's' : ''} available — most recent: {formatDateNice(data.snapshots[0].date)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Off-box cloud copy in Cloudflare R2. If your live database is compromised or wiped,
                support can restore from any of these within an hour.
              </p>
            </div>
          </div>
        ) : null}

        {/* Snapshot list + preview */}
        {!isLoading && data && data.count > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Snapshots column */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">Available snapshots</h2>
              </div>
              <div className="divide-y divide-border max-h-[600px] overflow-auto">
                {data.snapshots.map((s) => (
                  <div
                    key={s.key}
                    className={`px-4 py-3 flex items-center justify-between gap-3 hover:bg-muted/20 transition-colors ${
                      selectedDate === s.date ? 'bg-muted/30' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{formatDateNice(s.date)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatBytes(s.sizeBytes)}
                        {s.lastModified ? ` · uploaded ${formatLastModified(s.lastModified)} PH` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => loadPreview(s.date)}
                        className="text-xs border border-border rounded-md px-2 py-1 hover:bg-muted flex items-center gap-1"
                        title="Preview row counts"
                      >
                        <Eye className="h-3 w-3" /> Preview
                      </button>
                      <button
                        onClick={() => download(s.date)}
                        className="text-xs rounded-md px-2 py-1 text-white flex items-center gap-1"
                        style={{ background: 'var(--accent)' }}
                        title="Download JSON"
                      >
                        <Download className="h-3 w-3" /> Download
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Preview column */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="px-4 sm:px-5 py-3 border-b border-border">
                <h2 className="text-sm font-semibold text-foreground">
                  {selectedDate ? `Preview — ${formatDateNice(selectedDate)}` : 'Preview'}
                </h2>
              </div>
              <div className="p-4">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading preview…
                  </div>
                ) : preview ? (
                  <div className="space-y-3">
                    <div className="text-xs text-muted-foreground space-y-1">
                      <p>Generated: <span className="text-foreground">{preview.generatedAt ? new Date(preview.generatedAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—'}</span></p>
                      <p>Tenant ID: <code className="text-[10px] text-foreground">{preview.tenantId ?? '—'}</code></p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {Object.entries(preview.rowCounts)
                        .filter(([, c]) => c > 0)
                        .sort((a, b) => b[1] - a[1])
                        .map(([table, count]) => (
                          <div key={table} className="flex justify-between items-baseline px-3 py-1.5 rounded-md bg-muted/40">
                            <span className="text-xs text-muted-foreground capitalize">{table}</span>
                            <span className="text-sm font-semibold text-foreground">{count.toLocaleString()}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-10">
                    Click <strong>Preview</strong> on a snapshot to see row counts.
                  </p>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Recovery procedure */}
        <div className="bg-card border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            If you ever need to restore
          </h2>
          <ol className="text-xs text-muted-foreground space-y-2 ml-4 list-decimal">
            <li>Download the snapshot from the date BEFORE the incident.</li>
            <li>Email it to <span className="text-foreground">support@clerque.ph</span> with the subject <em>"URGENT — restore from backup"</em>.</li>
            <li>We re-insert the data within 1 business hour (paying customers) or 4 business hours (free tier).</li>
            <li>On restore, every staff member's password is reset; they re-set on next login.</li>
          </ol>
          <p className="text-[11px] text-muted-foreground border-t border-border pt-3">
            Recovery Point Objective (RPO) = up to 24 hours · last cron run was 02:00 UTC ·
            Recovery Time Objective (RTO) = 1 business hour for restoring from any snapshot listed above.
          </p>
        </div>
      </div>
    </div>
  );
}
