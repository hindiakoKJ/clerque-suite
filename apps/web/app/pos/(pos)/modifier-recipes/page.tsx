'use client';

/**
 * Clerque Cloud — Modifier Recipes
 *
 * Top-level admin page that lets owners attach ingredient consumption + a
 * recipe-multiplier to every modifier option. Counter's order-submit path
 * (apps/api/src/orders/orders.service.ts) reads these on every sale and
 * drains RawMaterialInventory + posts COGS automatically.
 *
 * Anatomy:
 *   • Page header with "What this does" explainer card
 *   • Accordion of modifier groups; each row expands to its options
 *   • Per option: name, price adjustment (read-only — set elsewhere),
 *                 recipeMultiplier input, ingredient editor, COGS preview
 *
 * No tab switching — the whole tree is here so an owner can sweep through
 * every option once. Inline save per option keeps the API noise low.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Plus, Trash2, Save, FlaskConical, Calculator, ArrowDown, ArrowUp, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatPeso } from '@/lib/utils';
import { toast } from 'sonner';

interface RawMaterial {
  id: string;
  name: string;
  unit: string;
  costPrice: number | null;
}

interface Ingredient {
  id: string;
  rawMaterialId: string;
  quantity: string | number;
  unit: string;
  rawMaterial: { id: string; name: string; unit: string; costPrice: number | null };
}

interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  recipeMultiplier: number | string;
  isDefault: boolean;
  sortOrder: number;
  ingredients: Ingredient[];
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  options: ModifierOption[];
  _count: { products: number };
}

/** Local-state shape for inline edits before the user hits Save. */
interface OptionDraft {
  recipeMultiplier: string;
  ingredients: Array<{ rawMaterialId: string; quantity: string; unit: string }>;
}

