import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrdersService } from './orders.service';

/**
 * A sale lands in the drawer of the shift it names.
 *
 * The only check on shiftId used to be "belongs to this tenant", so a cashier
 * could ring her sales on a colleague's open shift (the shortfall lands on
 * the wrong drawer at close) or on a shift already closed and counted.
 */
describe('OrdersService.create — whose shift', () => {
  const TENANT = 'tenant-1';
  const ME = 'cashier-me';

  let prisma: any;
  let svc: OrdersService;

  const payload = (over: Record<string, unknown> = {}) => ({
    clientUuid: 'uuid-1', shiftId: 'shift-1', branchId: 'branch-1',
    items: [], payments: [{ method: 'CASH', amount: 100 }], discounts: [],
    subtotal: 100, discountAmount: 0, vatAmount: 0, totalAmount: 100,
    isPwdScDiscount: false, createdAt: new Date().toISOString(), ...over,
  });

  beforeEach(() => {
    prisma = {
      order:  { findFirst: jest.fn().mockResolvedValue(null) },
      user:   { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]) },
      branch: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
      shift:  { findFirst: jest.fn().mockResolvedValue({ cashierId: 'cashier-other', closedAt: null }) },
      tenant: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', planCode: 'CLERQUE', isPtuHolder: false }),
        findUnique: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', planCode: 'CLERQUE' }),
      },
    };
    svc = new OrdersService(
      prisma as any,
      { assertDateIsOpen: jest.fn() } as any,
      { assertVatConsistency: jest.fn() } as any,
      { log: jest.fn() } as any,
      {} as any, {} as any, {} as any, {} as any,
    );
  });

  /** The code the shift wall answered with, or null when the sale got past it. */
  const wall = async (role: string, opts: Record<string, unknown> = {}) => {
    try {
      await svc.create(TENANT, ME, payload() as never, { callerRole: role, ...opts });
      return null;
    } catch (err) {
      if (err instanceof ForbiddenException || err instanceof BadRequestException) {
        const code = (err.getResponse() as { code?: string })?.code;
        if (code === 'NOT_YOUR_SHIFT' || code === 'SHIFT_CLOSED') return code;
      }
      return null; // a later, unrelated step: the wall let it through
    }
  };

  it("refuses a cashier ringing on someone else's shift", async () => {
    expect(await wall('CASHIER')).toBe('NOT_YOUR_SHIFT');
  });

  it('lets a cashier ring on her own shift', async () => {
    prisma.shift.findFirst.mockResolvedValue({ cashierId: ME, closedAt: null });
    expect(await wall('CASHIER')).toBeNull();
  });

  it.each(['SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER'])('lets %s ring on any till', async (role) => {
    expect(await wall(role)).toBeNull();
  });

  it('refuses a live sale on a shift that is already closed', async () => {
    prisma.shift.findFirst.mockResolvedValue({ cashierId: ME, closedAt: new Date() });
    expect(await wall('CASHIER')).toBe('SHIFT_CLOSED');
  });

  it('still accepts an offline sale replayed after its shift closed: the cash really went into that drawer', async () => {
    prisma.shift.findFirst.mockResolvedValue({ cashierId: ME, closedAt: new Date() });
    expect(await wall('CASHIER', { replayedOffline: true, skipStockCeiling: true })).toBeNull();
  });
});
