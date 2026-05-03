'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
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
  /**
   * Cart line keys claimed by this PWD/SC. Empty array means the discount
   * covers the entire cart (legacy "all items" path). Used to prevent
   * double-claiming when additional PWDs/SCs are added later.
   * Only meaningful when type is PWD or SENIOR_CITIZEN.
   */
  selectedLineKeys?: string[];
  /** Free-text reason — required for CASHIER_APPLIED / MANAGER_OVERRIDE; logged on receipt + journal */
  reason?: string;
}

/**
 * Additional PWD/SC entry — used when multiple qualified individuals share
 * a single order. The first PWD/SC always lives in `orderDiscount`; entries
 * 2..5 are appended to `additionalPwdScEntries`.
 *
 * Per BIR (RR 7-2010 + practical interpretation), the 20% discount is a
 * right of each qualified individual, not per receipt — so a group of
 * seniors can each claim 20% on their own portion of a shared meal.
 *
 * Capped at 5 entries total per order (industry-standard interpretation).
 */
export interface AdditionalPwdScEntry {
  type: 'PWD' | 'SENIOR_CITIZEN';
  idRef: string;
  idOwnerName: string;
  /** Cart line keys claimed by this PWD/SC. Always non-empty for additional entries. */
  selectedLineKeys: string[];
  /** Subtotal of THIS PWD/SC's selected items (before discount) */
  selectedSubtotal: number;
  /** 20% of the VAT-exclusive base for this PWD's items */
  discountOnBase: number;
  vatExclusiveBase: number;
  /** VAT on this PWD's discounted items (zero for non-VAT tenants) */
  vatOnDiscounted: number;
  /** Total reduction vs original (discountOnBase + VAT relief) */
  totalSavings: number;
}

/** Hard cap on PWD/SC IDs per single order. */
export const MAX_PWD_SC_PER_ORDER = 5;

interface CartState {
  lines: CartLine[];
  orderDiscount: CartDiscount | null;
  /**
   * Additional PWD/SC entries beyond the first (which lives in orderDiscount).
   * Empty array = single-PWD or no-PWD case (the common path).
   */
  additionalPwdScEntries: AdditionalPwdScEntry[];
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
  /**
   * Apply the FIRST PWD/SC discount.
   * @param selectedLineKeys Cart line keys this PWD claimed. When omitted, the
   *                          legacy "covers the whole cart" path is used.
   * @param selectedSubtotal Subtotal of selected items. When omitted, the full
   *                          cart subtotal is used.
   */
  applyPwdSc: (
    type: 'PWD' | 'SENIOR_CITIZEN',
    idRef: string,
    idOwnerName: string,
    selectedSubtotal?: number,
    selectedLineKeys?: string[],
  ) => void;
  /**
   * Add a SECOND through FIFTH PWD/SC discount on top of an existing one.
   * Silently no-ops when there's no first PWD/SC yet, or when the cap
   * (MAX_PWD_SC_PER_ORDER) is reached. selectedLineKeys must list the
   * cart lines this PWD claims (and they must NOT already be claimed
   * by another PWD on the same order).
   */
  addAdditionalPwdSc: (
    type: 'PWD' | 'SENIOR_CITIZEN',
    idRef: string,
    idOwnerName: string,
    selectedSubtotal: number,
    selectedLineKeys: string[],
  ) => void;
  removeAdditionalPwdSc: (index: number) => void;
  /**
   * Manual cashier-applied whole-cart discount.
   * @param value     Either a percent (1-100) or a fixed peso amount.
   * @param isPercent true → value is a percent of subtotal; false → value is a fixed peso amount.
   * @param reason    Required free-text reason (logged on receipt + journal).
   */
  applyManualDiscount: (value: number, isPercent: boolean, reason: string) => void;
  removeOrderDiscount: () => void;
  clearCart: () => void;

