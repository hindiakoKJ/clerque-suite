export type AccountingEventType =
  | 'SALE'
  | 'COGS'
  | 'VOID'
  | 'RETURN'
  | 'EOD_SUMMARY'
  | 'INVENTORY_ADJUSTMENT'
  | 'SETTLEMENT';

export type AccountingEventStatus = 'PENDING' | 'SYNCED' | 'FAILED';

export interface SaleEventPayload {
  orderId: string;
  orderNumber: string;
  branchId: string;
  completedAt: string;
  lines: SaleEventLine[];
  payments: SaleEventPayment[];
  vatAmount: number;
  totalAmount: number;
  discountAmount: number;
  isPwdScDiscount: boolean;
}

export interface SaleEventLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  costPrice?: number;
  vatAmount: number;
  lineTotal: number;
  isVatable: boolean;
}

export interface SaleEventPayment {
  method: string;
  amount: number;
  reference?: string;
}

export interface CogsEventPayload {
  orderId: string;
  branchId: string;
  lines: CogsEventLine[];
}

export interface CogsEventLine {
  productId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
}
