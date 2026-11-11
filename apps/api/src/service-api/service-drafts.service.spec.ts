import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ServiceDraftsService, ServiceCaller } from './service-drafts.service';

/**
 * Drafts an API key may open. What these pin: a draft is made once per
 * reference; only from the key's own tenant's branch, items and accounts;
 * a journal draft must balance; a count's proposed figure is never its
 * counted figure; a receiving draft moves nothing; and every draft is the
 * key's in the audit trail, never a person's.
 */

const T = 't1';
const B = 'b1';
const caller: ServiceCaller = { tenantId: T, keyId: 'key1', label: 'AIBA inventory' };
const D = (n: number | string) => new Prisma.Decimal(n);

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}

function build(opts: {
  branches?: Record<string, string>;            // id -> tenant
  materials?: Array<{ id: string; tenantId: string; name: string; unit?: string; prep?: boolean }>;
  accounts?: Array<{ id: string; code: string; name: string; isActive?: boolean; postingControl?: string }>;
  openRequest?: any;
  onHand?: Record<string, number>;
  vendors?: any[];
  bills?: any[];
  lots?: any[];
  receivingDrafts?: any[];
  po?: any;
} = {}) {
  const drafts = new Map<string, any>();      // reference -> service_drafts row
  const audit: any[] = [];
  const branches = opts.branches ?? { [B]: T };
  const materials = opts.materials ?? [
    { id: 'rm_1', tenantId: T, name: 'Fresh milk', unit: 'L' },
    { id: 'rm_2', tenantId: T, name: 'Beans', unit: 'g' },
  ];
  const writes: string[] = [];
  const tx: any = {
    rawMaterialInventory: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(
        Object.entries(opts.onHand ?? {}).filter(([id]) => where.rawMaterialId.in.includes(id)).map(([id, q]) => ({ rawMaterialId: id, quantity: D(q) })),
      )),
    },
    orderItem: { findMany: jest.fn().mockResolvedValue([]) },
    cycleCount: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'cc_new', countNumber: data.countNumber, status: data.status })),
    },
  };
  const prisma: any = {
    serviceDraft: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(drafts.get(where.tenantId_reference.reference) ?? null)),
      create: jest.fn(({ data }: any) => {
        if (drafts.has(data.reference)) return Promise.reject(p2002());
        const row = { id: `sd_${drafts.size + 1}`, targetId: null, createdAt: new Date(), ...data };
        drafts.set(data.reference, row);
        return Promise.resolve({ id: row.id });
      }),
      update: jest.fn(({ where, data }: any) => {
        for (const r of drafts.values()) if (r.id === where.id) Object.assign(r, data);
        return Promise.resolve({});
      }),
      delete: jest.fn(({ where }: any) => {
        for (const [k, r] of drafts) if (r.id === where.id) drafts.delete(k);
        return Promise.resolve({});
      }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    branch: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(branches[where.id] === where.tenantId ? { id: where.id } : null)),
    },
    rawMaterial: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(
        materials.filter((m) => m.tenantId === where.tenantId && where.id.in.includes(m.id))
          .map((m) => ({ id: m.id, name: m.name, unit: m.unit ?? 'g', subRecipeItems: m.prep ? [{ id: 's' }] : [] })),
      )),
    },
    account: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(
        (opts.accounts ?? []).filter((a) => where.code.in.includes(a.code))
          .map((a) => ({ isActive: true, postingControl: 'OPEN', ...a })),
      )),
    },
    purchaseRequest: {
      findFirst: jest.fn().mockResolvedValue(opts.openRequest ?? null),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'pr_new', requestNumber: data.requestNumber, status: 'OPEN', notes: null, lines: [] })),
      update: jest.fn().mockResolvedValue({}),
    },
    purchaseRequestLine: { create: jest.fn().mockResolvedValue({}) },
    cycleCount: { findFirst: jest.fn().mockResolvedValue({ status: 'OPEN' }) },
    journalEntry: { findFirst: jest.fn().mockResolvedValue({ status: 'DRAFT' }) },
    vendor: {
      findMany: jest.fn().mockResolvedValue((opts.vendors ?? []).filter((v) => v.tin)),
      findFirst: jest.fn(({ where }: any) => Promise.resolve(
        (opts.vendors ?? []).find((v) => v.name.toLowerCase() === where.name.equals.toLowerCase()) ?? null)),
    },
    aPBill: { findFirst: jest.fn(({ where }: any) => Promise.resolve(
      (opts.bills ?? []).find((b) => b.vendorId === where.vendorId && b.vendorBillRef === where.vendorBillRef) ?? null)) },
    rawMaterialLot: { findFirst: jest.fn(({ where }: any) => Promise.resolve(
      (opts.lots ?? []).find((l) => l.referenceNumber === where.referenceNumber && where.rawMaterialId.in.includes(l.rawMaterialId)) ?? null)) },
    receivingDraft: {
      findMany: jest.fn().mockResolvedValue(opts.receivingDrafts ?? []),
      findFirst: jest.fn().mockResolvedValue({ status: 'DRAFT' }),
      create: jest.fn(({ data }: any) => Promise.resolve({ id: 'rd_new', status: data.status })),
    },
    purchaseOrder: { findFirst: jest.fn().mockResolvedValue(opts.po ?? null) },
    $transaction: jest.fn((fn: any) => fn(tx)),
  };
  // Anything that would move stock, cost or the books: none of these exist on the
  // fake, so touching one fails the test.
  for (const m of ['rawMaterialInventory', 'aPBill', 'accountingEvent', 'rawMaterialLot']) {
    const model = prisma[m] ?? (prisma[m] = {});
    for (const op of ['create', 'update', 'upsert', 'createMany', 'updateMany']) {
      model[op] = jest.fn(() => { writes.push(`${m}.${op}`); return Promise.resolve({}); });
    }
  }
  const warehouse: any = { nextCountNumber: jest.fn().mockResolvedValue('CC-2026-000007') };
  const procure: any = {
    nextRequestNumber: jest.fn().mockResolvedValue('REQ-20261130-001'),
    nextLineNumber: jest.fn((num: string, lines: any[]) => `${num}-${String(lines.length + 1).padStart(2, '0')}`),
  };
  const journal: any = {
    create: jest.fn((_t: string, dto: any, by: string, source: string) =>
      Promise.resolve({ id: 'je_new', entryNumber: 'JE-0001', status: dto.saveDraft ? 'DRAFT' : 'POSTED', createdBy: by, source })),
  };
  const auditSvc: any = { log: jest.fn((e: any) => { audit.push(e); return Promise.resolve(); }) };
  const svc = new ServiceDraftsService(prisma, warehouse, procure, journal, auditSvc);
  return { svc, prisma, tx, drafts, audit, journal, writes, procure };
}

