import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  formatTagNumber, isTagNumber, partKind, readDetails, tagLineNote, tagNumberFromNote, tagState, whyNotSellable, writeDetails,
} from './tag-rules';
import { planTagSale, claimTags, releaseTag } from '../orders/tag-sale';
import { TagsService } from './tags.service';

/**
 * Clerque Inventory, Phase 1: a one-of-a-kind part carries a printed 6-digit
 * label number, and sells once, by that number, at its own cost. The shop this
 * is for loses parts to staff who sell them off the books; every rule below is
 * one way that stops or shows up.
 */

describe('tag rules', () => {
  it('a label number is exactly six digits, never a retail barcode', () => {
    expect(isTagNumber('000457')).toBe(true);
    expect(isTagNumber('4801234567893')).toBe(false); // EAN-13
    expect(isTagNumber('12345')).toBe(false);
    expect(formatTagNumber(457)).toBe('000457');
  });

  it('the SKU prefix says which parts the law watches', () => {
    expect(partKind('ENG-2NZ')).toBe('ENGINE');
    expect(partKind('hc-vios')).toBe('HALF_CUT');
    expect(partKind('FRM-1')).toBe('FRAME_PIECE');
    expect(partKind('HL-VIOS')).toBe('PART');
    expect(partKind(null)).toBe('PART');
  });

  it('keeps the engine and chassis numbers, and reads a rental shop\'s plain notes as notes', () => {
    const d = readDetails(writeDetails({ engineNumber: ' 2NZ-1234567 ', notes: 'tested, sure start' }));
    expect(d).toEqual({ engineNumber: '2NZ-1234567', chassisNumber: null, notes: 'tested, sure start' });
    expect(readDetails('scratch on the left armrest')).toEqual({ notes: 'scratch on the left armrest' });
  });

  it('the receipt line carries the tag and its stamped number, and a void can read the tag back', () => {
    const note = tagLineNote('000457', { engineNumber: '2NZ-1234567' });
    expect(note).toBe('Tag 000457 · Engine No. 2NZ-1234567');
    expect(tagNumberFromNote(note)).toBe('000457');
    expect(tagNumberFromNote('extra hot')).toBeNull();
  });

  it('a tag waits for its cost, and is sold only when costed, photographed and at this branch', () => {
    expect(tagState('IN_STOCK', null)).toBe('WAITING_FOR_COST');
    const ok = { status: 'IN_STOCK', acquiredCost: 1800, branchId: 'b1', photoCount: 1 };
    expect(whyNotSellable(ok, 'b1')).toBeNull();
    expect(whyNotSellable({ ...ok, acquiredCost: null }, 'b1')).toMatch(/cost/);
    expect(whyNotSellable({ ...ok, photoCount: 0 }, 'b1')).toMatch(/photo/);
    expect(whyNotSellable({ ...ok, status: 'SOLD' }, 'b1')).toMatch(/already sold/);
    expect(whyNotSellable(ok, 'b2')).toMatch(/another branch/);
  });
});

// ── selling ────────────────────────────────────────────────────────────────

function sale(over: any = {}) {
  return {
    clientUuid: 'c1', branchId: 'b1', items: [], payments: [{ method: 'CASH', amount: 3500 }], discounts: [],
    subtotal: 3500, discountAmount: 0, vatAmount: 0, totalAmount: 3500, isPwdScDiscount: false, createdAt: new Date().toISOString(),
    ...over,
  } as any;
}
const tagLine = (over: any = {}) => ({ productId: 'p-lamp', productName: 'Headlamp LH Vios', unitPrice: 3500, quantity: 1, discountAmount: 0, vatAmount: 0, lineTotal: 3500, isVatable: false, serializedUnitId: 't1', ...over });

function db(opts: { tags?: any[]; photos?: Record<string, number>; taggedProducts?: string[]; businessType?: string } = {}) {
  const tags = opts.tags ?? [{ id: 't1', serialNumber: '000457', productId: 'p-lamp', branchId: 'b1', status: 'IN_STOCK', acquiredCost: 1800, conditionNotes: null, product: { sku: 'HL-VIOS' } }];
  return {
    serializedUnit: {
      findMany: jest.fn(async () => tags),
      groupBy: jest.fn(async ({ where }: any) => (opts.taggedProducts ?? []).filter((p) => where.productId.in.includes(p)).map((productId) => ({ productId }))),
    },
    document: { groupBy: jest.fn(async () => Object.entries(opts.photos ?? { t1: 1 }).map(([entityId, n]) => ({ entityId, _count: { _all: n } }))) },
    tenant: { findUnique: jest.fn(async () => ({ businessType: opts.businessType ?? 'RETAIL' })) },
  } as any;
}

