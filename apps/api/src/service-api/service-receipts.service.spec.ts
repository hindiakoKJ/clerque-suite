import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ProcureReceiptsService } from '../procure/procure-receipts.service';
import { aliasKeys } from '../procure/receipt-parser';
import { SanityConfirmRequiredException } from '../common/sanity/sanity.types';
import { ReceiptsCaller, ServiceReceiptsService } from './service-receipts.service';

/**
 * Paid receipts by Telegram: the one place a key posts. What these pin:
 * read writes nothing and gives Clerque's own verdict; mode auto posts only
 * when Clerque's own checks hold against the shop's own memory (and answers
 * NEEDS_A_PERSON, posting nothing, for each one that fails); mode confirmed
 * posts what a person confirmed; one reference posts once; it all happens as
 * the owner who issued the key, and only while they may; another tenant's
 * branch or item is never reached.
 *
 * The memory and the same-receipt check run through the real
 * ProcureReceiptsService on a mocked Prisma; only its reading (the model)
 * and its posting (tested in procure-receipts.spec) are stubbed.
 */

const T = 't1';
const B = 'b1';
const OWNER = 'u_owner';
const caller: ReceiptsCaller = { tenantId: T, keyId: 'key1', label: 'AIBA', defaultBranchId: B };

const MILK_BC = '04806503950622';
const alias = (tenantId: string, rawMaterialId: string, printed: string, barcode: string | null, packSize: number) => {
  const { key, printedKey } = aliasKeys({ description: printed, barcode });
  return { tenantId, key, printedKey, rawMaterialId, packSize: new Prisma.Decimal(packSize), brandNote: null };
};

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });
}

