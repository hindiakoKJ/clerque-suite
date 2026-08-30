import { ShiftsService } from './shifts.service';

/**
 * A refund empties the drawer, and expected cash has to know.
 *
 * Nothing in this service read refunds at all — grep returned zero hits — so a
 * ₱180 cash refund left the till while expected cash still counted the whole
 * original sale. The drawer came up ₱180 short, `close()` booked a variance
 * against the GL, and the cashier was asked to sign for a shortage that was
 * money she had handed to a customer in front of a witness.
 *
 * The close screen's own help text already promised the opposite:
 * "expected cash (= opening cash + cash sales − refunds − paid-outs)".
 *
 * Attributed by WHEN THE CASH LEFT, not when the sale happened: a refund
 * against yesterday's coffee empties today's drawer.
 */
describe('ShiftsService — refunds and expected cash', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const OPENED = new Date('2026-08-30T07:00:00Z');

  function build(opts: {
    refunds?: Array<{ refundAmount: number }>;
    cashOuts?: Array<{ type: string; amount: number }>;
    closedAt?: Date | null;
    /** Orders at this branch during the window that belong to no shift. */
    strayOrders?: Array<{ status: string; totalAmount: number; payments: Array<{ method: string; amount: number }> }>;
  } = {}) {
    const refundWhere: any[] = [];
    const prisma: any = {
      order: {
        /*
          buildSummary asks this twice: once for the shift's OWN orders, and
          once for orders at the branch in the same window carrying no shiftId
          at all (a supervisor ringing sales outside the shift gate). The two
          are told apart by `shiftId: null`.
        */
        findMany: jest.fn(({ where }: any) => {
          if (where?.shiftId === null) return Promise.resolve(opts.strayOrders ?? []);
          return Promise.resolve([
            {
              status: 'COMPLETED', totalAmount: 500,
              payments: [{ method: 'CASH', amount: 500 }],
            },
          ]);
        }),
      },
      shiftCashOut: { findMany: jest.fn().mockResolvedValue(opts.cashOuts ?? []) },
      orderItemRefund: {
        findMany: jest.fn(({ where }: any) => {
          refundWhere.push(where);
          return Promise.resolve(opts.refunds ?? []);
        }),
      },
    };
    const svc = new ShiftsService(prisma, { log: jest.fn() } as any, { generateZRead: jest.fn() } as any) as any;
    const shift = {
      id: 's1', tenantId: TENANT, branchId: BRANCH, cashierId: 'u1',
      openingCash: 1000, openedAt: OPENED,
      closedAt: opts.closedAt === undefined ? null : opts.closedAt,
      closingCashDeclared: null, closingCashExpected: null, variance: null, notes: null,
    };
    return { svc, shift, refundWhere };
  }

  it('subtracts a cash refund from expected cash', async () => {
    // 1000 opening + 500 cash sales − 180 refunded = 1320 in the drawer.
    const { svc, shift } = build({ refunds: [{ refundAmount: 180 }] });
    const s = await svc.buildSummary(shift);
    expect(s.expectedCash).toBe(1320);
  });

  it('reports the refund total so the numbers on screen add up', async () => {
    const { svc, shift } = build({ refunds: [{ refundAmount: 180 }, { refundAmount: 45 }] });
    const s = await svc.buildSummary(shift);
    expect(s.refundTotal).toBe(225);
    expect(s.expectedCash).toBe(1000 + 500 - 225);
  });

  it('leaves expected cash alone when nothing was refunded', async () => {
    const { svc, shift } = build({ refunds: [] });
    const s = await svc.buildSummary(shift);
    expect(s.refundTotal).toBe(0);
    expect(s.expectedCash).toBe(1500);
  });

  it('stacks with paid-outs and cash drops rather than replacing them', async () => {
    const { svc, shift } = build({
      refunds: [{ refundAmount: 180 }],
      cashOuts: [{ type: 'PAID_OUT', amount: 120 }, { type: 'CASH_DROP', amount: 300 }],
    });
    const s = await svc.buildSummary(shift);
    expect(s.expectedCash).toBe(1000 + 500 - 180 - 120 - 300);
  });

  it('counts only CASH refunds — a GCash reversal never touches the drawer', async () => {
    const { svc, shift, refundWhere } = build({ refunds: [] });
    await svc.buildSummary(shift);
    expect(refundWhere[0].refundMethod).toBe('CASH');
  });

  it('counts refunds GIVEN during this shift, whenever the sale happened', async () => {
    // A refund against yesterday's coffee still empties today's till, so the
    // window is the shift's, not the order's.
    const { svc, shift, refundWhere } = build({ refunds: [] });
    await svc.buildSummary(shift);
    expect(refundWhere[0].createdAt.gte).toBe(OPENED);
  });

  it('scopes to this tenant and branch, not every till in the company', async () => {
    const { svc, shift, refundWhere } = build({ refunds: [] });
    await svc.buildSummary(shift);
    expect(refundWhere[0].orderItem.order).toEqual({ tenantId: TENANT, branchId: BRANCH });
  });

  it('bounds an open shift at the start only, so refunds land as they happen', async () => {
    const { svc, shift, refundWhere } = build({ refunds: [] });
    await svc.buildSummary(shift);
    expect(refundWhere[0].createdAt.lte).toBeUndefined();
  });

  it('bounds a closed shift at both ends', async () => {
    const closedAt = new Date('2026-08-30T15:00:00Z');
    const { svc, shift, refundWhere } = build({ refunds: [], closedAt });
    await svc.buildSummary(shift);
    expect(refundWhere[0].createdAt.lte).toBe(closedAt);
  });
});

