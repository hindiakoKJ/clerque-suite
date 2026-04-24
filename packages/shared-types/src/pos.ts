export type PaymentMethod =
  | 'CASH'
  | 'GCASH_PERSONAL'
  | 'GCASH_BUSINESS'
  | 'MAYA_PERSONAL'
  | 'MAYA_BUSINESS'
  | 'QR_PH';

export type OrderStatus = 'OPEN' | 'COMPLETED' | 'VOIDED' | 'RETURNED';
export type DiscountType = 'PROMO' | 'CASHIER_APPLIED' | 'MANAGER_OVERRIDE' | 'PWD' | 'SENIOR_CITIZEN';

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
}

export interface OfflineDiscount {
  discountType: DiscountType;
  discountConfigId?: string;
  discountPercent?: number;
  discountFixed?: number;
  discountAmount: number;
  reason?: string;
  authorizedById?: string;
}
