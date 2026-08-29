'use client';
/**
 * Sprint 19 — Import Templates download page.
 *
 * Single screen where the owner can grab every Excel template Clerque
 * accepts for bulk import. The Products template is vertical-aware: a
 * pharmacy tenant downloads a 15-column template with medicine fields
 * and lot/expiry seed; a coffee shop gets espresso + latte sample rows;
 * a laundry gets wash & dry per kilo. Everyone else (retail / service /
 * mfg / trucking / construction) gets a vertical-tailored sample set.
 *
 * Server generates the .xlsx on the fly per request, so there's no
 * static file to keep up to date.
 */
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft, Download, Package, Boxes, Users as UsersIcon, Truck,
  FileSpreadsheet, Loader2, BookOpen, Scroll, Box, Info, Sprout, ChefHat,
  Upload, CheckCircle2, AlertTriangle, ArrowRightLeft,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, resolveAssetUrl } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { isRecipeBusinessType } from '@repo/shared-types';

interface TenantProfile {
  businessType?: string | null;
}

const VERTICAL_NAME: Record<string, string> = {
  COFFEE_SHOP:   'Coffee Shop',
  RESTAURANT:    'Restaurant',
  BAKERY:        'Bakery',
  FOOD_STALL:    'Food Stall',
  BAR_LOUNGE:    'Bar / Lounge',
  CATERING:      'Catering',
  RETAIL:        'Retail',
  SERVICE:       'Service',
  LAUNDRY:       'Laundry',
  MANUFACTURING: 'Manufacturing',
  PHARMACY:      'Pharmacy',
  TRUCKING:      'Trucking',
  CONSTRUCTION:  'Construction',
};

interface TemplateInfo {
  id:        string;
  name:      string;
  desc:      string;
  endpoint:  string;
  filename:  string;
  Icon:      typeof Package;
  highlight?: boolean;
  /**
   * POST route that accepts the filled-in workbook. Templates whose data is
   * seeded elsewhere (the bundled Setup Pack) leave this unset and stay
   * download-only.
   */
  upload?:   string;
  /**
   * GET route returning the shop's OWN data in this template's columns.
   *
   * The blank template answers "what do I have to fill in?". This answers
   * "what do I already have?", which is the only question a shop past day one
   * is asking — and the reason ingredient files kept being rebuilt by hand
   * outside the app, in whatever shape the person rebuilding them chose.
   * Same columns either way, so what comes out is what Import takes back.
   */
  exportEndpoint?: string;
  exportFilename?: string;
}

/** Shape every importer returns. Fields it doesn't use simply stay 0. */
interface ImportResult {
  created?:  number;
  updated?:  number;
  skipped?:  number;
  imported?: number;
  errors?:   Array<{ row?: number; message?: string } | string>;
  /** Rows imported with no Cost Price — surfaced so margins are not trusted blindly. */
  missingCost?: number;
}

