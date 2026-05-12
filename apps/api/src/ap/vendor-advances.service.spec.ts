/**
 * VendorAdvancesService — Sprint 22 unit tests.
 *
 * Mirror of customer-advances.service.spec.ts for the AP side:
 *   - create → DRAFT (no JE)
 *   - post   → POSTED (DR Vendor Prepayments Asset / CR Cash)
 *   - apply  → decreases APBill.balanceAmount + bumps appliedAmount
 *   - refund → terminal REFUNDED with reverse JE
 */

import { Test, TestingModule } from '@nestjs/testing';
import { VendorAdvancesService } from './vendor-advances.service';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from '../accounting/journal.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { NumberingService } from '../numbering/numbering.service';
import { AuditService } from '../audit/audit.service';

const ACCT_CASH  = 'acct-cash';
const ACCT_ASSET = 'acct-1063-asset';

interface CapturedJE { lines: Array<{ accountId: string; debit?: number; credit?: number }>; description: string }

function buildPrismaMock() {
  const advanceStore: Record<string, any> = {};
  const billStore: Record<string, any> = {
    'bill-1': {
      id: 'bill-1', tenantId: 'tenant-1', vendorId: 'vend-1',
      billNumber: 'BILL-001', status: 'OPEN',
      totalAmount: 1000, whtAmount: 0, paidAmount: 0, balanceAmount: 1000,
    },
  };
  const applicationStore: Array<any> = [];

  return {
    advanceStore, billStore, applicationStore,

    vendor: {
      findFirst: jest.fn().mockResolvedValue({ id: 'vend-1', name: 'VendorCo' }),
    },
    account: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => {
        if (where.code === '1063') return Promise.resolve({ id: ACCT_ASSET });
        if (where.type === 'ASSET' && where.name) return Promise.resolve({ id: ACCT_CASH });
        return Promise.resolve(null);
      }),
    },
    vendorAdvance: {
      findFirst: jest.fn().mockImplementation(({ where, include }: any) => {
        const adv = advanceStore[where.id];
        if (!adv) return Promise.resolve(null);
        const withRels = { ...adv };
        if (include?.vendor)       withRels.vendor       = { id: 'vend-1', name: 'VendorCo' };
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
    vendorAdvanceApplication: {
      create: jest.fn().mockImplementation(({ data }: any) => {
        applicationStore.push({ ...data, appliedAmount: Number(data.appliedAmount) });
        return Promise.resolve(data);
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    aPBill: {
      findFirst: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(billStore[where.id] ?? null)),
      findUnique: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(billStore[where.id] ?? null)),
      update: jest.fn().mockImplementation(({ where, data }: any) => {
        const b = billStore[where.id];
        if (data.paidAmount    !== undefined) b.paidAmount    = Number(data.paidAmount);
        if (data.balanceAmount !== undefined) b.balanceAmount = Number(data.balanceAmount);
        if (data.status        !== undefined) b.status        = data.status;
        return Promise.resolve(b);
      }),
    },
  };
}

async function makeService() {
  const prismaMock: any = buildPrismaMock();
  prismaMock.$transaction = jest.fn().mockImplementation(async (cb: any) => cb(prismaMock));

  const captured: CapturedJE[] = [];
  const journalMock = {
    create: jest.fn().mockImplementation((_tid: string, dto: any) => {
      captured.push({ lines: dto.lines, description: dto.description });
      return Promise.resolve({ id: `je-${captured.length}`, entryNumber: `JE-${captured.length}` });
    }),
    reverse: jest.fn().mockResolvedValue({ id: 'je-rev', entryNumber: 'JE-REV' }),
  };
  const periodsMock   = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
  const numberingMock = { next: jest.fn().mockResolvedValue('VA-2026-0001') };
  const auditMock     = { log: jest.fn().mockResolvedValue(undefined) };

  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      VendorAdvancesService,
      { provide: PrismaService,            useValue: prismaMock    },
      { provide: JournalService,           useValue: journalMock   },
      { provide: AccountingPeriodsService, useValue: periodsMock   },
      { provide: NumberingService,         useValue: numberingMock },
      { provide: AuditService,             useValue: auditMock     },
    ],
  }).compile();

  return {
    svc:      moduleRef.get(VendorAdvancesService),
    prisma:   prismaMock,
    journal:  journalMock,
    captured,
  };
}

describe('VendorAdvancesService — happy path', () => {
  it('create → post → apply: emits asset JE and decreases bill balance', async () => {
    const { svc, prisma, captured } = await makeService();

    const draft = await svc.create('tenant-1', 'user-1', {
      vendorId:    'vend-1',
      advanceDate: '2026-05-12',
      method:      'CASH',
      totalAmount: 500,
    } as any);
    expect(draft.status).toBe('DRAFT');

    await svc.post('tenant-1', draft.id, 'user-1');
    expect(captured).toHaveLength(1);
    const [je] = captured;
    expect(je.lines).toEqual([
      expect.objectContaining({ accountId: ACCT_ASSET, debit:  500 }),
      expect.objectContaining({ accountId: ACCT_CASH,  credit: 500 }),
    ]);

    const applied = await svc.apply('tenant-1', draft.id, 'user-1', {
      billId: 'bill-1',
      amount: 300,
    } as any);
    expect(Number(applied.appliedAmount)).toBe(300);
    expect(Number(applied.unappliedAmount)).toBe(200);

    const bill = prisma.billStore['bill-1'];
    expect(bill.paidAmount).toBe(300);
    expect(bill.balanceAmount).toBe(700);
    expect(bill.status).toBe('PARTIALLY_PAID');
  });

  it('refund: marks REFUNDED and posts reverse JE for unapplied amount', async () => {
    const { svc, captured } = await makeService();

    const draft = await svc.create('tenant-1', 'user-1', {
      vendorId:    'vend-1',
      advanceDate: '2026-05-12',
      method:      'CASH',
      totalAmount: 500,
    } as any);
    await svc.post('tenant-1', draft.id, 'user-1');
    await svc.refund('tenant-1', draft.id, 'user-1', { method: 'CASH' } as any);

    expect(captured).toHaveLength(2);
    const refundJE = captured[1];
    expect(refundJE.lines).toEqual([
      expect.objectContaining({ accountId: ACCT_CASH,  debit:  500 }),
      expect.objectContaining({ accountId: ACCT_ASSET, credit: 500 }),
    ]);
  });
});