/* ── Count ──────────────────────────────────────────────────────────────── */

describe('draft count', () => {
  const body = {
    branchId: B, reason: 'Weekly count plan', reference: 'AIBA-IN-2026-11-30-01',
    lines: [
      { itemId: 'rm_1', kind: 'raw', proposedQty: '7.5000', why: 'Variance -0.5 L over 3 days' },
      { itemId: 'rm_2', kind: 'raw' },
    ],
  };

  it('opens an OPEN count with only those lines, counted figure = expected, the proposal only in the note', async () => {
    const { svc, tx } = build({ onHand: { rm_1: 8, rm_2: 1200 } });
    const r = await svc.draftCount(caller, body);
    expect(r).toMatchObject({ id: 'cc_new', status: 'OPEN', reference: body.reference, number: 'CC-2026-000007' });
    const data = tx.cycleCount.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ tenantId: T, branchId: B, status: 'OPEN', startedById: 'apikey:key1' });
    expect(data.notes).toContain('AIBA inventory');
    const [milk, beans] = data.lines.create;
    expect(milk.expectedQty.toString()).toBe('8');
    expect(milk.countedQty.toString()).toBe('8');                     // NOT 7.5: nothing is posted on AIBA's word
    expect(milk.notes).toBe('AIBA proposes 7.5000: Variance -0.5 L over 3 days');
    expect(beans.notes).toBe('Please count');
  });

  it('the same reference twice answers with the first count, no second one', async () => {
    const { svc, tx, prisma } = build();
    const first = await svc.draftCount(caller, body);
    prisma.cycleCount.findFirst.mockResolvedValue({ status: 'OPEN' });
    const second = await svc.draftCount(caller, body);
    expect(second).toMatchObject({ id: first.id, status: 'OPEN', reference: body.reference, replayed: true });
    expect(tx.cycleCount.create).toHaveBeenCalledTimes(1);
  });

  it('two retries racing: the loser reads the winner, the database key decides', async () => {
    const { svc, drafts } = build();
    drafts.set(body.reference, { id: 'sd_x', kind: 'COUNT', targetId: 'cc_old', createdAt: new Date(), reference: body.reference });
    const r = await svc.draftCount(caller, body);
    expect(r).toMatchObject({ id: 'cc_old', replayed: true });
  });

  it('a reference used for another kind of draft is a conflict', async () => {
    const { svc, drafts } = build();
    drafts.set(body.reference, { id: 'sd_x', kind: 'JOURNAL', targetId: 'je1', createdAt: new Date() });
    await expect(svc.draftCount(caller, body)).rejects.toThrow(ConflictException);
  });

  it("refuses another tenant's branch, and frees the reference for a corrected retry", async () => {
    const { svc, drafts, tx } = build({ branches: { [B]: 'other-tenant' } });
    await expect(svc.draftCount(caller, body)).rejects.toThrow(NotFoundException);
    expect(tx.cycleCount.create).not.toHaveBeenCalled();
    expect(drafts.size).toBe(0);
  });

  it("refuses another tenant's item", async () => {
    const { svc } = build({ materials: [{ id: 'rm_1', tenantId: T, name: 'Milk' }, { id: 'rm_2', tenantId: 'other', name: 'Beans' }] });
    await expect(svc.draftCount(caller, body)).rejects.toThrow('Item(s) not found: rm_2.');
  });

  it('refuses finished goods and duplicate lines', async () => {
    const { svc } = build();
    await expect(svc.draftCount(caller, { ...body, lines: [{ itemId: 'p1', kind: 'product' }] })).rejects.toThrow(BadRequestException);
    await expect(svc.draftCount(caller, { ...body, lines: [{ itemId: 'rm_1' }, { itemId: 'rm_1' }] })).rejects.toThrow(/more than one line/);
  });

  it('is in the audit trail as the key, by label, never as a person', async () => {
    const { svc, audit } = build();
    await svc.draftCount(caller, body);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      tenantId: T, action: 'SERVICE_DRAFT_CREATED', entityType: 'CycleCount', entityId: 'cc_new', performedBy: 'apikey:key1',
      after: expect.objectContaining({ apiKeyLabel: 'AIBA inventory', reference: body.reference }),
    });
  });
});

