'use client';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2, Search, Trash2 } from 'lucide-react';
import { formatPeso } from '@/lib/utils';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BranchPicker } from '@/components/inventory/BranchPicker';
import { TagCard } from '@/components/inventory/TagCard';
import { useInventoryBranch } from '@/hooks/inventory/useInventoryBranch';
import { lookupCode, uploadTagPhoto, writeOffTag } from '@/lib/inventory/tag-api';
import {
  WRITE_OFF_REASONS, apiErrorText, cleanCode, type LookupResult, type Tag, type WriteOffReason,
} from '@/lib/inventory/tags';
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
  const [writeOffNote, setWriteOffNote] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef  = useRef<HTMLInputElement>(null);

  async function find(raw: string = code) {
    const c = cleanCode(raw);
    if (!c) return;
    setLoading(true);
    setError('');
    setPhotoNote('');
    setWriteOffNote('');
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
  // Only the owner writes a part off, and only one still on the shelf.
  const canWriteOff = !!tag && isOwner && (tag.status === 'WAITING_FOR_COST' || tag.status === 'IN_STOCK');

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
          {canWriteOff && (
            <WriteOffPanel
              key={tag.id}
              tag={tag}
              onDone={async (message) => {
                setWriteOffNote(message);
                queryClient.invalidateQueries({ queryKey: ['tags'] });
                // Read the tag again so it shows as written off.
                try { setResult(await lookupCode(tag.number, branchId)); } catch { /* the note says it was written off */ }
              }}
            />
          )}
          {writeOffNote && <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm" role="status">{writeOffNote}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * The owner writes a part off: why, and a photo of the part with its number
 * showing. Damage goes to waste in the books, a lost or stolen part to loss;
 * a part still waiting for its cost was never in the books, so it is only
 * taken off the list.
 */
function WriteOffPanel({ tag, onDone }: { tag: Tag; onDone: (message: string) => Promise<void> }) {
  const [open, setOpen]     = useState(false);
  const [reason, setReason] = useState<WriteOffReason | ''>('');
  const [note, setNote]     = useState('');
  const [photo, setPhoto]   = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <Button variant="outline" onClick={() => setOpen(true)} className="h-12 w-full border-red-500/40 text-base text-red-700 hover:bg-red-500/10 dark:text-red-300">
        <Trash2 className="h-5 w-5" /> Write this part off
      </Button>
    );
  }

  async function save() {
    if (!reason) { setError('Say why it is written off.'); return; }
    if (!photo) { setError('Take a photo of the part with its number showing.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await writeOffTag(tag.id, reason, note, photo);
      await onDone(r.bookedTo
        ? `Tag ${r.number} is written off and out of stock. The books show it as ${r.bookedTo === '5060' ? 'a loss (5060)' : 'waste (5070)'}, at its cost.`
        : `Tag ${r.number} is written off. It had no cost yet, so nothing changes in the books.`);
    } catch (e) {
      setError(apiErrorText(e, 'The part was not written off.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-red-500/40 bg-red-500/5 p-4">
      <p className="text-base font-semibold">Write off Tag {tag.number}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {WRITE_OFF_REASONS.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => { setReason(r.value); setError(''); }}
            aria-pressed={reason === r.value}
            className={`min-h-11 rounded-lg border px-3 py-2 text-sm font-medium ${reason === r.value ? 'border-red-500 bg-red-500/15 text-red-800 dark:text-red-200' : 'border-border bg-card'}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="What happened (optional)" className="h-11" />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { setPhoto(e.target.files?.[0] ?? null); setError(''); e.target.value = ''; }}
      />
      <Button variant="outline" onClick={() => fileRef.current?.click()} className="h-11 w-full">
        <Camera className="h-4 w-4" /> {photo ? `Photo: ${photo.name}` : 'Photo of the part, number showing'}
      </Button>
      {error && <p className="text-sm font-medium text-red-700 dark:text-red-300" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={saving} className="h-11 flex-1 bg-red-600 text-white hover:bg-red-700">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Write it off'}
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="h-11">Cancel</Button>
      </div>
    </section>
  );
}
