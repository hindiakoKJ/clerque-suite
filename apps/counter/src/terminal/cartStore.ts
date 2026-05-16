/**
 * Cart store — vertical-agnostic. F&B, Retail, Laundry, Pharmacy all use this.
 * Currency is integer ₱ cents end-to-end; format only for display.
 *
 * VAT model: lines tag themselves implicitly. For now we treat every line as
 * VAT-inclusive at 12% (VAT-registered tenants) and rely on the consumer to
 * branch on `tenant.isVatRegistered`. The selectors below give both worlds.
 */
import { create } from 'zustand';
import type { CartLine, CartModifier, CartState, DiningMode } from '@/types';

const VAT_RATE = 0.12;

let __uid = 0;
const uid = () => `l_${Date.now()}_${++__uid}`;

export interface AddLineInput {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  qty: number;
  unitPrice: number;            // ₱ cents
  modifiers?: CartModifier[];
  /** Optional pre-computed line total. If absent we compute from qty/unit/modifiers. */
  lineTotal?: number;
  /** Skip merging with existing matching line. */
  noMerge?: boolean;
}

export interface CartStore extends CartState {
  // mutations
  addLine: (input: AddLineInput) => string;
  setQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;       // soft-remove (sets removed=true)
  restoreLine: (lineId: string) => void;
  voidLine: (lineId: string, reason: string, supervisorId: string) => void;
  applyDiscount: (lineId: string, discount: CartLine['discount']) => void;
  setDiningMode: (mode: DiningMode | undefined) => void;
  setTableNumber: (table: string | undefined) => void;
  setCustomer: (customer: CartState['customer']) => void;
  setPwdScId: (id: CartState['pwdScId']) => void;
  clear: () => void;

  // selectors (computed on-demand)
  subtotal: () => number;
  discountTotal: () => number;
  vatableSales: () => number;
  vatExempt: () => number;
  vatAmount: () => number;
  total: () => number;
  lineCount: () => number;

  /** Lines that count toward totals (not removed). */
  activeLines: () => CartLine[];
}

function computeLineTotal(qty: number, unit: number, modifiers: CartModifier[]): number {
  const mod = modifiers.reduce((s, m) => s + m.priceAdjustment, 0);
  return Math.max(0, Math.round((unit + mod) * qty));
}

function applyDiscountToLine(line: CartLine): number {
  if (!line.discount) return line.lineTotal;
  if (line.discount.fixedCents != null) return Math.max(0, line.lineTotal - line.discount.fixedCents);
  const pct = line.discount.percent ?? (line.discount.kind === 'SENIOR' || line.discount.kind === 'PWD' ? 20 : 0);
  return Math.max(0, Math.round(line.lineTotal * (1 - pct / 100)));
}

export const useCartStore = create<CartStore>((set, get) => ({
  lines: [],
  payments: [],
  diningMode: undefined,
  tableNumber: undefined,
  customer: undefined,
  pwdScId: undefined,

  addLine: (input) => {
    const modifiers = input.modifiers ?? [];
    const lineTotal = input.lineTotal ?? computeLineTotal(input.qty, input.unitPrice, modifiers);

    // Merge if same product+variant+no modifiers and not removed/voided.
    if (!input.noMerge && modifiers.length === 0) {
      const existing = get().lines.find(
        (l) => l.productId === input.productId &&
          l.variantId === input.variantId &&
          l.modifiers.length === 0 &&
          !l.removed && !l.voidedAt,
      );
      if (existing) {
        const newQty = existing.qty + input.qty;
        const newTotal = computeLineTotal(newQty, existing.unitPrice, existing.modifiers);
        set({
          lines: get().lines.map((l) =>
            l.id === existing.id ? { ...l, qty: newQty, lineTotal: newTotal } : l,
          ),
        });
        return existing.id;
      }
    }

    const id = uid();
    const line: CartLine = {
      id,
      productId: input.productId,
      productName: input.productName,
      variantId: input.variantId,
      variantName: input.variantName,
      qty: input.qty,
      unitPrice: input.unitPrice,
      modifiers,
      lineTotal,
    };
    set({ lines: [...get().lines, line] });
    return id;
  },

  setQty: (lineId, qty) => set({
    lines: get().lines.map((l) => {
      if (l.id !== lineId) return l;
      const q = Math.max(0, qty);
      return { ...l, qty: q, lineTotal: computeLineTotal(q, l.unitPrice, l.modifiers) };
    }),
  }),

  removeLine: (lineId) => set({
    lines: get().lines.map((l) => l.id === lineId ? { ...l, removed: true } : l),
  }),

  restoreLine: (lineId) => set({
    lines: get().lines.map((l) => l.id === lineId ? { ...l, removed: false } : l),
  }),

  voidLine: (lineId, reason, supervisorId) => set({
    lines: get().lines.map((l) =>
      l.id === lineId
        ? { ...l, voidedAt: new Date().toISOString(), voidReason: `${reason} (by ${supervisorId})` }
        : l,
    ),
  }),

  applyDiscount: (lineId, discount) => set({
    lines: get().lines.map((l) => l.id === lineId ? { ...l, discount } : l),
  }),

  setDiningMode: (mode) => set({ diningMode: mode }),
  setTableNumber: (table) => set({ tableNumber: table }),
  setCustomer: (customer) => set({ customer }),
  setPwdScId: (pwdScId) => set({ pwdScId }),

  clear: () => set({
    lines: [], payments: [],
    diningMode: undefined, tableNumber: undefined,
    customer: undefined, pwdScId: undefined,
  }),

  activeLines: () => get().lines.filter((l) => !l.removed && !l.voidedAt),

  subtotal: () => get().activeLines().reduce((s, l) => s + l.lineTotal, 0),

  discountTotal: () => get().activeLines().reduce(
    (s, l) => s + (l.lineTotal - applyDiscountToLine(l)),
    0,
  ),

  vatableSales: () => {
    // Senior/PWD lines are VAT-exempt by BIR rule.
    const exemptKinds = new Set(['SENIOR', 'PWD']);
    return get().activeLines().reduce((s, l) => {
      const isExempt = l.discount && exemptKinds.has(l.discount.kind);
      return isExempt ? s : s + applyDiscountToLine(l);
    }, 0);
  },

  vatExempt: () => {
    const exemptKinds = new Set(['SENIOR', 'PWD']);
    return get().activeLines().reduce((s, l) => {
      const isExempt = l.discount && exemptKinds.has(l.discount.kind);
      return isExempt ? s + applyDiscountToLine(l) : s;
    }, 0);
  },

  vatAmount: () => {
    // VAT-inclusive: vatable / 1.12 * 0.12
    const vatable = get().vatableSales();
    return Math.round(vatable - vatable / (1 + VAT_RATE));
  },

  total: () => get().activeLines().reduce((s, l) => s + applyDiscountToLine(l), 0),

  lineCount: () => get().activeLines().reduce((s, l) => s + l.qty, 0),
}));

