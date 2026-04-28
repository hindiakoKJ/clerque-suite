/**
 * Demo Mode — Zustand Store with sessionStorage Persistence
 *
 * Holds the in-memory state for demo mode.  Persists to sessionStorage so
 * the visitor's changes survive page refreshes within the same tab, but
 * disappear when the tab closes.
 *
 * Cross-app propagation lives in the action methods: `recordOrder()` not
 * only adds the order but also auto-creates the matching JournalEntry and
 * deducts inventory — simulating what the real backend's @Cron event
 * processor would do.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  DemoState,
  DemoOrder,
  DemoJournalEntry,
  DemoJournalLineEntry,
  DemoTimeEntry,
  DemoOrderPayment,
} from './types';
import { freshDemoState } from './seed';

interface DemoStoreActions {
  /** Reset to fresh seed state (called by "Reset Demo" button). */
  reset: () => void;

  /** Record a new order from POS terminal.  Auto-creates the journal entry
   *  and decrements inventory.  Returns the materialised order. */
  recordOrder: (input: RecordOrderInput) => DemoOrder;

  /** Void an order — flips status, reverses inventory, creates reversing JE. */
  voidOrder: (orderId: string, reason: string) => DemoOrder | null;

  /** Record a payment (collection) against an existing CHARGE order. */
  recordCollection: (
    orderId: string,
    amount: number,
    method: DemoOrderPayment['method'],
    reference: string | null,
  ) => DemoOrder | null;

  /** Open a new shift. */
  openShift: (cashierId: string, openingCash: number) => string;

  /** Close the active shift. */
  closeShift: (declaredCash: number) => void;

  /** Clock in for an employee. */
  clockIn: (employeeId: string) => DemoTimeEntry | null;

  /** Clock out for an employee — completes their open time entry. */
  clockOut: (employeeId: string) => DemoTimeEntry | null;
}

export interface RecordOrderInput {
  items: { productId: string; quantity: number; discountAmount?: number }[];
  paymentMethod: 'CASH' | 'GCASH_PERSONAL' | 'GCASH_BUSINESS' | 'MAYA_PERSONAL' | 'MAYA_BUSINESS' | 'QR_PH' | 'CHARGE';
  customerId?: string | null;
  customerName?: string | null;
  customerTin?: string | null;
  customerAddress?: string | null;
  amountTendered?: number;       // CASH only — for change calc
  reference?: string | null;
}

type Store = DemoState & DemoStoreActions;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Soft cap on the number of orders a demo visitor can accumulate.
 * Above this cap, recordOrder() refuses with a friendly error so the
 * sessionStorage budget (typically 5MB) doesn't fill up and start
 * silently failing writes.
 */
const DEMO_MAX_ORDERS = 500;