/**
 * Cash in the drawer that no shift claims.
 *
 * Supervisors bypass the shift gate entirely (ShiftGate.tsx), so when the owner
 * jumps on the till at the morning rush his sales carry no shiftId — while the
 * cash goes into the very same physical drawer. The barista then counts MORE
 * than she is expected to have, the system books the surplus to the GL as
 * income, and she is asked to sign for money she cannot explain.
 *
 * Reported rather than added: whether an owner should open his own shift is a
 * decision about how the shop runs, and with several shifts open per branch
 * there is no unambiguous one to attach a stray order to. Folding it into
 * expected cash would quietly make one person accountable for another's till.
 */
describe('ShiftsService — cash no shift claims', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const OPENED = new Date('2026-08-30T07:00:00Z');

  function build(strayOrders: any[] = []) {
    const orderWhere: any[] = [];
    const prisma: any = {
      order: {
        findMany: jest.fn(({ where }: any) => {
          orderWhere.push(where);
          if (where?.shiftId === null) return Promise.resolve(strayOrders);
          return Promise.resolve([
            { status: 'COMPLETED', totalAmount: 500, payments: [{ method: 'CASH', amount: 500 }] },
          ]);
        }),
      },
      shiftCashOut:    { findMany: jest.fn().mockResolvedValue([]) },
      orderItemRefund: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new ShiftsService(prisma, { log: jest.fn() } as any, { generateZRead: jest.fn() } as any) as any;
    const shift = {
      id: 's1', tenantId: TENANT, branchId: BRANCH, cashierId: 'u1',
      openingCash: 1000, openedAt: OPENED, closedAt: null,
      closingCashDeclared: null, closingCashExpected: null, variance: null, notes: null,
    };
    return { svc, shift, orderWhere };
  }

  it('reports cash the owner rang outside any shift', async () => {
    const { svc, shift } = build([
      { status: 'COMPLETED', totalAmount: 320, payments: [{ method: 'CASH', amount: 320 }] },
    ]);
    const s = await svc.buildSummary(shift);
    expect(s.unattributedCashSales).toBe(320);
  });

  it('does NOT fold it into expected cash', async () => {
    // The cashier is accountable for what she rang. Adding someone else's
    // sales to her expected figure makes her answer for another person's till.
    const { svc, shift } = build([
      { status: 'COMPLETED', totalAmount: 320, payments: [{ method: 'CASH', amount: 320 }] },
    ]);
    const s = await svc.buildSummary(shift);
    expect(s.expectedCash).toBe(1500);
  });

  it('counts only the cash part of a split payment', async () => {
    const { svc, shift } = build([
      { status: 'COMPLETED', totalAmount: 500, payments: [
        { method: 'GCASH_BUSINESS', amount: 300 }, { method: 'CASH', amount: 200 },
      ] },
    ]);
    const s = await svc.buildSummary(shift);
    expect(s.unattributedCashSales).toBe(200);
  });

  it('reads zero on an ordinary shift, so it stays out of the way', async () => {
    const { svc, shift } = build([]);
    const s = await svc.buildSummary(shift);
    expect(s.unattributedCashSales).toBe(0);
  });

  it('looks only at this branch, this window, POS, and not voids', async () => {
    const { svc, shift, orderWhere } = build([]);
    await svc.buildSummary(shift);
    const stray = orderWhere.find((w) => w?.shiftId === null);
    expect(stray.tenantId).toBe(TENANT);
    expect(stray.branchId).toBe(BRANCH);
    expect(stray.channel).toBe('POS');
    expect(stray.status).toEqual({ not: 'VOIDED' });
    expect(stray.createdAt.gte).toBe(OPENED);
  });
});