  // Computed selectors
  subtotal: () => number;
  totalDiscount: () => number;
  vatAmount: () => number;
  grandTotal: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
  lines: [],
  orderDiscount: null,
  additionalPwdScEntries: [],
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
      return {
        lines: nextLines,
        orderDiscount:          nextLines.length === 0 ? null : state.orderDiscount,
        additionalPwdScEntries: nextLines.length === 0 ? []   : state.additionalPwdScEntries,
      };
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
    set((state) => {
      // Empty cart: nothing to discount.  Returning {} from set() means
      // "no state change" — Zustand will skip the re-render.  Critical
      // because this method is called from a useEffect whose dep array
      // includes `promotions`; if we always returned a new lines array
      // (even an empty one), it would trigger an infinite render loop.
      if (state.lines.length === 0) return {};

      let changed = false;
      const newLines = state.lines.map((line) => {
        const result = getLinePromoDiscount(line, promotions);
        const newDiscount = result ? round2(result.discountAmount / line.quantity) : 0;
        const newPromo = result
          ? { promoId: result.promoId, promoName: result.promoName }
          : undefined;

        // Compare against the line's current state — if nothing actually
        // differs, return the same line reference to skip re-render
        const currentPromoId = line.promotionApplied?.promoId;
        const newPromoId = newPromo?.promoId;
        if (line.itemDiscount === newDiscount && currentPromoId === newPromoId) {
          return line; // unchanged — same reference
        }
        changed = true;
        return {
          ...line,
          itemDiscount: newDiscount,
          promotionApplied: newPromo,
        };
      });

      // No line actually changed → return {} to skip the re-render entirely
      return changed ? { lines: newLines } : {};
    });
  },

  applyPwdSc: (type, idRef, idOwnerName, selectedSubtotal, selectedLineKeys) => {
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
        selectedLineKeys: selectedLineKeys ?? [],
      },
      // Reset any additional PWD/SC entries when starting fresh.
      additionalPwdScEntries: [],
    });
  },

  addAdditionalPwdSc: (type, idRef, idOwnerName, selectedSubtotal, selectedLineKeys) => {
    const { taxStatus, orderDiscount, additionalPwdScEntries } = get();
    // Must have a first PWD/SC already applied
    if (!orderDiscount || (orderDiscount.type !== 'PWD' && orderDiscount.type !== 'SENIOR_CITIZEN')) return;
    // Hard cap: 5 IDs total per order (1 in orderDiscount + 4 additional)
    if (additionalPwdScEntries.length >= MAX_PWD_SC_PER_ORDER - 1) return;
    if (selectedSubtotal <= 0) return;
    if (!selectedLineKeys || selectedLineKeys.length === 0) return;

    // Defensive: drop any line keys that are already claimed by another PWD.
    // The modal should already filter these out, but guard at the store too.
    const claimedKeys = new Set<string>([
      ...(orderDiscount.selectedLineKeys ?? []),
      ...additionalPwdScEntries.flatMap((e) => e.selectedLineKeys),
    ]);
    const dedupedKeys = selectedLineKeys.filter((k) => !claimedKeys.has(k));
    if (dedupedKeys.length === 0) return;

    const { vatExclusiveBase, discountOnBase, vatOnDiscounted, totalSavings } =
      computeDiscount(selectedSubtotal, taxStatus);

    set({
      additionalPwdScEntries: [
        ...additionalPwdScEntries,
        {
          type,
          idRef,
          idOwnerName,
          selectedLineKeys: dedupedKeys,
          selectedSubtotal,
          discountOnBase,
          vatExclusiveBase,
          vatOnDiscounted,
          totalSavings,
        },
      ],
    });
  },

  removeAdditionalPwdSc: (index) => {
    set((state) => ({
      additionalPwdScEntries: state.additionalPwdScEntries.filter((_, i) => i !== index),
    }));
  },

  applyManualDiscount: (value, isPercent, reason) => {
    const sub = get().subtotal();
    if (sub <= 0) return;
    // Cap discount at the subtotal so we never go negative
    const rawAmount = isPercent ? sub * (value / 100) : value;
    const discountOnBase = round2(Math.min(Math.max(0, rawAmount), sub));
    if (discountOnBase === 0) return;
    set({
      orderDiscount: {
        type: 'CASHIER_APPLIED',
        label: isPercent ? `Discount (${value}%)` : 'Discount',
        discountOnBase,
        vatExclusiveBase: sub,
        // VAT recalc on the discounted total is handled by vatAmount() via the
        // discountRatio path — these two fields stay 0 for CASHIER_APPLIED.
        vatOnDiscounted: 0,
        vatOnUnselected: 0,
        totalSavings: discountOnBase,
        percent: isPercent ? value : undefined,
        reason,
      },
    });
  },

  removeOrderDiscount: () => set({ orderDiscount: null, additionalPwdScEntries: [] }),
  clearCart: () => set({ lines: [], orderDiscount: null, additionalPwdScEntries: [] }),

  subtotal: () => get().lines.reduce((sum, l) => sum + (l.unitPrice - l.itemDiscount) * l.quantity, 0),

  totalDiscount: () => {
    const { lines, orderDiscount, additionalPwdScEntries } = get();
    const itemDiscounts = lines.reduce((sum, l) => sum + l.itemDiscount * l.quantity, 0);
    const additional = additionalPwdScEntries.reduce((sum, e) => sum + e.discountOnBase, 0);
    return itemDiscounts + (orderDiscount?.discountOnBase ?? 0) + additional;
  },

  vatAmount: () => {
    const { lines, orderDiscount, additionalPwdScEntries, taxStatus } = get();

    // Only VAT-registered tenants collect 12% VAT
    if (taxStatus !== 'VAT') return 0;

    const isPwdSc = orderDiscount?.type === 'PWD' || orderDiscount?.type === 'SENIOR_CITIZEN';
    if (isPwdSc && orderDiscount) {
      // VAT structure with one or more PWDs:
      //   - Each PWD pays VAT only on their own discounted slice (effective ~3%)
      //   - Items claimed by NO PWD pay full 12% VAT
      //
      // The "no double-claim" guarantee is enforced upstream (in the modal +
      // the addAdditionalPwdSc dedupe). Here we trust selectedLineKeys is
      // disjoint across entries and compute the unclaimed slice precisely
      // by line keys — no approximation, no gross-up math.
      const claimed = new Set<string>([
        ...(orderDiscount.selectedLineKeys ?? []),
        ...additionalPwdScEntries.flatMap((e) => e.selectedLineKeys),
      ]);

      // Edge case: legacy "covers entire cart" (selectedLineKeys is empty AND
      // there are no additional entries) — preserve original behaviour.
      if (claimed.size === 0 && additionalPwdScEntries.length === 0) {
        return orderDiscount.vatOnDiscounted + (orderDiscount.vatOnUnselected ?? 0);
      }

      // Unclaimed subtotal = sum of vatable lines NOT in any PWD's claim list.
      // (Non-vatable items collect zero VAT regardless of who claimed them.)
      const unclaimedVatableSubtotal = lines
        .filter((l) => l.product.isVatable && !claimed.has(l.lineKey))
        .reduce((sum, l) => sum + (l.unitPrice - l.itemDiscount) * l.quantity, 0);
      const vatOnUnclaimed = unclaimedVatableSubtotal > 0
        ? computeVat(unclaimedVatableSubtotal).vat
        : 0;

      const additionalVatOnDiscounted = additionalPwdScEntries.reduce((sum, e) => sum + e.vatOnDiscounted, 0);
      return orderDiscount.vatOnDiscounted + additionalVatOnDiscounted + vatOnUnclaimed;
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

  grandTotal: () => {
    const { subtotal, orderDiscount, additionalPwdScEntries } = get();
    const additionalSavings = additionalPwdScEntries.reduce((sum, e) => sum + e.totalSavings, 0);
    return subtotal() - (orderDiscount?.totalSavings ?? 0) - additionalSavings;
  },
    }),
    {
      name: 'clerque-cart',
      // sessionStorage: cart survives accidental refresh / brief crash within
      // the same tab session, but a fully closed browser/tab clears it.
      // This matches the "never lose a sale" principle without leaking carts
      // across logins on shared terminals.
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({
        lines: state.lines,
        orderDiscount: state.orderDiscount,
        additionalPwdScEntries: state.additionalPwdScEntries,
        branchId: state.branchId,
        shiftId: state.shiftId,
        // taxStatus / isVatRegistered intentionally NOT persisted — they
        // are re-set fresh from the JWT on every auth-store hydration so
        // a stale value can never be used to compute VAT.
      }),
      version: 1,
    },
  ),
);
