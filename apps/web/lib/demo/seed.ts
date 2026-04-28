/**
 * Demo Mode — Seed Data
 *
 * Pre-populated sample data the visitor sees on first /demo entry.
 *
 * The demo represents a fictional Philippine F&B business — "Bambu Coffee" —
 * with realistic Filipino MSME shape: 1 owner, 3 staff, mix of cash and B2B
 * charge customers, 30 sample chart-of-accounts entries, and a week of
 * historical activity to make the dashboards feel populated.
 *
 * All IDs are deterministic strings prefixed `demo-` so they're easy to
 * spot in DevTools and won't collide with real DB IDs.
 *
 * Data shape: 30 accounts, 12 products, 3 customers, 3 employees, 8 orders
 * across last 7 days (mix CASH + CHARGE), corresponding journal entries,
 * 1 closed shift + 1 active shift, 7 days of clock-in/out records, 3
 * payslips from last month.
 */

import type {
  DemoAccount,
  DemoCategory,
  DemoCustomer,
  DemoEmployee,
  DemoJournalEntry,
  DemoOrder,
  DemoPayslip,
  DemoProduct,
  DemoShift,
  DemoState,
  DemoTimeEntry,
} from './types';

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

const DEMO_BRANCH_ID = 'demo-branch-main';
const DEMO_CASHIER_ID = 'demo-employee-anna';
const DEMO_OWNER_ID = 'demo-employee-owner';

