'use client';
import { create } from 'zustand';
import { computeVat, computePwdScDiscount } from '@/lib/pos/utils';

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
  unitPrice: number;
  itemDiscount: number;
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
  setBranch: (branchId: string, shiftId?: string) => void;

  addItem: (product: CartProduct, variantId?: string) => void;
  removeItem: (productId: string, variantId?: string) => void;
  updateQty: (productId: string, qty: number, variantId?: string) => void;
  setItemDiscount: (productId: string, discount: number) => void;

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

  setBranch: (branchId, shiftId) => set({ branchId, shiftId }),

  addItem: (product, variantId) => {
    set((state) => {
      const existing = state.lines.find((l) => l.product.id === product.id && l.variantId === variantId);
      if (existing) {
        return {
          lines: state.lines.map((l) =>
            l.product.id === product.id && l.variantId === variantId
              ? { ...l, quantity: l.quantity + 1 }
              : l,
          ),
        };
      }
      return {
        lines: [...state.lines, { product, variantId, quantity: 1, unitPrice: product.price, itemDiscount: 0 }],
      };
    });
  },

  removeItem: (productId, variantId) => {
    set((state) => {
      const nextLines = state.lines.filter((l) => !(l.product.id === productId && l.variantId === variantId));
      return { lines: nextLines, orderDiscount: nextLines.length === 0 ? null : state.orderDiscount };
    });
  },

  updateQty: (productId, qty, variantId) => {
    if (qty <= 0) { get().removeItem(productId, variantId); return; }
    set((state) => ({
      lines: state.lines.map((l) =>
        l.product.id === productId && l.variantId === variantId ? { ...l, quantity: qty } : l,
      ),
    }));
  },

  setItemDiscount: (productId, discount) => {
    set((state) => ({
      lines: state.lines.map((l) => l.product.id === productId ? { ...l, itemDiscount: discount } : l),
    }));
  },

  applyPwdSc: (type, idRef, idOwnerName, selectedSubtotal) => {
    const fullSubtotal    = get().subtotal();
    const basis           = selectedSubtotal ?? fullSubtotal;
    const unselectedSubtotal = selectedSubtotal != null ? fullSubtotal - selectedSubtotal : 0;

    const { vatExclusiveBase, discountOnBase, vatOnDiscounted, totalSavings } = computePwdScDiscount(basis);
    const vatOnUnselected = unselectedSubtotal > 0 ? computeVat(unselectedSubtotal).vat : 0;

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
    const { lines, orderDiscount } = get();
    const isPwdSc = orderDiscount?.type === 'PWD' || orderDiscount?.type === 'SENIOR_CITIZEN';
    if (isPwdSc && orderDiscount) {
      return orderDiscount.vatOnDiscounted + (orderDiscount.vatOnUnselected ?? 0);
    }
    const subtotalAfterDiscount =
      lines.reduce((sum, l) => sum + (l.unitPrice - l.itemDiscount) * l.quantity, 0) -
      (orderDiscount?.discountOnBase ?? 0);
    const vatableAmount = lines.some((l) => l.product.isVatable) ? subtotalAfterDiscount : 0;
    return computeVat(vatableAmount).vat;
  },

  grandTotal: () => get().subtotal() - (get().orderDiscount?.totalSavings ?? 0),
}));
