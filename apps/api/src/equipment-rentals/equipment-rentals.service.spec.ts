import { EquipmentRentalsService } from './equipment-rentals.service';

/**
 * Equipment rentals — the money split the brief is strict about:
 *   • rent fee → INCOME at pickup (4113), never refunded
 *   • deposit  → LIABILITY held (2078), NOT income while out
 *   • good return → refund the deposit (clear 2078)
 *   • loss/damage → forfeit the deposit (2078 → 4114 income) + retire the item
 * These pin the journal each step posts.
 */
describe('EquipmentRentalsService — deposit lifecycle', () => {
  const TENANT = 'club-1';

  const build = (over: { items?: any[]; rental?: any; linesAfter?: any[] } = {}) => {
    const items = over.items ?? [
      { id: 'i1', name: 'Paddle A', status: 'AVAILABLE', isActive: true, branchId: 'b1', rentFeeCentavos: 5000, depositCentavos: 30000 },
    ];
    const journalCalls: any[] = [];
    const journal = { create: jest.fn().mockImplementation((...args: any[]) => { journalCalls.push(args); return Promise.resolve({ id: 'je' }); }) };
    const accounts = { findByCode: jest.fn().mockImplementation((_t: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })) };
    const tax = { computeTaxBreakdown: (gross: number, status: string) =>
      status === 'VAT'
        ? { netAmount: Math.round((gross / 1.12) * 100) / 100, vatAmount: Math.round((gross - gross / 1.12) * 100) / 100, grossAmount: gross, totalAmount: gross }
        : { netAmount: gross, vatAmount: 0, grossAmount: gross, totalAmount: gross } };

    const tx = {
      rentalTransaction: {
        count:  jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'r1', rentalNumber: data.rentalNumber, lines: (data.lines?.create ?? []).map((l: any, i: number) => ({ id: `l${i+1}`, ...l, returned: false, forfeited: false })) })),
        update: jest.fn().mockResolvedValue({}),
      },
      rentableItem: { updateMany: jest.fn().mockResolvedValue({}), update: jest.fn().mockResolvedValue({}) },
      rentalLine:   { update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue(over.linesAfter ?? []) },
    };
    const prisma: any = {
      rentableItem: { findMany: jest.fn().mockResolvedValue(items), findFirst: jest.fn().mockResolvedValue(items[0]) },
      rentalTransaction: { findFirst: jest.fn().mockResolvedValue(over.rental ?? null) },
      rentalLine: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: 'VAT' }) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };

    const svc = new EquipmentRentalsService(prisma, journal as any, accounts as any, tax as any);
    return { svc, prisma, journal, journalCalls, tx };
  };

  const creditFor = (dto: any, code: string) =>
    dto.lines.filter((l: any) => l.accountId === `acct-${code}`).reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
  const debitFor = (dto: any, code: string) =>
    dto.lines.filter((l: any) => l.accountId === `acct-${code}`).reduce((s: number, l: any) => s + (l.debit ?? 0), 0);

  it('pickup: rent fee → income (4113) + VAT, deposit → liability (2078), NOT income', async () => {
    const { svc, journalCalls } = build();
    await svc.rentOut(TENANT, 'user-1', { customerName: 'Ana', itemIds: ['i1'] });

    expect(journalCalls).toHaveLength(1);
    const dto = journalCalls[0][1];
    // ₱50 rent fee (VAT-inclusive) → 44.64 net + 5.36 VAT; ₱300 deposit.
    expect(creditFor(dto, '4113')).toBeCloseTo(44.64, 2);   // Equipment Rental Income
    expect(creditFor(dto, '2020')).toBeCloseTo(5.36, 2);    // Output VAT
    expect(creditFor(dto, '2078')).toBeCloseTo(300, 2);     // Rental Deposits Held (LIABILITY)
    expect(creditFor(dto, '4114')).toBe(0);                 // NOT forfeited income yet
    expect(debitFor(dto, '1010')).toBeCloseTo(350, 2);      // cash collected = fee + deposit
    // Balanced.
    const debit  = dto.lines.reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
    const credit = dto.lines.reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100));
    expect(journalCalls[0][3]).toBe('SYSTEM');
  });

  it('good return: refunds the deposit — DR 2078 / CR 1010, no income touched', async () => {
    const rental = {
      id: 'r1', rentalNumber: 'RENT-00001', status: 'OUT',
      depositRefundedCentavos: 0, depositForfeitedCentavos: 0,
      lines: [{ id: 'l1', itemId: 'i1', depositCentavos: 30000, returned: false, forfeited: false }],
    };
    const { svc, journalCalls } = build({ rental, linesAfter: [{ id: 'l1', returned: true, forfeited: false }] });
    await svc.returnRental(TENANT, 'r1', { condition: 'good' });

    const dto = journalCalls[0][1];
    expect(debitFor(dto, '2078')).toBeCloseTo(300, 2);   // clear liability
    expect(creditFor(dto, '1010')).toBeCloseTo(300, 2);  // cash out to customer
    expect(creditFor(dto, '4113')).toBe(0);
    expect(creditFor(dto, '4114')).toBe(0);              // NOT income — it was refunded
  });

  it('loss: forfeits the deposit — DR 2078 / CR 4114 income, item retired', async () => {
    const rental = {
      id: 'r1', rentalNumber: 'RENT-00001', status: 'OUT',
      depositRefundedCentavos: 0, depositForfeitedCentavos: 0,
      lines: [{ id: 'l1', itemId: 'i1', depositCentavos: 30000, returned: false, forfeited: false }],
    };
    const { svc, journalCalls, tx } = build({ rental, linesAfter: [{ id: 'l1', returned: false, forfeited: true }] });
    await svc.returnRental(TENANT, 'r1', { condition: 'loss' });

    const dto = journalCalls[0][1];
    expect(debitFor(dto, '2078')).toBeCloseTo(300, 2);   // clear liability
    expect(creditFor(dto, '4114')).toBeCloseTo(300, 2);  // → Forfeited Deposit income
    expect(creditFor(dto, '1010')).toBe(0);              // nothing returned to customer
    // Item retired.
    expect(tx.rentableItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'RETIRED' }) }),
    );
  });

  it('rejects renting an item that is already out', async () => {
    const { svc } = build({ items: [{ id: 'i1', name: 'Paddle A', status: 'RENTED', isActive: true, rentFeeCentavos: 5000, depositCentavos: 30000 }] });
    await expect(svc.rentOut(TENANT, 'u', { customerName: 'Ana', itemIds: ['i1'] }))
      .rejects.toThrow(/Not available/);
  });
});