export const useDemoStore = create<Store>()(
  persist(
    (set, get) => ({
      ...freshDemoState(),

      reset: () => set({ ...freshDemoState() }),

      recordOrder: (input) => {
        const state = get();
        if (state.orders.length >= DEMO_MAX_ORDERS) {
          throw new Error(
            `Demo limit reached (${DEMO_MAX_ORDERS} orders). Click "Reset Demo" in the top banner to clear the demo and start fresh.`,
          );
        }
        const seq = state.nextOrderSeq;
        const orderNumber = `OR-2026-${String(seq).padStart(5, '0')}`;
        const orderId = `demo-order-live-${seq}`;
        const now = new Date().toISOString();

        // Materialise items
        const items = input.items.map((it, ix) => {
          const product = state.products.find((p) => p.id === it.productId);
          if (!product) throw new Error(`Demo: product ${it.productId} not found`);
          const lineGross = round2(product.price * it.quantity - (it.discountAmount ?? 0));
          const lineNet = round2(lineGross / 1.12);
          const lineVat = round2(lineGross - lineNet);
          return {
            id: `${orderId}-line-${ix}`,
            productId: product.id,
            productName: product.name,
            unitPrice: product.price,
            quantity: it.quantity,
            discountAmount: it.discountAmount ?? 0,
            vatAmount: lineVat,
            lineTotal: lineGross,
          };
        });

        const subtotal = round2(items.reduce((s, i) => s + (i.lineTotal - i.vatAmount), 0));
        const totalGross = round2(items.reduce((s, i) => s + i.lineTotal, 0));
        const vatAmount = round2(items.reduce((s, i) => s + i.vatAmount, 0));

        const isCharge = input.paymentMethod === 'CHARGE';
        const customer = input.customerId
          ? state.customers.find((c) => c.id === input.customerId) ?? null
          : null;

        const amountPaid = isCharge ? 0 : totalGross;
        const activeShift = state.shifts.find((s) => s.isActive);

        const order: DemoOrder = {
          id: orderId,
          orderNumber,
          status: 'COMPLETED',
          invoiceType: isCharge ? 'CHARGE' : 'CASH_SALE',
          customerId: customer?.id ?? input.customerId ?? null,
          customerName: customer?.name ?? input.customerName ?? null,
          customerTin: customer?.tin ?? input.customerTin ?? null,
          customerAddress: customer?.address ?? input.customerAddress ?? null,
          branchId: 'demo-branch-main',
          shiftId: activeShift?.id ?? null,
          cashierId: 'demo-employee-owner',
          cashierName: 'You (Demo Owner)',
          subtotal,
          discountAmount: round2(items.reduce((s, i) => s + i.discountAmount, 0)),
          vatAmount,
          totalAmount: totalGross,
          amountPaid,
          amountDue: round2(totalGross - amountPaid),
          dueDate: isCharge && customer
            ? (() => {
                const d = new Date();
                d.setDate(d.getDate() + customer.creditTermDays);
                return d.toISOString();
              })()
            : null,
          items,
          payments: amountPaid > 0
            ? [{
                id: `${orderId}-pay-1`,
                method: input.paymentMethod,
                amount: amountPaid,
                reference: input.reference ?? null,
              }]
            : [],
          createdAt: now,
          voidedAt: null,
          voidReason: null,
        };

        // Auto-create journal entry (simulates the @Cron event processor)
        const journal = generateJournalEntryForOrder(order, state.nextJournalSeq);

        // Decrement inventory
        const updatedProducts = state.products.map((p) => {
          const matching = items.find((it) => it.productId === p.id);
          if (matching) {
            return { ...p, inventoryQty: Math.max(0, p.inventoryQty - matching.quantity) };
          }
          return p;
        });

        set({
          orders: [order, ...state.orders],
          journalEntries: [journal, ...state.journalEntries],
          products: updatedProducts,
          nextOrderSeq: seq + 1,
          nextJournalSeq: state.nextJournalSeq + 1,
        });

        return order;
      },

      voidOrder: (orderId, reason) => {
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.status === 'VOIDED') return null;

        const now = new Date().toISOString();
        const voided: DemoOrder = {
          ...order,
          status: 'VOIDED',
          voidedAt: now,
          voidReason: reason,
        };

        // Reversal journal entry: flip the original entry's debits/credits
        const originalJe = state.journalEntries.find((j) => j.sourceOrderId === orderId);
        let updatedJournalEntries = state.journalEntries;
        let nextJeSeq = state.nextJournalSeq;
        if (originalJe) {
          const reversal: DemoJournalEntry = {
            id: `demo-je-rev-${nextJeSeq}`,
            entryNumber: `JE-2026-${String(nextJeSeq).padStart(5, '0')}`,
            date: now,
            postingDate: now,
            description: `Void reversal: ${order.orderNumber} — ${reason}`,
            reference: order.orderNumber,
            status: 'POSTED',
            source: 'SYSTEM',
            lines: originalJe.lines.map((l) => ({
              ...l,
              debit: l.credit,
              credit: l.debit,
            })),
            totalDebit: originalJe.totalCredit,
            totalCredit: originalJe.totalDebit,
            sourceOrderId: orderId,
          };
          updatedJournalEntries = [reversal, ...state.journalEntries];
          nextJeSeq = nextJeSeq + 1;
        }

        // Reverse inventory
        const updatedProducts = state.products.map((p) => {
          const item = order.items.find((it) => it.productId === p.id);
          if (item) {
            return { ...p, inventoryQty: p.inventoryQty + item.quantity };
          }
          return p;
        });

        set({
          orders: state.orders.map((o) => (o.id === orderId ? voided : o)),
          journalEntries: updatedJournalEntries,
          products: updatedProducts,
          nextJournalSeq: nextJeSeq,
        });

        return voided;
      },

      recordCollection: (orderId, amount, method, reference) => {
        const state = get();
        const order = state.orders.find((o) => o.id === orderId);
        if (!order || order.invoiceType !== 'CHARGE') return null;
        if (amount <= 0 || amount > order.amountDue) return null;

        const newPayment: DemoOrderPayment = {
          id: `${orderId}-pay-${order.payments.length + 1}`,
          method,
          amount: round2(amount),
          reference,
        };
        const newAmountPaid = round2(order.amountPaid + amount);
        const newAmountDue = round2(order.totalAmount - newAmountPaid);

        const updatedOrder: DemoOrder = {
          ...order,
          amountPaid: newAmountPaid,
          amountDue: newAmountDue,
          payments: [...order.payments, newPayment],
        };

        // Create collection journal entry: Dr Cash, Cr Accounts Receivable
        const drAccount = method === 'CASH' ? 'acc-1010' : 'acc-1031';
        const collectionJe: DemoJournalEntry = {
          id: `demo-je-col-${state.nextJournalSeq}`,
          entryNumber: `JE-2026-${String(state.nextJournalSeq).padStart(5, '0')}`,
          date: new Date().toISOString(),
          postingDate: new Date().toISOString(),
          description: `Collection on ${order.orderNumber} — ${order.customerName ?? 'Customer'}`,
          reference: order.orderNumber,
          status: 'POSTED',
          source: 'AR',
          lines: [
            {
              accountId: drAccount,
              accountCode: drAccount === 'acc-1010' ? '1010' : '1031',
              accountName: drAccount === 'acc-1010' ? 'Cash on Hand' : 'Digital Wallet Receivable',
              debit: round2(amount),
              credit: 0,
              description: `${method} payment`,
            },
            {
              accountId: 'acc-1030',
              accountCode: '1030',
              accountName: 'Accounts Receivable – Trade',
              debit: 0,
              credit: round2(amount),
              description: `Reduce AR ${order.customerName ?? 'Customer'}`,
            },
          ],
          totalDebit: round2(amount),
          totalCredit: round2(amount),
          sourceOrderId: orderId,
        };

        set({
          orders: state.orders.map((o) => (o.id === orderId ? updatedOrder : o)),
          journalEntries: [collectionJe, ...state.journalEntries],
          nextJournalSeq: state.nextJournalSeq + 1,
        });

        return updatedOrder;
      },

      openShift: (cashierId, openingCash) => {
        const state = get();
        const newShiftId = `demo-shift-${Date.now()}`;
        const employee = state.employees.find((e) => e.id === cashierId);
        const newShift = {
          id: newShiftId,
          branchId: 'demo-branch-main',
          cashierId,
          cashierName: employee?.name ?? 'Demo User',
          openingCash,
          closingCashDeclared: null,
          closingCashExpected: null,
          variance: null,
          openedAt: new Date().toISOString(),
          closedAt: null,
          isActive: true,
        };
        // Close any existing active shift first
        const updatedShifts = state.shifts.map((s) =>
          s.isActive ? { ...s, isActive: false, closedAt: new Date().toISOString() } : s,
        );
        set({ shifts: [...updatedShifts, newShift] });
        return newShiftId;
      },

      closeShift: (declaredCash) => {
        const state = get();
        const active = state.shifts.find((s) => s.isActive);
        if (!active) return;
        const cashSales = state.orders
          .filter((o) => o.shiftId === active.id && o.status === 'COMPLETED')
          .flatMap((o) => o.payments)
          .filter((p) => p.method === 'CASH')
          .reduce((s, p) => s + p.amount, 0);
        const expectedCash = round2(active.openingCash + cashSales);
        set({
          shifts: state.shifts.map((s) =>
            s.id === active.id
              ? {
                  ...s,
                  isActive: false,
                  closedAt: new Date().toISOString(),
                  closingCashDeclared: declaredCash,
                  closingCashExpected: expectedCash,
                  variance: round2(declaredCash - expectedCash),
                }
              : s,
          ),
        });
      },

      clockIn: (employeeId) => {
        const state = get();
        const employee = state.employees.find((e) => e.id === employeeId);
        if (!employee) return null;
        // Don't double-clock-in
        const existing = state.timeEntries.find(
          (t) => t.employeeId === employeeId && !t.clockOut,
        );
        if (existing) return existing;
        const newEntry: DemoTimeEntry = {
          id: `demo-time-${Date.now()}`,
          employeeId,
          employeeName: employee.name,
          branchId: 'demo-branch-main',
          clockIn: new Date().toISOString(),
          clockOut: null,
          hoursWorked: 0,
        };
        set({ timeEntries: [newEntry, ...state.timeEntries] });
        return newEntry;
      },

      clockOut: (employeeId) => {
        const state = get();
        const open = state.timeEntries.find(
          (t) => t.employeeId === employeeId && !t.clockOut,
        );
        if (!open) return null;
        const clockOutAt = new Date();
        const clockInAt = new Date(open.clockIn);
        const hours = (clockOutAt.getTime() - clockInAt.getTime()) / (1000 * 60 * 60);
        const closed: DemoTimeEntry = {
          ...open,
          clockOut: clockOutAt.toISOString(),
          hoursWorked: round2(hours),
        };
        set({
          timeEntries: state.timeEntries.map((t) => (t.id === open.id ? closed : t)),
        });
        return closed;
      },
    }),
    {
      name: 'clerque-demo-store',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? window.sessionStorage : ({} as Storage),
      ),
    },
  ),
);

