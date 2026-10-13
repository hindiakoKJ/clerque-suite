'use client';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Search } from 'lucide-react';
import { formatPeso } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BranchPicker } from '@/components/inventory/BranchPicker';
import { TagCard } from '@/components/inventory/TagCard';
import { useInventoryBranch } from '@/hooks/inventory/useInventoryBranch';
import { lookupCode, uploadTagPhoto } from '@/lib/inventory/tag-api';
import { apiErrorText, cleanCode, type LookupResult } from '@/lib/inventory/tags';
import { OWNER_ROLES } from '../inventory-nav';

/**
 * Find a tag: type or scan any code. A label number shows the part, its
 * photos, its price and whether it can be sold; a product barcode or SKU
 * shows the product; anything else says so.
 */
export default function FindTagPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isOwner = !!user && OWNER_ROLES.includes(user.role);
  const { branchId } = useInventoryBranch();

  const [code, setCode]         = useState('');
  const [searched, setSearched] = useState('');
  const [result, setResult]     = useState<LookupResult | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoNote, setPhotoNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef  = useRef<HTMLInputElement>(null);

  async function find(raw: string = code) {
    const c = cleanCode(raw);
    if (!c) return;
    setLoading(true);
    setError('');
    setPhotoNote('');
    try {
      const r = await lookupCode(c, branchId);
      setResult(r);
      setSearched(c);
      setCode('');
    } catch (e) {
      setResult(null);
      setError(apiErrorText(e, 'Could not look that code up.'));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }

  const tag = result?.kind === 'TAG' ? result.tag : null;
  // Staff add photos only while the part waits for its cost; after that, the owner alone (the API's rule).
  const canAddPhotos = !!tag && (tag.status === 'WAITING_FOR_COST' || (isOwner && tag.status === 'IN_STOCK'));

  async function addPhotos(files: FileList | null) {
    if (!tag || !files || files.length === 0) return;
    setUploading(true);
    setPhotoNote('');
    let sent = 0;
    let firstError = '';
    for (const file of Array.from(files)) {
      try {
        await uploadTagPhoto(tag.id, file);
        sent++;
      } catch (e) {
        if (!firstError) firstError = apiErrorText(e, 'The photo was not accepted.');
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: ['tags'] });
    setPhotoNote(firstError
      ? `${sent} photo${sent === 1 ? '' : 's'} added. ${firstError}`
      : `${sent} photo${sent === 1 ? '' : 's'} added.`);
    // Read the tag again so the new photos show.
    try { setResult(await lookupCode(tag.number, branchId)); } catch { /* the note above already says what happened */ }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Find a tag</h2>
          <p className="text-sm text-muted-foreground">Type or scan a label number, a barcode or a SKU.</p>
        </div>
        <BranchPicker />
      </div>

      <form
        className="flex gap-2"
        onSubmit={(e) => { e.preventDefault(); void find(); }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoComplete="off"
            placeholder="e.g. 000457"
            aria-label="Code to find"
            className="h-14 pl-10 font-mono text-xl font-semibold"
          />
        </div>
        <Button type="submit" disabled={loading || !code.trim()} className="h-14 px-6 text-base">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Find'}
        </Button>
      </form>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm font-medium text-red-700 dark:text-red-300" role="alert">{error}</p>
      )}

      {result?.kind === 'NONE' && (
        <div className="rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-base font-semibold">No tag or product with that code</p>
          <p className="mt-1 font-mono text-sm text-muted-foreground">{searched}</p>
        </div>
      )}

      {result?.kind === 'PRODUCT' && (
        <div className="rounded-xl border border-border bg-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Product (not a tag)</p>
          <p className="mt-1 text-lg font-semibold">{result.product.name}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Price</dt>
            <dd className="font-semibold">{formatPeso(Number(result.product.price))}</dd>
            {result.product.sku && <><dt className="text-muted-foreground">SKU</dt><dd className="font-mono">{result.product.sku}</dd></>}
            {result.product.barcode && <><dt className="text-muted-foreground">Barcode</dt><dd className="font-mono">{result.product.barcode}</dd></>}
          </dl>
        </div>
      )}

      {tag && (
        <div className="space-y-3">
          <TagCard tag={tag} large />
          {canAddPhotos && (
            <div className="space-y-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => { void addPhotos(e.target.files); e.target.value = ''; }}
              />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="h-12 w-full text-base">
                {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Camera className="h-5 w-5" />}
                Add photos to this tag
              </Button>
              {photoNote && <p className="text-sm text-muted-foreground" role="status">{photoNote}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