describe('selling a tagged part', () => {
  it('a costed, photographed tag sells, with its own cost and its number on the line', async () => {
    const plan = await planTagSale(db(), 't', sale({ items: [tagLine()] }), true, true);
    expect(plan.byIndex.get(0)).toMatchObject({ id: 't1', number: '000457', cost: 1800, note: 'Tag 000457' });
    expect(plan.costByNumber.get('000457')).toBe(1800);
  });

  it('a part still waiting for the owner\'s cost, or with no photo, is refused at the till', async () => {
    const waiting = db({ tags: [{ id: 't1', serialNumber: '000457', productId: 'p-lamp', branchId: 'b1', status: 'IN_STOCK', acquiredCost: null, conditionNotes: null, product: { sku: 'X' } }] });
    await expect(planTagSale(waiting, 't', sale({ items: [tagLine()] }), true, true)).rejects.toThrow(/cost yet/);
    await expect(planTagSale(db({ photos: {} }), 't', sale({ items: [tagLine()] }), true, true)).rejects.toThrow(/no photo/);
  });

  it('the part rung as a plain line, to hide which piece left, is refused', async () => {
    const plain = sale({ items: [{ ...tagLine(), serializedUnitId: undefined }] });
    await expect(planTagSale(db({ taggedProducts: ['p-lamp'] }), 't', plain, true, true)).rejects.toThrow(/by its tag/);
  });

  it('...but not at a medical-equipment shop, whose rentals share the units table', async () => {
    const plain = sale({ items: [{ ...tagLine(), serializedUnitId: undefined }] });
    await expect(planTagSale(db({ taggedProducts: ['p-lamp'], businessType: 'MEDICAL_EQUIPMENT' }), 't', plain, true, true)).resolves.toBeDefined();
  });

  it('one piece is quantity one', async () => {
    await expect(planTagSale(db(), 't', sale({ items: [tagLine({ quantity: 2 })] }), true, true)).rejects.toThrow(/quantity must be 1/);
  });

  it('an engine needs a named buyer (RA 10883 stock record)', async () => {
    const engine = db({ tags: [{ id: 't1', serialNumber: '000457', productId: 'p-lamp', branchId: 'b1', status: 'IN_STOCK', acquiredCost: 45000, conditionNotes: null, product: { sku: 'ENG-2NZ' } }] });
    await expect(planTagSale(engine, 't', sale({ items: [tagLine()] }), true, true)).rejects.toThrow(/buyer's name and address/);
    await expect(planTagSale(engine, 't', sale({ items: [tagLine()], customerName: 'Juan Cruz', customerAddress: 'Banawe St, QC' }), true, true)).resolves.toBeDefined();
  });

  it('tagged money goes to the shop: no personal wallet, and a reference on every e-wallet', async () => {
    await expect(planTagSale(db(), 't', sale({ items: [tagLine()], payments: [{ method: 'GCASH_PERSONAL', amount: 3500, reference: 'x' }] }), true, true)).rejects.toThrow(/business GCash/);
    await expect(planTagSale(db(), 't', sale({ items: [tagLine()], payments: [{ method: 'GCASH_BUSINESS', amount: 3500 }] }), true, true)).rejects.toThrow(/reference number/);
  });

  it('a sale rung offline is never refused when it syncs, even if the tag is no longer for sale', async () => {
    const sold = db({ tags: [{ id: 't1', serialNumber: '000457', productId: 'p-lamp', branchId: 'b1', status: 'SOLD', acquiredCost: 1800, conditionNotes: null, product: { sku: 'X' } }] });
    await expect(planTagSale(sold, 't', sale({ items: [tagLine()] }), false, true)).resolves.toBeDefined();
  });

  it('a shop that never tags is untouched: no tag lines, no refusals', async () => {
    const plan = await planTagSale(db({ tags: [] }), 't', sale({ items: [{ ...tagLine(), serializedUnitId: undefined }] }), true, false);
    expect(plan.byIndex.size).toBe(0);
  });
});

describe('two phones, one part', () => {
  const plan = { byIndex: new Map([[0, { id: 't1', number: '000457', productId: 'p', cost: 1800, note: 'Tag 000457' }]]), costByNumber: new Map() };

  it('the first sale takes the tag; a second live sale of it fails and saves nothing', async () => {
    const tx: any = { serializedUnit: { updateMany: jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 }) } };
    await expect(claimTags(tx, 't', 'o1', plan as any, true)).resolves.toEqual([]);
    await expect(claimTags(tx, 't', 'o2', plan as any, true)).rejects.toThrow(ConflictException);
    expect(tx.serializedUnit.updateMany).toHaveBeenCalledWith({
      where: { id: 't1', tenantId: 't', status: 'IN_STOCK', acquiredCost: { not: null } },
      data: { status: 'SOLD', soldOrderId: 'o1' },
    });
  });

  it('an offline sale that clashes is kept and reported', async () => {
    const tx: any = { serializedUnit: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
    await expect(claimTags(tx, 't', 'o2', plan as any, false)).resolves.toEqual(['000457']);
  });

  it('a void puts the part back on the shelf; a refund without the part writes it off', async () => {
    const tx: any = { serializedUnit: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
    await releaseTag(tx, 't', 'o1', 'Tag 000457 · Engine No. 2NZ', true);
    expect(tx.serializedUnit.updateMany).toHaveBeenLastCalledWith({
      where: { tenantId: 't', serialNumber: '000457', soldOrderId: 'o1', status: 'SOLD' }, data: { status: 'IN_STOCK', soldOrderId: null },
    });
    await releaseTag(tx, 't', 'o1', 'Tag 000457', false);
    expect(tx.serializedUnit.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: 'RETIRED' } }));
    expect(await releaseTag(tx, 't', 'o1', null, true)).toBeNull();
  });
});