/* ─── Helper: build a journal entry from an order ──────────────────────────── */

function generateJournalEntryForOrder(
  order: DemoOrder,
  jeSeq: number,
): DemoJournalEntry {
  const lines: DemoJournalLineEntry[] = [];

  // Debit side: Cash, Digital Wallet, or AR depending on payment
  if (order.invoiceType === 'CHARGE' && order.amountPaid < order.totalAmount) {
    if (order.amountPaid > 0) {
      const isDigital = order.payments[0]?.method.startsWith('GCASH') ||
                        order.payments[0]?.method.startsWith('MAYA') ||
                        order.payments[0]?.method === 'QR_PH';
      lines.push({
        accountId: isDigital ? 'acc-1031' : 'acc-1010',
        accountCode: isDigital ? '1031' : '1010',
        accountName: isDigital ? 'Digital Wallet Receivable' : 'Cash on Hand',
        debit: order.amountPaid,
        credit: 0,
        description: `Partial payment ${order.orderNumber}`,
      });
    }
    if (order.totalAmount - order.amountPaid > 0) {
      lines.push({
        accountId: 'acc-1030',
        accountCode: '1030',
        accountName: 'Accounts Receivable – Trade',
        debit: round2(order.totalAmount - order.amountPaid),
        credit: 0,
        description: `AR ${order.customerName ?? 'Customer'}`,
      });
    }
  } else if (order.invoiceType === 'CHARGE') {
    // Fully paid CHARGE → straight to AR (which is then immediately offset by payment)
    lines.push({
      accountId: 'acc-1010',
      accountCode: '1010',
      accountName: 'Cash on Hand',
      debit: order.totalAmount,
      credit: 0,
      description: `Cash sale ${order.orderNumber}`,
    });
  } else {
    const method = order.payments[0]?.method ?? 'CASH';
    const isDigital = method.startsWith('GCASH') || method.startsWith('MAYA') || method === 'QR_PH';
    lines.push({
      accountId: isDigital ? 'acc-1031' : 'acc-1010',
      accountCode: isDigital ? '1031' : '1010',
      accountName: isDigital ? 'Digital Wallet Receivable' : 'Cash on Hand',
      debit: order.totalAmount,
      credit: 0,
      description: `${method} sale ${order.orderNumber}`,
    });
  }

  // Credit side: split revenue between Food and Beverage by category heuristic
  // (Beverage = Coffee + Tea categories; Food = everything else)
  let bevRevenue = 0;
  let foodRevenue = 0;
  for (const item of order.items) {
    const lineNet = item.lineTotal - item.vatAmount;
    // Hardcoded category heuristic — coffee/tea products start with prod-1..6
    const isBeverage = ['prod-1', 'prod-2', 'prod-3', 'prod-4', 'prod-5', 'prod-6'].includes(item.productId);
    if (isBeverage) bevRevenue += lineNet;
    else foodRevenue += lineNet;
  }
  if (foodRevenue > 0) {
    lines.push({
      accountId: 'acc-4010',
      accountCode: '4010',
      accountName: 'Sales Revenue – Food',
      debit: 0,
      credit: round2(foodRevenue),
      description: 'Food sales',
    });
  }
  if (bevRevenue > 0) {
    lines.push({
      accountId: 'acc-4020',
      accountCode: '4020',
      accountName: 'Sales Revenue – Beverage',
      debit: 0,
      credit: round2(bevRevenue),
      description: 'Beverage sales',
    });
  }
  if (order.vatAmount > 0) {
    lines.push({
      accountId: 'acc-2020',
      accountCode: '2020',
      accountName: 'Output VAT Payable',
      debit: 0,
      credit: order.vatAmount,
      description: '12% Output VAT',
    });
  }

  return {
    id: `demo-je-${jeSeq}`,
    entryNumber: `JE-2026-${String(jeSeq).padStart(5, '0')}`,
    date: order.createdAt,
    postingDate: order.createdAt,
    description: `Auto-posted: Sale ${order.orderNumber}${order.customerName ? ` - ${order.customerName}` : ''}`,
    reference: order.orderNumber,
    status: 'POSTED',
    source: 'SYSTEM',
    lines,
    totalDebit: round2(lines.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(lines.reduce((s, l) => s + l.credit, 0)),
    sourceOrderId: order.id,
  };
}
