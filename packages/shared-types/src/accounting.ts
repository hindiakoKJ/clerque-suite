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

// ─── Void event ────────────────────────────────────────────────────────────

export interface VoidEventPayload {
  orderId:        string;
  orderNumber:    string;
  branchId:       string;
  voidedAt:       string;       // ISO 8601
  reason:         string;
  totalAmount:    number;
  vatAmount:      number;
  discountAmount: number;
  /** Original sale payments — used to reverse the GL entries */
  payments:       SaleEventPayment[];
  /** Original COGS lines — used to reverse inventory cost entries */
  cogsLines:      CogsEventLine[];
}

// ─── Return / refund event ─────────────────────────────────────────────────

export interface ReturnEventPayload {
  orderId:        string;
  orderNumber:    string;
  branchId:       string;
  returnedAt:     string;       // ISO 8601
  reason:         string;
  lines:          ReturnEventLine[];
  refundMethod:   string;       // CASH | GCASH_PERSONAL | etc.
  totalRefund:    number;
  vatRefund:      number;
}

export interface ReturnEventLine {
  productId:   string;
  productName: string;
  quantity:    number;
  unitPrice:   number;
  unitCost:    number;
  lineTotal:   number;
  vatAmount:   number;
}

// ─── End-of-day summary event ──────────────────────────────────────────────

export interface EodSummaryPayload {
  shiftId:          string;
  branchId:         string;
  openedAt:         string;     // ISO 8601
  closedAt:         string;     // ISO 8601
  openingCash:      number;
  closingCash:      number;
  expectedCash:     number;
  cashVariance:     number;     // closingCash - expectedCash
  totalOrders:      number;
  totalVoided:      number;
  totalRevenue:     number;
  totalVat:         number;
  totalDiscount:    number;
  totalCogs:        number;
  paymentBreakdown: EodPaymentLine[];
  topProducts:      EodTopProduct[];
}

export interface EodPaymentLine {
  method:     string;
  count:      number;
  totalAmount: number;
}

export interface EodTopProduct {
  productId:   string;
  productName: string;
  quantity:    number;
  revenue:     number;
}

// ─── Inventory adjustment event ────────────────────────────────────────────

export interface InventoryAdjustmentPayload {
  productId:    string;
  productName:  string;
  branchId:     string;
  adjustedAt:   string;         // ISO 8601
  adjustedById: string;
  type:         'STOCK_IN' | 'STOCK_OUT' | 'ADJUSTMENT' | 'WASTE' | 'TRANSFER';
  quantityBefore: number;
  quantityChange: number;       // positive = in, negative = out
  quantityAfter:  number;
  unitCost?:    number;         // present for STOCK_IN (purchase cost)
  totalCost?:   number;         // unitCost × |quantityChange|
  reason?:      string;
  referenceId?: string;         // PO number, transfer ID, etc.
}

// ─── Settlement batch event ────────────────────────────────────────────────

export interface SettlementEventPayload {
  batchId:        string;
  branchId:       string;
  settledAt:      string;       // ISO 8601
  confirmedById:  string;
  paymentMethod:  string;       // GCASH_PERSONAL | MAYA_BUSINESS | etc.
  periodFrom:     string;
  periodTo:       string;
  totalExpected:  number;       // sum of orders using this method
  totalSettled:   number;       // actual amount confirmed received
  variance:       number;       // totalSettled - totalExpected
  referenceNumber?: string;     // bank/provider reference
  notes?:         string;
}

// ─── Union discriminated type for typed event routing ─────────────────────

export type AccountingEventPayload =
  | ({ type: 'SALE' }                & SaleEventPayload)
  | ({ type: 'COGS' }                & CogsEventPayload)
  | ({ type: 'VOID' }                & VoidEventPayload)
  | ({ type: 'RETURN' }              & ReturnEventPayload)
  | ({ type: 'EOD_SUMMARY' }         & EodSummaryPayload)
  | ({ type: 'INVENTORY_ADJUSTMENT' } & InventoryAdjustmentPayload)
  | ({ type: 'SETTLEMENT' }          & SettlementEventPayload);