/* ── Purchase request ──────────────────────────────────────────────────── */

describe('draft purchase request', () => {
  const body = {
    branchId: B, note: 'Reorder from usage and lead time', reference: 'AIBA-IN-2026-11-30-02',
    lines: [
      { itemId: 'rm_1', kind: 'raw', qty: '24.0000', why: '4 days left' },
      { itemId: 'rm_2', kind: 'raw', qty: '1000' },
    ],
  };

  it("opens the branch's OPEN request when there is none, as the key", async () => {
    const { svc, prisma } = build();
    const r = await svc.draftPurchaseRequest(caller, body);
    expect(r).toMatchObject({ id: 'pr_new', status: 'OPEN', reference: body.reference, added: ['rm_1', 'rm_2'], skipped: [] });
    expect(prisma.purchaseRequest.create.mock.calls[0][0].data).toMatchObject({ tenantId: T, branchId: B, createdById: 'apikey:key1' });
    expect(prisma.purchaseRequestLine.create).toHaveBeenCalledTimes(2);
    expect(prisma.purchaseRequestLine.create.mock.calls[0][0].data.qtyRequested.toString()).toBe('24');
  });

  it("joins the branch's open request and leaves a person's line alone", async () => {
    const { svc, prisma } = build({
      openRequest: { id: 'pr_open', requestNumber: 'REQ-20261130-001', status: 'OPEN', notes: null, lines: [{ rawMaterialId: 'rm_1', lineNumber: 'REQ-20261130-001-01' }] },
    });
    const r = await svc.draftPurchaseRequest(caller, body);
    expect(r).toMatchObject({ id: 'pr_open', added: ['rm_2'], skipped: ['rm_1'] });
    expect(prisma.purchaseRequest.create).not.toHaveBeenCalled();
    expect(prisma.purchaseRequestLine.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a prep (made in the kitchen, not bought)', async () => {
    const { svc } = build({ materials: [{ id: 'rm_1', tenantId: T, name: 'Caramel sauce', prep: true }, { id: 'rm_2', tenantId: T, name: 'Beans' }] });
    await expect(svc.draftPurchaseRequest(caller, body)).rejects.toThrow(/made in the kitchen/);
  });

  it('refuses a quantity of zero', async () => {
    const { svc } = build();
    await expect(svc.draftPurchaseRequest(caller, { ...body, lines: [{ itemId: 'rm_1', qty: '0' }] })).rejects.toThrow(BadRequestException);
  });
});

/* ── Journal ───────────────────────────────────────────────────────────── */

describe('draft journal', () => {
  const accounts = [
    { id: 'a6100', code: '6100', name: 'Salaries and wages' },
    { id: 'a2101', code: '2101', name: 'SSS payable' },
    { id: 'a1010', code: '1010', name: 'Cash on hand' },
    { id: 'a2010', code: '2010', name: 'Accounts payable', postingControl: 'AP_ONLY' },
  ];
  const body = {
    date: '2026-11-30', memo: 'Payroll 2026-11-16 to 2026-11-30', reference: 'AIBA-PY-2026-11-30',
    lines: [
      { account: '6100', debit: '52310.00', credit: '0.00', memo: 'Salaries and wages' },
      { account: '2101', debit: '0.00', credit: '2150.00', memo: 'SSS payable' },
      { account: '1010', debit: '0.00', credit: '50160.00' },
    ],
  };

  it('creates a DRAFT, source AIBA, created by the key, through the journal service', async () => {
    const { svc, journal } = build({ accounts });
    const r = await svc.draftJournal(caller, body);
    expect(r).toMatchObject({ id: 'je_new', status: 'DRAFT', reference: body.reference });
    const [tenant, dto, by, source] = journal.create.mock.calls[0];
    expect(tenant).toBe(T);
    expect(by).toBe('apikey:key1');
    expect(source).toBe('AIBA');
    expect(dto).toMatchObject({ saveDraft: true, date: '2026-11-30', reference: body.reference, description: body.memo });
    expect(dto.lines).toEqual([
      { accountId: 'a6100', debit: 52310, credit: 0, description: 'Salaries and wages' },
      { accountId: 'a2101', debit: 0, credit: 2150, description: 'SSS payable' },
      { accountId: 'a1010', debit: 0, credit: 50160, description: undefined },
    ]);
  });

  it('refuses an entry out of balance by a centavo', async () => {
    const { svc, journal } = build({ accounts });
    const off = { ...body, lines: [...body.lines.slice(0, 2), { account: '1010', debit: '0', credit: '50159.99' }] };
    await expect(svc.draftJournal(caller, off)).rejects.toThrow('Out of balance: debits 52310.00, credits 52309.99.');
    expect(journal.create).not.toHaveBeenCalled();
  });

  it("refuses an account code the tenant does not have (another tenant's chart is not looked at)", async () => {
    const { svc, prisma } = build({ accounts });
    const bad = { ...body, lines: [body.lines[0], { account: '9999', debit: '0', credit: '52310.00' }] };
    await expect(svc.draftJournal(caller, bad)).rejects.toThrow('Unknown account code(s): 9999.');
    expect(prisma.account.findMany.mock.calls[0][0].where.tenantId).toBe(T);
  });

  it('refuses an account only a sub-ledger may post to', async () => {
    const { svc } = build({ accounts });
    const bad = { ...body, lines: [body.lines[0], { account: '2010', debit: '0', credit: '52310.00' }] };
    await expect(svc.draftJournal(caller, bad)).rejects.toThrow(/Only Clerque's own modules post to 2010/);
  });

  it('refuses a line with both a debit and a credit, or more than 2 decimals', async () => {
    const { svc } = build({ accounts });
    await expect(svc.draftJournal(caller, { ...body, lines: [{ account: '6100', debit: '1', credit: '1' }, body.lines[1]] })).rejects.toThrow(BadRequestException);
    await expect(svc.draftJournal(caller, { ...body, lines: [{ account: '6100', debit: '1.005' }, { account: '1010', credit: '1.005' }] })).rejects.toThrow(/more than 2 decimals/);
  });

  it('the same reference twice gives the first draft back, as it is now', async () => {
    const { svc, journal, prisma } = build({ accounts });
    await svc.draftJournal(caller, body);
    prisma.journalEntry.findFirst.mockResolvedValue({ status: 'POSTED' });
    const again = await svc.draftJournal(caller, body);
    expect(again).toMatchObject({ id: 'je_new', status: 'POSTED', replayed: true });
    expect(journal.create).toHaveBeenCalledTimes(1);
  });
});

/* ── Receiving ─────────────────────────────────────────────────────────── */

describe('draft receiving', () => {
  const body = () => ({
    branchId: B, reference: 'AIBA-AP-2026-11-20-DAIRYCO-1042',
    supplier: { name: 'Dairy Co', tin: '123-456-789-000' },
    invoice: { number: 'SI-1042', date: '2026-11-20', dueDate: '2026-12-20', vatable: true, subtotal: '2053.57', vat: '246.43', total: '2300.00' },
    lines: [{ itemId: 'rm_1', kind: 'raw', qty: '24.0000', uom: 'L', unitCost: '85.5655', lineTotal: '2053.57', printed: 'FRESH MILK 1L x24' }],
    evidence: { file: 'invoice-1042.jpg', sha256: 'a'.repeat(64) },
  });
  const vendor = { id: 'v1', name: 'Dairy Co', tin: '123456789000' };

  it('holds the delivery as a DRAFT and moves nothing: no stock, lot, cost, journal or bill', async () => {
    const { svc, prisma, writes } = build({ vendors: [vendor] });
    const r = await svc.draftReceiving(caller, body());
    expect(r).toMatchObject({ id: 'rd_new', status: 'DRAFT', reference: body().reference, supplierMatched: true });
    const data = prisma.receivingDraft.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      tenantId: T, branchId: B, status: 'DRAFT', vendorId: 'v1', invoiceNumber: 'SI-1042', vatable: true,
      createdByApiKeyId: 'key1', evidenceFile: 'invoice-1042.jpg',
    });
    expect(data.lines[0]).toMatchObject({ itemId: 'rm_1', qty: '24.0000', unitCost: '85.5655', lineTotal: '2053.57' });
    expect(writes).toEqual([]);
  });

  it("refuses the same supplier's invoice number already received (its AP bill)", async () => {
    const { svc } = build({ vendors: [vendor], bills: [{ vendorId: 'v1', vendorBillRef: 'SI-1042', billNumber: 'BILL-000031' }] });
    await expect(svc.draftReceiving(caller, body())).rejects.toThrow('Invoice SI-1042 from Dairy Co is already received (bill BILL-000031).');
  });

  it('refuses an invoice already received on the screen under that number', async () => {
    const { svc } = build({ vendors: [vendor], lots: [{ rawMaterialId: 'rm_1', referenceNumber: 'SI-1042' }] });
    await expect(svc.draftReceiving(caller, body())).rejects.toThrow(ConflictException);
  });

  it('refuses a second draft of the same invoice under another reference', async () => {
    const { svc } = build({ receivingDrafts: [{ reference: 'AIBA-OTHER', vendorId: null, supplierName: 'DAIRY CO', supplierTin: null }] });
    await expect(svc.draftReceiving(caller, body())).rejects.toThrow(/already a receiving draft \(reference AIBA-OTHER\)/);
  });

  it('the same invoice number from another supplier is not a duplicate', async () => {
    const { svc } = build({ receivingDrafts: [{ reference: 'X', vendorId: 'v9', supplierName: 'Bakery Inc', supplierTin: '999-888-777-000' }] });
    await expect(svc.draftReceiving(caller, body())).resolves.toMatchObject({ status: 'DRAFT', supplierMatched: false });
  });

  it('refuses figures that do not add up, and a unit other than the item’s own', async () => {
    const { svc } = build();
    const badTotal = body(); badTotal.invoice.total = '2300.01';
    await expect(svc.draftReceiving(caller, badTotal)).rejects.toThrow(/is not the total/);
    const badLine = body(); badLine.lines[0].lineTotal = '2000.00'; badLine.invoice.subtotal = '2000.00'; badLine.invoice.total = '2246.43';
    await expect(svc.draftReceiving(caller, badLine)).rejects.toThrow(/is not the line total/);
    const badUnit = body(); badUnit.lines[0].uom = 'ml';
    await expect(svc.draftReceiving(caller, badUnit)).rejects.toThrow(/kept in L/);
  });

  it("refuses another tenant's branch or item", async () => {
    const other = build({ branches: { [B]: 'other' } });
    await expect(other.svc.draftReceiving(caller, body())).rejects.toThrow(NotFoundException);
    const foreignItem = build({ materials: [{ id: 'rm_1', tenantId: 'other', name: 'Milk', unit: 'L' }] });
    await expect(foreignItem.svc.draftReceiving(caller, body())).rejects.toThrow('Item(s) not found: rm_1.');
  });

  it("refuses a purchase order of another branch, or more than it still expects", async () => {
    const po = { id: 'po_1', branchId: B, vendorId: 'v1', status: 'ORDERED', items: [{ rawMaterialId: 'rm_1', qtyOrdered: D(20), qtyReceived: D(0) }] };
    const { svc } = build({ vendors: [vendor], po });
    await expect(svc.draftReceiving(caller, { ...body(), purchaseOrderId: 'po_1' })).rejects.toThrow(/more than the 20.0000 still to come/);
    const elsewhere = build({ vendors: [vendor], po: { ...po, branchId: 'b2', items: [{ rawMaterialId: 'rm_1', qtyOrdered: D(24), qtyReceived: D(0) }] } });
    await expect(elsewhere.svc.draftReceiving(caller, { ...body(), purchaseOrderId: 'po_1' })).rejects.toThrow(/another branch/);
  });

  it('is idempotent by reference', async () => {
    const { svc, prisma } = build({ vendors: [vendor] });
    await svc.draftReceiving(caller, body());
    const again = await svc.draftReceiving(caller, body());
    expect(again).toMatchObject({ id: 'rd_new', status: 'DRAFT', replayed: true });
    expect(prisma.receivingDraft.create).toHaveBeenCalledTimes(1);
  });
});