// ── the tag service ────────────────────────────────────────────────────────

function service(over: any = {}) {
  const prisma: any = {
    auditLog: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    serializedUnit: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    product: { findFirst: jest.fn() },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'b1' }) },
    document: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: false }) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    inventoryItem: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    inventoryLog: { create: jest.fn() },
    accountingEvent: { create: jest.fn() },
    $executeRaw: jest.fn(),
    ...over,
  };
  prisma.$transaction = jest.fn(async (fn: any) => fn(prisma));
  const audit = { log: jest.fn() };
  const documents = { uploadBuffer: jest.fn().mockResolvedValue({ id: 'doc1' }), serve: jest.fn() };
  return { svc: new TagsService(prisma, documents as any, audit as any), prisma, documents };
}

const TAG_ROW = {
  id: 't1', serialNumber: '000457', status: 'IN_STOCK', acquiredCost: null, conditionNotes: null, branchId: 'b1', productId: 'p1',
  soldOrderId: null, createdAt: new Date(), product: { name: 'Headlamp', sku: 'HL', price: 3500 },
};

describe('label runs', () => {
  it('a run starts after the highest number ever printed or used, and is recorded', async () => {
    const { svc, prisma } = service({
      auditLog: { findMany: jest.fn().mockResolvedValue([{ after: { from: '000001', to: '000020' } }]), create: jest.fn() },
      serializedUnit: { findMany: jest.fn().mockResolvedValue([{ serialNumber: '000025' }, { serialNumber: 'WC-SN-99' }]) },
    });
    const run = await svc.reserveLabels('t', 'owner', 3);
    expect(run).toEqual({ from: '000026', to: '000028', numbers: ['000026', '000027', '000028'] });
    expect(prisma.$executeRaw).toHaveBeenCalled(); // one run at a time per shop
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ entityType: 'TAG_LABEL_RUN', after: { from: '000026', to: '000028', count: 3 } }) });
  });

  it('refuses silly run sizes', async () => {
    const { svc } = service();
    await expect(svc.reserveLabels('t', 'o', 0)).rejects.toThrow(BadRequestException);
    await expect(svc.reserveLabels('t', 'o', 501)).rejects.toThrow(BadRequestException);
  });
});

