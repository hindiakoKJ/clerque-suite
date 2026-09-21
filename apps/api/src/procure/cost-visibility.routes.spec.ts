import { purchaseCostsVisibleTo } from './cost-visibility';
import { IngredientReportsController } from '../ingredient-reports/ingredient-reports.controller';
import { ProductsController } from '../products/products.controller';
import { OrdersController } from '../orders/orders.controller';
import { ReportsController } from '../reports/reports.controller';
import { NotificationsScheduler } from '../notifications/notifications.scheduler';

/**
 * "Show purchase costs to staff" OFF, on the routes staff reach that the
 * first pass did not cover (review of 2026-09-21):
 *
 *   - WAREHOUSE_STAFF could open the ingredient reports, lots and per-ingredient
 *     movements -- every figure on them money.
 *   - The till loaded every product's cost on every load; the cashier's order
 *     list carried each line's cost; the end-of-shift summary carried the
 *     shift's cost of sales and profit.
 *   - The overdue-vendor-bills bell went to everyone with the supplier total.
 *
 * A shop that shows costs to its staff must see no change at all.
 */

const TENANT = 't1';
const user = (role: string) => ({ sub: 'u1', tenantId: TENANT, branchId: 'b1', role }) as any;
const tenantReader = (show: boolean | null) => ({
  tenant: { findUnique: jest.fn().mockResolvedValue(show == null ? null : { showPurchaseCostsToStaff: show }) },
});

describe('purchaseCostsVisibleTo', () => {
  it('answers the deciders without a query', async () => {
    const prisma = tenantReader(false);
    expect(await purchaseCostsVisibleTo(prisma as any, TENANT, 'BUSINESS_OWNER')).toBe(true);
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
  });

  it('follows the switch for staff, and keeps the open behaviour when the shop cannot be read', async () => {
    expect(await purchaseCostsVisibleTo(tenantReader(false) as any, TENANT, 'CASHIER')).toBe(false);
    expect(await purchaseCostsVisibleTo(tenantReader(true) as any, TENANT, 'CASHIER')).toBe(true);
    expect(await purchaseCostsVisibleTo(tenantReader(null) as any, TENANT, 'CASHIER')).toBe(true);
    expect(await purchaseCostsVisibleTo(tenantReader(false) as any, TENANT, undefined)).toBe(false);
  });
});

describe('ingredient reports, lots and per-ingredient movements', () => {
  function build(show: boolean) {
    const svc: any = {
      getMovements:        jest.fn().mockResolvedValue({ movements: [] }),
      getLots:             jest.fn().mockResolvedValue({ lots: [] }),
      getAggregatedReport: jest.fn().mockResolvedValue({ rows: [] }),
    };
    return { svc, controller: new IngredientReportsController(svc, tenantReader(show) as any) };
  }

  it('refuse the stock clerk in plain words, and read nothing, once costs are hidden', async () => {
    const { svc, controller } = build(false);
    const said = /Only the owner or a manager can open this, because it shows what the shop paid for stock\./;
    await expect(controller.getMovements(user('WAREHOUSE_STAFF'), 'rm1')).rejects.toThrow(said);
    await expect(controller.getLots(user('WAREHOUSE_STAFF'), 'rm1')).rejects.toThrow(said);
    await expect(controller.getAggregated(user('WAREHOUSE_STAFF'))).rejects.toThrow(said);
    expect(svc.getMovements).not.toHaveBeenCalled();
    expect(svc.getLots).not.toHaveBeenCalled();
    expect(svc.getAggregatedReport).not.toHaveBeenCalled();
  });

  it('stay open to the owner and the books, and to everyone on a shop that shows costs', async () => {
    for (const [show, role] of [[false, 'BUSINESS_OWNER'], [false, 'ACCOUNTANT'], [true, 'WAREHOUSE_STAFF']] as const) {
      const { controller } = build(show);
      await expect(controller.getMovements(user(role), 'rm1')).resolves.toEqual({ movements: [] });
      await expect(controller.getLots(user(role), 'rm1')).resolves.toEqual({ lots: [] });
      await expect(controller.getAggregated(user(role))).resolves.toEqual({ rows: [] });
    }
  });
});

describe('GET /products/pos -- the till', () => {
  const tiles = () => [
    { id: 'p1', name: 'Latte', price: 150, costPrice: 42.5, maxProducible: 12, isOutOfStock: false },
    { id: 'p2', name: 'Water', price: 30, costPrice: null, maxProducible: null, isOutOfStock: false },
  ];
  const build = (show: boolean) => {
    const products: any = { findForPos: jest.fn().mockResolvedValue(tiles()) };
    return new ProductsController(products, {} as any, tenantReader(show) as any);
  };

  it("carries no product cost to a cashier the shop hides costs from; the rest of the tile is the same", async () => {
    const res: any[] = await build(false).findForPos(user('CASHIER'), 'b1');
    expect(res.every((t) => !('costPrice' in t))).toBe(true);
    expect(res[0]).toEqual({ id: 'p1', name: 'Latte', price: 150, maxProducible: 12, isOutOfStock: false });
  });

  it('is unchanged for the owner, and for a shop that shows costs', async () => {
    expect(((await build(false).findForPos(user('BUSINESS_OWNER'), 'b1')) as any)[0].costPrice).toBe(42.5);
    expect(((await build(true).findForPos(user('CASHIER'), 'b1')) as any)[0].costPrice).toBe(42.5);
  });
});

