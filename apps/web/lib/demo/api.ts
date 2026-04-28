/**
 * Demo Mode — API Adapter
 *
 * Drop-in replacement for the real axios `api` client.  When demo mode
 * is active, every api.get/post/patch/delete call is routed here instead
 * of hitting the backend.
 *
 * The adapter exposes the same interface as axios (get, post, patch, delete,
 * defaults, interceptors as no-ops) so call sites in the rest of apps/web
 * don't need to know they're talking to the demo.
 *
 * Each route handler returns `{ data: ... }` to match axios's response shape.
 *
 * COVERAGE: ~30 endpoints across POS, Ledger, AR, Payroll, Tenant, Auth.
 * Endpoints not listed here return a NOT_DEMO_HANDLED error which the UI
 * should treat gracefully (typically: feature unavailable in demo).
 */

import { useDemoStore } from './store';
import {
  DEMO_TENANT_INFO,
  DEMO_USER_INFO,
  DEMO_BRANCH_INFO,
  DEMO_FULL_COA_COUNT,
  DEMO_VISIBLE_COA_COUNT,
} from './seed';

interface DemoResponse<T = unknown> {
  data: T;
  status: number;
}

interface RequestConfig {
  params?: Record<string, unknown>;
  headers?: Record<string, string>;
  responseType?: string;
}

/* ─── Route table ──────────────────────────────────────────────────────────── */

type RouteHandler = (
  url: string,
  body?: unknown,
  config?: RequestConfig,
) => DemoResponse<unknown> | Promise<DemoResponse<unknown>>;

interface RouteEntry {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';
  pattern: RegExp;
  handler: RouteHandler;
}

function ok<T>(data: T): DemoResponse<T> {
  return { data, status: 200 };
}

function notFound(): DemoResponse<{ message: string; code: 'NOT_FOUND' }> {
  return { data: { message: 'Not found in demo', code: 'NOT_FOUND' }, status: 404 };
}

function notHandled(method: string, url: string): DemoResponse<{ message: string; code: string }> {
  return {
    data: {
      message: `Demo: ${method} ${url} is not interactive in demo mode.`,
      code: 'DEMO_NOT_HANDLED',
    },
    status: 200, // Return 200 so the UI doesn't show error toasts
  };
}

