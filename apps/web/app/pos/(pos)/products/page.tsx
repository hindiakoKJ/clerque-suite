'use client';
import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Plus, Search, Pencil, ToggleLeft, ToggleRight, Package, Layers, Warehouse, ChefHat, Trash2, FlaskConical, Upload, AlertTriangle, FolderTree } from 'lucide-react';
import { api, resolveAssetUrl } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';
import { ModifierGroupModal } from '@/components/pos/ModifierGroupModal';
import { StockAdjustModal } from '@/components/pos/StockAdjustModal';
import { useBusinessSetup } from '@/components/portal/BusinessSetupWizard';
import { isFnbType, isLaundryType, getVerticalPack } from '@repo/shared-types';
import { ImportModal } from '@/components/ui/ImportModal';

interface Category { id: string; name: string; }
interface Uom { id: string; name: string; abbreviation: string; isActive: boolean; }
interface Branch { id: string; name: string; }
interface RawMaterial { id: string; name: string; unit: string; costPrice: number | null; }
interface BomItem { rawMaterialId: string; quantity: string; }
interface Product {
  id: string;
  name: string;
  sku?: string;
  barcode?: string | null;
  price: number | string;
  costPrice?: number | string | null;
  categoryId?: string;
  category?: Category | null;
  unitOfMeasureId?: string | null;
  unitOfMeasure?: Uom | null;
  isVatable: boolean;
  isActive: boolean;
  description?: string;
  inventoryMode?: 'UNIT_BASED' | 'RECIPE_BASED';
  bomItems?: Array<{ rawMaterialId: string; quantity: number; rawMaterial?: { id: string; name: string; unit: string } }>;
  imageUrl?: string | null;
  // Sprint 17 — Pharmacy / Compliance-Engine fields
  genericName?:      string | null;
  brandName?:        string | null;
  dosageForm?:       string | null;
  strength?:         string | null;
  isRxRequired?:     boolean;
  isControlledDrug?: boolean;
  // Server-computed: branch-scoped stock. For UNIT_BASED = InventoryItem.quantity.
  // For RECIPE_BASED = floor(min(rawMatStock / bomQty)) across all BOM lines.
  stockQty?: number | null;
  isLowStock?: boolean;
}

const EMPTY_FORM = {
  name: '', sku: '', barcode: '', description: '', categoryId: '',
  price: '', costPrice: '', isVatable: true, unitOfMeasureId: '',
  inventoryMode: 'UNIT_BASED' as 'UNIT_BASED' | 'RECIPE_BASED',
  imageUrl: '',
  // Sprint 17 — Pharmacy / Compliance-Engine fields. Optional everywhere.
  genericName: '',
  brandName: '',
  dosageForm: '',
  strength: '',
  isRxRequired: false,
  isControlledDrug: false,
};

const INPUT_CLS =
  'w-full border border-border bg-background rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent transition-shadow';

