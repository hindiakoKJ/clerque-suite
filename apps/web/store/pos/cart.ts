'use client';
import { create } from 'zustand';
import { computeVat, computeDiscount, round2 } from '@/lib/pos/utils';
import { getLinePromoDiscount } from '@/lib/pos/promotions';
import type { CartItemModifier, TaxStatus } from '@repo/shared-types';
import type { ActivePromotion } from '@/lib/pos/promotions';

export type { CartItemModifier };

export interface CartProduct {
  id: string;
  name: string;
  price: number;
  costPrice?: number;
  isVatable: boolean;
  categoryId?: string;
}

export interface CartLine {
  product: CartProduct;
  variantId?: string;
  quantity: number;
  unitPrice: number;      // base price + sum of modifier price adjustments
  itemDiscount: number;   // per-unit discount (promo-applied or manual)
  modifiers?: CartItemModifier[];
  lineKey: string;        // unique key: productId + variantId + sorted optionIds
  /** Set when a promotion is auto-applied to this line. */
  promotionApplied?: { promoId: string; promoName: string };
}

export interface CartDiscount {
  type: 'PWD' | 'SENIOR_CITIZEN' | 'CASHIER_APPLIED' | 'MANAGER_OVERRIDE';
  label: string;
  /** 20% of the VAT-exclusive base — shown on receipt as the discount line */
  discountOnBase: number;
  /** VAT-exclusive base used to compute the discount */
  vatExclusiveBase: number;
  /** VAT on the discounted VAT-exclusive amount */
  vatOnDiscounted: number;
  /** VAT on items NOT included in the PWD/SC selection */
  vatOnUnselected: number;
  /** Full reduction vs original total (discountOnBase + VAT relief) */
  totalSavings: number;
  percent?: number;
  idRef?: string;
  idOwnerName?: string;
}

interface CartState {
  lines: CartLine[];
  orderDiscount: CartDiscount | null;
  branchId: string | null;
  shiftId: string | null;
  /** Tenant BIR tax classification. Set at login from JWT; drives all tax & discount logic. */
  taxStatus: TaxStatus;
  /** Convenience derived flag (taxStatus === 'VAT'). */
  isVatRegistered: boolean;
  setBranch: (branchId: string, shiftId?: string) => void;
  /** Called once on auth store hydration to push tenant flags into the cart store. */
  setTenantFlags: (taxStatus: TaxStatus) => void;

  addItem: (product: CartProduct, variantId?: string, modifiers?: CartItemModifier[]) => void;
  removeItem: (lineKey: string) => void;
  updateQty: (lineKey: string, qty: number) => void;
  setItemDiscount: (lineKey: string, discount: number) => void;

  /**
   * Auto-apply the best active promotion to each cart line.
   * Called from the terminal page whenever active promotions change.
   * Lines with no applicable promotion have their promo discount cleared.
   */
  applyPromoDiscounts: (promotions: ActivePromotion[]) => void;

  /**
   * Apply PWD/SC discount.
   * @param selectedSubtotal Optional: subtotal of only the selected (discountable) items.
   *                         If omitted the entire cart subtotal is used.
   */
  applyPwdSc: (type: 'PWD' | 'SENIOR_CITIZEN', idRef: string, idOwnerName: string, selectedSubtotal?: number) => void;
  removeOrderDiscount: () => void;
  clearCart: () => void;

  // Computed selectors
  subtotal: () => number;
  totalDiscount: () => number;
  vatAmount: () => number;
  grandTotal: () => number;
}