describe('GET /orders and GET /orders/:id', () => {
  const order = () => ({
    id: 'o1', orderNumber: 'ORD-1', totalAmount: 150,
    items: [{ id: 'i1', productName: 'Latte', unitPrice: 150, lineTotal: 150, costPrice: 42.5, modifiers: [] }],
  });
  const build = (show: boolean) => {
    const orders: any = {
      findAll: jest.fn().mockResolvedValue({ data: [order()], total: 1, take: 100, skip: 0 }),
      findOne: jest.fn().mockResolvedValue(order()),
    };
    return new OrdersController(orders, {} as any, tenantReader(show) as any);
  };

  it("leave each line's cost off for a cashier the shop hides costs from", async () => {
    const list: any = await build(false).findAll(user('CASHIER'));
    expect(list.total).toBe(1);
    expect(list.data[0].items[0]).not.toHaveProperty('costPrice');
    expect(list.data[0].items[0]).toMatchObject({ productName: 'Latte', unitPrice: 150, lineTotal: 150 });
    const one: any = await build(false).findOne(user('CASHIER'), 'o1');
    expect(one.items[0]).not.toHaveProperty('costPrice');
    expect(one.totalAmount).toBe(150);
  });

  it('are unchanged for the owner, and for a shop that shows costs', async () => {
    expect(((await build(false).findAll(user('BUSINESS_OWNER'))) as any).data[0].items[0].costPrice).toBe(42.5);
    expect(((await build(true).findOne(user('CASHIER'), 'o1')) as any).items[0].costPrice).toBe(42.5);
  });
});

describe('GET /reports/shift/:id -- the end-of-shift summary', () => {
  const report = () => ({
    totalOrders: 3, netSales: 450, cashRevenue: 300,
    totalCogs: 127.5, grossProfit: 274.29, grossMargin: 0.68,
    itemsMissingCost: { lineCount: 0, revenueLeak: 0 },
    shift: { id: 's1' },
  });
  const build = (show: boolean) => {
    const reports: any = { getShiftReport: jest.fn().mockResolvedValue(report()) };
    return new ReportsController(reports, {} as any, tenantReader(show) as any);
  };

  it("keeps the cashier's own figures and leaves off cost of sales, profit and margin", async () => {
    const res: any = await build(false).getShift(user('CASHIER'), 's1');
    expect(res).not.toHaveProperty('totalCogs');
    expect(res).not.toHaveProperty('grossProfit');
    expect(res).not.toHaveProperty('grossMargin');
    expect(res).toMatchObject({ totalOrders: 3, netSales: 450, cashRevenue: 300, shift: { id: 's1' } });
  });

  it('is unchanged for the owner, and for a shop that shows costs', async () => {
    expect(((await build(false).getShift(user('BUSINESS_OWNER'), 's1')) as any).grossProfit).toBe(274.29);
    expect(((await build(true).getShift(user('CASHIER'), 's1')) as any).totalCogs).toBe(127.5);
  });
});

describe('the overdue vendor bills bell', () => {
  function build(show: boolean) {
    const created: any[] = [];
    const prisma: any = {
      aRInvoice: { aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {} }) },
      aPBill: {
        aggregate: jest.fn().mockResolvedValue({ _count: 2, _sum: { totalAmount: 5000, paidAmount: 1000, whtAmount: 0 } }),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: show }) },
      user: { findMany: jest.fn().mockResolvedValue([{ id: 'owner' }, { id: 'books' }]) },
    };
    const notifications: any = { create: jest.fn(async (n: any) => { created.push(n); return n; }) };
    return { scheduler: new NotificationsScheduler(prisma, notifications) as any, prisma, created };
  }

  it('goes to everyone, as it always has, on a shop that shows costs to staff', async () => {
    const { scheduler, created, prisma } = build(true);
    await scheduler.overdueArApProducer(TENANT);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ userId: null, title: expect.stringContaining('₱4,000.00 due') });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('goes only to the people who see costs, one each, once they are hidden from staff', async () => {
    const { scheduler, created, prisma } = build(false);
    await scheduler.overdueArApProducer(TENANT);
    expect(created.map((n) => n.userId)).toEqual(['owner', 'books']);
    expect(created.every((n) => /₱4,000\.00 due/.test(n.title))).toBe(true);
    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: TENANT, isActive: true });
    expect(where.role.in).toEqual(expect.arrayContaining(['BUSINESS_OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT']));
    expect(where.role.in).not.toContain('CASHIER');
    expect(where.role.in).not.toContain('GENERAL_EMPLOYEE');
  });
});