export default function ImportTemplatesPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);

  // Sprint 19 — Owner-only. Bulk imports can replace the entire catalog
  // and should never be triggered by a cashier or front-of-house staff.
  const isOwner = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  useEffect(() => {
    if (user && !isOwner) router.replace('/settings');
  }, [user, isOwner, router]);

  const { data: profile } = useQuery<TenantProfile>({
    queryKey: ['tenant-profile'],
    queryFn:  () => api.get('/tenant/profile').then((r) => r.data),
    enabled:  !!user && isOwner,
  });

  if (user && !isOwner) return null;

  const businessType = profile?.businessType ?? null;
  const verticalLabel = businessType ? (VERTICAL_NAME[businessType] ?? businessType) : '—';
  const isPharmacy = businessType === 'PHARMACY';
  // Same predicate the Setup Pack builder uses on the server, so the sheets
  // this page offers and describes always match the file that is generated.
  const isRecipeFriendly = isRecipeBusinessType(businessType);

  const [downloading, setDownloading] = useState<string | null>(null);
  const [uploading, setUploading]     = useState<string | null>(null);
  const [results, setResults]         = useState<Record<string, ImportResult | { failed: string }>>({});

  /**
   * Upload a filled-in template straight from this page.
   *
   * Ingredients and Recipes have importer endpoints but no module screen of
   * their own, so before this there was nowhere in the product to actually
   * send them — the page told you to "use the Import button on each module's
   * page" and for those two no such button existed. Recipe COGS was therefore
   * effectively unreachable without API access.
   */
  async function uploadFilled(t: TemplateInfo, file: File) {
    if (!t.upload) return;
    setUploading(t.id);
    setResults((r) => ({ ...r, [t.id]: undefined as unknown as ImportResult }));
    try {
      const form = new FormData();
      form.append('file', file);
      // The api instance defaults to Content-Type: application/json, and axios
      // serialises FormData to JSON whenever that header is set — the file
      // arrived at the server as {"file":{}} and every upload from this page
      // failed with "No file uploaded." Naming multipart here is what the
      // other upload screens do, and it lets the browser write the boundary.
      const { data } = await api.post<ImportResult | Record<string, ImportResult>>(
        t.upload,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );

      // The Setup Pack answers per SHEET ({ products: {...}, customers: {...} })
      // rather than with one flat tally, so add the sheets up — otherwise a
      // successful multi-sheet import reports "0 added".
      const isPerSheet =
        !!data &&
        typeof data === 'object' &&
        (data as ImportResult).created === undefined &&
        (data as ImportResult).imported === undefined &&
        Object.values(data as Record<string, unknown>).some(
          (v) => !!v && typeof v === 'object' && 'imported' in (v as object),
        );

      const totals: ImportResult = isPerSheet
        ? Object.values(data as Record<string, ImportResult>)
            .filter((v) => !!v && typeof v === 'object')
            .reduce<ImportResult>(
              (acc, sheet) => ({
                created:     (acc.created ?? 0) + (sheet.created ?? sheet.imported ?? 0),
                updated:     (acc.updated ?? 0) + (sheet.updated ?? 0),
                skipped:     (acc.skipped ?? 0) + (sheet.skipped ?? 0),
                missingCost: (acc.missingCost ?? 0) + (sheet.missingCost ?? 0),
                errors:      [...(acc.errors ?? []), ...(sheet.errors ?? [])],
              }),
              { created: 0, updated: 0, skipped: 0, missingCost: 0, errors: [] },
            )
        : ((data as ImportResult) ?? {});

      setResults((r) => ({ ...r, [t.id]: totals }));
      const created = totals.created ?? totals.imported ?? 0;
      const updated = totals.updated ?? 0;
      const skipped = totals.skipped ?? 0;
      const errs    = totals.errors?.length ?? 0;
      // Skipped has to be said out loud. Rows carrying a reference number that
      // has already been taken in are refused on purpose -- that is what stops
      // a delivery being received twice. Reporting only "0 added, 0 updated"
      // makes a working safeguard look like a failed upload, and the natural
      // response to a failed upload is to try again.
      const skipNote = skipped ? `, ${skipped} already imported (skipped)` : '';
      if (errs > 0) toast.warning(`${t.name}: ${created} added, ${updated} updated${skipNote}, ${errs} row(s) need attention.`);
      else if (created === 0 && updated === 0 && skipped > 0)
        toast.success(`${t.name}: nothing new — all ${skipped} row(s) were already imported.`);
      else toast.success(`${t.name}: ${created} added, ${updated} updated${skipNote}.`);
    } catch (err: any) {
      // A timeout or dropped connection is NOT proof that nothing happened.
      // A big import runs for a while server-side; the browser giving up first
      // showed a bare "Upload failed", and the obvious response to that is to
      // upload again. Say what is actually known, and point at the safeguard.
      const status  = err?.response?.status;
      const noReply = !err?.response || err?.code === 'ECONNABORTED';
      const raw     = err?.response?.data?.message;
      const msg = noReply || status === 504 || status === 502
        ? 'The server did not answer in time. It may still have finished — reload this page and check '
          + 'before uploading again. Rows carrying a Reference Number that is already in are skipped, '
          + 'so a second upload cannot double anything.'
        : (Array.isArray(raw) ? raw.join(' ') : String(raw ?? 'Upload failed.'));
      setResults((r) => ({ ...r, [t.id]: { failed: msg } }));
      toast.error(msg);
    } finally {
      setUploading(null);
    }
  }

  async function downloadTemplate(t: TemplateInfo, mode: 'blank' | 'mine' = 'blank') {
    const endpoint = mode === 'mine' ? t.exportEndpoint! : t.endpoint;
    const filename = mode === 'mine' ? t.exportFilename! : t.filename;
    setDownloading(mode === 'mine' ? `${t.id}:mine` : t.id);
    try {
      const res = await api.get(endpoint, { responseType: 'blob' });
      const blob = new Blob([res.data as any], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Download failed.');
    } finally {
      setDownloading(null);
    }
  }

  const templates: TemplateInfo[] = [
    {
      id: 'loyverse',
      name: 'Coming from Loyverse? Migrate your catalog',
      desc:
        'Upload the "Item list" export straight from Loyverse (Back office → Items → Export) — no retyping and no reformatting. ' +
        'Columns are matched automatically, size/variant items become separate products, and stock on hand is carried over. ' +
        'Download gives you a sample export showing the columns we read.',
      endpoint: '/import/template/loyverse',
      filename: 'clerque-loyverse-sample.xlsx',
      upload:   '/import/loyverse',
      Icon: ArrowRightLeft,
      highlight: true,
    },
    {
      id: 'setup-pack',
      name: 'Business Setup Pack (all-in-one)',
      desc: isRecipeFriendly
        ? 'One workbook for the whole setup: Products (with opening stock), Ingredients, Recipes, Customers, Vendors and Chart of Accounts. Fill the sheets in order — Recipes link to Products and Ingredients by name. Untouched sheets are skipped.'
        : 'One workbook with Products (including opening stock), Customers, Vendors and Chart of Accounts. Fill only the sheets you need — untouched sheets are skipped. Best for first-time setup.',
      endpoint: '/import/template/setup-pack',
      exportEndpoint: '/import/export/setup-pack',
      exportFilename: 'clerque-my-setup.xlsx',
      upload:   '/import/setup-pack',
      filename: 'clerque-setup-pack.xlsx',
      Icon: Box,
      highlight: true,
    },
    {
      id: 'products',
      name: `Products${isPharmacy ? ' (with drug class + lot)' : ''}`,
      desc: isPharmacy
        ? '15 columns including Generic Name, Brand, Dosage Form, Strength, Drug Class, Initial Lot # + Expiry, and Initial Stock. Drug-class drives the till workflow at sale.'
        : isRecipeFriendly
          ? `Your menu, tailored to ${verticalLabel}. Fill Opening Stock for anything you buy ready to sell (bottled drinks, chips) — that stocks it here, no second file needed. Leave it blank for made-to-order items; those are stocked by their ingredients via the Ingredients + Recipes templates below.`
          : `Your catalog, tailored to ${verticalLabel}. Fill Opening Stock with what you have on hand and you are done — no separate inventory file needed.`,
      endpoint: '/import/template/products',
      upload:   '/import/products',
      filename: `clerque-products-${(businessType ?? 'general').toLowerCase()}.xlsx`,
      Icon: Package,
    },
    ...(isRecipeFriendly ? [
      {
        id: 'ingredients',
        name: 'Ingredients (Raw Materials)',
        desc: `For recipe-based COGS. Define every raw material your products are made from (espresso beans, milk, rice, sauce…) with cost per unit. Required before importing Recipes.`,
        endpoint: '/import/template/ingredients',
        exportEndpoint: '/import/export/ingredients',
        exportFilename: 'clerque-ingredients.xlsx',
      upload:   '/import/ingredients',
        filename: 'clerque-ingredients.xlsx',
        Icon: Sprout,
      },
      {
        id: 'recipes',
        name: 'Recipes (BOM)',
        desc: `One row per ingredient × product. Maps your menu items to ingredients with quantities — Iced Latte 16oz = 18g beans + 200ml milk + 1 cup + 1 lid + 1 stirrer. Auto-flips matched products to RECIPE_BASED so COGS is derived live from ingredients × WAC.`,
        endpoint: '/import/template/recipes',
        exportEndpoint: '/import/export/recipes',
        exportFilename: 'clerque-recipes.xlsx',
      upload:   '/import/recipes',
        filename: 'clerque-recipes.xlsx',
        Icon: ChefHat,
      },
    ] as TemplateInfo[] : []),
    {
      id: 'inventory',
      name: 'Inventory (stock count)',
      desc: 'Only needed for a later stock take, or to set counts at a SECOND branch. First-time setup does not need this — put the count in the Products sheet’s Opening Stock column instead.',
      endpoint: '/import/template/inventory',
      upload:   '/import/inventory',
      filename: 'clerque-inventory.xlsx',
      Icon: Boxes,
    },
    {
      id: 'customers',
      name: 'Customers',
      desc: 'Customer master (AR sub-ledger). Includes credit terms, credit limits, and contact details for B2B / charge-account billing.',
      endpoint: '/import/template/customers',
      upload:   '/import/customers',
      filename: 'clerque-customers.xlsx',
      Icon: UsersIcon,
    },
    {
      id: 'vendors',
      name: 'Vendors / Suppliers',
      desc: 'Vendor master (AP). Captures BIR TIN, default WHT rate, ATC code, and credit terms — drives input VAT + 2306 workflows.',
      endpoint: '/import/template/vendors',
      upload:   '/import/vendors',
      filename: 'clerque-vendors.xlsx',
      Icon: Truck,
    },
    {
      id: 'stock-receipts',
      name: 'Stock Receipts (incoming deliveries)',
      desc: 'Bulk-load past supplier deliveries with lot + expiry. Posts to inventory + creates lots. Useful when migrating from another system.',
      endpoint: '/import/template/stock-receipts',
      upload:   '/import/stock-receipts',
      filename: 'clerque-stock-receipts.xlsx',
      Icon: FileSpreadsheet,
    },
    {
      id: 'coa',
      name: 'Chart of Accounts',
      desc: 'GL account list (PFRS-for-SMEs aligned). Customize the default chart for your business — most owners can skip this one.',
      endpoint: '/import/template/chart-of-accounts',
      upload:   '/import/chart-of-accounts',
      filename: 'clerque-coa.xlsx',
      Icon: BookOpen,
    },
    {
      id: 'journal-entries',
      name: 'Journal Entries',
      desc: 'Bulk-load opening balances or migration entries. Each row is one debit or credit line; entries are matched by reference number.',
      endpoint: '/import/template/journal-entries',
      upload:   '/import/journal-entries',
      filename: 'clerque-journal-entries.xlsx',
      Icon: Scroll,
    },
  ];

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined' && window.history.length > 1) router.back();
          else router.push('/settings');
        }}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <FileSpreadsheet className="h-6 w-6 text-[var(--accent)]" />
          Import Templates
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Download Excel templates for bulk imports. The Products template is automatically tailored
          to your business type ({verticalLabel}) — sample rows + columns match what you actually sell.
        </p>
      </div>

      <div className="rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/30 p-3 flex items-start gap-3">
        <Info className="h-5 w-5 text-[var(--accent)] mt-0.5 shrink-0" />
        <div className="text-sm">
          <div className="font-medium text-foreground">Tailored to your business</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Your Products template is generated for <strong>{verticalLabel}</strong>. Switch business type in
            Settings → Business Profile if it&apos;s set wrong; the template will follow.
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {templates.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl border p-4 flex items-start justify-between gap-3 transition-colors ${
              t.highlight
                ? 'border-[var(--accent)]/50 bg-[var(--accent-soft)]/40'
                : 'border-border bg-card hover:border-[var(--accent)]/30'
            }`}
          >
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className={`rounded-lg p-2 shrink-0 ${
                t.highlight ? 'bg-[var(--accent)] text-white' : 'bg-muted text-muted-foreground'
              }`}>
                <t.Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                  {t.name}
                  {t.highlight && <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)] text-white">recommended</span>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{t.desc}</div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => downloadTemplate(t)}
                  disabled={downloading === t.id}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  {downloading === t.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Download className="h-4 w-4" />}
                  {downloading === t.id ? 'Downloading…' : '.xlsx'}
                </button>

                {t.exportEndpoint && (
                  // "My data" sits BEFORE Import, because after day one that is
                  // the button people actually want: download what you already
                  // have, change a price, upload the same file back. The blank
                  // template beside it is only useful once.
                  <button
                    onClick={() => downloadTemplate(t, 'mine')}
                    disabled={downloading === `${t.id}:mine`}
                    title="Download YOUR data in these columns — edit it and upload it back"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/50 text-emerald-600 dark:text-emerald-400 px-3 py-2 text-sm hover:bg-emerald-500/10 disabled:opacity-50"
                  >
                    {downloading === `${t.id}:mine`
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Download className="h-4 w-4" />}
                    {downloading === `${t.id}:mine` ? 'Exporting…' : 'My data'}
                  </button>
                )}

                {t.upload && (
                  <label
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm cursor-pointer ${
                      uploading === t.id
                        ? 'opacity-50 cursor-wait border-border'
                        : 'border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent-soft)]'
                    }`}
                  >
                    {uploading === t.id
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Upload className="h-4 w-4" />}
                    {uploading === t.id ? 'Importing…' : 'Import'}
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      disabled={uploading === t.id}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        // Reset so re-picking the same file still fires onChange.
                        e.target.value = '';
                        if (f) void uploadFilled(t, f);
                      }}
                    />
                  </label>
                )}
              </div>

              {results[t.id] && (
                'failed' in (results[t.id] as { failed?: string })
                  ? (
                    <div className="flex items-start gap-1.5 text-xs text-red-600 max-w-[16rem] text-right">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <span>{(results[t.id] as { failed: string }).failed}</span>
                    </div>
                  )
                  : (() => {
                    const r = results[t.id] as ImportResult;
                    const created = r.created ?? r.imported ?? 0;
                    const updated = r.updated ?? 0;
                    const skipped = r.skipped ?? 0;
                    const errs    = r.errors?.length ?? 0;
                    return (
                      <div className={`flex items-start gap-1.5 text-xs ${errs ? 'text-amber-600' : 'text-emerald-600'}`}>
                        {errs
                          ? <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          : <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                        <span>
                          {created} added · {updated} updated
                          {skipped ? ` · ${skipped} skipped` : ''}
                          {errs ? ` · ${errs} error${errs === 1 ? '' : 's'}` : ''}
                          {r.missingCost
                            ? ` · ${r.missingCost} without a cost price yet`
                            : ''}
                        </span>
                      </div>
                    );
                  })()
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="flex items-start gap-1.5">
          <span className="font-semibold text-foreground">Order matters.</span>
          {isRecipeFriendly
            ? <>Two kinds of item, two ways to stock them. Things you buy <strong>ready to sell</strong> (bottled water, chips) just need the Products sheet — fill its <strong>Opening Stock</strong> column. Things you <strong>make to order</strong> (drinks, meals) are stocked by their ingredients: <strong>Products → Ingredients → Recipes → Stock Receipts</strong>, and you leave Opening Stock blank for them.</>
            : <>For first-time setup, use the <strong>Setup Pack</strong> — it bundles everything with a Read Me sheet that walks you through the order (Products → Inventory → Customers → Vendors).</>}
        </p>
        <p>
          Each template has a Read Me / Instructions section at the top of the sheet. Open the
          .xlsx in Excel or Google Sheets, fill the rows below the headers, then press
          <strong className="text-foreground"> Import</strong> on the same row to upload it back
          here. Sample rows (prefixed <code>SAMPLE -</code>) are skipped automatically, so you can
          leave them in place.
        </p>
        <p>
          <strong className="text-foreground">Existing products / customers / vendors / ingredients are updated, not duplicated</strong> — the importer
          matches by Name (and Barcode for products). To add new rows, just add new names.
        </p>
        {isRecipeFriendly && (
          <p>
            <strong className="text-foreground">Why recipe COGS matters:</strong> a 16oz iced latte costing ~₱35 in ingredients (18g beans + 200ml milk + cup/lid/stirrer) sold at ₱150 = ~76% gross margin. Without a recipe, COGS is whatever you typed in the Cost Price column — usually wrong.
          </p>
        )}
      </div>
    </div>
  );
}