function isoDaysAgo(daysAgo: number, hour = 12, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function todayISO(hour = 9, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ─── 30 Sample Chart-of-Accounts (subset of the real 186) ─────────────────── */

const SEED_ACCOUNTS: DemoAccount[] = [
  // Assets
  { id: 'acc-1010', code: '1010', name: 'Cash on Hand',                    type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-1020', code: '1020', name: 'Cash in Bank – Current Account',  type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-1030', code: '1030', name: 'Accounts Receivable – Trade',     type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-1031', code: '1031', name: 'Digital Wallet Receivable',       type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-1040', code: '1040', name: 'Inventory – Merchandise',         type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-1041', code: '1041', name: 'Inventory – Raw Materials',       type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-1045', code: '1045', name: 'CWT Receivable (BIR Form 2307)',  type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-1050', code: '1050', name: 'Prepaid Expenses',                type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-1060', code: '1060', name: 'Input VAT',                       type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-1500', code: '1500', name: 'Property and Equipment',          type: 'ASSET',     normalBalance: 'DEBIT',  isSystem: false, isActive: true },

  // Liabilities
  { id: 'acc-2010', code: '2010', name: 'Accounts Payable – Trade',        type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: true,  isActive: true },
  { id: 'acc-2020', code: '2020', name: 'Output VAT Payable',              type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: true,  isActive: true },
  { id: 'acc-2030', code: '2030', name: 'SSS Premium Payable',             type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false, isActive: true },
  { id: 'acc-2031', code: '2031', name: 'PhilHealth Premium Payable',      type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false, isActive: true },
  { id: 'acc-2040', code: '2040', name: 'Withholding Tax Payable (Comp)',  type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false, isActive: true },
  { id: 'acc-2061', code: '2061', name: 'EWT Payable (Withheld from Payees)', type: 'LIABILITY', normalBalance: 'CREDIT', isSystem: false, isActive: true },

  // Equity
  { id: 'acc-3010', code: '3010', name: "Owner's Capital",                 type: 'EQUITY',    normalBalance: 'CREDIT', isSystem: true,  isActive: true },
  { id: 'acc-3020', code: '3020', name: "Owner's Drawings",                type: 'EQUITY',    normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-3030', code: '3030', name: 'Retained Earnings',               type: 'EQUITY',    normalBalance: 'CREDIT', isSystem: true,  isActive: true },

  // Revenue
  { id: 'acc-4010', code: '4010', name: 'Sales Revenue – Food',            type: 'REVENUE',   normalBalance: 'CREDIT', isSystem: true,  isActive: true },
  { id: 'acc-4020', code: '4020', name: 'Sales Revenue – Beverage',        type: 'REVENUE',   normalBalance: 'CREDIT', isSystem: true,  isActive: true },
  { id: 'acc-4030', code: '4030', name: 'Sales Returns and Allowances',    type: 'REVENUE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-4040', code: '4040', name: 'Discounts Allowed',               type: 'REVENUE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },

  // Expenses
  { id: 'acc-5010', code: '5010', name: 'Cost of Sales – Food',            type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-5020', code: '5020', name: 'Cost of Sales – Beverage',        type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: true,  isActive: true },
  { id: 'acc-6010', code: '6010', name: 'Salaries Expense',                type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-6020', code: '6020', name: 'Rent Expense',                    type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-6030', code: '6030', name: 'Utilities Expense',               type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-6040', code: '6040', name: 'Supplies Expense',                type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },
  { id: 'acc-6050', code: '6050', name: 'Communication Expense',           type: 'EXPENSE',   normalBalance: 'DEBIT',  isSystem: false, isActive: true },
];

/* ─── Categories ───────────────────────────────────────────────────────────── */

const SEED_CATEGORIES: DemoCategory[] = [
  { id: 'cat-coffee',    name: 'Coffee',        sortOrder: 1, isActive: true },
  { id: 'cat-tea',       name: 'Tea',           sortOrder: 2, isActive: true },
  { id: 'cat-pastries',  name: 'Pastries',      sortOrder: 3, isActive: true },
  { id: 'cat-sandwiches', name: 'Sandwiches',   sortOrder: 4, isActive: true },
];

/* ─── Products (12 demo F&B items) ─────────────────────────────────────────── */

const SEED_PRODUCTS: DemoProduct[] = [
  { id: 'prod-1', sku: 'COF-AME', barcode: '4806507000017', name: 'Americano',           price: 120, costPrice: 35, isVatable: true, categoryId: 'cat-coffee',     categoryName: 'Coffee',     unitOfMeasure: 'CUP', inventoryQty: 80,  lowStockAlert: 10, isActive: true },
  { id: 'prod-2', sku: 'COF-LAT', barcode: '4806507000024', name: 'Cafe Latte',          price: 150, costPrice: 48, isVatable: true, categoryId: 'cat-coffee',     categoryName: 'Coffee',     unitOfMeasure: 'CUP', inventoryQty: 65,  lowStockAlert: 10, isActive: true },
  { id: 'prod-3', sku: 'COF-CAP', barcode: '4806507000031', name: 'Cappuccino',          price: 150, costPrice: 48, isVatable: true, categoryId: 'cat-coffee',     categoryName: 'Coffee',     unitOfMeasure: 'CUP', inventoryQty: 60,  lowStockAlert: 10, isActive: true },
  { id: 'prod-4', sku: 'COF-MOC', barcode: '4806507000048', name: 'Mocha',               price: 165, costPrice: 55, isVatable: true, categoryId: 'cat-coffee',     categoryName: 'Coffee',     unitOfMeasure: 'CUP', inventoryQty: 45,  lowStockAlert: 10, isActive: true },
  { id: 'prod-5', sku: 'TEA-MAT', barcode: '4806507000055', name: 'Matcha Latte',        price: 180, costPrice: 60, isVatable: true, categoryId: 'cat-tea',        categoryName: 'Tea',        unitOfMeasure: 'CUP', inventoryQty: 38,  lowStockAlert: 10, isActive: true },
  { id: 'prod-6', sku: 'TEA-MIL', barcode: '4806507000062', name: 'Milk Tea',            price: 130, costPrice: 40, isVatable: true, categoryId: 'cat-tea',        categoryName: 'Tea',        unitOfMeasure: 'CUP', inventoryQty: 70,  lowStockAlert: 10, isActive: true },
  { id: 'prod-7', sku: 'PAS-CRO', barcode: '4806507000079', name: 'Croissant',           price: 95,  costPrice: 30, isVatable: true, categoryId: 'cat-pastries',   categoryName: 'Pastries',   unitOfMeasure: 'PCS', inventoryQty: 24,  lowStockAlert: 10, isActive: true },
  { id: 'prod-8', sku: 'PAS-CHE', barcode: '4806507000086', name: 'Cheesecake Slice',    price: 175, costPrice: 50, isVatable: true, categoryId: 'cat-pastries',   categoryName: 'Pastries',   unitOfMeasure: 'PCS', inventoryQty: 15,  lowStockAlert: 5,  isActive: true },
  { id: 'prod-9', sku: 'PAS-MUF', barcode: '4806507000093', name: 'Blueberry Muffin',    price: 110, costPrice: 35, isVatable: true, categoryId: 'cat-pastries',   categoryName: 'Pastries',   unitOfMeasure: 'PCS', inventoryQty: 18,  lowStockAlert: 5,  isActive: true },
  { id: 'prod-10', sku: 'SAN-CHK', barcode: '4806507000109', name: 'Chicken Sandwich',    price: 220, costPrice: 70, isVatable: true, categoryId: 'cat-sandwiches', categoryName: 'Sandwiches', unitOfMeasure: 'PCS', inventoryQty: 12,  lowStockAlert: 5,  isActive: true },
  { id: 'prod-11', sku: 'SAN-TUN', barcode: '4806507000116', name: 'Tuna Melt',           price: 240, costPrice: 80, isVatable: true, categoryId: 'cat-sandwiches', categoryName: 'Sandwiches', unitOfMeasure: 'PCS', inventoryQty: 10,  lowStockAlert: 5,  isActive: true },
  { id: 'prod-12', sku: 'SAN-VEG', barcode: '4806507000123', name: 'Veggie Wrap',         price: 195, costPrice: 60, isVatable: true, categoryId: 'cat-sandwiches', categoryName: 'Sandwiches', unitOfMeasure: 'PCS', inventoryQty: 14,  lowStockAlert: 5,  isActive: true },
];

/* ─── B2B Customers (4 demo customers, mix paid/unpaid) ─────────────────────── */

const SEED_CUSTOMERS: DemoCustomer[] = [
  { id: 'cust-1', name: 'Andoks Catering Services Inc.', tin: '009-123-456-000', address: '123 Aurora Blvd, Quezon City', email: 'accounts@andokscatering.ph',     phone: '0917-555-0101', creditLimit: 50000, creditTermDays: 30, isActive: true },
  { id: 'cust-2', name: 'Manila Office Tower Bldg Mgmt', tin: '008-234-567-000', address: '8 Ayala Avenue, Makati City',  email: 'admin@manilaofficetower.ph',    phone: '0917-555-0202', creditLimit: 30000, creditTermDays: 15, isActive: true },
  { id: 'cust-3', name: 'Quezon City School Foundation', tin: '007-345-678-000', address: '45 Katipunan Avenue, QC',      email: 'finance@qcschoolfdn.org',       phone: '0917-555-0303', creditLimit: 25000, creditTermDays: 30, isActive: true },
  { id: 'cust-4', name: 'BPO Coffee Cart Account',       tin: null,              address: '50 Eastwood Ave, Libis',       email: null,                            phone: '0917-555-0404', creditLimit: 10000, creditTermDays: 7,  isActive: true },
];

/* ─── Employees (3 demo staff) ─────────────────────────────────────────────── */

const SEED_EMPLOYEES: DemoEmployee[] = [
  // Owner has a salary so they can have their own payslip in Personnel View
  { id: DEMO_OWNER_ID,   name: 'You (Demo Owner)', role: 'BUSINESS_OWNER', personaKey: 'OWNER_OPERATOR',          email: 'owner@demo.bambu',      branchId: DEMO_BRANCH_ID, isActive: true, monthlySalary: 35000 },
  { id: DEMO_CASHIER_ID, name: 'Anna Reyes',       role: 'CASHIER',        personaKey: 'CASHIER_BASIC',           email: 'anna@demo.bambu',       branchId: DEMO_BRANCH_ID, isActive: true, monthlySalary: 18000 },
  { id: 'demo-employee-john',     name: 'John Cruz',  role: 'GENERAL_EMPLOYEE', personaKey: 'GENERAL_EMPLOYEE_DEFAULT', email: 'john@demo.bambu',  branchId: DEMO_BRANCH_ID, isActive: true, monthlySalary: 16000 },
  { id: 'demo-employee-sandra',   name: 'Sandra Lim', role: 'BOOKKEEPER',       personaKey: 'BOOKKEEPER_DEFAULT',       email: 'sandra@demo.bambu', branchId: DEMO_BRANCH_ID, isActive: true, monthlySalary: 22000 },
];

/* ─── Orders + corresponding journal entries (last 7 days) ─────────────────── */

interface SeedOrderInput {
  daysAgo: number;
  hour: number;
  items: { productId: string; quantity: number }[];
  paymentMethod: 'CASH' | 'GCASH_BUSINESS' | 'MAYA_BUSINESS' | 'CHARGE';
  customerId?: string | null;
}

function materializeOrder(input: SeedOrderInput, idx: number): { order: DemoOrder; journal: DemoJournalEntry } {
  const items = input.items.map((it, ix) => {
    const product = SEED_PRODUCTS.find((p) => p.id === it.productId)!;
    const lineGross = product.price * it.quantity;
    const lineNet = round2(lineGross / 1.12);
    const lineVat = round2(lineGross - lineNet);
    return {
      id: `demo-line-${idx}-${ix}`,
      productId: product.id,
      productName: product.name,
      unitPrice: product.price,
      quantity: it.quantity,
      discountAmount: 0,
      vatAmount: lineVat,
      lineTotal: lineGross,
    };
  });

  const totalGross = round2(items.reduce((s, i) => s + i.lineTotal, 0));
  const subtotal = round2(items.reduce((s, i) => s + (i.lineTotal - i.vatAmount), 0));
  const vatAmount = round2(items.reduce((s, i) => s + i.vatAmount, 0));

  const customer = input.customerId ? SEED_CUSTOMERS.find((c) => c.id === input.customerId) ?? null : null;
  const isCharge = input.paymentMethod === 'CHARGE';

  // For CHARGE orders, vary payment status: order [0] paid, [1] partial, [2] unpaid
  let amountPaid = totalGross;
  if (isCharge) {
    if (idx === 1) amountPaid = round2(totalGross * 0.5);   // partial
    else if (idx === 2) amountPaid = 0;                      // unpaid
  }

  const order: DemoOrder = {
    id: `demo-order-${idx}`,
    orderNumber: `OR-2026-${String(1000 + idx).padStart(5, '0')}`,
    status: 'COMPLETED',
    invoiceType: isCharge ? 'CHARGE' : 'CASH_SALE',
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? null,
    customerTin: customer?.tin ?? null,
    customerAddress: customer?.address ?? null,
    branchId: DEMO_BRANCH_ID,
    shiftId: input.daysAgo === 0 ? 'demo-shift-active' : `demo-shift-day-${input.daysAgo}`,
    cashierId: input.daysAgo === 0 ? DEMO_OWNER_ID : DEMO_CASHIER_ID,
    cashierName: input.daysAgo === 0 ? 'You (Demo Owner)' : 'Anna Reyes',
    subtotal,
    discountAmount: 0,
    vatAmount,
    totalAmount: totalGross,
    amountPaid,
    amountDue: round2(totalGross - amountPaid),
    dueDate: isCharge && customer ? isoDaysAgo(input.daysAgo - customer.creditTermDays, input.hour) : null,
    items,
    payments: amountPaid > 0
      ? [{
          id: `demo-pay-${idx}`,
          method: input.paymentMethod,
          amount: amountPaid,
          reference: input.paymentMethod === 'CASH' ? null : `REF-${100000 + idx}`,
        }]
      : [],
    createdAt: isoDaysAgo(input.daysAgo, input.hour),
    voidedAt: null,
    voidReason: null,
  };

  // Auto-generate journal entry: Dr Cash/Receivable; Cr Sales Revenue + Output VAT
  const journalLines = [];

  if (isCharge && amountPaid < totalGross) {
    // Mixed: receivable for unpaid + cash for paid portion
    if (amountPaid > 0) {
      const cashAccount = input.paymentMethod === 'CASH' || !customer ? 'acc-1010' : 'acc-1031';
      journalLines.push({
        accountId: cashAccount,
        accountCode: cashAccount === 'acc-1010' ? '1010' : '1031',
        accountName: cashAccount === 'acc-1010' ? 'Cash on Hand' : 'Digital Wallet Receivable',
        debit: amountPaid,
        credit: 0,
        description: `Partial payment ${order.orderNumber}`,
      });
    }
    if (totalGross - amountPaid > 0) {
      journalLines.push({
        accountId: 'acc-1030',
        accountCode: '1030',
        accountName: 'Accounts Receivable – Trade',
        debit: round2(totalGross - amountPaid),
        credit: 0,
        description: `AR ${customer?.name ?? 'Customer'}`,
      });
    }
  } else {
    // Cash-equivalent or fully paid charge
    let drAccountId = 'acc-1010';
    let drCode = '1010';
    let drName = 'Cash on Hand';
    if (input.paymentMethod === 'GCASH_BUSINESS' || input.paymentMethod === 'MAYA_BUSINESS') {
      drAccountId = 'acc-1031';
      drCode = '1031';
      drName = 'Digital Wallet Receivable';
    } else if (isCharge && amountPaid === totalGross) {
      drAccountId = 'acc-1030';
      drCode = '1030';
      drName = 'Accounts Receivable – Trade';
    }
    journalLines.push({
      accountId: drAccountId,
      accountCode: drCode,
      accountName: drName,
      debit: totalGross,
      credit: 0,
      description: `${input.paymentMethod} payment ${order.orderNumber}`,
    });
  }

  // Credit Sales Revenue (split between Food and Beverage)
  // Simple heuristic: items in cat-coffee/cat-tea → 4020; others → 4010
  let foodRevenue = 0;
  let bevRevenue = 0;
  for (const it of items) {
    const product = SEED_PRODUCTS.find((p) => p.id === it.productId)!;
    const netLine = it.lineTotal - it.vatAmount;
    if (product.categoryId === 'cat-coffee' || product.categoryId === 'cat-tea') {
      bevRevenue += netLine;
    } else {
      foodRevenue += netLine;
    }
  }
  if (foodRevenue > 0) {
    journalLines.push({
      accountId: 'acc-4010',
      accountCode: '4010',
      accountName: 'Sales Revenue – Food',
      debit: 0,
      credit: round2(foodRevenue),
      description: 'Food sales',
    });
  }
  if (bevRevenue > 0) {
    journalLines.push({
      accountId: 'acc-4020',
      accountCode: '4020',
      accountName: 'Sales Revenue – Beverage',
      debit: 0,
      credit: round2(bevRevenue),
      description: 'Beverage sales',
    });
  }
  if (vatAmount > 0) {
    journalLines.push({
      accountId: 'acc-2020',
      accountCode: '2020',
      accountName: 'Output VAT Payable',
      debit: 0,
      credit: vatAmount,
      description: '12% Output VAT',
    });
  }

  const journal: DemoJournalEntry = {
    id: `demo-je-${idx}`,
    entryNumber: `JE-2026-${String(2000 + idx).padStart(5, '0')}`,
    date: order.createdAt,
    postingDate: order.createdAt,
    description: `Auto-posted: Sale ${order.orderNumber}${customer ? ` - ${customer.name}` : ''}`,
    reference: order.orderNumber,
    status: 'POSTED',
    source: 'SYSTEM',
    lines: journalLines,
    totalDebit: round2(journalLines.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(journalLines.reduce((s, l) => s + l.credit, 0)),
    sourceOrderId: order.id,
  };

  return { order, journal };
}

const SEED_ORDER_INPUTS: SeedOrderInput[] = [
  // Today (active shift)
  { daysAgo: 0, hour: 8,  items: [{ productId: 'prod-1', quantity: 2 }, { productId: 'prod-7', quantity: 1 }], paymentMethod: 'CASH' },
  { daysAgo: 0, hour: 10, items: [{ productId: 'prod-5', quantity: 1 }, { productId: 'prod-8', quantity: 1 }], paymentMethod: 'GCASH_BUSINESS' },

  // Yesterday
  { daysAgo: 1, hour: 9,  items: [{ productId: 'prod-2', quantity: 4 }, { productId: 'prod-7', quantity: 4 }], paymentMethod: 'CHARGE', customerId: 'cust-1' },  // partial paid
  { daysAgo: 1, hour: 14, items: [{ productId: 'prod-10', quantity: 3 }, { productId: 'prod-1', quantity: 3 }], paymentMethod: 'CHARGE', customerId: 'cust-2' },  // unpaid
  { daysAgo: 1, hour: 17, items: [{ productId: 'prod-6', quantity: 2 }, { productId: 'prod-9', quantity: 1 }], paymentMethod: 'MAYA_BUSINESS' },

  // 2-3 days ago
  { daysAgo: 2, hour: 11, items: [{ productId: 'prod-3', quantity: 1 }, { productId: 'prod-11', quantity: 1 }], paymentMethod: 'CASH' },
  { daysAgo: 3, hour: 13, items: [{ productId: 'prod-4', quantity: 2 }, { productId: 'prod-12', quantity: 2 }], paymentMethod: 'CHARGE', customerId: 'cust-3' },  // fully paid

  // Last week
  { daysAgo: 6, hour: 10, items: [{ productId: 'prod-1', quantity: 3 }, { productId: 'prod-2', quantity: 2 }, { productId: 'prod-7', quantity: 5 }], paymentMethod: 'GCASH_BUSINESS' },
];

const seedOrderResults = SEED_ORDER_INPUTS.map((input, idx) => materializeOrder(input, idx));
const SEED_ORDERS: DemoOrder[] = seedOrderResults.map((r) => r.order);
const SEED_JOURNAL_ENTRIES: DemoJournalEntry[] = seedOrderResults.map((r) => r.journal);

/* ─── Shifts (yesterday closed + today active) ─────────────────────────────── */

const SEED_SHIFTS: DemoShift[] = [
  // Yesterday's closed shift
  {
    id: 'demo-shift-day-1',
    branchId: DEMO_BRANCH_ID,
    cashierId: DEMO_CASHIER_ID,
    cashierName: 'Anna Reyes',
    openingCash: 2000,
    closingCashDeclared: 4500,
    closingCashExpected: 4520,
    variance: -20,
    openedAt: isoDaysAgo(1, 7, 0),
    closedAt: isoDaysAgo(1, 18, 0),
    isActive: false,
  },
  // Today's active shift
  {
    id: 'demo-shift-active',
    branchId: DEMO_BRANCH_ID,
    cashierId: DEMO_OWNER_ID,
    cashierName: 'You (Demo Owner)',
    openingCash: 2000,
    closingCashDeclared: null,
    closingCashExpected: null,
    variance: null,
    openedAt: todayISO(7, 0),
    closedAt: null,
    isActive: true,
  },
];

/* ─── Time entries (last 7 days, 3 employees) ──────────────────────────────── */

const SEED_TIME_ENTRIES: DemoTimeEntry[] = (() => {
  const entries: DemoTimeEntry[] = [];
  const employees = SEED_EMPLOYEES.filter((e) => e.role !== 'BUSINESS_OWNER');
  let id = 0;
  for (let day = 6; day >= 1; day--) {
    for (const emp of employees) {
      const clockIn = isoDaysAgo(day, 7, 30);
      const clockOut = isoDaysAgo(day, 17, 0);
      entries.push({
        id: `demo-time-${id++}`,
        employeeId: emp.id,
        employeeName: emp.name,
        branchId: DEMO_BRANCH_ID,
        clockIn,
        clockOut,
        hoursWorked: 9.5,
      });
    }
  }
  // Today's clock-in (Anna only — others not yet)
  entries.push({
    id: `demo-time-${id++}`,
    employeeId: DEMO_CASHIER_ID,
    employeeName: 'Anna Reyes',
    branchId: DEMO_BRANCH_ID,
    clockIn: todayISO(8, 0),
    clockOut: null,
    hoursWorked: 0,
  });
  return entries;
})();

/* ─── Payslips (last month for 3 employees) ────────────────────────────────── */

const SEED_PAYSLIPS: DemoPayslip[] = (() => {
  const lastMonthStart = new Date();
  lastMonthStart.setMonth(lastMonthStart.getMonth() - 1);
  lastMonthStart.setDate(1);
  lastMonthStart.setHours(0, 0, 0, 0);
  const lastMonthEnd = new Date(lastMonthStart);
  lastMonthEnd.setMonth(lastMonthStart.getMonth() + 1);
  lastMonthEnd.setDate(0);

  return SEED_EMPLOYEES
    .filter((e) => e.monthlySalary > 0)
    .map((emp) => {
      const basicPay = emp.monthlySalary;
      const overtimePay = round2(basicPay * 0.05);
      const allowances = 1500;
      const grossPay = round2(basicPay + overtimePay + allowances);
      const sss = round2(basicPay * 0.045);
      const philhealth = round2(basicPay * 0.0225);
      const pagibig = 100;
      const wht = round2(Math.max(0, (grossPay - sss - philhealth - pagibig - 20833) * 0.20));
      const totalDeductions = round2(sss + philhealth + pagibig + wht);
      return {
        id: `demo-payslip-${emp.id}`,
        employeeId: emp.id,
        employeeName: emp.name,
        periodStart: lastMonthStart.toISOString(),
        periodEnd: lastMonthEnd.toISOString(),
        daysWorked: 22,
        hoursWorked: 176,
        basicPay,
        overtimePay,
        allowances,
        grossPay,
        sssContribution: sss,
        philhealthContribution: philhealth,
        pagibigContribution: pagibig,
        withholdingTax: wht,
        totalDeductions,
        netPay: round2(grossPay - totalDeductions),
        isPaid: true,
        paidAt: lastMonthEnd.toISOString(),
      };
    });
})();

/* ─── Bundle into the demo state shape ─────────────────────────────────────── */

export function freshDemoState(): DemoState {
  return {
    accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
    products: SEED_PRODUCTS.map((p) => ({ ...p })),
    categories: SEED_CATEGORIES.map((c) => ({ ...c })),
    customers: SEED_CUSTOMERS.map((c) => ({ ...c })),
    employees: SEED_EMPLOYEES.map((e) => ({ ...e })),
    orders: SEED_ORDERS.map((o) => ({ ...o, items: [...o.items], payments: [...o.payments] })),
    journalEntries: SEED_JOURNAL_ENTRIES.map((j) => ({ ...j, lines: [...j.lines] })),
    shifts: SEED_SHIFTS.map((s) => ({ ...s })),
    timeEntries: SEED_TIME_ENTRIES.map((t) => ({ ...t })),
    payslips: SEED_PAYSLIPS.map((p) => ({ ...p })),
    nextOrderSeq: 1000 + SEED_ORDERS.length + 1,
    nextJournalSeq: 2000 + SEED_JOURNAL_ENTRIES.length + 1,
  };
}

/* ─── Exposed constants for reference ──────────────────────────────────────── */

export const DEMO_TENANT_INFO = {
  id: 'demo-tenant',
  name: 'Bambu Coffee',
  slug: 'bambu-demo',
  businessType: 'FNB' as const,
  taxStatus: 'VAT' as const,
  tier: 'TIER_6' as const,
  isVatRegistered: true,
  isBirRegistered: true,
  tinNumber: '012-345-678-000',
  businessName: 'Bambu Coffee',
  registeredAddress: '123 Demo Street, Quezon City',
  hasTimeMonitoring: true,
  hasBirForms: true,
};

export const DEMO_USER_INFO = {
  id: DEMO_OWNER_ID,
  name: 'You (Demo Owner)',
  email: 'owner@demo.bambu',
  tenantId: 'demo-tenant',
  branchId: DEMO_BRANCH_ID,
  role: 'BUSINESS_OWNER' as const,
  personaKey: 'OWNER_OPERATOR',
  isSuperAdmin: false,
};

export const DEMO_BRANCH_INFO = {
  id: DEMO_BRANCH_ID,
  name: 'Bambu Main Branch',
  isActive: true,
};

/* ─── Disclaimer constants ─────────────────────────────────────────────────── */

export const DEMO_FULL_COA_COUNT = 186;
export const DEMO_VISIBLE_COA_COUNT = SEED_ACCOUNTS.length;