const routes: RouteEntry[] = [
  // ── Auth (demo always returns the demo user) ────────────────────────────────
  { method: 'GET', pattern: /^\/?auth\/me$/, handler: () => ok(buildJwtPayload()) },
  { method: 'GET', pattern: /^\/?auth\/sessions$/, handler: () => ok([]) },
  { method: 'POST', pattern: /^\/?auth\/refresh$/, handler: () => ok({ accessToken: 'demo-token', refreshToken: 'demo-refresh' }) },
  { method: 'POST', pattern: /^\/?auth\/logout$/, handler: () => ok({ ok: true }) },

  // ── Tenant ──────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?tenant\/profile$/, handler: () => ok(DEMO_TENANT_INFO) },
  { method: 'GET', pattern: /^\/?tenant\/branches$/, handler: () => ok([DEMO_BRANCH_INFO]) },
  { method: 'GET', pattern: /^\/?users\/branches$/, handler: () => ok([DEMO_BRANCH_INFO]) },

  // ── Categories ──────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?categories$/, handler: () => ok(useDemoStore.getState().categories) },

  // ── Products ────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?products$/, handler: () => ok(useDemoStore.getState().products) },
  { method: 'GET', pattern: /^\/?products\/pos$/, handler: () => {
      // POS-optimized format: include category info, inventory at branch
      return ok(
        useDemoStore.getState().products.map((p) => ({
          id: p.id,
          sku: p.sku,
          barcode: p.barcode,
          name: p.name,
          price: p.price,
          costPrice: p.costPrice,
          isVatable: p.isVatable,
          isActive: p.isActive,
          category: { id: p.categoryId, name: p.categoryName },
          unitOfMeasure: { id: p.unitOfMeasure, abbreviation: p.unitOfMeasure },
          inventory: { quantity: p.inventoryQty, lowStockAlert: p.lowStockAlert },
          modifiers: [],
          variants: [],
        })),
      );
    },
  },
  { method: 'GET', pattern: /^\/?products\/barcode\/[^/]+$/, handler: (url) => {
      const barcode = url.split('/').pop();
      const product = useDemoStore.getState().products.find((p) => p.barcode === barcode);
      return product ? ok(product) : notFound();
    },
  },

  // ── Orders ──────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?orders$/, handler: (_url, _body, config) => {
      const orders = useDemoStore.getState().orders;
      const params = config?.params ?? {};
      const status = (params['status'] as string) ?? null;
      const limit = (params['limit'] as number) ?? 50;
      const filtered = status ? orders.filter((o) => o.status === status) : orders;
      return ok({
        data: filtered.slice(0, limit),
        total: filtered.length,
        page: 1,
        pages: 1,
      });
    },
  },
  { method: 'GET', pattern: /^\/?orders\/[^/]+$/, handler: (url) => {
      const id = url.split('/').pop()!;
      const order = useDemoStore.getState().orders.find((o) => o.id === id);
      return order ? ok(order) : notFound();
    },
  },
  { method: 'POST', pattern: /^\/?orders$/, handler: (_url, body) => {
      const payload = body as {
        order: {
          items: { productId: string; quantity: number; discountAmount?: number }[];
          paymentMethod: string;
          customerId?: string;
          customerName?: string;
          customerTin?: string;
          customerAddress?: string;
          amountTendered?: number;
          reference?: string;
        };
      };
      const order = useDemoStore.getState().recordOrder({
        items: payload.order.items,
        paymentMethod: payload.order.paymentMethod as Parameters<ReturnType<typeof useDemoStore.getState>['recordOrder']>[0]['paymentMethod'],
        customerId: payload.order.customerId ?? null,
        customerName: payload.order.customerName ?? null,
        customerTin: payload.order.customerTin ?? null,
        customerAddress: payload.order.customerAddress ?? null,
        reference: payload.order.reference ?? null,
      });
      return ok(order);
    },
  },
  { method: 'POST', pattern: /^\/?orders\/sync$/, handler: (_url, body) => {
      // Bulk-sync from offline queue — demo just no-ops successfully
      const payload = body as { orders: unknown[] };
      return ok({ synced: payload.orders.length, errors: [] });
    },
  },
  { method: 'POST', pattern: /^\/?orders\/[^/]+\/void$/, handler: (url, body) => {
      const id = url.split('/')[url.split('/').length - 2];
      const reason = (body as { reason?: string })?.reason ?? 'Demo void';
      const result = useDemoStore.getState().voidOrder(id, reason);
      return result ? ok(result) : notFound();
    },
  },

  // ── Shifts ──────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?shifts\/active$/, handler: () => {
      const active = useDemoStore.getState().shifts.find((s) => s.isActive);
      return ok(active ?? null);
    },
  },
  { method: 'GET', pattern: /^\/?shifts$/, handler: () => ok(useDemoStore.getState().shifts) },
  { method: 'GET', pattern: /^\/?shifts\/[^/]+$/, handler: (url) => {
      const id = url.split('/').pop()!;
      const shift = useDemoStore.getState().shifts.find((s) => s.id === id);
      return shift ? ok(shift) : notFound();
    },
  },
  { method: 'POST', pattern: /^\/?shifts$/, handler: (_url, body) => {
      const payload = body as { openingCash?: number };
      const shiftId = useDemoStore.getState().openShift(
        DEMO_USER_INFO.id,
        payload.openingCash ?? 2000,
      );
      const shift = useDemoStore.getState().shifts.find((s) => s.id === shiftId);
      return ok(shift);
    },
  },
  { method: 'POST', pattern: /^\/?shifts\/[^/]+\/close$/, handler: (_url, body) => {
      const payload = body as { closingCashDeclared?: number };
      useDemoStore.getState().closeShift(payload.closingCashDeclared ?? 0);
      return ok({ ok: true });
    },
  },

  // ── Reports ─────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?reports\/daily$/, handler: () => {
      const state = useDemoStore.getState();
      const orders = state.orders;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayOrders = orders.filter(
        (o) => new Date(o.createdAt) >= today && o.status === 'COMPLETED',
      );
      const totalRevenue = todayOrders.reduce((s, o) => s + o.totalAmount, 0);
      const cashRevenue = todayOrders
        .flatMap((o) => o.payments)
        .filter((p) => p.method === 'CASH')
        .reduce((s, p) => s + p.amount, 0);
      const nonCashRevenue = Math.max(0, totalRevenue - cashRevenue);
      const voidCount = orders.filter(
        (o) => new Date(o.createdAt) >= today && o.status === 'VOIDED',
      ).length;

      // Group payments by method
      const methodTotals: Record<string, { total: number; orders: Set<string> }> = {};
      for (const o of todayOrders) {
        for (const p of o.payments) {
          if (!methodTotals[p.method]) methodTotals[p.method] = { total: 0, orders: new Set() };
          methodTotals[p.method].total += p.amount;
          methodTotals[p.method].orders.add(o.id);
        }
      }
      const byPaymentMethod = Object.entries(methodTotals).map(([method, v]) => ({
        method,
        totalAmount: Math.round(v.total * 100) / 100,
        orderCount: v.orders.size,
      }));

      // Top products by revenue
      const productAggregates: Record<string, { productId: string; productName: string; quantity: number; revenue: number }> = {};
      for (const o of todayOrders) {
        for (const item of o.items) {
          if (!productAggregates[item.productId]) {
            productAggregates[item.productId] = {
              productId: item.productId,
              productName: item.productName,
              quantity: 0,
              revenue: 0,
            };
          }
          productAggregates[item.productId].quantity += item.quantity;
          productAggregates[item.productId].revenue += item.lineTotal;
        }
      }
      const topProducts = Object.values(productAggregates)
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10)
        .map((p) => ({
          productId: p.productId,
          productName: p.productName,
          quantitySold: p.quantity,
          revenue: Math.round(p.revenue * 100) / 100,
        }));

      // Hourly breakdown (24 hours, even if zero)
      const byHour = Array.from({ length: 24 }, (_, hour) => ({
        hour,
        orderCount: 0,
        revenue: 0,
      }));
      for (const o of todayOrders) {
        const h = new Date(o.createdAt).getHours();
        if (byHour[h]) {
          byHour[h].orderCount += 1;
          byHour[h].revenue += o.totalAmount;
        }
      }

      return ok({
        date: today.toISOString().slice(0, 10),
        totalOrders: todayOrders.length,
        voidCount,
        totalRevenue,
        cashRevenue,
        nonCashRevenue,
        avgOrderValue: todayOrders.length > 0 ? totalRevenue / todayOrders.length : 0,
        byPaymentMethod,
        topProducts,
        byHour,
      });
    },
  },
  { method: 'GET', pattern: /^\/?reports\/shift\/[^/]+$/, handler: (url) => {
      const id = url.split('/').pop()!;
      const shift = useDemoStore.getState().shifts.find((s) => s.id === id);
      if (!shift) return notFound();
      const shiftOrders = useDemoStore.getState().orders.filter((o) => o.shiftId === id);
      return ok({
        shift,
        totalOrders: shiftOrders.length,
        totalRevenue: shiftOrders.reduce((s, o) => s + o.totalAmount, 0),
        cashRevenue: shiftOrders
          .flatMap((o) => o.payments)
          .filter((p) => p.method === 'CASH')
          .reduce((s, p) => s + p.amount, 0),
        voidCount: shiftOrders.filter((o) => o.status === 'VOIDED').length,
      });
    },
  },

  // ── Inventory ───────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?inventory$/, handler: () => {
      const products = useDemoStore.getState().products;
      return ok({
        data: products.map((p) => ({
          id: p.id,
          productId: p.id,
          productName: p.name,
          sku: p.sku,
          quantity: p.inventoryQty,
          lowStockAlert: p.lowStockAlert,
          isLowStock: p.inventoryQty <= p.lowStockAlert,
        })),
        total: products.length,
      });
    },
  },
  { method: 'GET', pattern: /^\/?inventory\/low-stock$/, handler: () => {
      return ok(
        useDemoStore.getState().products.filter((p) => p.inventoryQty <= p.lowStockAlert),
      );
    },
  },

  // ── Accounting: Chart of Accounts ───────────────────────────────────────────
  { method: 'GET', pattern: /^\/?accounting\/accounts$/, handler: () => {
      // Compute running balances from journal entries
      const state = useDemoStore.getState();
      const balances = computeAccountBalances(state.accounts, state.journalEntries);
      return ok({
        data: state.accounts.map((a) => ({ ...a, balance: balances[a.id] ?? 0 })),
        meta: {
          isDemoSample: true,
          visibleCount: DEMO_VISIBLE_COA_COUNT,
          fullCount: DEMO_FULL_COA_COUNT,
          message: `Showing ${DEMO_VISIBLE_COA_COUNT} of ${DEMO_FULL_COA_COUNT} BIR-compliant accounts.  The full Philippine Chart of Accounts is included with your subscription.`,
        },
      });
    },
  },
  { method: 'GET', pattern: /^\/?accounting\/accounts\/trial-balance$/, handler: () => {
      const state = useDemoStore.getState();
      const balances = computeAccountBalances(state.accounts, state.journalEntries);
      const rows = state.accounts.map((a) => {
        const balance = balances[a.id] ?? 0;
        return {
          accountId: a.id,
          code: a.code,
          name: a.name,
          type: a.type,
          debit: a.normalBalance === 'DEBIT' && balance > 0 ? balance : 0,
          credit: a.normalBalance === 'CREDIT' && balance > 0 ? balance : 0,
        };
      });
      const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
      const totalCredit = rows.reduce((s, r) => s + r.credit, 0);
      return ok({ rows, totalDebit, totalCredit, asOf: new Date().toISOString().slice(0, 10) });
    },
  },
  { method: 'GET', pattern: /^\/?accounting\/accounts\/pl-summary$/, handler: () => {
      const state = useDemoStore.getState();
      const balances = computeAccountBalances(state.accounts, state.journalEntries);
      const revenue = state.accounts
        .filter((a) => a.type === 'REVENUE')
        .reduce((s, a) => s + (balances[a.id] ?? 0), 0);
      const expense = state.accounts
        .filter((a) => a.type === 'EXPENSE')
        .reduce((s, a) => s + (balances[a.id] ?? 0), 0);
      return ok({
        revenue,
        expense,
        netIncome: revenue - expense,
      });
    },
  },
  { method: 'GET', pattern: /^\/?accounting\/accounts\/[^/]+\/ledger$/, handler: (url) => {
      const id = url.split('/').slice(-2)[0];
      const account = useDemoStore.getState().accounts.find((a) => a.id === id);
      if (!account) return notFound();
      const lines = useDemoStore.getState().journalEntries.flatMap((je) =>
        je.lines
          .filter((l) => l.accountId === id)
          .map((l) => ({
            date: je.date,
            entryNumber: je.entryNumber,
            description: je.description,
            reference: je.reference,
            debit: l.debit,
            credit: l.credit,
          })),
      );
      return ok({ account, lines });
    },
  },

  // ── Accounting: Journal Entries ─────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?accounting\/journal$/, handler: () => {
      return ok({
        data: useDemoStore.getState().journalEntries.slice(0, 100),
        total: useDemoStore.getState().journalEntries.length,
        page: 1,
        pages: 1,
      });
    },
  },
  { method: 'GET', pattern: /^\/?accounting\/journal\/[^/]+$/, handler: (url) => {
      const id = url.split('/').pop()!;
      const je = useDemoStore.getState().journalEntries.find((j) => j.id === id);
      return je ? ok(je) : notFound();
    },
  },
  { method: 'GET', pattern: /^\/?accounting\/events\/stats$/, handler: () => {
      return ok({ pending: 0, synced: useDemoStore.getState().journalEntries.length, failed: 0 });
    },
  },
  { method: 'GET', pattern: /^\/?accounting\/events$/, handler: () => ok({ data: [], total: 0 }) },

  // ── AR (Accounts Receivable) ────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?ar\/customers$/, handler: () => ok(useDemoStore.getState().customers) },
  { method: 'GET', pattern: /^\/?ar\/customers\/[^/]+$/, handler: (url) => {
      const id = url.split('/').pop()!;
      const customer = useDemoStore.getState().customers.find((c) => c.id === id);
      return customer ? ok(customer) : notFound();
    },
  },
  { method: 'GET', pattern: /^\/?ar\/aging$/, handler: () => {
      const orders = useDemoStore.getState().orders.filter(
        (o) => o.invoiceType === 'CHARGE' && o.amountDue > 0 && o.status === 'COMPLETED',
      );
      const buckets = { current: 0, b30: 0, b60: 0, b90: 0, b90plus: 0 };
      const today = new Date();
      const byCustomer: Record<string, { customerId: string; customerName: string; total: number; current: number; b30: number; b60: number; b90: number; b90plus: number }> = {};

      for (const o of orders) {
        const due = o.dueDate ? new Date(o.dueDate) : new Date(o.createdAt);
        const daysPastDue = Math.floor((today.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
        let bucket: keyof typeof buckets = 'current';
        if (daysPastDue > 90) bucket = 'b90plus';
        else if (daysPastDue > 60) bucket = 'b90';
        else if (daysPastDue > 30) bucket = 'b60';
        else if (daysPastDue > 0) bucket = 'b30';

        buckets[bucket] += o.amountDue;

        if (o.customerId) {
          if (!byCustomer[o.customerId]) {
            byCustomer[o.customerId] = {
              customerId: o.customerId,
              customerName: o.customerName ?? 'Unknown',
              total: 0,
              current: 0,
              b30: 0,
              b60: 0,
              b90: 0,
              b90plus: 0,
            };
          }
          byCustomer[o.customerId].total += o.amountDue;
          byCustomer[o.customerId][bucket] += o.amountDue;
        }
      }

      return ok({
        buckets,
        total: Object.values(buckets).reduce((s, v) => s + v, 0),
        byCustomer: Object.values(byCustomer),
      });
    },
  },
  { method: 'GET', pattern: /^\/?ar\/invoices$/, handler: () => {
      const orders = useDemoStore.getState().orders.filter((o) => o.invoiceType === 'CHARGE');
      return ok({
        data: orders.map((o) => ({
          id: o.id,
          orderNumber: o.orderNumber,
          customerId: o.customerId,
          customerName: o.customerName,
          createdAt: o.createdAt,
          dueDate: o.dueDate,
          totalAmount: o.totalAmount,
          amountPaid: o.amountPaid,
          amountDue: o.amountDue,
          status: o.amountDue === 0 ? 'PAID' : o.amountPaid > 0 ? 'PARTIALLY_PAID' : 'UNPAID',
        })),
        total: orders.length,
      });
    },
  },
  { method: 'GET', pattern: /^\/?ar\/summary$/, handler: () => {
      const orders = useDemoStore.getState().orders.filter(
        (o) => o.invoiceType === 'CHARGE' && o.status === 'COMPLETED',
      );
      const totalReceivable = orders.reduce((s, o) => s + o.amountDue, 0);
      const totalCollected = orders.reduce((s, o) => s + o.amountPaid, 0);
      return ok({
        totalReceivable,
        totalCollected,
        invoiceCount: orders.length,
        unpaidCount: orders.filter((o) => o.amountDue > 0).length,
      });
    },
  },
  { method: 'POST', pattern: /^\/?ar\/invoices\/[^/]+\/collect$/, handler: (url, body) => {
      const id = url.split('/').slice(-2)[0];
      const payload = body as { amount: number; method: string; reference?: string | null };
      const result = useDemoStore.getState().recordCollection(
        id,
        payload.amount,
        payload.method as Parameters<ReturnType<typeof useDemoStore.getState>['recordCollection']>[2],
        payload.reference ?? null,
      );
      return result ? ok(result) : notFound();
    },
  },

  // ── Payroll ─────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?payroll\/clock\/status$/, handler: () => {
      const state = useDemoStore.getState();
      const open = state.timeEntries.find(
        (t) => t.employeeId === DEMO_USER_INFO.id && !t.clockOut,
      );
      return ok({ isClockedIn: !!open, currentEntry: open ?? null });
    },
  },
  { method: 'POST', pattern: /^\/?payroll\/clock\/in$/, handler: () => {
      const result = useDemoStore.getState().clockIn(DEMO_USER_INFO.id);
      return ok(result);
    },
  },
  { method: 'POST', pattern: /^\/?payroll\/clock\/out$/, handler: () => {
      const result = useDemoStore.getState().clockOut(DEMO_USER_INFO.id);
      return result ? ok(result) : notFound();
    },
  },
  { method: 'GET', pattern: /^\/?payroll\/attendance\/mine$/, handler: () => {
      const entries = useDemoStore.getState().timeEntries.filter(
        (t) => t.employeeId === DEMO_USER_INFO.id,
      );
      return ok(entries);
    },
  },
  { method: 'GET', pattern: /^\/?payroll\/employees$/, handler: () => {
      return ok(useDemoStore.getState().employees.filter((e) => e.role !== 'BUSINESS_OWNER'));
    },
  },
  { method: 'GET', pattern: /^\/?payroll\/timesheets$/, handler: () => {
      return ok(useDemoStore.getState().timeEntries);
    },
  },
  { method: 'GET', pattern: /^\/?payroll\/payslips$/, handler: () => {
      return ok({ data: useDemoStore.getState().payslips, total: useDemoStore.getState().payslips.length });
    },
  },
  { method: 'GET', pattern: /^\/?payroll\/payslips\/mine$/, handler: () => {
      // Demo owner has no payslips; return empty
      return ok([]);
    },
  },
  { method: 'GET', pattern: /^\/?payroll\/runs$/, handler: () => ok({ data: [], total: 0 }) },
  { method: 'GET', pattern: /^\/?payroll\/contributions$/, handler: () => {
      const totals = useDemoStore.getState().payslips.reduce(
        (acc, p) => ({
          sss: acc.sss + p.sssContribution,
          philhealth: acc.philhealth + p.philhealthContribution,
          pagibig: acc.pagibig + p.pagibigContribution,
          wht: acc.wht + p.withholdingTax,
        }),
        { sss: 0, philhealth: 0, pagibig: 0, wht: 0 },
      );
      return ok(totals);
    },
  },

  // ── Users ───────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?users$/, handler: () => ok(useDemoStore.getState().employees) },

  // ── Audit ───────────────────────────────────────────────────────────────────
  { method: 'GET', pattern: /^\/?audit$/, handler: () => ok({ data: [], total: 0 }) },
];

