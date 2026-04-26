'use client';
import { useState, useRef, useCallback } from 'react';
import {
  Upload,
  FileSpreadsheet,
  Download,
  CheckCircle2,
  XCircle,
  AlertCircle,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { downloadAuthFile } from '@/lib/utils';

interface ImportError {
  row: number;
  message: string;
}

interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
}

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  templateUrl: string;
  uploadUrl: string;
  /** Additional query params appended to uploadUrl, e.g. { branchId: 'abc' } */
  extraParams?: Record<string, string>;
  onSuccess?: (result: ImportResult) => void;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function ImportModal({
  open,
  onClose,
  title,
  description,
  templateUrl,
  uploadUrl,
  extraParams,
  onSuccess,
}: ImportModalProps) {
  const [dragging, setDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function resetState() {
    setSelectedFile(null);
    setResult(null);
    setUploadError(null);
    setUploading(false);
    setDragging(false);
  }

  function handleClose() {
    resetState();
    onClose();
  }

  function acceptFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (ext !== 'xlsx' && ext !== 'csv') {
      setUploadError('Only .xlsx and .csv files are accepted.');
      return;
    }
    setUploadError(null);
    setResult(null);
    setSelectedFile(file);
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) acceptFile(file);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) acceptFile(file);
    // Reset input so the same file can be re-selected after clearing
    e.target.value = '';
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setUploadError(null);
    setResult(null);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      // Build URL with extra params
      let url = uploadUrl;
      if (extraParams && Object.keys(extraParams).length > 0) {
        const qs = new URLSearchParams(extraParams).toString();
        url = `${url}?${qs}`;
      }

      const { data } = await api.post<ImportResult>(url, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setResult(data);
      onSuccess?.(data);
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ??
        err?.message ??
        'Upload failed. Please try again.';
      setUploadError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const fullUrl = `${API_URL}${templateUrl}`;
      const filename = templateUrl.split('/').pop() + '.xlsx';
      await downloadAuthFile(fullUrl, filename.replace('.xlsx.xlsx', '.xlsx'));
    } catch {
      setUploadError('Failed to download template. Please try again.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  const hasErrors = result && result.errors.length > 0;
  const isSuccess = result !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg w-full">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
        </DialogHeader>

        <div className="space-y-4 mt-1">
          {/* Template download */}
          <button
            onClick={handleDownloadTemplate}
            disabled={downloadingTemplate}
            className="flex items-center gap-2 w-full px-4 py-2.5 rounded-lg border border-dashed border-border bg-background text-sm font-medium text-muted-foreground hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors disabled:opacity-50"
          >
            <Download className="h-4 w-4 shrink-0" />
            {downloadingTemplate ? 'Downloading template…' : 'Download Template (.xlsx)'}
          </button>

          {/* Drop zone */}
          {!isSuccess && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-8 cursor-pointer transition-colors select-none ${
                dragging
                  ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                  : selectedFile
                  ? 'border-[var(--accent)]/50 bg-[var(--accent)]/3'
                  : 'border-border bg-muted/30 hover:border-[var(--accent)]/50 hover:bg-muted/50'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.csv"
                className="sr-only"
                onChange={handleFileInput}
              />
              {selectedFile ? (
                <>
                  <FileSpreadsheet
                    className="h-8 w-8"
                    style={{ color: 'var(--accent)' }}
                  />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      {selectedFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {(selectedFile.size / 1024).toFixed(1)} KB — click to change
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <Upload className="h-8 w-8 text-muted-foreground" />
                  <div className="text-center">
                    <p className="text-sm font-medium text-foreground">
                      Drop your file here, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Accepts .xlsx and .csv files
                    </p>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Upload error */}
          {uploadError && (
            <div className="flex items-start gap-2.5 rounded-lg border border-red-400/30 bg-red-500/8 px-3 py-2.5">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-600 dark:text-red-400">{uploadError}</p>
            </div>
          )}

          {/* Results panel */}
          {isSuccess && (
            <div className="rounded-xl border border-border bg-background overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/30">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">Import Complete</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {result.imported} imported
                    {result.updated > 0 && `, ${result.updated} updated`}
                    {result.skipped > 0 && `, ${result.skipped} skipped`}
                    {result.errors.length > 0 && `, ${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`}
                  </p>
                </div>
                <button
                  onClick={() => { resetState(); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 underline underline-offset-2"
                >
                  Import another
                </button>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 divide-x divide-border text-center">
                <div className="px-3 py-2.5">
                  <p className="text-base font-bold text-green-600 dark:text-green-400">
                    {result.imported}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-0.5">
                    Created
                  </p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-base font-bold" style={{ color: 'var(--accent)' }}>
                    {result.updated}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-0.5">
                    Updated
                  </p>
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-base font-bold text-muted-foreground">
                    {result.skipped}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-0.5">
                    Skipped
                  </p>
                </div>
                <div className="px-3 py-2.5">
                  <p className={`text-base font-bold ${result.errors.length > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                    {result.errors.length}
                  </p>
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mt-0.5">
                    Errors
                  </p>
                </div>
              </div>

              {/* Error list */}
              {hasErrors && (
                <div className="border-t border-red-400/30 bg-red-500/5">
                  <div className="px-4 py-2 flex items-center gap-2">
                    <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                    <p className="text-xs font-semibold text-red-600 dark:text-red-400">
                      Row errors — please fix and re-import
                    </p>
                  </div>
                  <div className="max-h-36 overflow-y-auto border-t border-red-400/20">
                    {result.errors.map((err, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 px-4 py-1.5 border-b border-red-400/10 last:border-b-0"
                      >
                        <span className="text-[10px] font-mono font-semibold text-red-400 shrink-0 mt-0.5 min-w-[3.5rem]">
                          Row {err.row}
                        </span>
                        <span className="text-xs text-red-600 dark:text-red-400 leading-relaxed">
                          {err.message}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleClose}
              className="flex-1 h-9 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
            >
              {isSuccess ? 'Done' : 'Cancel'}
            </button>
            {!isSuccess && (
              <button
                onClick={handleUpload}
                disabled={!selectedFile || uploading}
                className="flex-1 h-9 rounded-lg text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {uploading ? 'Uploading…' : 'Upload & Import'}
              </button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