export const cartHelpers = { computeLineTotal, applyDiscountToLine, VAT_RATE };

// =====================================================================
// `useCart` — convenience facade used by Laundry/Pharmacy terminals.
//
// Shape: { cart: snapshot, addLine(line: CartLine|AddLineInput), voidLine(id, reason?, supervisorId?), setCustomer, ... }
// The `cart` snapshot mirrors `CartState` so consumers can read `cart.lines`,
// `cart.customer`, etc. Calling `addLine` with a fully-formed `CartLine`
// (i.e. it already has `id` + `lineTotal`) just appends it as-is.
// =====================================================================
export interface CartSnapshot extends CartState {}

export interface UseCartFacade {
  cart: CartSnapshot;
  addLine: (input: AddLineInput | import('@/types').CartLine) => string;
  setQty: (lineId: string, qty: number) => void;
  removeLine: (lineId: string) => void;
  restoreLine: (lineId: string) => void;
  voidLine: (lineId: string, reason?: string, supervisorId?: string) => void;
  applyDiscount: (lineId: string, discount: CartLine['discount']) => void;
  setDiningMode: (mode: DiningMode | undefined) => void;
  setTableNumber: (table: string | undefined) => void;
  setCustomer: (customer: CartState['customer']) => void;
  setPwdScId: (id: CartState['pwdScId']) => void;
  clear: () => void;
}

function isFullLine(input: AddLineInput | CartLine): input is CartLine {
  return (input as CartLine).id !== undefined && (input as CartLine).lineTotal !== undefined && (input as CartLine).modifiers !== undefined;
}

/**
 * Subscribes to the cart store and exposes a facade. Accepts an optional
 * selector mirroring zustand's signature: `useCart((s) => s.cart)`.
 */
export function useCart(): UseCartFacade;
export function useCart<T>(selector: (facade: UseCartFacade) => T): T;
export function useCart<T>(selector?: (facade: UseCartFacade) => T): T | UseCartFacade {
  // Subscribe to entire store so any change re-renders the consumer. This is
  // acceptable for terminal screens where most state matters.
  const state = useCartStore();
  const facade: UseCartFacade = {
    cart: {
      lines: state.lines,
      payments: state.payments,
      diningMode: state.diningMode,
      tableNumber: state.tableNumber,
      customer: state.customer,
      pwdScId: state.pwdScId,
    },
    addLine: (input) => {
      if (isFullLine(input)) {
        // Append directly, preserving caller-supplied id.
        useCartStore.setState({ lines: [...useCartStore.getState().lines, input] });
        return input.id;
      }
      return state.addLine(input);
    },
    setQty: state.setQty,
    removeLine: state.removeLine,
    restoreLine: state.restoreLine,
    voidLine: (id, reason = 'VOID', supervisorId = 'pending-supervisor') =>
      state.voidLine(id, reason, supervisorId),
    applyDiscount: state.applyDiscount,
    setDiningMode: state.setDiningMode,
    setTableNumber: state.setTableNumber,
    setCustomer: state.setCustomer,
    setPwdScId: state.setPwdScId,
    clear: state.clear,
  };
  return selector ? selector(facade) : facade;
}

