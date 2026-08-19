import { BadRequestException } from '@nestjs/common';
import { ArService } from './ar.service';

/**
 * #43 — AR collection on a CHARGE order.
 *
 * Before: recordCollection wrote a raw journalEntry row (entryNumber
 * `AR-${Date.now()}`, bypassing atomic numbering / period lock / posting
 * control) and hardcoded DR 1010 Cash even for GCash/Maya. Combined with the
 * SALE handler debiting 1010 for the full CHARGE total, cash was counted
 * TWICE and 1030 went negative.
 *
 * Now: DR tender (1010 cash | 1031 digital) / CR 1030, posted through
 * journal.create with source 'AR', with the period pre-checked BEFORE the
 * data tx so a payment row is never committed against a closed period.
 */
describe('ArService.recordCollection (#43)', () => {
  const TENANT = 'tenant-1';
  const USER   = 'user-1';
  const ORDER  = 'ord-1';

  const build = (over: { order?: any; periodOpen?: boolean } = {}) => {
    const order = over.order ?? {
      id: ORDER, tenantId: TENANT, invoiceType: 'CHARGE', status: 'PENDING',
      orderNumber: 'ORD-2026-000042', totalAmount: 1120, customerName: null,
      customer: { name: 'ACME Corp' }, payments: [],
    };
    const calls: { txPaymentCreate: any[]; txOrderUpdate: any[]; journal: any[]; periodCheck: any[] } = {
      txPaymentCreate: [], txOrderUpdate: [], journal: [], periodCheck: [],
    };
    // Sequence tracker — proves the JE posts AFTER the data tx commits, and the
    // period pre-check runs BEFORE either.
    const sequence: string[] = [];

    const tx = {
      orderPayment: { create: jest.fn().mockImplementation(({ data }: any) => {
        sequence.push('tx:payment'); calls.txPaymentCreate.push(data);
        return Promise.resolve({ id: 'pay-1', ...data });
      }) },
      order: { update: jest.fn().mockImplementation((args: any) => {
        sequence.push('tx:order'); calls.txOrderUpdate.push(args); return Promise.resolve({});
      }) },
    };
    const prisma: any = {
      order:   { findFirst: jest.fn().mockResolvedValue(order) },
      account: { findFirst: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: `acct-${where.code}`, code: where.code })) },
      $transaction: jest.fn(async (cb: any) => { sequence.push('tx:begin'); const r = await cb(tx); sequence.push('tx:commit'); return r; }),
    };
    const journal = { create: jest.fn().mockImplementation((...args: any[]) => {
      sequence.push('journal.create'); calls.journal.push(args);
      return Promise.resolve({ id: 'je-1', entryNumber: 'JE-202608-0007' });
    }) };
    const periods = { assertDateIsOpen: jest.fn().mockImplementation((...args: any[]) => {
      sequence.push('periods.assert'); calls.periodCheck.push(args);
      return over.periodOpen === false
        ? Promise.reject(new BadRequestException('Period is closed'))
        : Promise.resolve();
    }) };

    const svc = new ArService(prisma, journal as any, periods as any);
    return { svc, prisma, journal, periods, calls, sequence, tx };
  };

  const lineFor = (dto: any, acct: string) => dto.lines.find((l: any) => l.accountId === `acct-${acct}`);

  it('cash collection → DR 1010 / CR 1030 via journal.create with source AR', async () => {
    const { svc, calls } = build();
    const res = await svc.recordCollection(ORDER, TENANT, USER, { amount: 500, paymentMethod: 'CASH' });

    expect(calls.journal).toHaveLength(1);
    const [tenantId, dto, createdBy, source] = calls.journal[0];
    expect(tenantId).toBe(TENANT);
    expect(createdBy).toBe(USER);
    expect(source).toBe('AR');                                   // NOT the MANUAL default
    expect(lineFor(dto, '1010')?.debit).toBe(500);               // cash tender
    expect(lineFor(dto, '1030')?.credit).toBe(500);              // relieves receivable
    expect(dto.lines).toHaveLength(2);
    expect(dto.lines.some((l: any) => l.accountId === 'acct-1031')).toBe(false);
    // Response shape kept for the controller / web page.
    expect(res.payment).toBeDefined();
    expect(res.journalEntry).toEqual(expect.objectContaining({ id: 'je-1' }));
    expect(res.fullyCollected).toBe(false);                     // 500 of 1120
  });

  it('digital (GCash) collection → DR 1031 wallet receivable, NOT 1010 cash', async () => {
    const { svc, calls } = build();
    await svc.recordCollection(ORDER, TENANT, USER, { amount: 1120, paymentMethod: 'GCASH_BUSINESS', reference: 'GC-123' });

    const dto = calls.journal[0][1];
    expect(lineFor(dto, '1031')?.debit).toBe(1120);
    expect(lineFor(dto, '1030')?.credit).toBe(1120);
    expect(dto.lines.some((l: any) => l.accountId === 'acct-1010')).toBe(false);
    expect(dto.reference).toBe('GC-123');
  });

  it('full collection marks the order COMPLETED; JE posts AFTER the data tx commits', async () => {
    const { svc, calls, sequence } = build();
    const res = await svc.recordCollection(ORDER, TENANT, USER, { amount: 1120, paymentMethod: 'CASH' });

    expect(res.fullyCollected).toBe(true);
    expect(calls.txOrderUpdate[0].data).toEqual(expect.objectContaining({ status: 'COMPLETED' }));
    // Ordering: period pre-check → data tx (payment + order) → commit → JE.
    // journal.create manages its own writes and must never run inside the tx.
    expect(sequence.indexOf('periods.assert')).toBeLessThan(sequence.indexOf('tx:begin'));
    expect(sequence.indexOf('tx:commit')).toBeLessThan(sequence.indexOf('journal.create'));
  });

  it('closed period → rejects BEFORE any payment row is written (no orphan payment)', async () => {
    const { svc, calls, journal } = build({ periodOpen: false });
    await expect(svc.recordCollection(ORDER, TENANT, USER, { amount: 100, paymentMethod: 'CASH' }))
      .rejects.toThrow(/closed/i);
    expect(calls.txPaymentCreate).toHaveLength(0);              // nothing committed
    expect(journal.create).not.toHaveBeenCalled();
  });

  it('rejects over-collection beyond the remaining balance', async () => {
    const order = {
      id: ORDER, tenantId: TENANT, invoiceType: 'CHARGE', status: 'PENDING', orderNumber: 'ORD-1',
      totalAmount: 1000, customerName: 'Walk-in', customer: null,
      payments: [{ amount: 800 }],                               // 200 remaining
    };
    const { svc, journal } = build({ order });
    await expect(svc.recordCollection(ORDER, TENANT, USER, { amount: 300, paymentMethod: 'CASH' }))
      .rejects.toThrow(/exceeds remaining balance/);
    expect(journal.create).not.toHaveBeenCalled();
  });

  it('never posts a raw journalEntry row — every JE goes through journal.create', async () => {
    const { svc, prisma } = build();
    await svc.recordCollection(ORDER, TENANT, USER, { amount: 100, paymentMethod: 'CASH' });
    // The old code did tx.journalEntry.create with `AR-${Date.now()}` — that
    // model is no longer touched by this service at all.
    expect((prisma as any).journalEntry).toBeUndefined();
  });
});