export const useCartStore = create<CartState>()((set, get) => ({
  lines: [],
  orderDiscount: null,
  branchId: null,
  shiftId: null,
  taxStatus: 'UNREGISTERED', // safe default; overwritten by setTenantFlags() on auth hydration
  isVatRegistered: false,

  setBranch: (branchId, shiftId) => set({ branchId, shiftId }),
  setTenantFlags: (taxStatus) => set({ taxStatus, isVatRegistered: taxStatus === 'VAT' }),

  addItem: (product, variantId, modifiers) => {
    const sortedOptionIds = (modifiers ?? []).map((m) => m.modifierOptionId).sort().join(',');
    const lineKey = [product.id, variantId ?? '', sortedOptionIds].join('|');
    const priceAdjustment = (modifiers ?? []).reduce((sum, m) => sum + m.priceAdjustment, 0);
    const unitPrice = product.price + priceAdjustment;

    set((state) => {
      const existing = state.lines.find((l) => l.lineKey === lineKey);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.lineKey === lineKey ? { ...l, quantity: l.quantity + 1 } : l,
          ),
        };
      }
      return {
        lines: [...state.lines, { product, variantId, modifiers, lineKey, quantity: 1, unitPrice, itemDiscount: 0 }],
      };
    });
  },

  removeItem: (lineKey) => {
    set((state) => {
      const nextLines = state.lines.filter((l) => l.lineKey !== lineKey);
      return { lines: nextLines, orderDiscount: nextLines.length === 0 ? null : state.orderDiscount };
    });
  },

  updateQty: (lineKey, qty) => {
    if (qty <= 0) { get().removeItem(lineKey); return; }
    set((state) => ({
      lines: state.lines.map((l) => l.lineKey === lineKey ? { ...l, quantity: qty } : l),
    }));
  },

  setItemDiscount: (lineKey, discount) => {
    set((state) => ({
      lines: state.lines.map((l) => l.lineKey === lineKey ? { ...l, itemDiscount: discount } : l),
    }));
  },

  applyPromoDiscounts: (promotions) => {
    set((state) => ({
      lines: state.lines.map((line) => {
        const result = getLinePromoDiscount(line, promotions);
        if (!result) {
          // Clear any previously applied promo discount
          return { ...line, itemDiscount: 0, promotionApplied: undefined };
        }
        // Convert total discount to per-unit so quantity changes auto-adjust
        const discountPerUnit = round2(result.discountAmount / line.quantity);
        return {
          ...line,
          itemDiscount: discountPerUnit,
          promotionApplied: { promoId: result.promoId, promoName: result.promoName },
        };
      }),
    }));
  },

  applyPwdSc: (type, idRef, idOwnerName, selectedSubtotal) => {
    const { taxStatus } = get();
    const fullSubtotal  = get().subtotal();
    const basis         = selectedSubtotal ?? fullSubtotal;
    const unselectedSubtotal = selectedSubtotal != null ? fullSubtotal - selectedSubtotal : 0;

    // RA 9994 / RA 7277 — dispatch to correct engine via unified helper
    const { vatExclusiveBase, discountOnBase, vatOnDiscounted, totalSavings } =
      computeDiscount(basis, taxStatus);

    // Unselected items: only carry VAT for VAT-registered tenants
    const vatOnUnselected =
      taxStatus === 'VAT' && unselectedSubtotal > 0
        ? computeVat(unselectedSubtotal).vat
        : 0;

    set({
      orderDiscount: {
        type,
        label:            type === 'PWD' ? 'PWD Discount' : 'Senior Citizen Discount',
        discountOnBase,
        vatExclusiveBase,
        vatOnDiscounted,
        vatOnUnselected,
        totalSavings,
        percent: 20,
        idRef,
        idOwnerName,
      },
    });
  },

  removeOrderDiscount: () => set({ orderDiscount: null }),
  clearCart: () => set({ lines: [], orderDiscount: null }),

  subtotal: () => get().lines.reduce((sum, l) => sum + (l.unitPrice - l.itemDiscount) * l.quantity, 0),

  totalDiscount: () => {
    const { lines, orderDiscount } = get();
    const itemDiscounts = lines.reduce((sum, l) => sum + l.itemDiscount * l.quantity, 0);
    return itemDiscounts + (orderDiscount?.discountOnBase ?? 0);
  },

  vatAmount: () => {
    const { lines, orderDiscount, taxStatus } = get();

    // Only VAT-registered tenants collect 12% VAT
    if (taxStatus !== 'VAT') return 0;

    const isPwdSc = orderDiscount?.type === 'PWD' || orderDiscount?.type === 'SENIOR_CITIZEN';
    if (isPwdSc && orderDiscount) {
      return orderDiscount.vatOnDiscounted + (orderDiscount.vatOnUnselected ?? 0);
    }
    // Compute VAT only on vatable lines, proportionally reduced by any order-level discount.
    // Using some() then applying the full subtotal was wrong for mixed-vatable carts — it
    // overcollected VAT on non-vatable items (e.g. basic food, medicines, senior essentials).
    const fullSubtotal    = lines.reduce((sum, l) => sum + (l.unitPrice - l.itemDiscount) * l.quantity, 0);
    const vatableSubtotal = lines
      .filter((l) => l.product.isVatable)
      .reduce((sum, l) => sum + (l.unitPrice - l.itemDiscount) * l.quantity, 0);
    if (vatableSubtotal === 0) return 0;
    // Apply order discount proportionally to the vatable portion
    const discountOnBase  = orderDiscount?.discountOnBase ?? 0;
    const discountRatio   = fullSubtotal > 0 ? (fullSubtotal - discountOnBase) / fullSubtotal : 1;
    const vatableAmount   = round2(vatableSubtotal * discountRatio);
    return computeVat(vatableAmount).vat;
  },

  grandTotal: () => get().subtotal() - (get().orderDiscount?.totalSavings ?? 0),
}));
