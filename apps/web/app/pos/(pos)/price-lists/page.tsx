'use client';

/**
 * Clerque Cloud — Price lists (Wholesale / Corporate / Event pricing)
 *
 * Owner creates named lists, sets per-product override prices, then assigns
 * each list to one or more customers. When Counter rings a sale with a
 * customer that has a list, OrdersService resolves prices from the list
 * before snapshotting the line.
 *
 * Common bakery example:
 *   "Wholesale (cafes)" list with Pandesal ₱8 (default ₱10), Ensaymada ₱30
 *   (default ₱35), etc. — assigned to Coffee Shop A + Coffee Shop B.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Tag, Pencil, X, Save, Trash2, Calculator, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

interface Product { id: string; name: string; price: number | string; }

interface PriceListItem {
  id:         string;
  productId:  string;
  unitPrice:  number | string;
  minQuantity: number | string | null;
  product:    { id: string; name: string; price: number | string };
}

interface PriceList {
  id:        string;
  name:      string;
  notes:     string | null;
  isActive:  boolean;
  items:     PriceListItem[];
  _count:    { customers: number };
}

interface DraftRow {
  productId:   string;
  unitPrice:   string;
  minQuantity: string;
}

export default function PriceListsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<PriceList | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const [saving, setSaving]   = useState(false);

  const listsQ = useQuery<PriceList[]>({
    queryKey: ['price-lists'],
    queryFn: () => api.get('/price-lists').then((r) => r.data),
    staleTime: 30_000,
  });
  const productsQ = useQuery<Product[]>({
    queryKey: ['price-lists', 'products'],
    queryFn: () => api.get('/products').then((r) => r.data),
    staleTime: 60_000,
  });

  const startEdit = (l: PriceList) => {
    setEditing(l);
    setDraftRows(l.items.map((i) => ({
      productId:   i.productId,
      unitPrice:   String(i.unitPrice),
      minQuantity: i.minQuantity != null ? String(i.minQuantity) : '',
    })));
  };

  const create = async () => {
    if (!newName.trim()) { toast.error('Name is required.'); return; }
    setCreating(true);
    try {
      await api.post('/price-lists', { name: newName.trim() });
      await qc.invalidateQueries({ queryKey: ['price-lists'] });
      setNewName('');
      toast.success(`Created "${newName.trim()}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create');
    } finally {
      setCreating(false);
    }
  };

  const addRow = () => {
    const firstUnused = productsQ.data?.find((p) =>
      !draftRows.some((r) => r.productId === p.id),
    );
    setDraftRows([...draftRows, {
      productId:   firstUnused?.id ?? '',
      unitPrice:   firstUnused ? String(firstUnused.price) : '',
      minQuantity: '',
    }]);
  };

  const patchRow = (idx: number, patch: Partial<DraftRow>) => {
    setDraftRows(draftRows.map((r, i) => i === idx ? { ...r, ...patch } : r));
  };

  const removeRow = (idx: number) => {
    setDraftRows(draftRows.filter((_, i) => i !== idx));
  };

  const saveItems = async () => {
    if (!editing) return;
    const items = draftRows
      .filter((r) => r.productId && Number(r.unitPrice) > 0)
      .map((r) => ({
        productId:   r.productId,
        unitPrice:   Number(r.unitPrice),
        minQuantity: r.minQuantity ? Number(r.minQuantity) : undefined,
      }));
    setSaving(true);
    try {
      await api.post(`/price-lists/${editing.id}/items`, { items });
      await qc.invalidateQueries({ queryKey: ['price-lists'] });
      toast.success(`Saved ${editing.name}`);
      setEditing(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Tag className="w-6 h-6 text-purple-600" />
          Price lists
        </h1>
        <p className="text-sm text-gray-600 mt-1 max-w-2xl">
          Wholesale / corporate / event pricing per customer. Assign a list to
          a customer on their profile; Counter rings their orders at the
          list price automatically.
        </p>
      </header>

      {/* Create row */}
      <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6 flex gap-2">
        <input
          type="text"
          placeholder='e.g. "Wholesale (cafes)"'
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void create()}
          className="flex-1 border rounded px-3 py-2"
        />
        <button
          onClick={create}
          disabled={creating || !newName.trim()}
          className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold disabled:opacity-50 flex items-center gap-1.5"
        >
          <Plus className="w-4 h-4" />
          Create list
        </button>
      </div>

      {/* List of lists */}
      {listsQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading…</div>
      ) : (listsQ.data?.length ?? 0) === 0 ? (
        <div className="text-center text-gray-500 py-12 bg-white border border-dashed border-gray-300 rounded-lg">
          No price lists yet. Create one above.
        </div>
      ) : (
        <div className="space-y-3">
          {listsQ.data!.map((l) => (
            <div key={l.id} className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <div className="font-semibold flex items-center gap-2">
                    <Tag className="w-4 h-4 text-purple-600" />
                    {l.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-3">
                    <span>{l.items.length} {l.items.length === 1 ? 'override' : 'overrides'}</span>
                    <span className="flex items-center gap-1"><Users className="w-3 h-3" />{l._count.customers} customers</span>
                  </div>
                </div>
                <button
                  onClick={() => startEdit(l)}
                  className="text-sm bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded font-semibold flex items-center gap-1"
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit prices
                </button>
              </div>

              {l.items.length > 0 ? (
                <div className="mt-3 border-t border-gray-100 pt-3 text-xs grid grid-cols-2 gap-x-4 gap-y-1">
                  {l.items.slice(0, 6).map((i) => (
                    <div key={i.id} className="flex justify-between">
                      <span className="text-gray-700 truncate">{i.product.name}</span>
                      <span className="font-mono text-gray-800">
                        {formatPeso(Math.round(Number(i.unitPrice) * 100))}
                        <span className="ml-1 text-gray-400 line-through">
                          {formatPeso(Math.round(Number(i.product.price) * 100))}
                        </span>
                      </span>
                    </div>
                  ))}
                  {l.items.length > 6 ? (
                    <span className="text-xs text-gray-500 italic col-span-2">+{l.items.length - 6} more…</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {/* Edit drawer */}
      {editing ? (
        <div className="fixed inset-0 bg-black/40 z-40 flex justify-end" onClick={() => setEditing(null)}>
          <div className="bg-white w-full max-w-2xl h-full overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Edit · {editing.name}</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-gray-600 mb-3">
              Override the unit price for any product. Customers assigned to
              this list see these prices at Counter. Missing products fall back
              to the default Product.price.
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-600 uppercase">
                  <tr>
                    <th className="text-left p-2">Product</th>
                    <th className="text-right p-2">Default</th>
                    <th className="text-right p-2">Override</th>
                    <th className="text-right p-2">Min qty</th>
                    <th className="text-right p-2">Δ</th>
                    <th className="p-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {draftRows.map((row, idx) => {
                    const p     = productsQ.data?.find((pp) => pp.id === row.productId);
                    const def   = p ? Number(p.price) : 0;
                    const over  = Number(row.unitPrice);
                    const delta = def > 0 ? ((over - def) / def) * 100 : 0;
                    return (
                      <tr key={idx} className="border-b border-gray-100">
                        <td className="p-2">
                          <select
                            value={row.productId}
                            onChange={(e) => {
                              const newP = productsQ.data?.find((pp) => pp.id === e.target.value);
                              patchRow(idx, {
                                productId: e.target.value,
                                unitPrice: newP ? String(newP.price) : row.unitPrice,
                              });
                            }}
                            className="border rounded px-2 py-1 w-full bg-white"
                          >
                            <option value="">Select product…</option>
                            {productsQ.data?.map((pp) => (
                              <option key={pp.id} value={pp.id}>{pp.name}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2 text-right font-mono text-gray-500">
                          {p ? formatPeso(Math.round(Number(p.price) * 100)) : '—'}
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number" step="0.01" min="0"
                            value={row.unitPrice}
                            onChange={(e) => patchRow(idx, { unitPrice: e.target.value })}
                            className="border rounded px-2 py-1 w-24 text-right font-mono"
                          />
                        </td>
                        <td className="p-2 text-right">
                          <input
                            type="number" step="1" min="0"
                            placeholder="—"
                            value={row.minQuantity}
                            onChange={(e) => patchRow(idx, { minQuantity: e.target.value })}
                            className="border rounded px-2 py-1 w-20 text-right font-mono"
                          />
                        </td>
                        <td className={`p-2 text-right font-mono text-xs ${delta < 0 ? 'text-green-700' : delta > 0 ? 'text-red-700' : 'text-gray-400'}`}>
                          {p && over > 0 ? (delta >= 0 ? '+' : '') + delta.toFixed(0) + '%' : ''}
                        </td>
                        <td className="p-2">
                          <button onClick={() => removeRow(idx)} className="text-gray-400 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <button
              onClick={addRow}
              className="text-purple-600 hover:text-purple-800 text-sm font-semibold flex items-center gap-1 mt-2"
            >
              <Plus className="w-3 h-3" />
              Add product
            </button>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded">
                Cancel
              </button>
              <button
                onClick={saveItems}
                disabled={saving}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? 'Saving…' : 'Save price list'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
