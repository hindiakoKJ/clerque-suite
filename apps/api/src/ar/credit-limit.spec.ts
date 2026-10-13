import { openChargeBalance, overCreditLimitMessage } from './credit-limit';
import { CustomersService } from './customers.service';

describe('openChargeBalance -- what a customer owes on account', () => {
  const prismaWith = (rows: unknown[]) => ({ order: { findMany: jest.fn().mockResolvedValue(rows) } }) as any;

  it('adds up what is still to collect on each CHARGE sale', async () => {
    const prisma = prismaWith([
      { totalAmount: 3000, payments: [{ amount: 500 }, { amount: 499.5 }] }, // 2,000.50 left
      { totalAmount: '1000.25', payments: [] },                              // Decimal-as-string
    ]);
    await expect(openChargeBalance(prisma, 't1', 'c1')).resolves.toBe(3000.75);
  });

  it('does not let an over-collected sale cancel out what is owed on another', async () => {
    const prisma = prismaWith([
      { totalAmount: 1000, payments: [{ amount: 1200 }] },
      { totalAmount: 500,  payments: [] },
    ]);
    await expect(openChargeBalance(prisma, 't1', 'c1')).resolves.toBe(500);
  });

  it('reads only this customer\'s CHARGE sales in this shop, voids left out', async () => {
    const prisma = prismaWith([]);
    await openChargeBalance(prisma, 't1', 'c1');
    expect(prisma.order.findMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', customerId: 'c1', invoiceType: 'CHARGE', status: { not: 'VOIDED' } },
      include: { payments: true },
    });
  });

  it('is the same figure the Customers page shows', async () => {
    const prisma = prismaWith([{ totalAmount: 800, payments: [{ amount: 300 }] }]);
    const svc = new CustomersService(prisma);
    await expect(svc.getOutstandingBalance('c1', 't1')).resolves.toBe(500);
  });
});

describe('overCreditLimitMessage', () => {
  const base = { name: 'Mang Ben Auto', creditLimit: 5000, owes: 3500 };

  it('says nothing when there is no limit', () => {
    expect(overCreditLimitMessage({ ...base, creditLimit: null, sale: 1_000_000 })).toBeNull();
  });

  it('says nothing inside the limit or exactly on it', () => {
    expect(overCreditLimitMessage({ ...base, sale: 1000 })).toBeNull();
    expect(overCreditLimitMessage({ ...base, sale: 1500 })).toBeNull();
  });

  it('names the customer, the limit and what they owe now', () => {
    expect(overCreditLimitMessage({ ...base, creditLimit: 12500, owes: 12000, sale: 1000 })).toBe(
      'This sale would put Mang Ben Auto over their ₱12,500.00 credit limit (owes ₱12,000.00 now). Take payment, or ask the owner.',
    );
  });

  it('treats a zero limit as "no credit", not "no limit"', () => {
    expect(overCreditLimitMessage({ ...base, creditLimit: 0, owes: 0, sale: 1 })).toMatch(/over their ₱0.00 credit limit/);
  });
});