export default function ModifierRecipesPage() {
  const qc = useQueryClient();
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, OptionDraft>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const groupsQ = useQuery<ModifierGroup[]>({
    queryKey: ['modifier-recipes', 'groups'],
    queryFn: () => api.get('/modifiers/groups').then((r) => r.data),
    staleTime: 30_000,
  });

  const rmQ = useQuery<RawMaterial[]>({
    queryKey: ['modifier-recipes', 'raw-materials'],
    queryFn: () => api.get('/raw-materials').then((r) => r.data),
    staleTime: 60_000,
  });

  /** Read the live draft (if mid-edit) or seed from server data. */
  const draftFor = (opt: ModifierOption): OptionDraft => {
    if (drafts[opt.id]) return drafts[opt.id];
    return {
      recipeMultiplier: String(opt.recipeMultiplier ?? 1),
      ingredients: opt.ingredients.map((i) => ({
        rawMaterialId: i.rawMaterialId,
        quantity:      String(i.quantity),
        unit:          i.unit,
      })),
    };
  };

  const patchDraft = (optId: string, patch: Partial<OptionDraft>) => {
    setDrafts((s) => {
      const cur = s[optId] ?? { recipeMultiplier: '1', ingredients: [] };
      return { ...s, [optId]: { ...cur, ...patch } };
    });
  };

  const saveOption = async (group: ModifierGroup, opt: ModifierOption) => {
    const draft = draftFor(opt);
    const multiplier = Number(draft.recipeMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      toast.error('Recipe multiplier must be a positive number.');
      return;
    }
    setSaving(opt.id);
    try {
      // 1. PATCH the option's recipeMultiplier if it changed
      const prevMult = Number(opt.recipeMultiplier ?? 1);
      if (Math.abs(prevMult - multiplier) > 0.0001) {
        await api.patch(`/modifiers/groups/${group.id}/options/${opt.id}`, {
          recipeMultiplier: multiplier,
        });
      }
      // 2. Replace ingredients (server handles diff in a single tx)
      const items = draft.ingredients
        .filter((i) => i.rawMaterialId && Number(i.quantity) > 0)
        .map((i) => ({
          rawMaterialId: i.rawMaterialId,
          quantity:      Number(i.quantity),
          unit:          i.unit,
        }));
      await api.post(`/modifiers/groups/${group.id}/options/${opt.id}/ingredients`, {
        items,
      });
      await qc.invalidateQueries({ queryKey: ['modifier-recipes', 'groups'] });
      setDrafts((s) => {
        const next = { ...s };
        delete next[opt.id];
        return next;
      });
      toast.success(`Saved · ${opt.name}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  const addIngredientRow = (optId: string) => {
    const cur = draftFor({ id: optId, ingredients: [], recipeMultiplier: '1' } as never);
    const baseDraft = drafts[optId] ?? cur;
    const firstRm = rmQ.data?.[0];
    patchDraft(optId, {
      ingredients: [
        ...baseDraft.ingredients,
        {
          rawMaterialId: firstRm?.id ?? '',
          quantity:      '',
          unit:          firstRm?.unit ?? '',
        },
      ],
    });
  };

  const removeIngredientRow = (optId: string, idx: number) => {
    const base = drafts[optId];
    if (!base) return;
    patchDraft(optId, {
      ingredients: base.ingredients.filter((_, i) => i !== idx),
    });
  };

  /** ₱ COGS contribution of an in-progress draft. Used live below each option. */
  const costFor = (draft: OptionDraft): number => {
    if (!rmQ.data) return 0;
    return draft.ingredients.reduce((acc, i) => {
      if (!i.rawMaterialId) return acc;
      const rm = rmQ.data!.find((r) => r.id === i.rawMaterialId);
      if (!rm?.costPrice) return acc;
      const qty = Number(i.quantity);
      if (!Number.isFinite(qty) || qty <= 0) return acc;
      return acc + qty * Number(rm.costPrice);
    }, 0);
  };

  const isDirty = (opt: ModifierOption): boolean => {
    const d = drafts[opt.id];
    if (!d) return false;
    if (Math.abs(Number(d.recipeMultiplier) - Number(opt.recipeMultiplier ?? 1)) > 0.0001) return true;
    if (d.ingredients.length !== opt.ingredients.length) return true;
    for (let i = 0; i < d.ingredients.length; i++) {
      const a = d.ingredients[i];
      const b = opt.ingredients[i];
      if (!b) return true;
      if (a.rawMaterialId !== b.rawMaterialId) return true;
      if (Number(a.quantity) !== Number(b.quantity)) return true;
      if (a.unit !== b.unit) return true;
    }
    return false;
  };

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="w-6 h-6 text-purple-600" />
          Modifier recipes
        </h1>
        <p className="text-sm text-gray-600 mt-1 max-w-2xl">
          Tell Counter what each modifier option costs you in ingredients. Every
          sale of "Latte · Grande · +Oat milk" then drains the right amount of
          coffee, milk, and oat milk from inventory and posts COGS automatically.
        </p>
      </header>

      {/* What it does explainer */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 text-sm text-amber-900">
        <div className="font-semibold mb-1 flex items-center gap-1.5">
          <Calculator className="w-4 h-4" />
          How modifier recipes work
        </div>
        <ul className="space-y-1 list-disc pl-5">
          <li>
            <b>Recipe multiplier</b> — set on size options (Tall = 1.0, Grande = 1.25,
            Venti = 1.5). Scales the product's base recipe up or down at sale time.
          </li>
          <li>
            <b>Ingredients</b> — anything the option <i>adds</i> on top of the base
            recipe. "Extra shot" = +5g coffee beans; "Oat milk" = +240ml oat milk.
          </li>
          <li>
            COGS is captured automatically from <code className="bg-amber-100 px-1 rounded">RawMaterial.costPrice</code> (WAC).
          </li>
        </ul>
      </div>

      {groupsQ.isLoading ? (
        <div className="text-center text-gray-500 py-12">Loading modifier groups…</div>
      ) : groupsQ.error ? (
        <div className="text-center text-red-600 py-12">
          Could not load modifier groups. {String(groupsQ.error)}
        </div>
      ) : !groupsQ.data?.length ? (
        <div className="text-center text-gray-500 py-12">
          No modifier groups yet. Create one on the{' '}
          <a href="/pos/products" className="text-purple-600 underline">Products</a> page first.
        </div>
      ) : (
        <div className="space-y-3">
          {groupsQ.data.map((g) => {
            const isOpen = openGroupId === g.id;
            return (
              <div key={g.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOpenGroupId(isOpen ? null : g.id)}
                  className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 text-left"
                >
                  {isOpen ? <ChevronDown className="w-4 h-4 text-gray-500" /> : <ChevronRight className="w-4 h-4 text-gray-500" />}
                  <div className="flex-1">
                    <div className="font-semibold">{g.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {g.options.length} {g.options.length === 1 ? 'option' : 'options'}
                      {' · '}
                      {g._count.products} {g._count.products === 1 ? 'product' : 'products'}
                      {' · '}
                      {g.required ? 'required' : 'optional'}
                      {' · '}
                      {g.multiSelect ? 'multi-select' : 'single-select'}
                    </div>
                  </div>
                </button>

                {isOpen ? (
                  <div className="border-t border-gray-100 divide-y divide-gray-100">
                    {g.options.map((opt) => {
                      const draft = draftFor(opt);
                      const dirty = isDirty(opt);
                      const cogs  = costFor(draft);
                      return (
                        <div key={opt.id} className="p-4 space-y-3">
                          {/* Top row — option label + multiplier */}
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex-1 min-w-[200px]">
                              <div className="font-medium">
                                {opt.name}
                                {opt.isDefault ? (
                                  <span className="ml-2 text-[10px] uppercase tracking-wide font-bold text-purple-600 bg-purple-100 rounded px-1.5 py-0.5">
                                    default
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                Price adj{' '}
                                <span className="font-mono text-gray-700">
                                  {Number(opt.priceAdjustment) >= 0 ? '+' : ''}
                                  {formatPeso(Number(opt.priceAdjustment) * 100)}
                                </span>
                              </div>
                            </div>
                            <label className="flex items-center gap-2 text-sm">
                              <span className="text-gray-600">Recipe ×</span>
                              <input
                                type="number"
                                step="0.05"
                                min="0.1"
                                value={draft.recipeMultiplier}
                                onChange={(e) => patchDraft(opt.id, { recipeMultiplier: e.target.value })}
                                className="w-24 border rounded px-2 py-1 text-sm font-mono"
                              />
                              {Number(draft.recipeMultiplier) > 1 ? (
                                <ArrowUp className="w-3 h-3 text-amber-600" />
                              ) : Number(draft.recipeMultiplier) < 1 ? (
                                <ArrowDown className="w-3 h-3 text-blue-600" />
                              ) : null}
                            </label>
                          </div>

                          {/* Ingredient editor */}
                          <div className="bg-gray-50 rounded p-3 space-y-2">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                                Adds on top of base recipe
                              </div>
                              <div className="text-xs text-gray-500">
                                Est. COGS{' '}
                                <span className="font-mono text-gray-800">{formatPeso(Math.round(cogs * 100))}</span>
                              </div>
                            </div>

                            {draft.ingredients.length === 0 ? (
                              <div className="text-xs text-gray-500 italic py-2">
                                No add-on ingredients. (Use the multiplier above for size scaling.)
                              </div>
                            ) : (
                              <div className="space-y-1.5">
                                {draft.ingredients.map((row, idx) => {
                                  const rm = rmQ.data?.find((r) => r.id === row.rawMaterialId);
                                  return (
                                    <div key={idx} className="flex flex-wrap items-center gap-2">
                                      <select
                                        value={row.rawMaterialId}
                                        onChange={(e) => {
                                          const newRm = rmQ.data?.find((r) => r.id === e.target.value);
                                          const next = [...draft.ingredients];
                                          next[idx] = {
                                            ...next[idx],
                                            rawMaterialId: e.target.value,
                                            unit:          newRm?.unit ?? next[idx].unit,
                                          };
                                          patchDraft(opt.id, { ingredients: next });
                                        }}
                                        className="border rounded px-2 py-1 text-sm flex-1 min-w-[160px] bg-white"
                                      >
                                        <option value="">Select raw material…</option>
                                        {rmQ.data?.map((r) => (
                                          <option key={r.id} value={r.id}>{r.name}</option>
                                        ))}
                                      </select>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={row.quantity}
                                        onChange={(e) => {
                                          const next = [...draft.ingredients];
                                          next[idx] = { ...next[idx], quantity: e.target.value };
                                          patchDraft(opt.id, { ingredients: next });
                                        }}
                                        placeholder="qty"
                                        className="border rounded px-2 py-1 text-sm w-24 font-mono bg-white"
                                      />
                                      <span className="text-xs text-gray-600 w-16">{rm?.unit ?? row.unit}</span>
                                      <button
                                        type="button"
                                        onClick={() => removeIngredientRow(opt.id, idx)}
                                        className="text-gray-400 hover:text-red-600 p-1"
                                        aria-label="Remove ingredient"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            <button
                              type="button"
                              onClick={() => addIngredientRow(opt.id)}
                              className="text-xs flex items-center gap-1 text-purple-600 hover:text-purple-800 font-semibold pt-1"
                            >
                              <Plus className="w-3 h-3" /> Add ingredient
                            </button>
                          </div>

                          {/* Save row */}
                          {dirty ? (
                            <div className="flex justify-end gap-2 pt-1">
                              <button
                                type="button"
                                disabled={saving === opt.id}
                                onClick={() => saveOption(g, opt)}
                                className="text-sm flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded font-semibold disabled:opacity-50"
                              >
                                <Save className="w-3.5 h-3.5" />
                                {saving === opt.id ? 'Saving…' : 'Save changes'}
                              </button>
                              <button
                                type="button"
                                disabled={saving === opt.id}
                                onClick={() => setDrafts((s) => {
                                  const next = { ...s };
                                  delete next[opt.id];
                                  return next;
                                })}
                                className="text-sm text-gray-600 hover:text-gray-900 px-3 py-1.5"
                              >
                                Discard
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