function build(opts: {
  users?: any[];
  keyCreator?: string;
  aliases?: any[];
  /** rawMaterialId -> last purchase prices per unit, newest first */
  history?: Record<string, number[]>;
  /** requests already in the books: { id, tenantId, requestNumber, notes, status } */
  posted?: any[];
  sanityWarns?: boolean;
  aiUsed?: number;
} = {}) {
  const drafts = new Map<string, any>();
  const requests: any[] = [...(opts.posted ?? [])];
  const users = opts.users ?? [{ id: OWNER, tenantId: T, name: 'Kristine', role: 'BUSINESS_OWNER', isActive: true, branchId: null }];
  const materials = [
    { id: 'milk',  tenantId: T,    name: 'Fresh milk', unit: 'ml', category: 'INGREDIENT', costPrice: 0.1, isActive: true },
    { id: 'sugar', tenantId: T,    name: 'Sugar',      unit: 'g',  category: 'INGREDIENT', costPrice: 0.1, isActive: true },
    { id: 'theirs', tenantId: 't2', name: 'Their milk', unit: 'ml', category: 'INGREDIENT', costPrice: 0.1, isActive: true },
  ];
  const aliases = opts.aliases ?? [
    alias(T, 'milk', 'ANGELINA NO SUGAR AD', MILK_BC, 1000),
    alias(T, 'sugar', 'WHITE SUGAR 1KG', null, 1000),
    alias('t2', 'theirs', 'THEIR MILK 1L', '4800000000099', 1000),
  ];
  const history = opts.history ?? { milk: [0.106], sugar: [0.1] };

  const prisma: any = {
    apiKey: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(
        where.id === 'key1' && where.tenantId === T ? { createdById: opts.keyCreator ?? OWNER } : null)),
    },
    user: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(
        users.find((u) => u.id === where.id && u.tenantId === where.tenantId) ?? null)),
    },
    branch: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(
        ({ b1: T, b2: T, other: 't2' } as Record<string, string>)[where.id] === where.tenantId ? { id: where.id } : null)),
    },
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ planCode: 'CLERQUE', aiAddonType: null, aiAddonExpiresAt: null, aiQuotaOverride: 100 }),
    },
    aiUsage: { count: jest.fn().mockResolvedValue(opts.aiUsed ?? 0) },
    receiptAlias: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(aliases.filter((a) =>
        a.tenantId === where.tenantId && (where.OR[0].key.in.includes(a.key) || where.OR[1].printedKey.in.includes(a.printedKey))))),
    },
    rawMaterial: {
      findMany: jest.fn(({ where }: any) => Promise.resolve(materials.filter((m) => m.tenantId === where.tenantId && m.isActive))),
    },
    purchaseRequest: {
      findFirst: jest.fn(({ where }: any) => {
        const mine = requests.filter((r) => r.tenantId === where.tenantId);
        if (where.notes?.startsWith) return Promise.resolve(mine.find((r) => (r.notes ?? '').startsWith(where.notes.startsWith)) ?? null);
        if (where.OR) {
          const lc = (x: string) => x.toLowerCase();
          const [eq, ends] = [where.OR[0].notes.equals, where.OR[1].notes.endsWith];
          return Promise.resolve(mine.find((r) => r.status !== 'CANCELLED' && r.notes
            && (lc(r.notes) === lc(eq) || lc(r.notes).endsWith(lc(ends)))) ?? null);
        }
        if (where.id) return Promise.resolve(mine.find((r) => r.id === where.id) ?? null);
        return Promise.resolve(null);
      }),
    },
    serviceDraft: {
      findUnique: jest.fn(({ where }: any) => Promise.resolve(
        [...drafts.values()].find((d) => d.tenantId === where.tenantId_reference.tenantId && d.reference === where.tenantId_reference.reference) ?? null)),
      create: jest.fn(({ data }: any) => {
        if ([...drafts.values()].some((d) => d.tenantId === data.tenantId && d.reference === data.reference)) return Promise.reject(p2002());
        const row = { id: `sd_${drafts.size + 1}`, targetId: null, createdAt: new Date(), ...data };
        drafts.set(row.id, row);
        return Promise.resolve({ id: row.id });
      }),
      update: jest.fn(({ where, data }: any) => { Object.assign(drafts.get(where.id), data); return Promise.resolve({}); }),
      delete: jest.fn(({ where }: any) => { drafts.delete(where.id); return Promise.resolve({}); }),
      deleteMany: jest.fn(({ where }: any) => { drafts.delete(where.id); return Promise.resolve({ count: 1 }); }),
    },
  };

  const receipts = new ProcureReceiptsService(prisma, {} as any, {} as any, {} as any, {} as any);
  const parse = jest.spyOn(receipts, 'parse');
  // Posting as ProcureReceiptsService.confirm does it, as far as these checks can see: a request carrying the
  // key tag, the note and the store and receipt number, in the books under the tenant it was posted for.
  const confirm = jest.spyOn(receipts, 'confirm').mockImplementation(async (tenantId: string, userId: string, _b: any, dto: any, sanity: any, o: any = {}) => {
    const answered = (sanity?.confirmations ?? []).some((c: any) => c.key === 'row:0' && c.value === '0.106');
    if (opts.sanityWarns && !answered) {
      throw new SanityConfirmRequiredException([{
        key: 'row:0', kind: 'INGREDIENT_COST', severity: 'unusual', name: 'Fresh milk', value: '0.106',
        message: 'Fresh milk: ₱106.00 for 1,000 ml is well above usual. Is this the correct cost?',
        typed: 106, usualLow: 80, usualHigh: 90, points: 3, unitLabel: 'for 1,000 ml',
      } as any]);
    }
    const label = [dto.vendor, dto.referenceNumber].filter(Boolean).join(' · ');
    const request = {
      id: `req${requests.length + 1}`, tenantId, requestNumber: `REQ-20261117-00${requests.length + 1}`, status: 'RECEIVED',
      createdById: userId, notes: [`[RCPT:${dto.idempotencyKey}]`, [o.note, label].filter(Boolean).join(' · ')].join(' '),
    };
    requests.push(request);
    return { duplicate: false, request, posted: dto.lines, skipped: [], failed: [], expenses: [], created: [], document: null } as any;
  });

  const sanity: any = {
    priceHistory: jest.fn((_t: string, ids: string[]) => Promise.resolve(new Map(ids.filter((id) => history[id])
      .map((id) => [id, { name: id, unit: 'u', points: history[id], referenceGross: null, costOnFile: null, usualPackSize: null }])))),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  const documents: any = { uploadBuffer: jest.fn().mockResolvedValue({ id: 'doc', filename: 'x' }) };
  const svc = new ServiceReceiptsService(prisma, receipts, sanity, audit, documents);
  return { svc, prisma, receipts, parse, confirm, sanity, audit, documents, drafts, requests };
}

