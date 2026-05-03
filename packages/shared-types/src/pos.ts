export type PaymentMethod =
  | 'CASH'
  | 'GCASH_PERSONAL'
  | 'GCASH_BUSINESS'
  | 'MAYA_PERSONAL'
  | 'MAYA_BUSINESS'
  | 'QR_PH';

export type OrderStatus = 'OPEN' | 'COMPLETED' | 'VOIDED' | 'RETURNED';
export type DiscountType = 'PROMO' | 'CASHIER_APPLIED' | 'MANAGER_OVERRIDE' | 'PWD' | 'SENIOR_CITIZEN';

/**
 * BIR-required tax classification per line item (mirrors schema enum TaxType).
 *   VAT_12     — 12% VAT; standard for most products and services
 *   VAT_EXEMPT — Exempt by law (basic necessities, medicines); no VAT collected
 *   ZERO_RATED — 0% VAT (exports, PEZA locators); input VAT still reclaimable
 */
export type TaxType = 'VAT_12' | 'VAT_EXEMPT' | 'ZERO_RATED';

/**
 * How payment is settled at point-of-sale.
 *   CASH_SALE — Payment received immediately (cash, e-wallet, QR Ph); the default for retail POS
 *   CHARGE    — On-account / credit terms (B2B, corporate accounts); creates an AR entry in Phase 4
 */
export type InvoiceType = 'CASH_SALE' | 'CHARGE';

export interface CartItemModifier {
  modifierGroupId: string;
  modifierOptionId: string;
  groupName: string;
  optionName: string;
  priceAdjustment: number;
}

export interface CartItem {
  productId: string;
  variantId?: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  discountAmount: number;
  vatAmount: number;
  lineTotal: number;
  costPrice?: number;
  isVatable: boolean;
  /** BIR per-line tax classification. Defaults to VAT_12 for vatable items. */
  taxType?: TaxType;
  modifiers?: CartItemModifier[];
}

export interface OfflineOrder {
  clientUuid: string;
  branchId: string;
  shiftId?: string;
  items: CartItem[];
  payments: { method: PaymentMethod; amount: number; reference?: string }[];
  discounts: OfflineDiscount[];
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  isPwdScDiscount: boolean;
  pwdScIdRef?: string;
  pwdScIdOwnerName?: string;
  createdAt: string;

  // ── BIR CAS: Invoice Classification ──────────────────────────────────────
  /** How payment is settled. Defaults to CASH_SALE for retail POS. */
  invoiceType?: InvoiceType;
  /** Dominant tax classification for the order. Defaults to VAT_12. */
  taxType?: TaxType;

  // ── BIR CAS: B2B Customer Fields (AR) ────────────────────────────────────
  // Required per RR No. 1-2026 for invoices issued to businesses.
  // All three are optional for walk-in / anonymous retail sales.
  /** Corporate buyer's business name (for B2B invoices) */
  customerName?: string;
  /** BIR TIN of the corporate buyer — required for their input VAT claim */
  customerTin?: string;
  /** Registered address of the corporate buyer — required for invoices > ₱1,000 */
  customerAddress?: string;
}

export interface OfflineDiscount {
  discountType: DiscountType;
  discountConfigId?: string;
  discountPercent?: number;
  discountFixed?: number;
  discountAmount: number;
  reason?: string;
  authorizedById?: string;
  /** PWD/SC ID — only set when discountType is PWD or SENIOR_CITIZEN. */
  pwdScIdRef?: string;
  /** PWD/SC cardholder name — only set when discountType is PWD or SENIOR_CITIZEN. */
  pwdScIdOwnerName?: string;
}
