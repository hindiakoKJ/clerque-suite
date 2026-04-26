'use client';
import { useState } from 'react';
import { X, Check } from 'lucide-react';
import { formatPeso } from '@/lib/utils';
import type { CartItemModifier } from '@repo/shared-types';

interface ModifierOption {
  id: string;
  name: string;
  priceAdjustment: number | string;
  isDefault: boolean;
  isActive: boolean;
}

interface ModifierGroup {
  id: string;
  name: string;
  required: boolean;
  multiSelect: boolean;
  minSelect: number;
  maxSelect: number | null;
  options: ModifierOption[];
}

interface ProductModifierGroup {
  modifierGroupId: string;
  sortOrder: number;
  modifierGroup: ModifierGroup;
}

interface Props {
  productName: string;
  basePrice: number;
  modifierGroups: ProductModifierGroup[];
  onConfirm: (modifiers: CartItemModifier[]) => void;
  onClose: () => void;
}

export function ModifierPickerModal({
  productName,
  basePrice,
  modifierGroups,
  onConfirm,
  onClose,
}: Props) {
  // selectedOptions: { [groupId]: Set<optionId> }
  const [selected, setSelected] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const { modifierGroup: g } of modifierGroups) {
      init[g.id] = new Set();
      for (const opt of g.options) {
        if (opt.isDefault) init[g.id].add(opt.id);
      }
    }
    return init;
  });

  function toggle(group: ModifierGroup, optionId: string) {
    setSelected((prev) => {
      const current = new Set(prev[group.id] ?? []);
      if (group.multiSelect) {
        if (current.has(optionId)) current.delete(optionId);
        else {
          if (group.maxSelect && current.size >= group.maxSelect) {
            // Remove oldest (first) to keep within max
            const first = Array.from(current)[0];
            current.delete(first);
          }
          current.add(optionId);
        }
      } else {
        current.clear();
        current.add(optionId);
      }
      return { ...prev, [group.id]: current };
    });
  }

  function canConfirm() {
    for (const { modifierGroup: g } of modifierGroups) {
      const count = selected[g.id]?.size ?? 0;
      if (g.required && count < Math.max(1, g.minSelect)) return false;
    }
    return true;
  }

  function buildModifiers(): CartItemModifier[] {
    const result: CartItemModifier[] = [];
    for (const { modifierGroup: g } of modifierGroups) {
      const ids = selected[g.id] ?? new Set();
      for (const optionId of ids) {
        const opt = g.options.find((o) => o.id === optionId);
        if (opt) {
          result.push({
            modifierGroupId: g.id,
            modifierOptionId: opt.id,
            groupName: g.name,
            optionName: opt.name,
            priceAdjustment: Number(opt.priceAdjustment),
          });
        }
      }
    }
    return result;
  }

  const totalAdjustment = modifierGroups.reduce((sum, { modifierGroup: g }) => {
    const ids = selected[g.id] ?? new Set();
    for (const optId of ids) {
      const opt = g.options.find((o) => o.id === optId);
      if (opt) sum += Number(opt.priceAdjustment);
    }
    return sum;
  }, 0);

  const finalPrice = basePrice + totalAdjustment;

  return (
    <div className="fixed inset-0 bg-foreground/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-background border border-border rounded-2xl shadow-2xl w-full max-w-sm max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <div>
            <h2 className="font-semibold text-foreground text-sm">{productName}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Customize your order</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Groups */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {modifierGroups.map(({ modifierGroup: g }) => (
            <div key={g.id}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-foreground">{g.name}</h3>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {g.required ? 'REQUIRED' : 'OPTIONAL'}
                  {g.multiSelect && ` · UP TO ${g.maxSelect ?? '∞'}`}
                </span>
              </div>
              <div className="space-y-2">
                {g.options.filter((o) => o.isActive).map((opt) => {
                  const isSelected = selected[g.id]?.has(opt.id) ?? false;
                  const adj = Number(opt.priceAdjustment);
                  return (
                    <button
                      key={opt.id}
                      onClick={() => toggle(g, opt.id)}
                      className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-all text-left ${
                        isSelected
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                          : 'border-border hover:border-muted-foreground/30'
                      }`}
                    >
                      <span className="text-sm font-medium text-foreground">{opt.name}</span>
                      <div className="flex items-center gap-2">
                        {adj > 0 && (
                          <span className="text-xs text-muted-foreground">+{formatPeso(adj)}</span>
                        )}
                        {adj === 0 && (
                          <span className="text-xs text-muted-foreground">Included</span>
                        )}
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                            isSelected
                              ? 'border-[var(--accent)] bg-[var(--accent)]'
                              : 'border-border'
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted-foreground">Total price</span>
            <span className="text-base font-bold" style={{ color: 'var(--accent)' }}>
              {formatPeso(finalPrice)}
            </span>
          </div>
          <button
            onClick={() => canConfirm() && onConfirm(buildModifiers())}
            disabled={!canConfirm()}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 hover:opacity-90 active:scale-98"
            style={{ background: 'var(--accent)' }}
          >
            Add to Order
          </button>
        </div>
      </div>
    </div>
  );
}