export default function ProductsPage() {
  const user = useAuthStore((s) => s.user);
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);

  // Recipe (BOM) state for RECIPE_BASED products
  const [recipe, setRecipe] = useState<BomItem[]>([]);
  const [bomSaving, setBomSaving] = useState(false);

  // Inventory prompt — shown after a new product is created
  const [invPrompt, setInvPrompt] = useState<{ productId: string; productName: string } | null>(null);
  const [invBranchId, setInvBranchId] = useState('');
  const [invQty, setInvQty] = useState('');
  const [invSaving, setInvSaving] = useState(false);

  const isOwner   = user?.role === 'BUSINESS_OWNER' || user?.role === 'SUPER_ADMIN';
  // MDM (Master Data Manager) and above can create/edit products; deactivation is owner-only
  const canManage = isOwner || user?.role === 'MDM';
  const isReadOnly = !canManage;

  const { data: tenantProfile } = useBusinessSetup(true);
  const isFnb      = isFnbType(tenantProfile?.businessType);
  const isLaundry  = isLaundryType(tenantProfile?.businessType);
  const isPharmacy = tenantProfile?.businessType === 'PHARMACY';

  // Vertical-aware copy + recipe gating come from the VerticalPack registry —
  // the single source of truth keyed by businessType. Sprint 12 made
  // `allowRecipeProducts` true for FNB / Retail / Service / Laundry, opening
  // the recipe (BOM) toggle on a per-product basis. Side-business items
  // (laundromat bottled water, hardware-store paint mix, etc.) can now track
  // ingredient-level COGS without forcing the whole tenant into RECIPE_BASED.
  const verticalPack = getVerticalPack(tenantProfile?.businessType ?? null);
  const NEW_ITEM_LABEL        = verticalPack.pos.productModal.titleNew;
  const NEW_NAME_PLACEHOLDER  = verticalPack.pos.productModal.namePlaceholder;
  const allowRecipeProducts   = verticalPack.pos.productModal.allowRecipeProducts;

  const [modifierTarget, setModifierTarget] = useState<Product | null>(null);
  const [showImport,    setShowImport]    = useState(false);
  const [showSetupPack, setShowSetupPack] = useState(false);

  // Stock management state (added so admin/owner can manage product stock from this page)
  const [adjustTarget, setAdjustTarget] = useState<{
    productId: string;
    productName: string;
    quantity: number;
    branchId: string;
  } | null>(null);
  const [filterLow, setFilterLow] = useState(false);

  const userBranchId = user?.branchId ?? '';

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ['products', showInactive, userBranchId],
    queryFn: () =>
      api.get(`/products`, {
        params: { includeInactive: showInactive ? 'true' : 'false', branchId: userBranchId || undefined },
      }).then((r) => r.data),
    enabled: !!user,
    staleTime: 30_000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ['categories'],
    queryFn: () => api.get('/categories').then((r) => r.data),
    enabled: !!user,
    staleTime: 60_000,
  });

  const { data: uoms = [] } = useQuery<Uom[]>({
    queryKey: ['uoms'],
    queryFn: () => api.get('/uom').then((r) => r.data),
    enabled: !!user && !!modal,  // only load when form is open
    staleTime: 120_000,
  });

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches'],
    queryFn: () => api.get('/tenant/branches').then((r) => r.data),
    enabled: !!invPrompt,  // only load when inventory prompt is shown
    staleTime: 120_000,
  });

  // Raw materials — only loaded for F&B businesses when modal is open
  const { data: rawMaterials = [] } = useQuery<RawMaterial[]>({
    queryKey: ['raw-materials'],
    queryFn: () => api.get('/inventory/raw-materials').then((r) => r.data),
    enabled: !!user && !!modal && isFnb,
    staleTime: 60_000,
  });

  // Stock levels for the current branch — joined into product rows below.
  // Pulls all rows (no pagination) so the productId-keyed map covers every visible product.
  interface InventoryStockRow {
    id: string;
    productId: string;
    branchId: string;
    quantity: number;
    lowStockAlert: number | null;
    isLowStock: boolean;
  }
  const { data: stockResponse } = useQuery<{ data: InventoryStockRow[] }>({
    queryKey: ['inventory', userBranchId, 'all'],
    queryFn: () =>
      api.get(`/inventory?branchId=${userBranchId}&page=1`).then((r) => r.data),
    enabled: !!userBranchId,
    staleTime: 15_000,
  });
  const stockByProductId = (stockResponse?.data ?? []).reduce<Record<string, InventoryStockRow>>(
    (acc, row) => { acc[row.productId] = row; return acc; },
    {},
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['products-pos'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  function openCreate() {
    // Default VAT-able to OFF for non-VAT-registered tenants. The Tenant
    // model has `taxStatus` (NON_VAT / VAT / EXEMPT / etc.) and a legacy
    // `isVatRegistered` boolean kept in sync. Either signal disables the
    // default. The toggle stays visible — owner may still mark a specific
    // item VAT-able if needed.
    const isVatTenant =
      (tenantProfile as any)?.taxStatus === 'VAT' ||
      (tenantProfile as any)?.isVatRegistered === true;
    setForm({ ...EMPTY_FORM, isVatable: isVatTenant });
    setRecipe([]);
    setEditing(null);
    setModal('create');
  }
  async function openEdit(p: Product) {
    setEditing(p);
    setModal('edit');
    setForm({
      name: p.name, sku: p.sku ?? '', barcode: p.barcode ?? '',
      description: p.description ?? '',
      categoryId: p.categoryId ?? '', price: String(Number(p.price)),
      costPrice: p.costPrice != null ? String(Number(p.costPrice)) : '',
      isVatable: p.isVatable,
      unitOfMeasureId: p.unitOfMeasureId ?? '',
      inventoryMode: p.inventoryMode ?? 'UNIT_BASED',
      imageUrl: p.imageUrl ?? '',
      genericName:      p.genericName     ?? '',
      brandName:        p.brandName       ?? '',
      dosageForm:       p.dosageForm      ?? '',
      strength:         p.strength        ?? '',
      isRxRequired:     p.isRxRequired    ?? false,
      isControlledDrug: p.isControlledDrug ?? false,
    });
    setRecipe([]);

    // For F&B: fetch full product detail to get BOM items
    // Sprint 12 — load BOM for any vertical whose pack allows recipe products,
    // not just F&B. A retail-store paint-mix product still needs to render its
    // recipe rows on edit.
    if (allowRecipeProducts && p.inventoryMode === 'RECIPE_BASED') {
      try {
        const { data: detail } = await api.get<Product>(`/products/${p.id}`);
        setForm((prev) => ({ ...prev, inventoryMode: detail.inventoryMode ?? 'UNIT_BASED' }));
        setRecipe(
          (detail.bomItems ?? []).map((b) => ({
            rawMaterialId: b.rawMaterialId,
            quantity: String(b.quantity),
          })),
        );
      } catch {
        // non-fatal — recipe section will just be empty
      }
    }
  }

  function addRecipeRow() {
    setRecipe((prev) => [...prev, { rawMaterialId: '', quantity: '' }]);
  }
  function removeRecipeRow(idx: number) {
    setRecipe((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateRecipeRow(idx: number, field: keyof BomItem, value: string) {
    setRecipe((prev) => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  }

  async function handleSave() {
    if (!form.name.trim() || !form.price) { toast.error('Name and price are required.'); return; }

    // Recipe-based products derive cost from the BOM at save time, so the
    // Cost Price field is read-only and the manual-entry guard does not apply.
    const isRecipeBased = form.inventoryMode === 'RECIPE_BASED';
    const validRecipe = recipe.filter((r) => r.rawMaterialId && r.quantity && parseFloat(r.quantity) > 0);

    if (!isRecipeBased && (form.costPrice === '' || form.costPrice == null)) {
      toast.error('Cost Price is required for accurate gross-profit reporting. Enter 0 if intentionally free.');
      return;
    }
    if (isRecipeBased && validRecipe.length === 0) {
      toast.error('Recipe-based products need at least one ingredient row with a quantity > 0.');
      return;
    }

    setSaving(true);
    try {
      const bomItems = isRecipeBased
        ? validRecipe.map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: parseFloat(r.quantity) }))
        : [];

      // For RECIPE_BASED products with a recipe attached, derive the cost
      // client-side too — the backend ignores this and re-derives from BOM
      // anyway, but sending the right number keeps form validation happy
      // and lets the user see the same value the backend will store.
      let resolvedCost = parseFloat(form.costPrice);
      if (form.inventoryMode === 'RECIPE_BASED' && bomItems.length > 0) {
        resolvedCost = bomItems.reduce((sum, b) => {
          const rm = rawMaterials.find((r) => r.id === b.rawMaterialId);
          return sum + (rm?.costPrice ?? 0) * b.quantity;
        }, 0);
      }
      if (Number.isNaN(resolvedCost)) resolvedCost = 0;

      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        sku: form.sku.trim() || undefined,
        barcode: form.barcode.trim() || undefined,
        description: form.description.trim() || undefined,
        categoryId: form.categoryId || undefined,
        price: parseFloat(form.price),
        costPrice: resolvedCost,
        isVatable: form.isVatable,
        unitOfMeasureId: form.unitOfMeasureId || undefined,
        inventoryMode: form.inventoryMode,
        imageUrl: form.imageUrl.trim() || undefined,
        // On create: send BOM inline
        ...(modal === 'create' && bomItems.length > 0 ? { bomItems } : {}),
      };
      // Sprint 17 — Pharmacy / Compliance fields, only sent when the
      // pharmacy fields panel is showing (avoids sending empty strings to
      // non-pharmacy tenants and triggering DTO validation noise).
      if (isPharmacy) {
        payload.genericName      = form.genericName.trim() || undefined;
        payload.brandName        = form.brandName.trim() || undefined;
        payload.dosageForm       = form.dosageForm.trim() || undefined;
        payload.strength         = form.strength.trim() || undefined;
        payload.isRxRequired     = form.isRxRequired;
        payload.isControlledDrug = form.isControlledDrug;
      }

      if (modal === 'create') {
        const { data: created } = await api.post<{ id: string; name: string }>('/products', payload);
        toast.success('Product created.');
        invalidate();
        setModal(null);
        // Offer to add to inventory immediately (only for unit-based products)
        if (!isRecipeBased) {
          setInvPrompt({ productId: created.id, productName: created.name });
          setInvBranchId('');
          setInvQty('');
        }
        return;
      } else if (editing) {
        await api.patch(`/products/${editing.id}`, payload);
        // On edit: replace BOM via dedicated endpoint
        if (isRecipeBased || editing.inventoryMode === 'RECIPE_BASED') {
          setBomSaving(true);
          await api.put(`/products/${editing.id}/bom`, { items: bomItems });
          setBomSaving(false);
        }
        toast.success('Product updated.');
      }
      invalidate();
      setModal(null);
    } catch (err: unknown) {
      setBomSaving(false);
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save product.');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(p: Product) {
    if (!isOwner) return;
    try {
      if (p.isActive) {
        await api.delete(`/products/${p.id}`);
        toast.success(`"${p.name}" deactivated.`);
      } else {
        await api.patch(`/products/${p.id}`, { isActive: true });
        toast.success(`"${p.name}" reactivated.`);
      }
      invalidate();
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update product.');
    }
  }

  async function handleAddToInventory() {
    if (!invPrompt) return;
    const qty = parseFloat(invQty);
    if (!invBranchId) { toast.error('Please select a branch.'); return; }
    if (!invQty || isNaN(qty) || qty <= 0) { toast.error('Please enter a valid quantity greater than 0.'); return; }
    setInvSaving(true);
    try {
      await api.post('/inventory/adjust', {
        productId: invPrompt.productId,
        branchId:  invBranchId,
        quantity:  qty,
        type:      'INITIAL',
        reason:    'Initial stock — added on product creation',
      });
      toast.success(`${qty} unit(s) added to inventory for "${invPrompt.productName}".`);
      qc.invalidateQueries({ queryKey: ['inventory'] });
      setInvPrompt(null);
    } catch (err: unknown) {
      toast.error((err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message?.toString() ?? 'Failed to add inventory.');
    } finally {
      setInvSaving(false);
    }
  }

  const filtered = products
    .filter(
      (p) =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.sku ?? '').toLowerCase().includes(search.toLowerCase()),
    )
    .filter((p) => !filterLow || stockByProductId[p.id]?.isLowStock);

  return (
    <div className="flex flex-col h-full bg-muted/30 overflow-auto">

      {/* Page header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 bg-background border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">Products</h1>
          {isReadOnly && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
              Read-Only
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or SKU…"
              className="pl-8 pr-3 py-1.5 text-sm border border-border bg-background text-foreground placeholder:text-muted-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent)] focus:border-transparent w-full sm:w-52 transition-shadow"
            />
          </div>
          {isOwner && (
            <button
              onClick={() => setShowInactive((v) => !v)}
              className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors whitespace-nowrap ${
                showInactive
                  ? 'bg-muted border-border text-foreground'
                  : 'bg-background border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {showInactive ? 'All (incl. inactive)' : 'Active only'}
            </button>
          )}
          <button
            onClick={() => setFilterLow(!filterLow)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium transition-colors whitespace-nowrap ${
              filterLow
                ? 'bg-amber-500 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
            }`}
            title="Show only products with stock at or below the alert level"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            Low stock
          </button>
          {canManage && (
            <>
              {isFnb && (
                <button
                  onClick={async () => {
                    if (!window.confirm(
                      'Set up the standard coffee-shop menu?\n\n' +
                      'This creates 15 default categories (Hot Coffee, Cold Coffee, Pastries, Sandwiches, Mains, etc.) ' +
                      'and routes each to the right station based on your floor layout (Bar, Kitchen, Pastry Pass).\n\n' +
                      'Existing categories with the same name will be left alone — only missing ones are added. ' +
                      'You can rename, reorder, or delete any of them after.',
                    )) return;
                    try {
                      const { data } = await api.post('/categories/seed-coffee-shop-defaults');
                      await qc.invalidateQueries({ queryKey: ['categories'] });
                      const stationLine = data.stations.length === 0
                        ? '\nWarning: no stations configured yet — categories were created without routing. Configure your floor layout in Settings to enable station routing.'
                        : '';
                      toast.success(
                        `Menu setup complete: ${data.created} created, ${data.updated} routing-fixed, ${data.skipped} skipped.${stationLine}`,
                        { duration: 6000 },
                      );
                    } catch (err: any) {
                      toast.error(err?.response?.data?.message ?? 'Could not seed the menu');
                    }
                  }}
                  className="flex items-center gap-1.5 text-xs border border-border bg-background text-foreground hover:bg-muted rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
                  title="One-click: create 15 standard café categories and auto-route them to your stations"
                >
                  <FlaskConical className="h-3.5 w-3.5" />
                  Setup Menu
                </button>
              )}
              <Link
                href="/pos/products/categories"
                className="flex items-center gap-1.5 text-xs border border-border bg-background text-foreground hover:bg-muted rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
                title="Manage categories and their modifier groups"
              >
                <FolderTree className="h-3.5 w-3.5" />
                Categories
              </Link>
              <button
                onClick={() => setShowSetupPack(true)}
                className="flex items-center gap-1.5 text-xs border border-border bg-background text-foreground hover:bg-muted rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
                title="One-shot import: products + opening stock in a single workbook"
              >
                <Upload className="h-3.5 w-3.5" />
                Setup Pack
              </button>
              <button
                onClick={() => setShowImport(true)}
                className="flex items-center gap-1.5 text-xs border border-border bg-background text-foreground hover:bg-muted rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
              >
                <Upload className="h-3.5 w-3.5" />
                Import
              </button>
              <button
                onClick={openCreate}
                className="flex items-center gap-1.5 text-xs hover:opacity-90 text-white rounded-lg px-3 py-1.5 font-medium transition-colors whitespace-nowrap"
                style={{ background: 'var(--accent)' }}
              >
                <Plus className="h-3.5 w-3.5" />
                {NEW_ITEM_LABEL}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <Package className="h-10 w-10 opacity-30" />
          <p className="text-sm">No products found.</p>
          {canManage && (
            <button onClick={openCreate} className="text-xs hover:underline" style={{ color: 'var(--accent)' }}>
              Add your first product
            </button>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  {['Name', 'SKU', 'Category', 'Price', 'Cost', 'Stock', 'UOM', 'VAT', 'Status', ...(allowRecipeProducts ? ['Recipe'] : []), ...(isFnb && canManage ? ['Modifiers'] : []), 'Actions'].map((h, i, arr) => (
                    <th
                      key={h}
                      className={`py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide ${
                        i === 0 ? 'text-left px-6' :
                        i === arr.length - 1 ? 'text-right px-6' :
                        ['Price','Cost','Stock'].includes(h) ? 'text-right px-4' :
                        ['VAT','Status','Modifiers','UOM','Recipe'].includes(h) ? 'text-center px-4' :
                        'text-left px-4'
                      }`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-muted/40 transition-colors ${!p.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-6 py-3 font-medium text-foreground">{p.name}</td>
                    <td className="px-4 py-3 text-muted-foreground font-mono text-xs">{p.sku ?? '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground">
                      {formatPeso(Number(p.price))}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {p.costPrice != null ? formatPeso(Number(p.costPrice)) : '—'}
                    </td>
                    {/* Stock — server-computed.
                        UNIT_BASED → InventoryItem.quantity at this branch.
                        RECIPE_BASED → max producible from BOM × ingredient stock. */}
                    <td className="px-4 py-3 text-right tabular-nums">
                      {(() => {
                        // Prefer the server-side computed value (handles RECIPE_BASED correctly).
                        if (p.stockQty != null) {
                          const isRecipe = p.inventoryMode === 'RECIPE_BASED';
                          const isLow = !!p.isLowStock;
                          return (
                            <div className="flex items-center justify-end gap-1.5">
                              {isLow && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                              <span className={`font-semibold ${isLow ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                                {p.stockQty}
                              </span>
                              {isRecipe && (
                                <span className="text-[10px] text-muted-foreground" title="Computed from ingredient stock × recipe">
                                  max
                                </span>
                              )}
                            </div>
                          );
                        }
                        // Fallback to the older inventory join (defensive)
                        const stock = stockByProductId[p.id];
                        if (!stock) return <span className="text-muted-foreground/40 text-xs">—</span>;
                        return (
                          <div className="flex items-center justify-end gap-1.5">
                            {stock.isLowStock && <AlertTriangle className="h-3 w-3 text-amber-500" />}
                            <span className={`font-semibold ${stock.isLowStock ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'}`}>
                              {stock.quantity}
                            </span>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-muted-foreground font-mono">
                      {p.unitOfMeasure?.abbreviation ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        p.isVatable ? 'bg-[var(--accent-soft)] text-[var(--accent)]' : 'bg-muted text-muted-foreground'
                      }`}>
                        {p.isVatable ? 'VAT' : 'EXEMPT'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        p.isActive
                          ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                          : 'bg-red-500/10 text-red-500'
                      }`}>
                        {p.isActive ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                    {/* Recipe badge — any vertical that allows recipe products */}
                    {allowRecipeProducts && (
                      <td className="px-4 py-3 text-center">
                        {p.inventoryMode === 'RECIPE_BASED' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                            <FlaskConical className="h-2.5 w-2.5" />
                            Recipe
                          </span>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Unit</span>
                        )}
                      </td>
                    )}
                    {/* Modifiers (F&B only) */}
                    {isFnb && canManage && (
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => setModifierTarget(p)}
                          className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                          title="Manage modifier groups"
                        >
                          <Layers className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}

                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {canManage && p.inventoryMode !== 'RECIPE_BASED' && (
                          <button
                            onClick={() => {
                              const stock = stockByProductId[p.id];
                              setAdjustTarget({
                                productId:   p.id,
                                productName: p.name,
                                quantity:    stock?.quantity ?? 0,
                                branchId:    userBranchId,
                              });
                            }}
                            className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                            title="Adjust stock"
                          >
                            <Warehouse className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canManage && (
                          <button
                            onClick={() => openEdit(p)}
                            className="text-muted-foreground hover:text-[var(--accent)] transition-colors"
                            title="Edit"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {isOwner && (
                          <button
                            onClick={() => handleToggleActive(p)}
                            className={`transition-colors ${
                              p.isActive
                                ? 'text-green-500 hover:text-red-400'
                                : 'text-muted-foreground hover:text-green-500'
                            }`}
                            title={p.isActive ? 'Deactivate' : 'Reactivate'}
                          >
                            {p.isActive ? <ToggleRight className="h-4 w-4" /> : <ToggleLeft className="h-4 w-4" />}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modifier Group Modal */}
      {modifierTarget && (
        <ModifierGroupModal
          productId={modifierTarget.id}
          productName={modifierTarget.name}
          onClose={() => setModifierTarget(null)}
        />
      )}

      {/* Inventory Prompt — shown after new product is created */}
      {invPrompt && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="px-6 py-5 border-b border-border flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-[var(--accent-soft)] flex items-center justify-center shrink-0">
                <Warehouse className="h-4 w-4 text-[var(--accent)]" />
              </div>
              <div>
                <h2 className="font-semibold text-foreground text-sm">Add to Inventory?</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Track stock levels for <span className="font-medium text-foreground">{invPrompt.productName}</span>
                </p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <p className="text-sm text-muted-foreground leading-relaxed">
                This product was created. Do you want to add it to inventory with an opening stock count?
              </p>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Branch</label>
                <select
                  value={invBranchId}
                  onChange={(e) => setInvBranchId(e.target.value)}
                  className={INPUT_CLS}
                >
                  <option value="">— Select branch —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Opening Quantity</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={invQty}
                  onChange={(e) => setInvQty(e.target.value)}
                  className={INPUT_CLS}
                  placeholder="e.g. 50"
                  autoFocus
                />
              </div>
            </div>
            <div className="px-6 pb-5 flex gap-3">
              <button
                onClick={() => setInvPrompt(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Skip
              </button>
              <button
                onClick={handleAddToInventory}
                disabled={invSaving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {invSaving ? 'Adding…' : 'Add to Inventory'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      <ImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        title="Import Products"
        description="Upload an .xlsx or .csv file to bulk-create or update products."
        templateUrl="/import/template/products"
        uploadUrl="/import/products"
        onSuccess={() => invalidate()}
      />

      {/* Setup Pack — combined products + opening stock import */}
      <ImportModal
        open={showSetupPack}
        onClose={() => setShowSetupPack(false)}
        title="Setup Pack — Products + Opening Stock"
        description="One workbook, two sheets. Stand up your full catalog and starting inventory in a single upload. Download the template, fill both sheets, then upload here."
        templateUrl="/api/v1/import/template/setup-pack"
        uploadUrl="/import/setup-pack"
        extraParams={userBranchId ? { branchId: userBranchId } : undefined}
        onSuccess={() => invalidate()}
      />

      {/* Stock Adjust Modal — opens from the Warehouse icon next to a product */}
      {adjustTarget && (
        <StockAdjustModal
          open={!!adjustTarget}
          productId={adjustTarget.productId}
          productName={adjustTarget.productName}
          currentQty={adjustTarget.quantity}
          branchId={adjustTarget.branchId}
          onClose={() => setAdjustTarget(null)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ['inventory', userBranchId] });
            setAdjustTarget(null);
          }}
        />
      )}

      {/* Create / Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-foreground/40 z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
            <div className="px-6 py-4 border-b border-border shrink-0">
              <h2 className="font-semibold text-foreground">
                {modal === 'create'
                  ? NEW_ITEM_LABEL
                  : isLaundry ? 'Edit Service / Item' : 'Edit Product'}
              </h2>
              {isLaundry && modal === 'create' && (
                <p className="text-[11px] text-muted-foreground mt-1">
                  Use this for retail items (detergent, fabric softener, hangers).
                  Per-kg / per-load <strong>service prices</strong> live under
                  <a href="/settings/laundry" className="text-[var(--accent)] hover:underline ml-1">Settings → Laundry</a>.
                </p>
              )}
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={INPUT_CLS}
                  placeholder={NEW_NAME_PLACEHOLDER}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">SKU</label>
                  <input
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Category
                  </label>
                  <select
                    value={form.categoryId}
                    onChange={async (e) => {
                      const v = e.target.value;
                      if (v === '__new__') {
                        const name = window.prompt('New category name (e.g. "Coffee", "Pastries")');
                        if (!name?.trim()) return;
                        try {
                          const { data } = await api.post('/categories', { name: name.trim() });
                          await qc.invalidateQueries({ queryKey: ['categories'] });
                          setForm((f) => ({ ...f, categoryId: data.id }));
                          toast.success(`Category "${data.name}" created`);
                        } catch (err: any) {
                          toast.error(err?.response?.data?.message ?? 'Could not create category');
                        }
                        return;
                      }
                      setForm((f) => ({ ...f, categoryId: v }));
                    }}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                    <option value="__new__">+ Create new category…</option>
                  </select>
                  {categories.length === 0 && (
                    <p className="text-[10px] text-muted-foreground mt-1 leading-relaxed">
                      No categories yet — pick &ldquo;Create new category…&rdquo; to add one inline.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Barcode (EAN/UPC)</label>
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="Optional"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">Unit of Measure</label>
                  <select
                    value={form.unitOfMeasureId}
                    onChange={(e) => setForm((f) => ({ ...f, unitOfMeasureId: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">— None —</option>
                    {uoms.filter((u) => u.isActive).map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.abbreviation})</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Selling Price (₱) <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number" min="0" step="0.01"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className={INPUT_CLS}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                    Cost Price (₱)
                    {form.inventoryMode === 'RECIPE_BASED' && recipe.length > 0 ? (
                      <span className="inline-flex items-center text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                        DERIVED
                      </span>
                    ) : (
                      <span className="text-red-400">*</span>
                    )}
                  </label>
                  {form.inventoryMode === 'RECIPE_BASED' && recipe.length > 0 ? (
                    <>
                      {/* Read-only derived value — computed from current
                          recipe × ingredient WAC. Server recalculates on every
                          BOM save and on every ingredient cost change, so
                          this is always live.  */}
                      <input
                        type="text"
                        value={(() => {
                          const total = recipe.reduce((sum, line) => {
                            const rm  = rawMaterials.find((r) => r.id === line.rawMaterialId);
                            const qty = parseFloat(line.quantity) || 0;
                            return sum + (rm?.costPrice ?? 0) * qty;
                          }, 0);
                          return total > 0 ? `₱${total.toFixed(2)}` : '—';
                        })()}
                        readOnly
                        disabled
                        className={`${INPUT_CLS} font-semibold text-[var(--accent)] cursor-not-allowed bg-muted/40`}
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                        Auto-computed from the recipe below — sum of (ingredient cost × quantity).
                        Updates automatically when ingredient prices change. To adjust, edit the recipe or update ingredient costs.
                      </p>
                    </>
                  ) : (
                    <>
                      <input
                        type="number" min="0" step="0.01"
                        value={form.costPrice}
                        onChange={(e) => setForm((f) => ({ ...f, costPrice: e.target.value }))}
                        className={INPUT_CLS}
                        placeholder="0.00"
                      />
                      <p className="mt-1 text-[11px] text-muted-foreground leading-snug">
                        Required — used to compute COGS &amp; gross profit on every sale.
                        For recipe items, the cost is computed from ingredients automatically.
                      </p>
                    </>
                  )}
                </div>
              </div>

              <ProductImagePicker
                value={form.imageUrl}
                onChange={(url) => setForm((f) => ({ ...f, imageUrl: url }))}
              />

              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={2}
                  className={`${INPUT_CLS} resize-none`}
                  placeholder="Optional"
                />
              </div>

              {/* VAT toggle — only shown for VAT-registered tenants. Non-VAT
                  tenants (NON_VAT / EXEMPT) don't charge VAT, so surfacing
                  the toggle is misleading. The form already defaults
                  isVatable to false for those tenants on openCreate(). */}
              {((tenantProfile as any)?.taxStatus === 'VAT' ||
                (tenantProfile as any)?.isVatRegistered === true) && (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">VAT-able (12%)</p>
                    <p className="text-xs text-muted-foreground">Enable if this product is subject to VAT</p>
                  </div>
                  <button
                    onClick={() => setForm((f) => ({ ...f, isVatable: !f.isVatable }))}
                    className="w-10 h-6 rounded-full transition-colors"
                    style={{ background: form.isVatable ? 'var(--accent)' : undefined }}
                  >
                    <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                      form.isVatable ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              )}

              {/* Sprint 17 — Pharmacy / Compliance fields. Only render for
                  PHARMACY tenants. Generics Act (RA 6675) needs generic
                  name on every Rx product; FDA needs dosage form + strength;
                  RA 9165 (DDB) needs the controlled-drug toggle so the POS
                  enforces the dispensing register. */}
              {isPharmacy && (
                <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-3">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    <span>💊 Pharmacy fields</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground -mt-1">
                    Optional; required only for Rx-controlled products. Generics Act, FDA, and RA 9165 (DDB) compliance.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="text-sm block">
                      <span className="text-xs text-muted-foreground">Generic name</span>
                      <input
                        type="text" value={form.genericName}
                        onChange={(e) => setForm((f) => ({ ...f, genericName: e.target.value }))}
                        className={INPUT_CLS}
                        placeholder="e.g. Paracetamol"
                      />
                    </label>
                    <label className="text-sm block">
                      <span className="text-xs text-muted-foreground">Brand name</span>
                      <input
                        type="text" value={form.brandName}
                        onChange={(e) => setForm((f) => ({ ...f, brandName: e.target.value }))}
                        className={INPUT_CLS}
                        placeholder="e.g. Biogesic"
                      />
                    </label>
                    <label className="text-sm block">
                      <span className="text-xs text-muted-foreground">Dosage form</span>
                      <input
                        type="text" value={form.dosageForm}
                        onChange={(e) => setForm((f) => ({ ...f, dosageForm: e.target.value }))}
                        className={INPUT_CLS}
                        placeholder="tablet / syrup / cream"
                      />
                    </label>
                    <label className="text-sm block">
                      <span className="text-xs text-muted-foreground">Strength</span>
                      <input
                        type="text" value={form.strength}
                        onChange={(e) => setForm((f) => ({ ...f, strength: e.target.value }))}
                        className={INPUT_CLS}
                        placeholder="500mg / 5mg/ml"
                      />
                    </label>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-sm font-medium">Requires prescription</p>
                      <p className="text-[11px] text-muted-foreground">POS blocks the sale until an Rx is attached at till.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, isRxRequired: !f.isRxRequired }))}
                      className="w-10 h-6 rounded-full transition-colors"
                      style={{ background: form.isRxRequired ? 'var(--accent)' : undefined }}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                        form.isRxRequired ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Controlled drug (RA 9165 / DDB)</p>
                      <p className="text-[11px] text-muted-foreground">Auto-creates a controlled-substance log entry on every dispense.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, isControlledDrug: !f.isControlledDrug, isRxRequired: !f.isControlledDrug ? true : f.isRxRequired }))}
                      className="w-10 h-6 rounded-full transition-colors"
                      style={{ background: form.isControlledDrug ? '#B45309' : undefined }}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                        form.isControlledDrug ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>
                </div>
              )}

              {/* Inventory Mode — gated by VerticalPack `allowRecipeProducts`.
                  Sprint 12 opened this to non-F&B verticals so a laundromat
                  selling bottled water (or a hardware store mixing paint)
                  can flag specific products as recipe-based and track
                  ingredient-level COGS, while their main catalog stays
                  UNIT_BASED. The kernel doesn't care which vertical calls
                  it — the JE engine consumes BOM items the same way. */}
              {allowRecipeProducts && (
                <>
                  <div className="flex items-center justify-between pt-1">
                    <div>
                      <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                        <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
                        Recipe-based inventory
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {isFnb
                          ? 'Track ingredients instead of finished units'
                          : 'For made-to-order side products. Most retail/service items should stay UNIT_BASED.'}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        const flipping = form.inventoryMode !== 'RECIPE_BASED';
                        // First-time guard for non-F&B tenants — show a confirm
                        // so an owner doesn't accidentally flag their whole catalog
                        // as recipe-based and break inventory reconciliation.
                        if (flipping && !isFnb) {
                          const ack = typeof localStorage !== 'undefined'
                            && localStorage.getItem('clerque-recipe-mode-ack') === '1';
                          if (!ack) {
                            const ok = window.confirm(
                              'Recipe mode is for items you assemble in-house from raw materials.\n\n' +
                              'Most retail / service products should stay UNIT_BASED. Use this only for things like:\n' +
                              '  • a hardware store mixing paint (base + tint)\n' +
                              '  • a laundromat bundling a custom cleaning kit\n' +
                              '  • a pharmacy compounding cream from base + active ingredient\n\n' +
                              'Continue?',
                            );
                            if (!ok) return;
                            try { localStorage.setItem('clerque-recipe-mode-ack', '1'); } catch {}
                          }
                        }
                        setForm((f) => ({
                          ...f,
                          inventoryMode: f.inventoryMode === 'RECIPE_BASED' ? 'UNIT_BASED' : 'RECIPE_BASED',
                        }));
                      }}
                      className="w-10 h-6 rounded-full transition-colors shrink-0"
                      style={{ background: form.inventoryMode === 'RECIPE_BASED' ? 'var(--accent)' : undefined }}
                    >
                      <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform mx-1 ${
                        form.inventoryMode === 'RECIPE_BASED' ? 'translate-x-4' : 'translate-x-0'
                      }`} />
                    </button>
                  </div>

                  {/* Recipe Editor */}
                  {form.inventoryMode === 'RECIPE_BASED' && (
                    <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <ChefHat className="h-4 w-4 text-[var(--accent)]" />
                          <span className="text-sm font-medium text-foreground">Recipe Ingredients</span>
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
                            {recipe.filter((r) => r.rawMaterialId).length} item{recipe.filter((r) => r.rawMaterialId).length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <button
                          onClick={addRecipeRow}
                          className="flex items-center gap-1 text-xs font-medium hover:opacity-80 transition-opacity"
                          style={{ color: 'var(--accent)' }}
                        >
                          <Plus className="h-3 w-3" />
                          Add ingredient
                        </button>
                      </div>

                      {recipe.length === 0 ? (
                        <div className="text-center py-4">
                          <p className="text-xs text-muted-foreground">No ingredients yet.</p>
                          <button
                            onClick={addRecipeRow}
                            className="text-xs mt-1 hover:underline"
                            style={{ color: 'var(--accent)' }}
                          >
                            Add your first ingredient
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {/* Header row */}
                          <div className="grid grid-cols-[1fr_90px_28px] gap-2 px-1">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Ingredient</span>
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Qty</span>
                            <span />
                          </div>
                          {/*
                            Sprint 22 — coffee-shop owner feedback (demo #2):
                            replaced plain <select> with a searchable input +
                            <datalist>. Users can type a few letters of the
                            ingredient name and the browser filters the list in
                            real-time — same UX as Xero / Stripe item pickers,
                            no extra JS library. The display value is the
                            ingredient name; we resolve back to the id via
                            rawMaterials.find on change.
                          */}
                          <datalist id="recipe-ingredient-options">
                            {rawMaterials.map((m) => (
                              <option key={m.id} value={`${m.name} (${m.unit})`} />
                            ))}
                          </datalist>
                          {recipe.map((row, idx) => {
                            const mat = rawMaterials.find((m) => m.id === row.rawMaterialId);
                            const displayValue = mat ? `${mat.name} (${mat.unit})` : '';
                            return (
                              <div key={idx} className="grid grid-cols-[1fr_90px_28px] gap-2 items-center">
                                <input
                                  list="recipe-ingredient-options"
                                  value={displayValue}
                                  onChange={(e) => {
                                    const typed = e.target.value;
                                    // Resolve the typed display string back to an id.
                                    // Strip the " (unit)" suffix so the user can type
                                    // just the ingredient name and we still match.
                                    const nameOnly = typed.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
                                    const match = rawMaterials.find(
                                      (m) => `${m.name} (${m.unit})` === typed
                                        || m.name.toLowerCase() === nameOnly,
                                    );
                                    updateRecipeRow(idx, 'rawMaterialId', match ? match.id : '');
                                  }}
                                  placeholder="Type to search ingredients…"
                                  className={INPUT_CLS + ' text-xs py-1.5'}
                                  autoComplete="off"
                                />
                                {/* Hidden select kept for screen-reader / accessibility fallback */}
                                <select
                                  value={row.rawMaterialId}
                                  onChange={(e) => updateRecipeRow(idx, 'rawMaterialId', e.target.value)}
                                  className="sr-only"
                                  tabIndex={-1}
                                  aria-hidden="true"
                                >
                                  <option value="">— Select ingredient —</option>
                                  {rawMaterials.map((m) => (
                                    <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                                  ))}
                                </select>
                                <div className="flex items-center gap-1">
                                  <input
                                    type="number"
                                    min="0.0001"
                                    step="0.001"
                                    value={row.quantity}
                                    onChange={(e) => updateRecipeRow(idx, 'quantity', e.target.value)}
                                    className={INPUT_CLS + ' text-xs py-1.5'}
                                    placeholder="0"
                                  />
                                  {mat && (
                                    <span className="text-[10px] text-muted-foreground font-mono shrink-0">{mat.unit}</span>
                                  )}
                                </div>
                                <button
                                  onClick={() => removeRecipeRow(idx)}
                                  className="text-muted-foreground hover:text-red-400 transition-colors flex items-center justify-center"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {rawMaterials.length === 0 && (
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg px-3 py-2">
                          No ingredients found. Go to <strong>Inventory → Ingredients</strong> to add your raw materials first.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-6 pb-5 flex gap-3 shrink-0">
              <button
                onClick={() => setModal(null)}
                className="flex-1 border border-border text-muted-foreground rounded-xl py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || bomSaving}
                className="flex-1 hover:opacity-90 disabled:opacity-60 text-white rounded-xl py-2 text-sm font-medium transition-opacity"
                style={{ background: 'var(--accent)' }}
              >
                {saving || bomSaving ? 'Saving…' : modal === 'create' ? 'Create' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Product image picker (camera + gallery) ─────────────────────────────────

/**
 * Universal image picker — works on Android / iOS / Windows / macOS.
 *
 * Two buttons:
 *   • Take Photo  — uses `capture="environment"` so phones open the rear
 *                   camera directly. Desktop browsers ignore `capture` and
 *                   show a normal file picker (still works fine).
 *   • Gallery     — standard file picker; phones default to gallery.
 *
 * The selected image is uploaded to POST /products/upload-image which
 * returns `{ url: '/uploads/public/...' }`. That URL gets stored on the
 * product row so every device — admin, cashier, customer display — renders
 * the same image without auth (public static asset).
 */
function ProductImagePicker({
  value, onChange,
}: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  async function handleFile(f: File | undefined | null) {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      toast.error('Please pick an image file (JPEG, PNG, WEBP, GIF).');
      return;
    }
    if (f.size > 5 * 1024 * 1024) {
      toast.error('Image must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data } = await api.post<{ url: string }>(
        '/products/upload-image', fd,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      onChange(data.url);
      toast.success('Photo uploaded.');
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="block text-xs font-medium text-muted-foreground mb-1">Product Photo</label>
      <div className="flex gap-3 items-start">
        {value ? (
          <div className="relative w-20 h-20 rounded-lg border border-border overflow-hidden bg-muted shrink-0 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveAssetUrl(value)}
              alt="Product"
              className="w-full h-full object-cover"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <button
              type="button"
              onClick={() => onChange('')}
              className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/70 text-white text-[11px] flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove photo"
            >
              ×
            </button>
          </div>
        ) : (
          <div className="w-20 h-20 rounded-lg border border-dashed border-border bg-muted/30 shrink-0 flex items-center justify-center text-[10px] text-muted-foreground text-center px-1">
            No photo
          </div>
        )}

        <div className="flex-1 space-y-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={cameraRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <input
              ref={galleryRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => cameraRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
            >
              📷 Take Photo
            </button>
            <button
              type="button"
              disabled={uploading}
              onClick={() => galleryRef.current?.click()}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border border-border hover:bg-muted disabled:opacity-50"
            >
              🖼️ Choose from Gallery
            </button>
            {uploading && (
              <span className="inline-flex items-center text-xs text-muted-foreground">Uploading…</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Optional. Up to 5 MB · JPEG / PNG / WEBP / GIF. Visible to every cashier and customer-display device once saved.
          </p>
        </div>
      </div>
    </div>
  );
}