/* ─── Public API: drop-in axios replacement ────────────────────────────────── */

function buildJwtPayload() {
  return {
    sub: DEMO_USER_INFO.id,
    name: DEMO_USER_INFO.name,
    tenantId: DEMO_USER_INFO.tenantId,
    branchId: DEMO_USER_INFO.branchId,
    email: DEMO_USER_INFO.email,
    role: DEMO_USER_INFO.role,
    isSuperAdmin: false,
    appAccess: [
      { app: 'POS', level: 'FULL' },
      { app: 'LEDGER', level: 'FULL' },
      { app: 'PAYROLL', level: 'FULL' },
    ],
    taxStatus: 'VAT',
    isVatRegistered: true,
    isBirRegistered: true,
    tinNumber: '012-345-678-000',
    businessName: 'Bambu Coffee',
    registeredAddress: '123 Demo Street, Quezon City',
    isPtuHolder: false,
    ptuNumber: null,
    minNumber: null,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

function findHandler(method: string, url: string): RouteHandler | null {
  const path = url.replace(/^.*\/api\/v1/, '').split('?')[0];
  for (const route of routes) {
    if (route.method === method && route.pattern.test(path)) {
      return route.handler;
    }
  }
  return null;
}

async function dispatch(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  url: string,
  body?: unknown,
  config?: RequestConfig,
): Promise<DemoResponse<unknown>> {
  const handler = findHandler(method, url);
  if (!handler) {
    // Log to console so developers can spot missing demo routes
    if (typeof window !== 'undefined') {
      console.warn(`[Demo API] No handler for ${method} ${url}`);
    }
    return notHandled(method, url);
  }
  // Add a tiny delay to simulate network latency
  await new Promise((r) => setTimeout(r, 60));
  return handler(url, body, config);
}

export const demoApi = {
  defaults: { baseURL: '' },
  interceptors: {
    request: { use: () => 0, eject: () => undefined },
    response: { use: () => 0, eject: () => undefined },
  },

  get: <T = unknown>(url: string, config?: RequestConfig): Promise<DemoResponse<T>> =>
    dispatch('GET', url, undefined, config) as Promise<DemoResponse<T>>,

  post: <T = unknown>(url: string, body?: unknown, config?: RequestConfig): Promise<DemoResponse<T>> =>
    dispatch('POST', url, body, config) as Promise<DemoResponse<T>>,

  patch: <T = unknown>(url: string, body?: unknown, config?: RequestConfig): Promise<DemoResponse<T>> =>
    dispatch('PATCH', url, body, config) as Promise<DemoResponse<T>>,

  put: <T = unknown>(url: string, body?: unknown, config?: RequestConfig): Promise<DemoResponse<T>> =>
    dispatch('PUT', url, body, config) as Promise<DemoResponse<T>>,

  delete: <T = unknown>(url: string, config?: RequestConfig): Promise<DemoResponse<T>> =>
    dispatch('DELETE', url, undefined, config) as Promise<DemoResponse<T>>,
};

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Compute current balance per account by summing journal entry lines.
 * Sign convention: balance is positive in the account's normal direction.
 */
function computeAccountBalances(
  accounts: ReturnType<typeof useDemoStore.getState>['accounts'],
  journalEntries: ReturnType<typeof useDemoStore.getState>['journalEntries'],
): Record<string, number> {
  const totals: Record<string, { debit: number; credit: number }> = {};
  for (const a of accounts) totals[a.id] = { debit: 0, credit: 0 };

  for (const je of journalEntries) {
    if (je.status !== 'POSTED') continue;
    for (const line of je.lines) {
      if (totals[line.accountId]) {
        totals[line.accountId].debit += line.debit;
        totals[line.accountId].credit += line.credit;
      }
    }
  }

  const balances: Record<string, number> = {};
  for (const a of accounts) {
    const t = totals[a.id];
    balances[a.id] = a.normalBalance === 'DEBIT' ? t.debit - t.credit : t.credit - t.debit;
  }
  return balances;
}
