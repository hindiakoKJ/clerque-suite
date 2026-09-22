import { Prisma } from '@prisma/client';
import { ProcureService } from './procure.service';
import { RequestContext, StationRequestService } from './station-request.service';

/**
 * A kitchen or bar tap on "Request what's running low", against a small
 * in-memory shop. The plan's own numbers are proven in the plan spec; this is
 * about which list a tap lands on, what it writes, who is told, and that a
 * repeat or a race never tells the owner twice.
 */
describe('StationRequestService', () => {
  const T = 't1';
  const B = 'b1';
  const NOW = new Date('2026-09-17T15:00:00+08:00');   // planning Friday Sep 18
  const HOUR = 3_600_000;
  const LATER_CLOSING = new Date('2026-09-17T21:30:00+08:00');

  const KITCHEN: RequestContext = {
    tenantId: T, branchId: B, branchName: 'Main', stationKind: 'KITCHEN', stationName: 'Kitchen',
    actorId: 'pairer', createdById: 'pairer', byLabel: 'Kitchen screen', source: 'STATION',
  };

  type Line = { id: string; rawMaterialId: string; lineNumber: string; qtyRequested: number; shortBy?: number | null; packsBought?: number | null; receivedAt?: Date | null };
  type Req = { id: string; tenantId: string; branchId: string; requestNumber: string; status: string; notes: string | null; sentAt: Date | null; sentById?: string | null; createdAt: Date; createdById?: string; lines: Line[] };
  type Material = { id: string; name: string; unit: string; category: string; batchYield: number | null; lowStockAlert: number | null; isActive: boolean; isPrep?: boolean; createdAt?: Date };

  const MATERIALS: Material[] = [
    { id: 'milk',   name: 'Fresh milk',   unit: 'ml',   category: 'INGREDIENT',     batchYield: null, lowStockAlert: null, isActive: true },
    { id: 'sugar',  name: 'White sugar',  unit: 'g',    category: 'INGREDIENT',     batchYield: null, lowStockAlert: null, isActive: true },
    { id: 'syrup',  name: 'Sugar Syrup',  unit: 'ml',   category: 'INGREDIENT',     batchYield: 1000, lowStockAlert: null, isActive: true, isPrep: true },
    { id: 'tissue', name: 'Tissue roll',  unit: 'roll', category: 'KITCHEN_SUPPLY', batchYield: null, lowStockAlert: null, isActive: true },
    { id: 'cups',   name: 'Old cups',     unit: 'pc',   category: 'BAR_SUPPLY',     batchYield: null, lowStockAlert: null, isActive: false },
  ];

  function build(opts: {
    requests?: Req[];
    stock?: Record<string, number>;
    /** Milk the same Fridays used: 2,400 ml a day -> 3,000 ml -> 3 packs. */
    milkPerFriday?: number;
    packs?: Record<string, number>;
    owner?: { id: string } | null;
    flipCount?: number;
    clashOnce?: boolean;
    historyFails?: boolean;
    /** No open day to learn from: the shop's first day on Clerque. */
    noHistory?: boolean;
  } = {}) {
    const requests: Req[] = (opts.requests ?? []).map((r) => ({ ...r, lines: r.lines.map((l) => ({ ...l })) }));
    const materials: Material[] = MATERIALS.map((m) => ({ createdAt: new Date('2026-01-01'), ...m }));
    const stock = opts.stock ?? { milk: 0, sugar: 50_000, syrup: 5000, tissue: 20 };
    const packs = opts.packs ?? { milk: 1000 };
    let clash = !!opts.clashOnce;
    const writes: string[] = [];

    const matRow = (m: Material) => ({ ...m, subRecipeItems: m.isPrep ? [{ id: 'x' }] : [] });
    const matches = (r: Req, where: any): boolean => {
      if (where.id && r.id !== where.id) return false;
      if (where.tenantId && r.tenantId !== where.tenantId) return false;
      if (where.branchId && r.branchId !== where.branchId) return false;
      if (typeof where.status === 'string' && r.status !== where.status) return false;
      if (where.status?.not && r.status === where.status.not) return false;
      if (where.sentAt?.gte && !(r.sentAt && r.sentAt >= where.sentAt.gte)) return false;
      if (where.notes?.contains && !(r.notes ?? '').includes(where.notes.contains)) return false;
      if (where.lines?.none && r.lines.some((l) => l.packsBought != null || l.receivedAt != null)) return false;
      return true;
    };
    const shaped = (r: Req, args: any) => args.include
      ? { ...r, branch: { id: B, name: 'Main' }, lines: r.lines.map((l) => ({ ...l, rawMaterial: { name: materials.find((m) => m.id === l.rawMaterialId)!.name, unit: materials.find((m) => m.id === l.rawMaterialId)!.unit, costPrice: 99 } })) }
      : args.select?.lines ? { ...r, lines: r.lines.map((l) => ({ ...l })) } : { id: r.id };

    const prisma: any = {
      $executeRaw: jest.fn(async () => 1),
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      purchaseRequest: {
        findFirst: jest.fn(async (args: any) => {
          const found = requests.filter((r) => matches(r, args.where));
          const key = args.orderBy?.sentAt ? 'sentAt' : 'createdAt';
          found.sort((a: any, b: any) => (b[key]?.getTime() ?? 0) - (a[key]?.getTime() ?? 0));
          return found[0] ? shaped(found[0], args) : null;
        }),
        // The closing job's look for a buy list already sent: what the table would return, notes only.
        findMany: jest.fn(async (args: any) => requests.filter((r) => matches(r, args.where)).map((r) => ({ notes: r.notes }))),
        create: jest.fn(async ({ data }: any) => {
          if (clash) { clash = false; throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }); }
          writes.push('request.create');
          const r: Req = { id: `req${requests.length + 1}`, status: 'OPEN', notes: null, sentAt: null, createdAt: NOW, lines: [], ...data };
          requests.push(r);
          return { ...r, lines: [] };
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          writes.push('request.updateMany');
          if (opts.flipCount === 0) return { count: 0 };
          const r = requests.find((x) => x.id === where.id && x.status === where.status);
          if (!r) return { count: 0 };
          Object.assign(r, data);
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }: any) => {
          writes.push('request.update');
          Object.assign(requests.find((x) => x.id === where.id)!, data);
          return {};
        }),
      },
      purchaseRequestLine: {
        // What is on the way: nothing, in these tests.
        findMany: jest.fn(async () => []),
        create: jest.fn(async ({ data }: any) => {
          writes.push('line.create');
          const r = requests.find((x) => x.id === data.purchaseRequestId)!;
          r.lines.push({ id: `l${r.lines.length + 1}`, ...data, qtyRequested: Number(data.qtyRequested) });
          return {};
        }),
        update: jest.fn(async ({ where, data }: any) => {
          writes.push('line.update');
          const l = requests.flatMap((r) => r.lines).find((x) => x.id === where.id)!;
          l.qtyRequested = Number(data.qtyRequested);
          return {};
        }),
      },
      rawMaterialLot: { findMany: jest.fn(async () => []) },
      rawMaterial: {
        findMany: jest.fn(async ({ where }: any) => materials.filter((m) => m.isActive === where.isActive).map(matRow)),
        findFirst: jest.fn(async ({ where }: any) => {
          const m = where.id
            ? materials.find((x) => x.id === where.id)
            : materials.find((x) => x.name.toLowerCase() === String(where.name.equals).toLowerCase());
          return m ? matRow(m) : null;
        }),
        create: jest.fn(async ({ data }: any) => {
          writes.push('material.create');
          const m: Material = { id: `new${materials.length}`, batchYield: null, isActive: true, ...data };
          materials.push(m);
          return matRow(m);
        }),
      },
      subRecipeItem: { findMany: jest.fn(async () => [{ parentRawMaterialId: 'syrup', rawMaterialId: 'sugar', quantity: 800 }]) },
      bomItem: { findMany: jest.fn(async () => [{ rawMaterialId: 'milk' }, { rawMaterialId: 'syrup' }]) },
      variantBomItem: { findMany: jest.fn(async () => []) },
      modifierOptionIngredient: { findMany: jest.fn(async () => []) },
      rawMaterialInventory: { findMany: jest.fn(async () => Object.entries(stock).map(([rawMaterialId, quantity]) => ({ rawMaterialId, quantity }))) },
      // Nothing waiting at a screen.
      orderItem: { findMany: jest.fn(async () => []) },
      user: { findFirst: jest.fn(async () => (opts.owner === undefined ? { id: 'owner1' } : opts.owner)) },
    };

    const procure: any = {
      lastPacks: jest.fn(async (_t: string, ids: string[]) => new Map(ids.filter((id) => packs[id]).map((id) => [id, { packSize: packs[id] }]))),
      nextRequestNumber: jest.fn(async () => `REQ-20260917-00${requests.length + 1}`),
      nextLineNumber: ProcureService.prototype.nextLineNumber,
      lineInclude: () => ({ lines: {} }),
      fileRequestPdf: jest.fn(async () => Buffer.from('%PDF')),
      tellTheOwners: jest.fn(async () => ['Anne', 'Mia']),
    };

    const svc = new StationRequestService(prisma, procure as ProcureService);
    const perFriday = opts.milkPerFriday ?? 2400;
    const history = opts.noHistory ? [] : [
      { day: '2026-09-11', used: new Map([['milk', perFriday]]) },
      { day: '2026-09-04', used: new Map([['milk', perFriday]]) },
    ];
    jest.spyOn(svc as any, 'history').mockImplementation(async () => {
      if (opts.historyFails) throw new Error('database down');
      return history;
    });
    return { svc, prisma, procure, requests, materials, writes };
  }

  const sentList = (over: Partial<Req> = {}): Req => ({
    id: 'sent1', tenantId: T, branchId: B, requestNumber: 'REQ-20260917-001', status: 'SENT', notes: '[PLAN:2026-09-18] [ASKED:BAR]',
    sentAt: new Date(NOW.getTime() - 2 * HOUR), createdAt: new Date(NOW.getTime() - 5 * HOUR), lines: [], ...over,
  });
  const openList = (over: Partial<Req> = {}): Req => ({
    id: 'open1', tenantId: T, branchId: B, requestNumber: 'REQ-20260917-002', status: 'OPEN', notes: null,
    sentAt: null, createdAt: new Date(NOW.getTime() - HOUR), lines: [], ...over,
  });

  /** Every key anywhere in the response, so a cost can never ride along unseen. */
  const allKeys = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.flatMap(allKeys);
    if (v && typeof v === 'object') return Object.entries(v).flatMap(([k, x]) => [k, ...allKeys(x)]);
    return [];
  };

  // ── which list ───────────────────────────────────────────────────────────

  it('adds to a list sent in the last 18 hours before the open one', async () => {
    const { svc, requests } = build({ requests: [sentList(), openList()] });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res.outcome).toBe('UPDATED');
    expect(res.request).toEqual({ id: 'sent1', requestNumber: 'REQ-20260917-001', status: 'SENT' });
    expect(requests.find((r) => r.id === 'sent1')!.lines.map((l) => [l.rawMaterialId, l.qtyRequested])).toEqual([['milk', 3000]]);
    expect(requests.find((r) => r.id === 'open1')!.lines).toEqual([]);
    // The tag says which screens asked, the bar before and the kitchen now.
    expect(requests.find((r) => r.id === 'sent1')!.notes).toBe('[PLAN:2026-09-18] [ASKED:BAR KITCHEN]');
  });

  it('a sent list somebody started buying is left alone: the open one is sent instead', async () => {
    const bought = sentList({ lines: [{ id: 'b1', rawMaterialId: 'sugar', lineNumber: 'REQ-20260917-001-01', qtyRequested: 1000, packsBought: 1 }] });
    const { svc, requests, procure } = build({ requests: [bought, openList()] });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res.outcome).toBe('SENT');
    expect(res.request).toEqual({ id: 'open1', requestNumber: 'REQ-20260917-002', status: 'SENT' });
    const open = requests.find((r) => r.id === 'open1')!;
    expect(open).toMatchObject({ status: 'SENT', sentAt: NOW, sentById: 'pairer' });
    expect(open.lines[0]).toMatchObject({ rawMaterialId: 'milk', lineNumber: 'REQ-20260917-002-01', qtyRequested: 3000 });
    expect(procure.fileRequestPdf).toHaveBeenCalledWith(T, 'open1', 'sent', 'pairer');
    expect(procure.tellTheOwners).toHaveBeenCalledWith(T, expect.objectContaining({ id: 'open1' }), expect.any(Buffer), 'pairer',
      { byLabel: 'Kitchen screen', newItems: null });
    expect(res.message).toBe('Sent to Anne and Mia. 1 item on the list.');
  });

  it('a list sent more than 18 hours ago is not added to: a new one is started and sent', async () => {
    const { svc, requests, procure } = build({ requests: [sentList({ sentAt: new Date(NOW.getTime() - 19 * HOUR) })] });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res.outcome).toBe('SENT');
    expect(procure.nextRequestNumber).toHaveBeenCalledWith(T);
    const made = requests[requests.length - 1];
    expect(made).toMatchObject({ requestNumber: 'REQ-20260917-002', createdById: 'pairer', status: 'SENT', notes: '[PLAN:2026-09-18] [ASKED:KITCHEN]' });
  });

  // ── never lower, only raise with news ────────────────────────────────────

  it('a line already asking for more stays as it is and counts as already on the list', async () => {
    const list = sentList({ lines: [{ id: 'm1', rawMaterialId: 'milk', lineNumber: 'REQ-20260917-001-01', qtyRequested: 5000 }] });
    const { svc, requests, procure } = build({ requests: [list] });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res).toMatchObject({ outcome: 'NOTHING_NEW', added: [], raised: [], unchanged: 1, message: 'Already sent. Nothing new.' });
    expect(requests[0].lines[0].qtyRequested).toBe(5000);
    expect(procure.tellTheOwners).not.toHaveBeenCalled();
  });

  it('a line asking for less is raised, and says what it was', async () => {
    const list = sentList({ lines: [
      { id: 'm1', rawMaterialId: 'milk', lineNumber: 'REQ-20260917-001-01', qtyRequested: 2000 },
      { id: 's1', rawMaterialId: 'sugar', lineNumber: 'REQ-20260917-001-02', qtyRequested: 1000 },
    ] });
    const { svc, requests, procure } = build({ requests: [list] });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res.outcome).toBe('UPDATED');
    expect(res.raised).toEqual([{
      rawMaterialId: 'milk', name: 'Fresh milk', amount: '3 packs (3,000 ml)', was: '2 packs (2,000 ml)', why: ['Fridays use about 2.4 L'],
    }]);
    expect(res.unchanged).toBe(1);
    expect(requests[0].lines[0].qtyRequested).toBe(3000);
    // Only what changed is told, in updated mode, with no PDF.
    expect(procure.fileRequestPdf).not.toHaveBeenCalled();
    expect(procure.tellTheOwners).toHaveBeenCalledWith(T, expect.objectContaining({ id: 'sent1' }), null, 'pairer', {
      mode: 'updated', changed: [{ rawMaterialId: 'milk', was: 2000 }], byLabel: 'Kitchen screen', newItems: null,
    });
    expect(res.message).toBe('Added 1 item. Anne and Mia were told.');
  });

  it('the same tap twice tells the owner once', async () => {
    const { svc, procure } = build({ requests: [openList()] });
    expect((await svc.apply(KITCHEN, [], NOW)).outcome).toBe('SENT');
    const again = await svc.apply(KITCHEN, [], NOW);
    expect(again).toMatchObject({ outcome: 'NOTHING_NEW', sentTo: [], unchanged: 1 });
    expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
  });

  it('a list the Procure screen sent in the same moment is not sent twice', async () => {
    const { svc, procure } = build({ requests: [openList()], flipCount: 0 });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res.outcome).toBe('UPDATED');       // the milk line went on; the send was someone else's
    expect(procure.fileRequestPdf).not.toHaveBeenCalled();
    expect(procure.tellTheOwners.mock.calls[0][4]).toMatchObject({ mode: 'updated' });
  });

  it('nothing low and no list: nothing is created and nobody is told', async () => {
    const { svc, writes, procure } = build({ stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 } });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res).toMatchObject({ outcome: 'NOTHING_NEW', request: null, message: 'Nothing is running low. Nothing was sent.', learning: false });
    expect(writes).toEqual([]);
    expect(procure.tellTheOwners).not.toHaveBeenCalled();
  });

  // ── the first days: too little sales history ─────────────────────────────

  it('first day, nothing low: never says nothing is running low, and tells the screen Clerque is still learning', async () => {
    const { svc, writes, procure } = build({ noHistory: true, stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 } });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res).toMatchObject({ outcome: 'NOTHING_NEW', request: null, message: 'Nothing was sent.', learning: true });
    expect(res.message).not.toMatch(/running low/);
    expect(writes).toEqual([]);
    expect(procure.tellTheOwners).not.toHaveBeenCalled();
    // The "+" preview says the same, so the screen can too before anything is added.
    expect((await svc.preview(KITCHEN, NOW)).learning).toBe(true);
  });

  it('first day, a hand-added item is sent and the screen still hears Clerque is learning', async () => {
    const { svc, requests } = build({ noHistory: true, stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 } });
    const res = await svc.apply(KITCHEN, [{ rawMaterialId: 'milk', qty: 2000 }], NOW);
    expect(res).toMatchObject({ outcome: 'SENT', learning: true, message: 'Sent to Anne and Mia. 1 item on the list.' });
    expect(requests[0].lines[0]).toMatchObject({ rawMaterialId: 'milk', qtyRequested: 2000 });
  });

  it('first day, an item out with no pack size is still asked for, at a starting amount, so the tap sends something', async () => {
    // Sugar is out, never bought through Clerque (no pack size) and has no reorder level: it used to go under "Check these" and off the list,
    // and a tap with 25 such items out sent nothing at all.
    const { svc, requests, procure } = build({ noHistory: true, stock: { milk: 50_000, sugar: 0, syrup: 5000, tissue: 20 } });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res).toMatchObject({ outcome: 'SENT', learning: true, check: [] });
    expect(res.added).toEqual([{
      rawMaterialId: 'sugar', name: 'White sugar', amount: '1,000 g',
      why: ['Out. No pack size or sales history yet, so this is a starting amount. Add more with + if you need it.'],
    }]);
    expect(requests[0].lines[0]).toMatchObject({ rawMaterialId: 'sugar', qtyRequested: 1000, shortBy: null });
    expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
  });

  it('first day at closing: an empty list is not called an all-clear', async () => {
    const { svc, procure } = build({ noHistory: true, stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 } });
    const closing: RequestContext = { ...KITCHEN, stationKind: null, stationName: null, actorId: null, createdById: 'owner1', byLabel: 'Clerque at closing time', source: 'CLOSING' };
    const res = await svc.apply(closing, [], LATER_CLOSING);
    expect(res).toMatchObject({ outcome: 'SENT', learning: true, message: 'Sent to Anne and Mia with nothing on the list yet.' });
    expect(res.message).not.toMatch(/all-clear/);
    expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
    // With a month behind it, the same empty list is the all-clear.
    const known = build({ stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 } });
    expect(await known.svc.apply(closing, [], LATER_CLOSING)).toMatchObject({ learning: false, message: 'Sent the all-clear to Anne and Mia. Nothing is running low.' });
  });

  it('two screens queue on one lock per branch', async () => {
    const { svc, prisma } = build({ requests: [openList()] });
    await svc.apply(KITCHEN, [], NOW);
    const [strings, key] = prisma.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain('pg_advisory_xact_lock(hashtext(?))');
    expect(key).toBe('procure-list:t1:b1');
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ timeout: 30_000 });
  });

  it('a request number taken by the Procure screen is retried', async () => {
    const { svc, requests, prisma } = build({ clashOnce: true });
    const res = await svc.apply(KITCHEN, [], NOW);
    expect(res.outcome).toBe('SENT');
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(requests).toHaveLength(1);
  });

  // ── "+" ──────────────────────────────────────────────────────────────────

  it('adds an item picked from the list, rounded up to a pack', async () => {
    // Everything else in stock: an item that is out goes on the list by itself now, with a starting amount.
    const { svc, requests } = build({ stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 }, requests: [openList()] });
    const res = await svc.apply(KITCHEN, [{ rawMaterialId: 'milk', qty: 1 }], NOW);
    expect(res.added).toEqual([{ rawMaterialId: 'milk', name: 'Fresh milk', amount: '1 pack (1,000 ml)', why: ['Added by hand on the Kitchen screen'] }]);
    expect(requests[0].lines[0]).toMatchObject({ rawMaterialId: 'milk', qtyRequested: 1000, shortBy: null });
  });

  it('a new item with the name of an existing one, in any case, is that item', async () => {
    const { svc, writes, requests } = build({ stock: { milk: 50_000 }, requests: [openList()] });
    await svc.apply(KITCHEN, [{ newItem: { name: 'TISSUE ROLL', category: 'KITCHEN_SUPPLY', unit: 'roll' }, qty: 4 }], NOW);
    expect(writes).not.toContain('material.create');
    expect(requests[0].lines[0]).toMatchObject({ rawMaterialId: 'tissue', qtyRequested: 4 });
  });

  it('a new item is created as a supply with no cost, and the owner is told where it came from', async () => {
    const { svc, prisma, procure } = build({ stock: { milk: 50_000 }, requests: [openList()] });
    const res = await svc.apply(KITCHEN, [{ newItem: { name: '  Dish   sponge ', category: 'KITCHEN_SUPPLY', unit: 'pc' }, qty: 3 }], NOW);
    expect(prisma.rawMaterial.create).toHaveBeenCalledWith(expect.objectContaining({
      data: { tenantId: T, name: 'Dish sponge', unit: 'pc', category: 'KITCHEN_SUPPLY', costPrice: null, lowStockAlert: null },
    }));
    expect(res.added[0]).toMatchObject({ name: 'Dish sponge', amount: '3 pc' });
    expect(procure.tellTheOwners.mock.calls[0][4]).toMatchObject({ newItems: { ids: ['new5'], screen: 'Kitchen screen' } });
  });

  it('a station cannot create an ingredient', async () => {
    const { svc, writes } = build();
    await expect(svc.apply(KITCHEN, [{ newItem: { name: 'Oat milk', category: 'INGREDIENT', unit: 'ml' }, qty: 1 }], NOW))
      .rejects.toThrow('A new item is a kitchen, bar or office supply. Ingredients are added by the owner.');
    expect(writes).toEqual([]);
  });

  it('refuses a prep and a switched-off item, by name', async () => {
    const { svc } = build({ requests: [openList()] });
    await expect(svc.apply(KITCHEN, [{ rawMaterialId: 'syrup', qty: 1 }], NOW))
      .rejects.toThrow('Sugar Syrup is made in the kitchen, not bought. Use the prep column.');
    await expect(svc.apply(KITCHEN, [{ newItem: { name: 'old cups', category: 'BAR_SUPPLY', unit: 'pc' }, qty: 1 }], NOW))
      .rejects.toThrow('Old cups is switched off in your item list. Ask the owner to turn it back on.');
  });

  it('carries no cost anywhere in what the screen gets back', async () => {
    const { svc } = build({ requests: [sentList({ lines: [{ id: 'm1', rawMaterialId: 'milk', lineNumber: 'REQ-20260917-001-01', qtyRequested: 1000 }] })] });
    const res = await svc.apply(KITCHEN, [{ newItem: { name: 'Dish sponge', category: 'KITCHEN_SUPPLY', unit: 'pc' }, qty: 3 }], NOW);
    const preview = await svc.preview(KITCHEN, NOW);
    for (const body of [res, preview]) {
      expect(allKeys(body).filter((k) => /cost|price|value/i.test(k))).toEqual([]);
    }
    expect(preview.pickable.map((p) => p.name)).toEqual(['Dish sponge', 'Fresh milk', 'Tissue roll', 'White sugar']);   // no prep, nothing switched off
  });

  it('the preview writes nothing and takes no lock', async () => {
    const { svc, prisma, writes } = build({ requests: [openList()] });
    const res = await svc.preview(KITCHEN, NOW);
    expect(res).toMatchObject({ plannedFor: '2026-09-18', plannedForLabel: 'Fri, Sep 18', stationKind: 'KITCHEN', unchanged: 0 });
    expect(res.added.map((a) => a.name)).toEqual(['Fresh milk']);
    expect(writes).toEqual([]);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  // ── at closing ───────────────────────────────────────────────────────────

  const BRANCH = { id: B, tenantId: T, name: 'Main' };
  const DUE = { day: '2026-09-17', closedAt: new Date('2026-09-17T21:00:00+08:00') };
  const LATER = new Date('2026-09-17T21:30:00+08:00');

  it('closing: a list already sent today means no lock and no writes', async () => {
    const { svc, prisma, writes } = build({ requests: [sentList()] });
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('ALREADY_SENT');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it('closing: nothing sent today sends the list, named as Clerque at closing time', async () => {
    const { svc, requests, procure } = build({ requests: [openList()] });
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('SENT');
    expect(requests[0]).toMatchObject({ status: 'SENT', sentById: null, notes: '[PLAN:2026-09-18] [ASKED:CLOSING]' });
    expect(procure.fileRequestPdf).toHaveBeenCalledWith(T, 'open1', 'sent', 'owner1');
    expect(procure.tellTheOwners).toHaveBeenCalledWith(T, expect.anything(), expect.any(Buffer), null, { byLabel: 'Clerque at closing time', newItems: null });
  });

  it('closing: a bar closing at 01:00 still sends the night after its own send, and only once', async () => {
    // Last night's closing job sent at 01:30 on the 17th: the same calendar day as tonight's business day.
    const lastNight = sentList({ id: 'night1', notes: '[PLAN:2026-09-17] [ASKED:CLOSING]', sentAt: new Date('2026-09-17T01:30:00+08:00'), sentById: null });
    const { svc, requests, procure } = build({ requests: [lastNight] });
    const tonight = new Date('2026-09-18T01:30:00+08:00');
    const due = { day: '2026-09-17', to: tonight };
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, due, tonight)).toBe('SENT');
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({ status: 'SENT', sentAt: tonight, notes: '[PLAN:2026-09-18] [ASKED:CLOSING]' });
    // The next five-minute run sees tonight's send.
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, due, new Date(tonight.getTime() + 5 * 60_000))).toBe('ALREADY_SENT');
    expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
  });

  it('closing: with nothing low it still sends the all-clear', async () => {
    const { svc, requests, procure } = build({ stock: { milk: 50_000, sugar: 50_000, syrup: 5000, tissue: 20 } });
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('SENT');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ status: 'SENT', createdById: 'owner1', lines: [] });
    expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
  });

  it('closing: a list sent between the look and the lock is not sent again', async () => {
    const { svc, prisma, writes } = build({ requests: [openList()] });
    // The cheap look finds nothing; by the time the lock is held, a screen has sent one.
    prisma.purchaseRequest.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ notes: '[PLAN:2026-09-18] [ASKED:KITCHEN]' }]);
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('ALREADY_SENT');
    expect(writes).toEqual([]);
  });

  it('closing: a list the owner sent from Procure counts as sent', async () => {
    // sendRequest stamps the day the list is for, the way a tap does, with no screen named.
    const { svc, writes } = build({ requests: [sentList({ notes: '[PLAN:2026-09-18]', sentAt: new Date('2026-09-17T18:00:00+08:00') })] });
    expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('ALREADY_SENT');
    expect(writes).toEqual([]);
  });

  /*
    Requests that are stamped sent the moment they are made, without asking
    anyone to buy anything. Posted after 10:00 on a day nobody tapped, each
    one used to pass for tomorrow's list, and the owner got nothing at
    closing. The closing job's look and its second look under the lock both
    have to see past them: either one alone would still answer ALREADY_SENT.
  */
  describe.each([
    ['a receipt posted in Procure > Receipts', { status: 'BOUGHT', notes: '[RCPT:rcpt-7f3a] Puregold · OR 4471' }],
    ['a purchase uploaded from the buy-lists sheet', { status: 'BOUGHT', notes: 'Recorded from an Excel upload (buy-lists.xlsx · 3f9c0a1b2c3d)' }],
    ['the balance of a short delivery', { status: 'BOUGHT', notes: '[BALANCEOF:REQ-20260915-002] [ONTHEWAY:2026-09-17] Balance of REQ-20260915-002: still coming' }],
    ['anything with the tag only inside a person\'s words', { status: 'BOUGHT', notes: 'Stall [PLAN:2026-09-18] by the market' }],
  ])('closing: %s is not the list for tomorrow', (_what, over) => {
    const made = (): Req => sentList({
      id: 'other1', requestNumber: 'REQ-20260917-005', ...over,
      sentAt: new Date('2026-09-17T11:30:00+08:00'), createdAt: new Date('2026-09-17T11:30:00+08:00'),
      lines: [{ id: 'o1', rawMaterialId: 'sugar', lineNumber: 'REQ-20260917-005-01', qtyRequested: 1000, packsBought: 1 }],
    });

    it('so tomorrow\'s list still goes out, once', async () => {
      const { svc, requests, procure, prisma } = build({ requests: [made()] });
      expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('SENT');
      // Looked twice, before the lock and under it, and neither look took it for the list.
      expect(prisma.purchaseRequest.findMany).toHaveBeenCalledTimes(2);
      const sent = requests[requests.length - 1];
      expect(sent).toMatchObject({ status: 'SENT', notes: '[PLAN:2026-09-18] [ASKED:CLOSING]' });
      expect(requests.find((r) => r.id === 'other1')).toMatchObject({ status: 'BOUGHT', notes: over.notes });
      expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
      // The next five-minute run sees the list it just sent.
      expect(await svc.sendAtClosingIfNothingSent(BRANCH, DUE, new Date(LATER.getTime() + 5 * 60_000))).toBe('ALREADY_SENT');
      expect(procure.tellTheOwners).toHaveBeenCalledTimes(1);
    });

    it('and the look under the lock does not stop it on its own either', async () => {
      const { svc } = build({ requests: [made()] });
      const since = new Date('2026-09-17T10:00:00+08:00');
      const res = await svc.apply({ ...KITCHEN, stationKind: null, stationName: null, actorId: null, byLabel: 'Clerque at closing time', source: 'CLOSING' },
        [], LATER, { onlyIfNothingSentSince: since });
      expect(res.outcome).toBe('SENT');
    });
  });

  it('closing: no owner account gives NO_OWNER, and a failure gives SKIPPED without throwing', async () => {
    expect(await build({ owner: null }).svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('NO_OWNER');
    const broken = build({ historyFails: true });
    const error = jest.spyOn((broken.svc as any).logger, 'error').mockImplementation(() => undefined);
    expect(await broken.svc.sendAtClosingIfNothingSent(BRANCH, DUE, LATER)).toBe('SKIPPED');
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Closing buy list failed for branch b1'));
  });
});
