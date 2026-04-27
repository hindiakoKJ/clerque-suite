'use client';

import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Download, Trash2, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocumentEntityType =
  | 'Order'
  | 'ExpenseEntry'
  | 'JournalEntry'
  | 'ExpenseClaim';

export interface DocumentAttachmentsProps {
  entityType: DocumentEntityType;
  entityId: string;
  /** When false (default), upload and delete controls are hidden. */
  canManage?: boolean;
}

interface DocumentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  label: string | null;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ACCEPTED_MIME = 'application/pdf,image/jpeg,image/png,image/webp';
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function queryKey(entityType: string, entityId: string) {
  return ['documents', entityType, entityId];
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function DocumentAttachments({
  entityType,
  entityId,
  canManage = false,
}: DocumentAttachmentsProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [label, setLabel] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // ── Fetch documents ────────────────────────────────────────────────────────

  const { data: documents = [], isLoading } = useQuery<DocumentRecord[]>({
    queryKey: queryKey(entityType, entityId),
    queryFn: () =>
      api
        .get('/documents', { params: { entityType, entityId } })
        .then((r) => r.data),
    enabled: !!entityId,
  });

  // ── Delete mutation ────────────────────────────────────────────────────────

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/documents/${id}`),
    onMutate: (id) => setDeletingId(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKey(entityType, entityId) });
      toast.success('Attachment deleted.');
    },
    onError: () => toast.error('Failed to delete attachment.'),
    onSettled: () => setDeletingId(null),
  });

  // ── Upload handler ────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = '';

    if (!file) return;

    if (file.size > MAX_BYTES) {
      toast.error('File exceeds 10 MB limit.');
      return;
    }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.type)) {
      toast.error('Only PDF, JPEG, PNG, and WEBP files are allowed.');
      return;
    }

    const form = new FormData();
    form.append('file', file);
    form.append('entityType', entityType);
    form.append('entityId', entityId);
    if (label.trim()) form.append('label', label.trim());

    setUploading(true);
    try {
      await api.post('/documents/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      qc.invalidateQueries({ queryKey: queryKey(entityType, entityId) });
      setLabel('');
      toast.success('File uploaded successfully.');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message;
      toast.error(msg ?? 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  // ── Download handler ─────────────────────────────────────────────────────

  function handleDownload(doc: DocumentRecord) {
    const url = `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'}/documents/${doc.id}/download`;

    // Construct a temporary link to trigger download with auth header is not
    // straightforward via <a>, so we fetch via axios and create an object URL.
    api
      .get(`/documents/${doc.id}/download`, { responseType: 'blob' })
      .then((res) => {
        const blob = new Blob([res.data], { type: doc.mimeType });
        const href = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = href;
        a.download = doc.filename;
        a.click();
        URL.revokeObjectURL(href);
      })
      .catch(() => toast.error('Download failed.'));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading attachments…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section heading */}
      <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        <Paperclip className="h-3.5 w-3.5" />
        Attachments
        {documents.length > 0 && (
          <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {documents.length}
          </span>
        )}
      </div>

      {/* Document list */}
      {documents.length > 0 ? (
        <ul className="space-y-1.5">
          {documents.map((doc) => (
            <li
              key={doc.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
            >
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />

              <div className="flex-1 min-w-0">
                <p className="truncate font-medium text-foreground">
                  {doc.filename}
                </p>
                <p className="text-muted-foreground">
                  {formatBytes(doc.sizeBytes)}
                  {doc.label && (
                    <>
                      {' '}
                      &middot;{' '}
                      <span className="inline-flex items-center rounded bg-muted border border-border px-1.5 py-0.5 text-[10px] font-medium text-foreground">
                        {doc.label}
                      </span>
                    </>
                  )}
                </p>
              </div>

              {/* Download */}
              <button
                onClick={() => handleDownload(doc)}
                title="Download"
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
              </button>

              {/* Delete */}
              {canManage && (
                <button
                  onClick={() => {
                    if (!confirm(`Delete "${doc.filename}"?`)) return;
                    deleteMut.mutate(doc.id);
                  }}
                  disabled={deletingId === doc.id}
                  title="Delete"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-40"
                >
                  {deletingId === doc.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No attachments yet.</p>
      )}

      {/* Upload controls */}
      {canManage && (
        <div className="space-y-2 pt-1">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional) — e.g. Official Receipt"
            className="h-8 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] transition-shadow"
          />

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MIME}
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Paperclip className="h-3.5 w-3.5" />
                Attach file
              </>
            )}
          </button>

          <p className="text-[10px] text-muted-foreground">
            PDF, JPEG, PNG, WEBP &middot; max 10 MB
          </p>
        </div>
      )}
    </div>
  );
}