const POST = (over: Record<string, unknown> = {}): any => ({
  reference: 'AIBA-RC-2026-11-17-01', mode: 'auto', total: '312.00', sentBy: 'Maria',
  vendor: 'Puregold', receiptDate: '2026-11-17', referenceNumber: 'OR-1001',
  lines: [
    { rawMaterialId: 'milk',  packsBought: 2, packSize: 1000, packCost: 106, printedText: 'ANGELINA NO SUGAR AD', barcode: MILK_BC },
    { rawMaterialId: 'sugar', packsBought: 1, packSize: 1000, packCost: 100, printedText: 'WHITE SUGAR 1KG' },
  ],
  images: [{ base64: 'AAAA', mediaType: 'image/jpeg' }],
  ...over,
});

const needsAPerson = async (p: Promise<unknown>, why: RegExp) => {
  const err: any = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(ConflictException);
  expect(err.getResponse()).toMatchObject({ code: 'NEEDS_A_PERSON' });
  expect(err.getResponse().why.join('\n')).toMatch(why);
};

const READING = (over: Record<string, unknown> = {}, lineOver: Array<Record<string, unknown>> = []): any => {
  const lines: any[] = [
    { index: 0, description: 'ANGELINA NO SUGAR AD', barcode: MILK_BC, kind: 'ingredient', lineTotal: 212, remembered: true,
      match: { rawMaterialId: 'milk', name: 'Fresh milk', unit: 'ml', category: 'INGREDIENT', score: 1, inRecipe: true },
      alternatives: [], pack: { packsBought: 2, packSize: 1000, packCost: 106, needsPackSize: false } },
    { index: 1, description: 'WHITE SUGAR 1KG', barcode: null, kind: 'ingredient', lineTotal: 100, remembered: true,
      match: { rawMaterialId: 'sugar', name: 'Sugar', unit: 'g', category: 'INGREDIENT', score: 1, inRecipe: true },
      alternatives: [], pack: { packsBought: 1, packSize: 1000, packCost: 100, needsPackSize: false } },
  ].map((l, i) => ({ ...l, ...(lineOver[i] ?? {}) }));
  return {
    documentKind: 'receipt', itemCount: 2, vendor: 'Puregold', dateText: null, dateIso: '2026-11-17',
    referenceNumber: 'OR-1001', total: 312, discount: null, discountNote: null, lines,
    summary: { lines: 2, matched: 2, remembered: 2, unmatched: 0, expenses: 0, needsPack: 0, linesTotal: 312,
               footsToTotal: true, printedItems: 2, itemsRead: 2, itemsMatch: true },
    ...over,
  };
};

const READ = { images: [{ base64: 'AAAA', mediaType: 'image/jpeg' as const }] };

let aiWas: string | undefined;
beforeAll(() => { aiWas = process.env.AI_FEATURES_ENABLED; process.env.AI_FEATURES_ENABLED = 'true'; });
afterAll(() => { if (aiWas === undefined) delete process.env.AI_FEATURES_ENABLED; else process.env.AI_FEATURES_ENABLED = aiWas; });

// ── read ─────────────────────────────────────────────────────────────────────

