'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, CheckCircle2, Loader2, Search, X, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatPeso } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BranchPicker } from '@/components/inventory/BranchPicker';
import { useInventoryBranch } from '@/hooks/inventory/useInventoryBranch';
import { createTag, uploadTagPhoto } from '@/lib/inventory/tag-api';
import { apiErrorText, cleanCode, isTagCode, numberFieldFor } from '@/lib/inventory/tags';

/**
 * Tag a part: the receiver scans the next label, picks what the part is,
 * types the engine or chassis number when the part has one, takes photos and
 * saves. The part then waits for the owner's cost before it can be sold.
 *
 * The label box is a plain text box: a USB or Bluetooth scanner types the
 * digits and presses Enter, which moves on to the product search.
 */

interface PosProduct {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  price: number | string;
}

interface Photo { key: string; file: File; preview: string }

/** A tag that saved but whose photos did not all upload: kept so they can be sent again. */
interface PendingPhotos { tagId: string; number: string; photos: Photo[]; error: string }

export default function TagAPartPage() {
  const queryClient = useQueryClient();
  const { branchId, canChoose } = useInventoryBranch();

  const [number, setNumber]       = useState('');
  const [search, setSearch]       = useState('');
  const [product, setProduct]     = useState<PosProduct | null>(null);
  const [engineNumber, setEngine] = useState('');
  const [chassisNumber, setChassis] = useState('');
  const [notes, setNotes]         = useState('');
  const [photos, setPhotos]       = useState<Photo[]>([]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [saved, setSaved]         = useState<string | null>(null);
  const [pending, setPending]     = useState<PendingPhotos | null>(null);

  const numberRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef   = useRef<HTMLInputElement>(null);

  // The same list the till sells from.
  const { data: products = [], isLoading: loadingProducts, isError: productsError } = useQuery<PosProduct[]>({
    queryKey: ['inventory-products', branchId],
    queryFn: () => api.get('/products/pos', { params: { branchId } }).then((r) => r.data),
    enabled: !!branchId,
    staleTime: 60_000,
  });

  const term = search.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!term) return [];
    return products
      .filter((p) =>
        p.name.toLowerCase().includes(term) ||
        (p.sku ?? '').toLowerCase().includes(term) ||
        (p.barcode ?? '').toLowerCase().includes(term))
      .slice(0, 30);
  }, [products, term]);

  const needs = numberFieldFor(product?.sku);

  // Let go of the photo previews when the page closes.
  const photosRef = useRef(photos);
  photosRef.current = photos;
  useEffect(() => () => { photosRef.current.forEach((p) => URL.revokeObjectURL(p.preview)); }, []);

  function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next = Array.from(files).map((file) => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...next]);
    setError('');
  }

  function removePhoto(key: string) {
    setPhotos((prev) => {
      const gone = prev.find((p) => p.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((p) => p.key !== key);
    });
  }

  function pickProduct(p: PosProduct) {
    setProduct(p);
    setSearch('');
    setEngine('');
    setChassis('');
    setError('');
  }

  function resetForm() {
    photos.forEach((p) => URL.revokeObjectURL(p.preview));
    setNumber('');
    setSearch('');
    setProduct(null);
    setEngine('');
    setChassis('');
    setNotes('');
    setPhotos([]);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
    numberRef.current?.focus();
  }

  /** Sends each photo; returns the ones that did not go, with the first reason. */
  async function sendPhotos(tagId: string, list: Photo[]): Promise<{ failed: Photo[]; error: string }> {
    const failed: Photo[] = [];
    let firstError = '';
    for (const p of list) {
      try {
        await uploadTagPhoto(tagId, p.file);
      } catch (e) {
        failed.push(p);
        if (!firstError) firstError = apiErrorText(e, 'The photo was not accepted.');
      }
    }
    return { failed, error: firstError };
  }

  async function save() {
    setSaved(null);
    const code = cleanCode(number);
    if (!isTagCode(code)) { setError('Type or scan the 6-digit number on the label.'); numberRef.current?.focus(); return; }
    if (!product) { setError('Pick what the part is.'); searchRef.current?.focus(); return; }
    if (needs === 'ENGINE' && !engineNumber.trim()) { setError('Type the engine number stamped on the engine.'); return; }
    if (needs === 'CHASSIS' && !chassisNumber.trim()) { setError('Type the chassis number stamped on the part.'); return; }
    if (!branchId) { setError('Pick the branch this part is at.'); return; }
    if (photos.length === 0) { setError('Take at least one photo of the part. It cannot be costed or sold without one.'); return; }

    setSaving(true);
    setError('');
    try {
      const tag = await createTag({
        number: code,
        productId: product.id,
        branchId,
        engineNumber: needs === 'ENGINE' ? engineNumber.trim() : undefined,
        chassisNumber: needs === 'CHASSIS' ? chassisNumber.trim() : undefined,
        notes: notes.trim() || undefined,
      });
      const { failed, error: photoError } = await sendPhotos(tag.id, photos);
      queryClient.invalidateQueries({ queryKey: ['tags'] });
      if (failed.length > 0) {
        // The tag exists; only these photos are missing. Keep them to send again.
        const sent = photos.filter((p) => !failed.includes(p));
        sent.forEach((p) => URL.revokeObjectURL(p.preview));
        setPhotos([]);
        setPending({ tagId: tag.id, number: tag.number, photos: failed, error: photoError });
        return;
      }
      resetForm();
      setSaved(`Tag ${tag.number} saved — waiting for the owner's cost`);
    } catch (e) {
      setError(apiErrorText(e, 'The tag was not saved.'));
    } finally {
      setSaving(false);
    }
  }

  async function retryPhotos() {
    if (!pending) return;
    setSaving(true);
    const { failed, error: photoError } = await sendPhotos(pending.tagId, pending.photos);
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['tags'] });
    if (failed.length > 0) {
      setPending({ ...pending, photos: failed, error: photoError });
      return;
    }
    pending.photos.forEach((p) => URL.revokeObjectURL(p.preview));
    const doneNumber = pending.number;
    setPending(null);
    resetForm();
    setSaved(`Tag ${doneNumber} saved — waiting for the owner's cost`);
  }

  function skipPhotos() {
    if (!pending) return;
    pending.photos.forEach((p) => URL.revokeObjectURL(p.preview));
    const doneNumber = pending.number;
    setPending(null);
    resetForm();
    setSaved(`Tag ${doneNumber} saved without all its photos. Add them from Find a tag before the owner costs it.`);
  }

  if (pending) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div>
              <p className="font-semibold">Tag {pending.number} is saved, but {pending.photos.length} photo{pending.photos.length === 1 ? '' : 's'} did not upload.</p>
              <p className="mt-1 text-sm text-muted-foreground">{pending.error}</p>
            </div>
          </div>
        </div>
        <PhotoGrid photos={pending.photos} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={retryPhotos} disabled={saving} className="h-12 flex-1 text-base">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Send the photos again
          </Button>
          <Button variant="outline" onClick={skipPhotos} disabled={saving} className="h-12">
            Skip, tag the next part
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Tag a part</h2>
          <p className="text-sm text-muted-foreground">One label, one part. The owner sets the cost after.</p>
        </div>
        <BranchPicker />
      </div>

      {saved && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm font-semibold text-emerald-800 dark:text-emerald-300" role="status">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{saved}</span>
        </div>
      )}

      {/* 1. Label number */}
      <section className="space-y-1.5">
        <label htmlFor="tag-number" className="text-sm font-semibold">1. Label number</label>
        <Input
          id="tag-number"
          ref={numberRef}
          autoFocus
          value={number}
          onChange={(e) => { setNumber(e.target.value); setSaved(null); setError(''); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (isTagCode(cleanCode(number))) searchRef.current?.focus();
            }
          }}
          inputMode="numeric"
          autoComplete="off"
          placeholder="e.g. 000457"
          className="h-14 font-mono text-2xl font-bold tracking-widest"
        />
        <p className="text-xs text-muted-foreground">Scan the label, or type the 6 digits under the barcode.</p>
      </section>

      {/* 2. What the part is */}
      <section className="space-y-1.5">
        <label htmlFor="tag-product" className="text-sm font-semibold">2. What is this part?</label>
        {product ? (
          <div className="flex items-center gap-3 rounded-xl border border-[var(--accent)]/40 bg-[var(--accent-soft)] p-3">
            <div className="min-w-0 flex-1">
              <div className="font-semibold leading-tight">{product.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {product.sku ? `${product.sku} · ` : ''}Price {formatPeso(Number(product.price))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => { setProduct(null); setTimeout(() => searchRef.current?.focus(), 0); }}>
              Change
            </Button>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="tag-product"
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  e.preventDefault();
                  // A scanned bin label or product barcode: an exact match picks it.
                  const exact = products.find((p) =>
                    (p.barcode && p.barcode.toLowerCase() === term) || (p.sku && p.sku.toLowerCase() === term));
                  if (exact) pickProduct(exact);
                  else if (matches.length === 1) pickProduct(matches[0]!);
                }}
                autoComplete="off"
                placeholder="Search by name or SKU, or scan the bin label"
                className="h-12 pl-9 text-base"
                disabled={!branchId}
              />
            </div>
            {!branchId && canChoose && <p className="text-xs text-muted-foreground">Pick the branch first.</p>}
            {productsError && <p className="text-xs text-red-600">Could not load the product list. Check the connection.</p>}
            {term && (
              <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-card">
                {loadingProducts ? (
                  <li className="p-3 text-sm text-muted-foreground">Loading…</li>
                ) : matches.length === 0 ? (
                  <li className="p-3 text-sm text-muted-foreground">No product matches. The owner adds products in Counter.</li>
                ) : (
                  matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => pickProduct(p)}
                        className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-muted"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{p.name}</span>
                          {p.sku && <span className="block font-mono text-xs text-muted-foreground">{p.sku}</span>}
                        </span>
                        <span className="shrink-0 text-sm font-semibold">{formatPeso(Number(p.price))}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </>
        )}
      </section>

      {/* 3. Engine or chassis number, only for the parts that carry one */}
      {needs === 'ENGINE' && (
        <section className="space-y-1.5">
          <label htmlFor="tag-engine" className="text-sm font-semibold">3. Engine number</label>
          <Input
            id="tag-engine"
            value={engineNumber}
            onChange={(e) => setEngine(e.target.value.toUpperCase())}
            autoComplete="off"
            placeholder="As stamped on the engine, e.g. 2NZ-1234567"
            className="h-12 font-mono text-base"
          />
          <p className="text-xs text-muted-foreground">Copy it exactly. It cannot be changed later. Take a photo of the stamp too.</p>
        </section>
      )}
      {needs === 'CHASSIS' && (
        <section className="space-y-1.5">
          <label htmlFor="tag-chassis" className="text-sm font-semibold">3. Chassis number</label>
          <Input
            id="tag-chassis"
            value={chassisNumber}
            onChange={(e) => setChassis(e.target.value.toUpperCase())}
            autoComplete="off"
            placeholder="As stamped on the part, e.g. NZE141-6048723"
            className="h-12 font-mono text-base"
          />
          <p className="text-xs text-muted-foreground">Copy it exactly. It cannot be changed later. Take a photo of the stamp too.</p>
        </section>
      )}

      {/* Notes */}
      <section className="space-y-1.5">
        <label htmlFor="tag-notes" className="text-sm font-semibold">Notes (optional)</label>
        <textarea
          id="tag-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Condition, what comes with it (ALT, A/C, starter), pair or set numbers"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
      </section>

      {/* Photos */}
      <section className="space-y-2">
        <div className="text-sm font-semibold">Photos</div>
        <PhotoGrid photos={photos} onRemove={removePhoto} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => { addPhotos(e.target.files); e.target.value = ''; }}
        />
        <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="h-12 w-full text-base">
          <Camera className="h-5 w-5" />
          {photos.length === 0 ? 'Take photos' : 'Take more photos'}
        </Button>
        <p className="text-xs text-muted-foreground">Whole part, both sides, any damage, and the number stamp if it has one.</p>
      </section>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm font-medium text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      )}

      <Button onClick={save} disabled={saving} className="h-14 w-full text-base">
        {saving ? <><Loader2 className="h-5 w-5 animate-spin" /> Saving…</> : 'Save this tag'}
      </Button>
    </div>
  );
}

function PhotoGrid({ photos, onRemove }: { photos: Photo[]; onRemove?: (key: string) => void }) {
  if (photos.length === 0) return null;
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {photos.map((p) => (
        <div key={p.key} className={cn('relative aspect-square overflow-hidden rounded-lg border border-border bg-muted')}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local preview, not a static asset */}
          <img src={p.preview} alt="Part photo" className="h-full w-full object-cover" />
          {onRemove && (
            <button
              type="button"
              onClick={() => onRemove(p.key)}
              aria-label="Remove this photo"
              className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
