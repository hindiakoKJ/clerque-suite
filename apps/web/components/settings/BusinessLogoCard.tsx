'use client';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, RefreshCw, Trash2, ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { LogoFileError, prepareLogoFile, type TenantBranding } from '@/lib/branding';
import { BRANDING_QUERY_KEY, useBranding } from '@/hooks/useBranding';
import { TenantMark } from '@/components/shell/TenantMark';

type Busy = null | 'preparing' | 'uploading' | 'removing';

/** Turn an upload/remove failure into one plain sentence. */
function failureMessage(err: unknown, action: 'upload' | 'remove'): string {
  const res = (err as { response?: { status?: number; data?: { message?: string | string[] } } })?.response;
  if (!res) {
    return action === 'upload'
      ? "The logo didn't upload. Check your connection and try again."
      : "The logo wasn't removed. Check your connection and try again.";
  }
  const raw = res.data?.message;
  const msg = Array.isArray(raw) ? raw[0] : raw;
  if (res.status === 413) return 'The logo is over 1 MB. Try a smaller or simpler image.';
  if (res.status === 404) return "Logo upload isn't available on this server yet. Try again later.";
  if (res.status === 403 && !msg) return 'Only the business owner can change the logo.';
  return msg || (action === 'upload' ? "The logo didn't upload. Try again." : "The logo wasn't removed. Try again.");
}

/**
 * Settings → Business Profile: the one place an owner sets the business logo.
 *
 * The picked file is checked and shrunk in the browser (about 512px, PNG kept
 * transparent), then sent to POST /tenant/logo. The server stores it and keeps
 * only a short link. Every screen reads it through GET /tenant/branding, so the
 * new logo shows up without anyone signing out.
 */
export function BusinessLogoCard() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const { logoSrc, displayName, initials, isLoading } = useBranding();
  const [busy, setBusy]   = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [tileFailed, setTileFailed] = useState(false);
  const [wideFailed, setWideFailed] = useState(false);
  useEffect(() => { setTileFailed(false); setWideFailed(false); }, [logoSrc]);

  const hasLogo = !!logoSrc;

  async function applyNewLogo(logoUrl: string | null) {
    // Show the change right away, then refetch so every screen agrees.
    qc.setQueriesData<TenantBranding | null>({ queryKey: BRANDING_QUERY_KEY }, (old) => (old ? { ...old, logoUrl } : old));
    setTileFailed(false);
    setWideFailed(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: BRANDING_QUERY_KEY }),
      qc.invalidateQueries({ queryKey: ['tenant-profile'] }),
    ]);
  }

  async function handleFile(file: File | undefined | null) {
    if (!file || busy) return;
    setError(null);
    setBusy('preparing');
    try {
      const prepared = await prepareLogoFile(file);
      setBusy('uploading');
      const fd = new FormData();
      fd.append('file', prepared);
      const { data } = await api.post<{ logoUrl?: unknown }>(
        '/tenant/logo', fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      if (typeof data?.logoUrl !== 'string' || !data.logoUrl) {
        throw new LogoFileError("The logo didn't upload. Try again.");
      }
      await applyNewLogo(data.logoUrl);
      toast.success('Logo saved. It now shows across your Clerque apps.');
    } catch (err) {
      setError(err instanceof LogoFileError ? err.message : failureMessage(err, 'upload'));
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function handleRemove() {
    if (busy) return;
    setError(null);
    setBusy('removing');
    try {
      await api.delete('/tenant/logo');
      await applyNewLogo(null);
      toast.success('Logo removed. Your initials show in its place.');
    } catch (err) {
      setError(failureMessage(err, 'remove'));
    } finally {
      setBusy(null);
    }
  }

  const showTileLogo = hasLogo && !tileFailed;
  const busyLabel =
    busy === 'preparing' ? 'Preparing…' :
    busy === 'uploading' ? 'Uploading…' :
    busy === 'removing'  ? 'Removing…'  : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Business Logo</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Shows in the app menu, on the app picker, on receipts and on the customer display.
          Use a PNG, JPG or WEBP image. We shrink it for you, and a transparent PNG keeps its
          see-through background. A square logo reads best in the small spots.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
        {/* Upload tile, 96x96: the logo as-is, or initials + "Add logo". */}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          aria-label={hasLogo ? 'Replace logo' : 'Add logo'}
          className={`group relative w-24 h-24 shrink-0 rounded-xl overflow-hidden flex items-center justify-center transition-colors disabled:cursor-wait ${
            showTileLogo
              ? 'border border-border bg-white'
              : 'border-2 border-dashed border-border bg-muted/30 hover:border-accent'
          }`}
        >
          {isLoading ? (
            <span className="text-[11px] text-muted-foreground">Loading…</span>
          ) : showTileLogo ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={logoSrc}
              alt="Your logo"
              className="max-w-full max-h-full object-contain p-2"
              onError={() => setTileFailed(true)}
            />
          ) : (
            <span className="flex flex-col items-center gap-1">
              {initials ? (
                <span
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'color-mix(in oklab, var(--accent, hsl(217 91% 55%)) 16%, transparent)', color: 'var(--accent, hsl(217 91% 55%))' }}
                >
                  {initials}
                </span>
              ) : (
                <ImagePlus className="w-6 h-6 text-muted-foreground" />
              )}
              <span className="text-[11px] font-medium text-muted-foreground group-hover:text-foreground">
                {hasLogo ? "Can't load" : 'Add logo'}
              </span>
            </span>
          )}
          {busyLabel && (
            <span className="absolute inset-0 bg-background/80 flex items-center justify-center text-[11px] font-medium text-foreground">
              {busyLabel}
            </span>
          )}
        </button>

        {/* Previews: the small square spots and a wide spot, so the owner sees
            how a wide wordmark shrinks before staff do. */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap items-end gap-5">
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">App menu</p>
              <div className="flex items-center gap-3 rounded-lg bg-secondary px-3 py-2">
                <TenantMark size={36} logoSrc={logoSrc} initials={initials || '?'} name={displayName} badgeIcon={ShoppingCart} badgeSize={14} />
                <TenantMark size={24} logoSrc={logoSrc} initials={initials || '?'} name={displayName} badgeIcon={ShoppingCart} badgeSize={10} />
              </div>
            </div>
            <div className="space-y-1.5 min-w-0">
              <p className="text-[11px] text-muted-foreground">Receipt and menu header</p>
              <div className="h-16 w-[216px] max-w-full rounded-lg border border-dashed border-border bg-white flex flex-col items-center justify-center px-2 text-center">
                {hasLogo && !wideFailed ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={logoSrc}
                    alt=""
                    className="max-h-12 max-w-[200px] object-contain"
                    onError={() => setWideFailed(true)}
                  />
                ) : (
                  <span className="text-xs font-bold text-gray-900 truncate max-w-full">
                    {(displayName ?? 'Your business').toUpperCase()}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={!!busy}
              className="flex items-center gap-2 bg-accent hover:opacity-90 text-white text-sm font-medium px-4 py-2 rounded-lg transition-opacity disabled:opacity-50"
            >
              {hasLogo ? <RefreshCw className="w-4 h-4" /> : <ImagePlus className="w-4 h-4" />}
              {hasLogo ? 'Replace' : 'Upload logo'}
            </button>
            {hasLogo && (
              <button
                type="button"
                onClick={() => void handleRemove()}
                disabled={!!busy}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-red-600 border border-border px-3 py-2 rounded-lg hover:bg-red-500/10 transition-colors disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" />
                Remove
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          {hasLogo && (tileFailed || wideFailed) && !error && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Your logo is saved but won&apos;t load right now. Try uploading it again.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
