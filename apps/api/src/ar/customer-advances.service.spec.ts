/**
 * CustomerAdvancesService — Sprint 22 unit tests.
 *
 * Covers:
 *   - create → DRAFT (no JE)
 *   - post   → POSTED (emits DR Cash / CR Customer Deposits Liability)
 *   - apply  → decreases invoice balanceAmount + bumps appliedAmount/unappliedAmount
 *   - refund → terminal REFUNDED with reverse-direction JE for unapplied balance
 *
 * Following the pattern in journal.accounting.spec.ts: mock PrismaService with
 * just enough surface, mock NumberingService + AccountingPeriodsService, mock
 * JournalService.create to capture lines.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { CustomerAdvancesService } from './customer-advances.service';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';

const ACCT_CASH = 'acct-cash';
const ACCT_LIAB = 'acct-2031-liab';

interface CapturedJE { lines: Array<{ accountId: string; debit?: number; credit?: number }>; description: string }

function buildPrismaMock() {
  const advanceStore: Record<string, any> = {};
  const invoiceStore: Record<string, any> = {
    'inv-1': {
      id: 'inv-1', tenantId: 'tenant-1', customerId: 'cust-1',
      invoiceNumber: 'INV-001', status: 'OPEN',
      totalAmount: 1000, paidAmount: 0, balanceAmount: 1000,
    },
  };
  const applicationStore: Array<any> = [];

  return {
    advanceStore, invoiceStore, applicationStore,

    customer: {
      findFirst: jest.fn().mockResolvedValue({ id: 'cust-1', name: 'ACME' }),
    },
    account: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where.code === '2031') return Promise.resolve({ id: ACCT_LIAB });
        if (where.code === '2030') return Promise.resolve(null);
        if (where.type === 'ASSET') return Promise.resolve({ id: ACCT_CASH });
        return Promise.resolve(null);
      }),
    },
    customerAdvance: {
      findFirst: jest.fn().mockImplementation(({ where, include }: any) => {
        const adv = advanceStore[where.id];
        if (!adv) return Promise.resolve(null);
        const withRels = { ...adv };
        if (include?.customer)     withRels.customer     = { id: 'cust-1', name: 'ACME' };
        if (include?.applications) withRels.applications = applicationStore.filter((a) => a.advanceId === adv.id);
        return Promise.resolve(withRels);
      }),
      findFirstOrThrow: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(advanceStore[where.id])),
      create: jest.fn().mockImplementation(({ data }: any) => {
        const id = `adv-${Object.keys(advanceStore).length + 1}`;
        const rec = { id, ...data,
          totalAmount:     Number(data.totalAmount),
          appliedAmount:   Number(data.appliedAmount),
          unappliedAmount: Number(data.unappliedAmount) };
        advanceStore[id] = rec;
        return Promise.resolve(rec);
      }),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const rec = advanceStore[where.id];
        Object.assign(rec, data);
        if (data.appliedAmount   !== undefined) rec.appliedAmount   = Number(data.appliedAmount);
        if (data.unappliedAmount !== undefined) rec.unappliedAmount = Number(data.unappliedAmount);
        return Promise.resolve(rec);
      }),
      updateMany: jest.fn().mockImplementation(({ where, data }: any) => {
        const rec = advanceStore[where.id];
        if (!rec) return Promise.resolve({ count: 0 });
        if (where.status && Array.isArray(where.status.in) && !where.status.in.includes(rec.status)) {
          return Promise.resolve({ count: 0 });
        }
        if (typeof where.status === 'string' && rec.status !== where.status) return Promise.resolve({ count: 0 });
        if (where.voidedAt === null && rec.voidedAt) return Promise.resolve({ count: 0 });
        Object.assign(rec, data);
        if (data.unappliedAmount !== undefined) rec.unappliedAmount = Number(data.unappliedAmount);
        return Promise.resolve({ count: 1 });
      }),
    },
    customerAdvanceApplication: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        applicationStore.push({ ...data, appliedAmount: Number(data.appliedAmount) });
        return Promise.resolve(data);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aRInvoice: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(invoiceStore[where.id] ?? null)),
      findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(invoiceStore[where.id] ?? null)),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const inv = invoiceStore[where.id];
        if (data.paidAmount    !== undefined) inv.paidAmount    = Number(data.paidAmount);
        if (data.balanceAmount !== undefined) inv.balanceAmount = Number(data.balanceAmount);
        if (data.status        !== undefined) inv.status        = data.status;
        return Promise.resolve(inv);
      }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb({
      customerAdvance:            (advanceStore as any) && (this as any),
    })),
  };
}

async function makeService() {
  const prismaMock: any = buildPrismaMock();
  // $transaction passes back a tx with the same surface as prisma
  prismaMock.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prismaMock));

  const captured: CapturedJE[] = [];
  const journalMock = {
    create:  jest.fn().mockImplementation((_tid: string, dto: any) => {
      captured.push({ lines: dto.lines, description: dto.description });
      return Promise.resolve({ id: `je-${captured.length}`, entryNumber: `JE-${captured.length}` });
    }),
    reverse: jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV' }),
  };
  const periodsMock = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
  const numberingMock = { next: jest.fn().mockResolvedValue('CA-2026-0001') };
  const auditMock = { log: jest.fn().mockResolvedValue(undefined) };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      CustomerAdvancesService,
      { provide: PrismaService,              useValue: prismaMock   },
      { provide: JournalService,             useValue: journalMock  },
      { provide: AccountingPeriodsService,   useValue: periodsMock  },
      { provide: NumberingService,           useValue: numberingMock },
      { provide: AuditService,               useValue: auditMock    },
    ],
  }).compile();

  return {
    svc:      moduleRef.get(CustomerAdvancesService),
    prisma:   prismaMock,
    journal:  journalMock,
    captured,
  };
}

describe('CustomerAdvancesService — happy path', () => {
  it('create → post → apply: emits liability JE and decreases invoice balance', async () => {
    const { svc, prisma, captured } = await makeService();

    // 1. create
    const draft = await svc.create('tenant-1', 'user-1', {
      customerId:  'cust-1',
      advanceDate: '2026-05-12',
      method:      'CASH',
      totalAmount: 500,
    } as any);
    expect(draft.status).toBe('DRAFT');
    expect(draft.appliedAmount).toBe(0);
    expect(draft.unappliedAmount).toBe(500);

    // 2. post
    const posted = await svc.post('tenant-1', draft.id, 'user-1');
    expect(posted).toBeDefined();
    expect(captured).toHaveLength(1);
    const [je] = captured;
    expect(je.lines).toEqual([
      expect.objectContaining({ accountId: ACCT_CASH, debit:  500 }),
      expect.objectContaining({ accountId: ACCT_LIAB, credit: 500 }),
    ]);

    // 3. apply to inv-1 for 300
    const applied = await svc.apply('tenant-1', draft.id, 'user-1', {
      invoiceId: 'inv-1',
      amount:    300,
    } as any);
    expect(Number(applied.appliedAmount)).toBe(300);
    expect(Number(applied.unappliedAmount)).toBe(200);

    const inv = prisma.invoiceStore['inv-1'];
    expect(inv.paidAmount).toBe(300);
    expect(inv.balanceAmount).toBe(700);
    expect(inv.status).toBe('PARTIALLY_PAID');
  });

  it('refund: marks REFUNDED and posts reverse JE for unapplied amount', async () => {
    const { svc, captured } = await makeService();

    const draft  = await svc.create('tenant-1', 'user-1', {
      customerId:  'cust-1',
      advanceDate: '2026-05-12',
      method:      'CASH',
      totalAmount: 500,
    } as any);
    await svc.post('tenant-1', draft.id, 'user-1');
    await svc.refund('tenant-1', draft.id, 'user-1', { method: 'CASH' } as any);

    // Two JEs: post + refund
    expect(captured).toHaveLength(2);
    const refundJE = captured[1];
    expect(refundJE.lines).toEqual([
      expect.objectContaining({ accountId: ACCT_LIAB, debit:  500 }),
      expect.objectContaining({ accountId: ACCT_CASH, credit: 500 }),
    ]);
  });
});
