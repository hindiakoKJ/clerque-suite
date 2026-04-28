/**
 * Demo Mode — In-Memory Type Definitions
 *
 * These mirror the shape of the real Prisma models that the API would
 * return, but simplified for demo purposes.  They are NOT meant to be
 * 1:1 with @prisma/client types — only the fields the UI consumes.
 */

export type DemoAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type DemoAccountNormalBalance = 'DEBIT' | 'CREDIT';

export interface DemoAccount {
  id: string;
  code: string;
  name: string;
  type: DemoAccountType;
  normalBalance: DemoAccountNormalBalance;
  isSystem: boolean;
  isActive: boolean;
  /** Running balance — computed at read time from journal entries. */
  balance?: number;
}

export interface DemoProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  price: number;
  costPrice: number;
  isVatable: boolean;
  categoryId: string;
  categoryName: string;
  unitOfMeasure: string;
  inventoryQty: number;
  lowStockAlert: number;
  isActive: boolean;
}

export interface DemoCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export interface DemoCustomer {
  id: string;
  name: string;
  tin: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  creditLimit: number;
  creditTermDays: number;
  isActive: boolean;
}

export interface DemoEmployee {
  id: string;
  name: string;
  role: string;            // UserRole string
  personaKey: string | null;
  email: string;
  branchId: string;
  isActive: boolean;
  /** Monthly salary (₱) — visible only when payroll feature is unlocked. */
  monthlySalary: number;
}

export type DemoOrderStatus = 'OPEN' | 'COMPLETED' | 'VOIDED' | 'RETURNED';
export type DemoInvoiceType = 'CASH_SALE' | 'CHARGE';
export type DemoPaymentMethod = 'CASH' | 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH' | 'CHARGE';

export interface DemoOrderItem {
  id: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  discountAmount: number;
  vatAmount: number;
  lineTotal: number;
}

export interface DemoOrderPayment {
  id: string;
  method: DemoPaymentMethod;
  amount: number;
  reference: string | null;
}

export interface DemoOrder {
  id: string;
  orderNumber: string;
  status: DemoOrderStatus;
  invoiceType: DemoInvoiceType;
  customerId: string | null;
  customerName: string | null;
  customerTin: string | null;
  customerAddress: string | null;
  branchId: string;
  shiftId: string | null;
  cashierId: string;
  cashierName: string;
  subtotal: number;
  discountAmount: number;
  vatAmount: number;
  totalAmount: number;
  amountPaid: number;
  amountDue: number;
  dueDate: string | null;       // ISO; for CHARGE orders
  items: DemoOrderItem[];
  payments: DemoOrderPayment[];
  createdAt: string;            // ISO
  voidedAt: string | null;
  voidReason: string | null;
}

export interface DemoJournalLineEntry {
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
}

export interface DemoJournalEntry {
  id: string;
  entryNumber: string;
  date: string;                 // ISO
  postingDate: string;
  description: string;
  reference: string | null;
  status: 'DRAFT' | 'POSTED' | 'VOIDED';
  source: 'MANUAL' | 'SYSTEM' | 'AP' | 'AR';
  lines: DemoJournalLineEntry[];
  totalDebit: number;
  totalCredit: number;
  /** If this entry was auto-created from an order, link back to it. */
  sourceOrderId: string | null;
}

export interface DemoShift {
  id: string;
  branchId: string;
  cashierId: string;
  cashierName: string;
  openingCash: number;
  closingCashDeclared: number | null;
  closingCashExpected: number | null;
  variance: number | null;
  openedAt: string;             // ISO
  closedAt: string | null;
  isActive: boolean;
}

export interface DemoTimeEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  branchId: string;
  clockIn: string;              // ISO
  clockOut: string | null;
  hoursWorked: number;
}

export interface DemoPayslip {
  id: string;
  employeeId: string;
  employeeName: string;
  periodStart: string;          // ISO
  periodEnd: string;
  daysWorked: number;
  hoursWorked: number;
  basicPay: number;
  overtimePay: number;
  allowances: number;
  grossPay: number;
  sssContribution: number;
  philhealthContribution: number;
  pagibigContribution: number;
  withholdingTax: number;
  totalDeductions: number;
  netPay: number;
  isPaid: boolean;
  paidAt: string | null;
}

/** Whole-store snapshot — what gets persisted to sessionStorage. */
export interface DemoState {
  accounts: DemoAccount[];
  products: DemoProduct[];
  categories: DemoCategory[];
  customers: DemoCustomer[];
  employees: DemoEmployee[];
  orders: DemoOrder[];
  journalEntries: DemoJournalEntry[];
  shifts: DemoShift[];
  timeEntries: DemoTimeEntry[];
  payslips: DemoPayslip[];
  /** Counter for generating sequential order numbers. */
  nextOrderSeq: number;
  /** Counter for journal entry numbers. */
  nextJournalSeq: number;
}
