'use client';
/**
 * Sprint 25 Phase 2C — Auto-backup admin page.
 *
 * Shows latest backup status and lets the owner trigger a manual run. Google
 * Drive OAuth ingestion is a TODO — the placeholder button is wired but
 * disabled until the OAuth flow lands.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CloudUpload, Database, PlayCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

interface LatestMeta {
  exists:      boolean;
  filename?:   string;
  sizeBytes?:  number;
  generatedAt?: string;
}

interface BackupConfig {
  googleDriveTokens?: Record<string, unknown>;
  folderId?:          string;
  lastBackupAt?:      string;
}

function formatBytes(n: number | undefined): string {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AutoBackupPage() {
  const qc = useQueryClient();

  const { data: latest, isLoading: loadingLatest } = useQuery({
    queryKey: ['auto-backup', 'latest'],
    queryFn:  async () => {
      const res = await api.get<LatestMeta>('/auto-backup/latest');
      return res.data;
    },
  });

  const { data: config } = useQuery({
    queryKey: ['auto-backup', 'config'],
    queryFn:  async () => {
      const res = await api.get<BackupConfig>('/auto-backup/config');
      return res.data;
    },
  });

  const runNow = useMutation({
    mutationFn: async () => {
      const res = await api.post('/auto-backup/run');
      return res.data;
    },
    onSuccess: () => {
      toast.success('Backup generated.');
      qc.invalidateQueries({ queryKey: ['auto-backup', 'latest'] });
      qc.invalidateQueries({ queryKey: ['auto-backup', 'config'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message ?? 'Backup failed.');
    },
  });

  return (
    <div className="flex flex-col h-full overflow-auto">
      <header className="bg-background border-b border-border px-4 sm:px-6 py-5">
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold">Auto-backup</h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1">
          Nightly JSON export of your products, orders, customers and inventory.
          Pro-tier feature.
        </p>
      </header>

      <main className="p-4 sm:p-6 space-y-6">
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm font-semibold mb-3">Latest backup</h2>
          {loadingLatest ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : !latest?.exists ? (
            <p className="text-sm text-muted-foreground">
              No backups have been generated yet. Run one now or wait for the
              nightly 02:00 cron.
            </p>
          ) : (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <dt className="text-muted-foreground">File</dt>
              <dd className="font-mono">{latest.filename}</dd>
              <dt className="text-muted-foreground">Size</dt>
              <dd>{formatBytes(latest.sizeBytes)}</dd>
              <dt className="text-muted-foreground">Generated</dt>
              <dd>{latest.generatedAt ? new Date(latest.generatedAt).toLocaleString() : '—'}</dd>
              {config?.lastBackupAt && (
                <>
                  <dt className="text-muted-foreground">Last recorded</dt>
                  <dd>{new Date(config.lastBackupAt).toLocaleString()}</dd>
                </>
              )}
            </dl>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
            >
              <PlayCircle className="h-4 w-4" />
              {runNow.isPending ? 'Running…' : 'Run backup now'}
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground"
              disabled
              title="OAuth flow coming in a follow-up commit"
            >
              <CloudUpload className="h-4 w-4" />
              Connect Google Drive (coming soon)
            </button>
          </div>
        </section>

        <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground">
          <p>
            Backups are written to <code className="font-mono">apps/api/backups/&lt;tenantId&gt;/&lt;date&gt;.json</code>{' '}
            on the API host. Once Google Drive is connected, the same JSON will
            be uploaded to your selected folder after each nightly run.
          </p>
        </section>
      </main>
    </div>
  );
}