describe('POST /service/procure/receipts/read', () => {
  it("answers the reader's own reading plus ok, and writes nothing", async () => {
    const { svc, parse, confirm, prisma, audit } = build();
    parse.mockResolvedValue(READING());
    const r = await svc.read(caller, READ);
    expect(parse).toHaveBeenCalledWith(T, OWNER, { images: READ.images, documentKind: undefined });
    expect(r).toMatchObject({ vendor: 'Puregold', referenceNumber: 'OR-1001', lines: expect.any(Array), summary: { footsToTotal: true } });
    expect(r.auto).toEqual({ ok: true, why: [] });
    expect(confirm).not.toHaveBeenCalled();
    expect(prisma.serviceDraft.create).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it.each([
    ['a line the shop never confirmed', READING({}, [{ remembered: false }]), /Line 1 .* not a line the shop confirmed before/],
    ['a line with no match', READING({}, [{}, { match: null, remembered: false }]), /Line 2 .* not a line the shop confirmed before/],
    ['a pack size still to ask', READING({}, [{ pack: { packsBought: 2, packSize: null, packCost: 106, needsPackSize: true } }]), /pack size is not known/],
    ['lines that do not foot to the total', READING({ total: 400, summary: { ...READING().summary, footsToTotal: false } }), /add up to ₱312.00, not the printed total ₱400.00/],
    ['no total read', READING({ total: null, summary: { ...READING().summary, footsToTotal: null } }), /No total was read/],
    ["the till's item count disagreeing", READING({ summary: { ...READING().summary, itemsMatch: false, printedItems: 3 } }), /prints 3 items; 2 were read/],
    ['no receipt number', READING({ referenceNumber: null }), /No receipt number/],
  ])('says not ok for %s', async (_name, reading, why) => {
    const { svc, parse } = build();
    parse.mockResolvedValue(reading);
    const r = await svc.read(caller, READ);
    expect(r.auto.ok).toBe(false);
    expect(r.auto.why.join('\n')).toMatch(why);
  });

  it('says not ok for a price more than 20% off the last cost, and ok at 20%', async () => {
    const off = build({ history: { milk: [0.05], sugar: [0.1] } });     // 0.106 is 112% above 0.05
    off.parse.mockResolvedValue(READING());
    const r = await off.svc.read(caller, READ);
    expect(r.auto.ok).toBe(false);
    expect(r.auto.why.join('\n')).toMatch(/112% above its last cost/);

    const edge = build({ history: { milk: [0.106 / 1.2], sugar: [0.1] } });
    edge.parse.mockResolvedValue(READING());
    expect((await edge.svc.read(caller, READ)).auto.ok).toBe(true);
  });

  it('says not ok for a receipt already in', async () => {
    const { svc, parse } = build({ posted: [{ id: 'r0', tenantId: T, requestNumber: 'REQ-0', status: 'RECEIVED', notes: '[RCPT:x] Puregold · OR-1001' }] });
    parse.mockResolvedValue(READING());
    const r = await svc.read(caller, READ);
    expect(r.auto.why.join('\n')).toMatch(/already in \(request REQ-0\)/);
  });

  it("is held to the shop's monthly AI allowance before reading", async () => {
    const { svc, parse } = build({ aiUsed: 100 });
    await expect(svc.read(caller, READ)).rejects.toMatchObject({ response: { code: 'AI_QUOTA_EXCEEDED' } });
    expect(parse).not.toHaveBeenCalled();
  });
});

// ── post, mode auto ──────────────────────────────────────────────────────────

describe('POST /service/procure/receipts/post, mode auto', () => {
  it('posts as the key\'s creator when every check holds, from the owner\'s pocket, with AIBA named', async () => {
    const { svc, confirm, audit, requests } = build();
    const r = await svc.post(caller, POST({ lines: POST().lines.map((l: any) => ({ ...l, acceptCostChange: true })) }));

    expect(r).toEqual({ status: 'POSTED', id: 'req1', number: 'REQ-20261117-001', reference: 'AIBA-RC-2026-11-17-01' });
    expect(confirm).toHaveBeenCalledTimes(1);
    const [tenantId, userId, branch, dto, sanity, o] = confirm.mock.calls[0] as any[];
    expect([tenantId, userId, branch]).toEqual([T, OWNER, B]);
    expect(dto).toMatchObject({ branchId: B, paymentMethod: 'OWNER_FUNDED', idempotencyKey: 'AIBA-RC-2026-11-17-01', imageBase64: 'AAAA' });
    // Nothing waves the ten-times guard through when no person has looked.
    expect(dto.lines.some((l: any) => 'acceptCostChange' in l)).toBe(false);
    // The cost question is always asked, and nobody answers it in mode auto.
    expect(sanity).toMatchObject({ optedIn: true, confirmations: [], userId: OWNER, role: 'BUSINESS_OWNER' });
    expect(o.note).toBe('Through AIBA (key AIBA); sent by Maria on Telegram');
    expect(requests[0].notes).toBe('[RCPT:AIBA-RC-2026-11-17-01] Through AIBA (key AIBA); sent by Maria on Telegram · Puregold · OR-1001');
    expect(audit.log.mock.calls[0][0]).toMatchObject({
      entityType: 'PurchaseRequest', entityId: 'req1', performedBy: 'apikey:key1',
      after: { kind: 'PAID_RECEIPT_POSTED', mode: 'auto', actingUserId: OWNER, sentBy: 'Maria', apiKeyLabel: 'AIBA' },
    });
  });

  it('within ₱1 of the printed total still posts; the fees count toward it', async () => {
    const { svc, confirm } = build();
    await svc.post(caller, POST({ total: '362.90', expenses: [{ description: 'Bag', amount: 50 }] }));
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a line the shop never confirmed', { lines: [{ rawMaterialId: 'milk', packsBought: 2, packSize: 1000, packCost: 106, printedText: 'SOMETHING NEW' }], total: '212' }, /Line 1 "SOMETHING NEW" is not a line the shop confirmed before/],
    ['a line with nothing printed to check', { lines: [{ rawMaterialId: 'milk', packsBought: 2, packSize: 1000, packCost: 106 }], total: '212' }, /no printed text or barcode/],
    ['a line confirmed before as another item', { lines: [{ rawMaterialId: 'sugar', packsBought: 2, packSize: 1000, packCost: 106, printedText: 'ANGELINA NO SUGAR AD', barcode: MILK_BC }], total: '212' }, /confirmed before as a different item/],
    ['a different pack size', { lines: [{ rawMaterialId: 'milk', packsBought: 2, packSize: 500, packCost: 53, printedText: 'ANGELINA NO SUGAR AD', barcode: MILK_BC }], total: '106' }, /pack size 500 is not the 1000 confirmed before/],
    ['a new item', { lines: [{ create: { name: 'Oat milk', unit: 'ml' }, packsBought: 1, packSize: 1000, packCost: 150, printedText: 'OAT MILK 1L' }], total: '150' }, /would create a new item/],
    ['lines that do not foot to the total', { total: '320.00' }, /add up to ₱312.00, not the printed total ₱320.00/],
    ['no receipt number', { referenceNumber: undefined }, /No receipt number/],
  ])('answers NEEDS_A_PERSON and posts nothing for %s', async (_name, over, why) => {
    const { svc, confirm, drafts } = build();
    await needsAPerson(svc.post(caller, POST(over)), why);
    expect(confirm).not.toHaveBeenCalled();
    expect(drafts.size).toBe(0);
  });

  it('answers NEEDS_A_PERSON for a cost more than 20% from the last one, either way', async () => {
    const above = build({ history: { milk: [0.05], sugar: [0.1] } });
    await needsAPerson(above.svc.post(caller, POST()), /Line 1 "ANGELINA NO SUGAR AD": ₱0.1060 per u is 112% above its last cost of ₱0.0500/);
    const below = build({ history: { milk: [0.2], sugar: [0.1] } });
    await needsAPerson(below.svc.post(caller, POST()), /47% below/);
    const none = build({ history: { sugar: [0.1] } });
    await needsAPerson(none.svc.post(caller, POST()), /no earlier cost to compare/);
    for (const b of [above, below, none]) expect(b.confirm).not.toHaveBeenCalled();
  });

  it('answers NEEDS_A_PERSON for a receipt already in, and posts nothing', async () => {
    const { svc, confirm } = build({ posted: [{ id: 'r0', tenantId: T, requestNumber: 'REQ-0', status: 'RECEIVED', notes: '[RCPT:other] Through AIBA (key AIBA); sent by Ana on Telegram · Puregold · OR-1001' }] });
    await needsAPerson(svc.post(caller, POST()), /Receipt Puregold · OR-1001 is already in \(request REQ-0\)/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('answers NEEDS_A_PERSON when the cost question has anything to ask, and frees the reference', async () => {
    const { svc, drafts, requests } = build({ sanityWarns: true });
    await needsAPerson(svc.post(caller, POST({ sanityConfirmations: [{ key: 'row:0', value: '0.106' }] })), /Is this the correct cost\?/);
    expect(requests).toHaveLength(0);
    expect(drafts.size).toBe(0);  // the same reference may come back in mode confirmed
  });

  it("checks the shop's own memory, not the body: another tenant's remembered line is unknown here", async () => {
    const { svc, confirm } = build();
    await needsAPerson(
      svc.post(caller, POST({ lines: [{ rawMaterialId: 'theirs', packsBought: 1, packSize: 1000, packCost: 100, printedText: 'THEIR MILK 1L', barcode: '4800000000099' }], total: '100' })),
      /not a line the shop confirmed before/,
    );
    expect(confirm).not.toHaveBeenCalled();
  });
});

// ── post, mode confirmed ─────────────────────────────────────────────────────

describe('POST /service/procure/receipts/post, mode confirmed', () => {
  it('posts what the person confirmed, new items included, the printed lines carried to be remembered', async () => {
    const { svc, confirm, requests } = build();
    const lines = [
      { rawMaterialId: 'milk', packsBought: 2, packSize: 1000, packCost: 106, printedText: 'ANGELINA NO SUGAR AD', barcode: MILK_BC },
      { create: { name: 'Oat milk', unit: 'ml' }, packsBought: 1, packSize: 1000, packCost: 150, printedText: 'OAT MILK 1L', barcode: '4800000000123' },
    ];
    const r = await svc.post(caller, POST({ mode: 'confirmed', confirmedBy: 'KJ', lines, total: '999', paymentMethod: 'CASH' }));
    expect(r.status).toBe('POSTED');
    const [, userId, , dto, sanity, o] = confirm.mock.calls[0] as any[];
    expect(userId).toBe(OWNER);
    expect(dto.lines).toEqual(lines);
    expect(dto.paymentMethod).toBe('CASH');
    expect(sanity).toMatchObject({ optedIn: true, confirmations: [] });
    expect(o.note).toBe('Through AIBA (key AIBA); sent by Maria on Telegram; confirmed by KJ');
    expect(requests[0].notes).toContain('; confirmed by KJ · Puregold · OR-1001');
  });

  it('needs confirmedBy', async () => {
    const { svc, confirm } = build();
    await expect(svc.post(caller, POST({ mode: 'confirmed' }))).rejects.toThrow(BadRequestException);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a cost question comes back as 409 SANITY with the warnings; answered, it posts', async () => {
    const { svc, drafts } = build({ sanityWarns: true });
    const err: any = await svc.post(caller, POST({ mode: 'confirmed', confirmedBy: 'KJ' })).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'SANITY', warnings: [{ key: 'row:0', value: '0.106' }] });
    expect(drafts.size).toBe(0);

    const r = await svc.post(caller, POST({ mode: 'confirmed', confirmedBy: 'KJ', sanityConfirmations: [{ key: 'row:0', value: '0.106' }] }));
    expect(r.status).toBe('POSTED');
  });
});

// ── once per reference ───────────────────────────────────────────────────────

describe('one reference posts once', () => {
  it('the same reference again answers the first post and posts nothing', async () => {
    const { svc, confirm } = build();
    const first = await svc.post(caller, POST());
    const again = await svc.post(caller, POST({ mode: 'confirmed', confirmedBy: 'KJ', total: '1' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ ...first, replayed: true });
  });

  it('a reference already used for a draft is refused', async () => {
    const { svc, drafts, confirm } = build();
    drafts.set('sd_x', { id: 'sd_x', tenantId: T, reference: 'AIBA-RC-2026-11-17-01', kind: 'COUNT', targetId: 'cc1', createdAt: new Date() });
    await expect(svc.post(caller, POST())).rejects.toThrow(/already used for a draft/);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('an attempt that died part way is finished by confirm, not refused as its own twin', async () => {
    const { svc, confirm } = build({ posted: [{ id: 'r0', tenantId: T, requestNumber: 'REQ-0', status: 'BOUGHT', notes: '[RCPT:AIBA-RC-2026-11-17-01] Through AIBA (key AIBA); sent by Maria on Telegram · Puregold · OR-1001' }] });
    await svc.post(caller, POST());
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((confirm.mock.calls[0] as any[])[3].idempotencyKey).toBe('AIBA-RC-2026-11-17-01');
  });
});

// ── who posts, and where ─────────────────────────────────────────────────────

describe('the acting user is the owner who issued the key', () => {
  it.each([
    ['deactivated', { id: OWNER, tenantId: T, name: 'K', role: 'BUSINESS_OWNER', isActive: false, branchId: null }],
    ['no longer an owner, MDM or branch manager', { id: OWNER, tenantId: T, name: 'K', role: 'CASHIER', isActive: true, branchId: B }],
    ['of another tenant', { id: OWNER, tenantId: 't2', name: 'K', role: 'BUSINESS_OWNER', isActive: true, branchId: null }],
  ])('refuses read and post when the creator is %s', async (_name, user) => {
    const { svc, parse, confirm } = build({ users: [user] });
    await expect(svc.read(caller, READ)).rejects.toMatchObject({ response: { code: 'KEY_OWNER_CANNOT_POST' } });
    await expect(svc.post(caller, POST())).rejects.toThrow(ForbiddenException);
    expect(parse).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a branch manager who issued it posts to their own branch only', async () => {
    const mgr = { id: 'u_mgr', tenantId: T, name: 'Ana', role: 'BRANCH_MANAGER', isActive: true, branchId: 'b2' };
    const { svc, confirm } = build({ users: [mgr], keyCreator: 'u_mgr' });
    await expect(svc.post(caller, POST({ branchId: B }))).rejects.toThrow(ForbiddenException);
    await svc.post(caller, POST());
    expect((confirm.mock.calls[0] as any[]).slice(1, 3)).toEqual(['u_mgr', 'b2']);
  });
});

describe('tenant isolation', () => {
  it("refuses another tenant's branch before anything is checked or posted", async () => {
    const { svc, confirm, drafts } = build();
    await expect(svc.post(caller, POST({ branchId: 'other' }))).rejects.toThrow(NotFoundException);
    await expect(svc.post(caller, POST({ mode: 'confirmed', confirmedBy: 'KJ', branchId: 'other' }))).rejects.toThrow(NotFoundException);
    expect(confirm).not.toHaveBeenCalled();
    expect(drafts.size).toBe(0);
  });

  it("refuses another tenant's item in mode confirmed (Clerque's own posting checks every item is the shop's)", async () => {
    const { svc, prisma, receipts, drafts } = build();
    (receipts.confirm as jest.Mock).mockRestore();
    // The real confirm, as far as its first refusal: no replay, no twin, no list, then the item.
    prisma.purchaseRequestLine = { findMany: jest.fn().mockResolvedValue([]) };
    prisma.rawMaterial.findFirst = jest.fn(({ where }: any) => Promise.resolve(where.id === 'theirs' && where.tenantId === T ? null : { id: where.id }));
    const lines = [{ rawMaterialId: 'theirs', packsBought: 1, packSize: 1000, packCost: 100, printedText: 'THEIR MILK 1L' }];
    await expect(svc.post(caller, POST({ mode: 'confirmed', confirmedBy: 'KJ', lines, total: '100' })))
      .rejects.toThrow('Ingredient not found in your list.');
    expect(drafts.size).toBe(0);
  });
});
