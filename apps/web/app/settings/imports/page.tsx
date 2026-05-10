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
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { api, resolveAssetUrl } from '@/lib/api';
import { useAuthStore } from '@/store/auth';

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
  // F&B + manufacturing benefit from Ingredients + Recipes (recipe-based COGS).
  // Other verticals can technically use them too, but most don't need them.
  const isRecipeFriendly = businessType
    ? ['COFFEE_SHOP', 'RESTAURANT', 'BAKERY', 'FOOD_STALL', 'BAR_LOUNGE', 'CATERING', 'MANUFACTURING'].includes(businessType)
    : false;

  const [downloading, setDownloading] = useState<string | null>(null);

  async function downloadTemplate(t: TemplateInfo) {
    setDownloading(t.id);
    try {
      const res = await api.get(t.endpoint, { responseType: 'blob' });
      const blob = new Blob([res.data as any], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url  = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = t.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${t.filename}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? 'Download failed.');
    } finally {
      setDownloading(null);
    }
  }

  const templates: TemplateInfo[] = [
    {
      id: 'setup-pack',
      name: 'Business Setup Pack (all-in-one)',
      desc: 'Bundled workbook with Products + Inventory + Customers + Vendors + Chart of Accounts in one file. Best for first-time setup.',
      endpoint: '/import/template/setup-pack',
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
          ? `Menu items / SKUs tailored to ${verticalLabel}. For recipe-based COGS (drinks, dishes, fabricated goods), use the Ingredients + Recipes templates AFTER this — Cost Price here is a fallback used only when no recipe exists.`
          : `7-column lean template tailored to ${verticalLabel}. Sample rows show the kind of items in your catalog.`,
      endpoint: '/import/template/products',
      filename: `clerque-products-${(businessType ?? 'general').toLowerCase()}.xlsx`,
      Icon: Package,
    },
    ...(isRecipeFriendly ? [
      {
        id: 'ingredients',
        name: 'Ingredients (Raw Materials)',
        desc: `For recipe-based COGS. Define every raw material your products are made from (espresso beans, milk, rice, sauce…) with cost per unit. Required before importing Recipes.`,
        endpoint: '/import/template/ingredients',
        filename: 'clerque-ingredients.xlsx',
        Icon: Sprout,
      },
      {
        id: 'recipes',
        name: 'Recipes (BOM)',
        desc: `One row per ingredient × product. Maps your menu items to ingredients with quantities — Iced Latte 16oz = 18g beans + 200ml milk + 1 cup + 1 lid + 1 stirrer. Auto-flips matched products to RECIPE_BASED so COGS is derived live from ingredients × WAC.`,
        endpoint: '/import/template/recipes',
        filename: 'clerque-recipes.xlsx',
        Icon: ChefHat,
      },
    ] as TemplateInfo[] : []),
    {
      id: 'inventory',
      name: 'Inventory (opening stock)',
      desc: 'Per-branch opening stock for each product. Use after the Products import to seed the first stock count at every branch.',
      endpoint: '/import/template/inventory',
      filename: 'clerque-inventory.xlsx',
      Icon: Boxes,
    },
    {
      id: 'customers',
      name: 'Customers',
      desc: 'Customer master (AR sub-ledger). Includes credit terms, credit limits, and contact details for B2B / charge-account billing.',
      endpoint: '/import/template/customers',
      filename: 'clerque-customers.xlsx',
      Icon: UsersIcon,
    },
    {
      id: 'vendors',
      name: 'Vendors / Suppliers',
      desc: 'Vendor master (AP). Captures BIR TIN, default WHT rate, ATC code, and credit terms — drives input VAT + 2306 workflows.',
      endpoint: '/import/template/vendors',
      filename: 'clerque-vendors.xlsx',
      Icon: Truck,
    },
    {
      id: 'stock-receipts',
      name: 'Stock Receipts (incoming deliveries)',
      desc: 'Bulk-load past supplier deliveries with lot + expiry. Posts to inventory + creates lots. Useful when migrating from another system.',
      endpoint: '/import/template/stock-receipts',
      filename: 'clerque-stock-receipts.xlsx',
      Icon: FileSpreadsheet,
    },
    {
      id: 'coa',
      name: 'Chart of Accounts',
      desc: 'GL account list (PFRS-for-SMEs aligned). Customize the default chart for your business — most owners can skip this one.',
      endpoint: '/import/template/chart-of-accounts',
      filename: 'clerque-coa.xlsx',
      Icon: BookOpen,
    },
    {
      id: 'journal-entries',
      name: 'Journal Entries',
      desc: 'Bulk-load opening balances or migration entries. Each row is one debit or credit line; entries are matched by reference number.',
      endpoint: '/import/template/journal-entries',
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
            <button
              onClick={() => downloadTemplate(t)}
              disabled={downloading === t.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50 shrink-0"
            >
              {downloading === t.id
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />}
              {downloading === t.id ? 'Downloading…' : '.xlsx'}
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-muted/20 p-4 text-xs text-muted-foreground space-y-1.5">
        <p className="flex items-start gap-1.5">
          <span className="font-semibold text-foreground">Order matters.</span>
          {isRecipeFriendly
            ? <>For recipe-based businesses (coffee shops, restaurants, bakeries, manufacturing), the right order is: <strong>Ingredients → Products → Recipes → Inventory</strong>. The Setup Pack only covers the basics; for full recipe COGS, use the Ingredients + Recipes templates separately.</>
            : <>For first-time setup, use the <strong>Setup Pack</strong> — it bundles everything with a Read Me sheet that walks you through the order (Products → Inventory → Customers → Vendors).</>}
        </p>
        <p>
          Each template has a Read Me / Instructions section at the top of the sheet. Open the
          .xlsx in Excel or Google Sheets, fill the rows below the headers, and upload via the
          matching Import button on each module&apos;s page.
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