describe('tagging a part', () => {
  const printed = { auditLog: { findMany: jest.fn().mockResolvedValue([{ after: { from: '000001', to: '000500' } }]), create: jest.fn() } };

  it('only with a number from a printed run', async () => {
    const { svc } = service({ product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', sku: 'HL', name: 'Headlamp' }) } });
    await expect(svc.createTag('t', 'u', { number: '000457', productId: 'p1', branchId: 'b1' })).rejects.toThrow(/never printed/);
  });

  it('an engine needs its stamped engine number', async () => {
    const { svc } = service({ ...printed, product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', sku: 'ENG-2NZ', name: 'Engine 2NZ' }) } });
    await expect(svc.createTag('t', 'u', { number: '000457', productId: 'p1', branchId: 'b1' })).rejects.toThrow(/engine number/);
  });

  it('a label already on another part is refused', async () => {
    const { Prisma } = jest.requireActual('@prisma/client');
    const dup = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' });
    const { svc } = service({
      ...printed,
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', sku: 'HL', name: 'Headlamp' }) },
      serializedUnit: { findMany: jest.fn(), create: jest.fn().mockRejectedValue(dup) },
    });
    await expect(svc.createTag('t', 'u', { number: '000457', productId: 'p1', branchId: 'b1' })).rejects.toThrow(/already on another part/);
  });

  it('a new tag waits for the owner\'s cost', async () => {
    const { svc } = service({
      ...printed,
      product: { findFirst: jest.fn().mockResolvedValue({ id: 'p1', sku: 'HL', name: 'Headlamp' }) },
      serializedUnit: { findMany: jest.fn(), create: jest.fn().mockResolvedValue(TAG_ROW) },
    });
    const tag = await svc.createTag('t', 'u', { number: '000457', productId: 'p1', branchId: 'b1' });
    expect(tag).toMatchObject({ number: '000457', status: 'WAITING_FOR_COST', sellable: false });
  });

  it('once costed, only the owner may add photos', async () => {
    const { svc } = service({ serializedUnit: { findFirst: jest.fn().mockResolvedValue({ id: 't1', acquiredCost: 1800, serialNumber: '000457' }) } });
    const file = { buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'p.jpg' };
    await expect(svc.addPhoto('t', 'u', 'CASHIER', 't1', file)).rejects.toThrow(ForbiddenException);
    await expect(svc.addPhoto('t', 'u', 'BUSINESS_OWNER', 't1', file)).resolves.toEqual({ id: 'doc1', url: '/tags/photos/doc1' });
  });
});

describe('costing a tag', () => {
  it('is refused before anyone has photographed the part', async () => {
    const { svc } = service({ serializedUnit: { findFirst: jest.fn().mockResolvedValue(TAG_ROW) }, document: { count: jest.fn().mockResolvedValue(0) } });
    await expect(svc.costTag('t', 'owner', 't1', 1800, 'OWNER_FUNDED')).rejects.toThrow(/no photo/);
  });

  it('puts one piece in stock at its own cost, and into the books paid from where the owner says', async () => {
    const costed = { ...TAG_ROW, acquiredCost: 1800 };
    const { svc, prisma } = service({
      serializedUnit: { findFirst: jest.fn().mockResolvedValueOnce(TAG_ROW).mockResolvedValueOnce(costed), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      inventoryItem: { findUnique: jest.fn().mockResolvedValue({ quantity: 2, avgCost: 1500 }), upsert: jest.fn() },
    });
    const tag = await svc.costTag('t', 'owner', 't1', 1800, 'BANK');
    expect(tag).toMatchObject({ status: 'IN_STOCK', cost: 1800 });
    expect(prisma.inventoryItem.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ quantity: expect.anything() }),
    }));
    const upd = prisma.inventoryItem.upsert.mock.calls[0][0].update;
    expect(Number(upd.quantity)).toBe(3);
    expect(Number(upd.avgCost)).toBe(1600); // (2 x 1500 + 1800) / 3
    expect(prisma.accountingEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      type: 'INVENTORY_ADJUSTMENT', payload: expect.objectContaining({ adjustmentType: 'STOCK_IN', totalValue: 1800, paymentMethod: 'BANK' }),
    }) });
  });

  it('a tag is costed once', async () => {
    const { svc } = service({ serializedUnit: { findFirst: jest.fn().mockResolvedValue({ ...TAG_ROW, acquiredCost: 1800 }) } });
    await expect(svc.costTag('t', 'owner', 't1', 1800, 'BANK')).rejects.toThrow(ConflictException);
  });
});

describe('looking up a code', () => {
  it('a 6-digit number is a tag; staff do not see its cost when the shop hides costs', async () => {
    const { svc } = service({ serializedUnit: { findFirst: jest.fn().mockResolvedValue({ ...TAG_ROW, acquiredCost: 1800 }) } });
    const r: any = await svc.lookup('t', 'CASHIER', '000457', 'b1');
    expect(r.kind).toBe('TAG');
    expect(r.tag.cost).toBeUndefined();
    const owner: any = await svc.lookup('t', 'BUSINESS_OWNER', '000457', 'b1');
    expect(owner.tag.cost).toBe(1800);
  });

  it('anything else is a product barcode or SKU, or nothing', async () => {
    const { svc } = service({
      serializedUnit: { findFirst: jest.fn().mockResolvedValue(null) },
      product: { findFirst: jest.fn().mockResolvedValueOnce({ id: 'p9', name: 'Bottled water', sku: 'W1', barcode: '4801234567893', price: 25 }).mockResolvedValueOnce(null) },
    });
    expect(await svc.lookup('t', 'CASHIER', '4801234567893')).toEqual({ kind: 'PRODUCT', product: { id: 'p9', name: 'Bottled water', sku: 'W1', barcode: '4801234567893', price: 25 } });
    expect(await svc.lookup('t', 'CASHIER', 'nope')).toEqual({ kind: 'NONE' });
  });
});
