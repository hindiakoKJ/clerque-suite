import { ProcureService, amountWords, namesInWords, onTheWay, lastPricedLines, priceFromLastTime } from './procure.service';
import { Prisma } from '@prisma/client';
import { servesSentences } from '@repo/shared-types';
import { productCeiling } from '../products/recipe-ceiling';

const PrismaKnownError = Prisma.PrismaClientKnownRequestError;

/**
 * Clerque Procure — the shop asking the owner to buy something.
 *
 * The failure it removes is timing, not paperwork: a shortage is found while
 * someone is already standing in the grocery, so a message goes to the owners
 * and somebody makes a second trip. Everything below protects that outcome —
 * one list per branch, a control number that stops a double buy, and an
 * explicit all-clear so silence never has to be interpreted.
 */
describe('ProcureService', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const USER   = 'u1';

  function build(opts: {
    open?: any;
    lines?: any[];
    status?: string;
    lowStock?: any[];
    /** Ingredients with no reorder level — invisible to Check stock by design. */
    unmonitored?: number;
    receiveImpl?: (rmId: string, dto: any) => any;
    /** Tenant.showPurchaseCostsToStaff — off means staff do not see costs. */
    showCostsToStaff?: boolean;
    /** The branch's OPEN list, when one exists beside the request under test. */
    openList?: any;
    /** What the newest received line of each ingredient says it held and cost. */
    lastPacks?: any[];
    /** RawMaterialInventory rows, at the branch unless a row names another. */
    onHand?: Array<{ rawMaterialId: string; quantity: number; branchId?: string }>;
    /** Lines on tickets at kitchen and bar screens: waiting, at this branch, on a paid order, unless a ticket says otherwise. */
    tickets?: Array<{
      productId: string; variantId?: string | null; quantity: number; refundedQty?: number;
      branchId?: string; status?: string; usageOnReady?: boolean; usagePostedAt?: Date | null;
    }>;
    /** A cycle count already started from this list. */
    openCount?: { id: string; countNumber: string; notes: string; lines: any[] } | null;
    /** The owners and managers on the account. */
    people?: Array<{ id: string; email: string | null; name: string; role: string; branchId?: string | null }>;
    /** A mailer that fails, to prove a send never depends on it. */
    mailFails?: boolean;
    /** A ledger that refuses -- a locked month, a chart with no 1063. */
    ledgerFails?: boolean;
    /** Documents already filed against requests; the mock filters them like the database. */
    filed?: Array<{ id?: string; entityId?: string; label: string | null; filename: string; mimeType?: string; createdAt?: Date }>;
    /** Storage that will not take a file, or will not give one back. */
    uploadFails?: boolean;
    readFails?: boolean;
    /** Recipe products, as the servings query selects them. */
    products?: any[];
    /** Kitchen preps an item goes into. */
    preps?: Array<{ rawMaterialId: string; parent: { id: string; name: string } }>;
    /** Add-on options that use an item. */
    addOns?: Array<{ rawMaterialId: string; option: { name: string } }>;
    /** The servings query fails -- the list must still load. */
    productsFail?: boolean;
    /**
     * Other requests at the shop -- sent, bought, closed, at this branch unless
     * one names another, and sent (and bought) an hour ago unless it says when.
     */
    elsewhere?: Array<{
      id: string; status: string; branchId?: string; lines: any[];
      requestNumber?: string; notes?: string | null; sentAt?: Date | null; boughtAt?: Date | null;
    }>;
    /** Stock lots received, at this branch unless one names another. */
    lots?: Array<{ rawMaterialId: string; qtyReceived: number; createdAt: Date; referenceNumber?: string | null; branchId?: string }>;
  } = {}) {
    const created: any[] = [];
    const createdRequests: any[] = [];
    const createdCounts: any[] = [];
    const countLines: any[] = [];
    let openCount: { id: string; countNumber: string; notes: string; lines: any[] } | null = opts.openCount ?? null;
    const updatedLines: any[] = [];
    const received: any[] = [];
    const entries: any[] = [];
    const docs: any[] = [];
    let openList = opts.openList ?? null;
    let request = opts.open === null ? null : {
      id: 'req1', tenantId: TENANT, branchId: BRANCH,
      requestNumber: 'REQ-20260830-001',
      status: opts.status ?? 'OPEN',
      // Copies: the line update above mutates them like the database would, and
      // the fixtures are shared between tests.
      lines: (opts.lines ?? []).map((l: any) => ({ ...l })),
      ...(opts.open ?? {}),
    };

    const filedDocs = (opts.filed ?? []).map((d, i) => ({
      id: `filed${i + 1}`, tenantId: TENANT, entityType: 'PurchaseRequest', entityId: 'req1',
      mimeType: 'application/pdf', createdAt: new Date('2026-08-30T10:00:00Z'), ...d,
    }));
    // Tenant, entity, label and type, the way the documents table would filter them.
    const filedWhere = (where: any) => filedDocs.filter((d: any) =>
      (where.tenantId == null || d.tenantId === where.tenantId)
      && (where.entityType == null || d.entityType === where.entityType)
      && (where.entityId == null || d.entityId === where.entityId)
      && (where.label === undefined || d.label === where.label)
      && (where.mimeType == null
        || (typeof where.mimeType === 'string' ? d.mimeType === where.mimeType : d.mimeType.startsWith(where.mimeType.startsWith))));

    const stockRows = () => (opts.onHand ?? []).map((x) => ({ branchId: BRANCH, ...x }));

    const prisma: any = {
      // Whether staff see delivery costs. These tests are about the list
      // itself, so they run as the default shop: everyone sees.
      tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: opts.showCostsToStaff ?? true }) },
      purchaseRequest: {
        // Asked for by id: the request under test. Asked for the branch's
        // OPEN list: whatever is open beside it, like a real table.
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(where?.status === 'OPEN' ? (openList ?? (request?.status === 'OPEN' ? request : null)) : request)),
        create:    jest.fn(({ data }: any) => {
          created.push(data);
          const { lines: nested, ...rest } = data;
          const made = {
            id: data.status === 'BOUGHT' ? 'follow1' : 'open1',
            status: 'OPEN',   // the column's default, when the create does not say
            ...rest,
            lines: (nested?.create ?? []).map((l: any, i: number) => ({ id: `f${i + 1}`, receivedAt: null, ...l })),
          };
          createdRequests.push(made);
          if (request === null) { request = made; return Promise.resolve(request); }
          if (!data.status) openList = made;   // a fresh OPEN list
          return Promise.resolve(made);
        }),
        update: jest.fn(({ data }: any) => {
          request = { ...request, ...data };
          return Promise.resolve(request);
        }),
      },
      purchaseRequestLine: {
        create:     jest.fn(({ data }: any) => {
          created.push(data);
          if (openList && data.purchaseRequestId === openList.id) openList.lines.push({ id: `o${openList.lines.length + 1}`, ...data });
          // Like the database: a line added to the request under test is on it when the request is read again.
          else if (request && data.purchaseRequestId === request.id) {
            request.lines.push({ id: `n${request.lines.length + 1}`, receivedAt: null, packsBought: null, packSize: null, ...data });
          }
          return Promise.resolve(data);
        }),
        update:     jest.fn(({ where, data }: any) => {
          updatedLines.push({ ...where, ...data });
          // Like the database: the request read back after an update carries the new numbers.
          const line = (request?.lines ?? []).find((l: any) => l.id === where.id);
          if (line) Object.assign(line, data);
          return Promise.resolve({});
        }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
        // What each ingredient held and cost the last time it was received. The
        // where-it-is-usually-bought query (it asks by request status) finds none.
        findMany:   jest.fn(({ where }: any = {}) => {
          /*
            What is on the way: lines not yet posted, on requests filtered the
            way the table would filter them -- the request under test and any
            others beside it.
          */
          if (where?.receivedAt === null) {
            const pr = where.purchaseRequest;
            const anHourAgo = new Date(Date.now() - 3_600_000);
            const dated = (r: any) => ({
              tenantId: TENANT, branchId: BRANCH, notes: null,
              requestNumber: `REQ-${r.id}`, sentAt: anHourAgo, boughtAt: r.status === 'BOUGHT' ? anHourAgo : null, ...r,
            });
            // Each OR branch: a status, and a date on or after, or a note containing.
            const branch = (r: any, c: any) => (c.status == null || r.status === c.status)
              && (!c.sentAt   || (r.sentAt != null && r.sentAt >= c.sentAt.gte))
              && (!c.boughtAt || (r.boughtAt != null && r.boughtAt >= c.boughtAt.gte))
              && (!c.notes    || (r.notes ?? '').includes(c.notes.contains));
            const all = [...(request ? [dated(request)] : []), ...(opts.elsewhere ?? []).map(dated)];
            return Promise.resolve(all
              .filter((r: any) => r.tenantId === pr.tenantId && r.branchId === pr.branchId && pr.OR.some((c: any) => branch(r, c))
                && (!pr.id || r.id !== pr.id.not))
              .flatMap((r: any) => r.lines
                .filter((l: any) => l.receivedAt == null)
                .map((l: any) => ({
                  rawMaterialId: l.rawMaterialId, qtyRequested: l.qtyRequested,
                  packsBought: l.packsBought ?? null, packSize: l.packSize ?? null,
                  purchaseRequest: { status: r.status, requestNumber: r.requestNumber, notes: r.notes, sentAt: r.sentAt, boughtAt: r.boughtAt },
                }))));
          }
          return Promise.resolve(where?.purchaseRequest?.status ? [] : (opts.lastPacks ?? []));
        }),
      },
      document: {
        count:     jest.fn(({ where }: any) => Promise.resolve(filedWhere(where).length)),
        findMany:  jest.fn(({ where }: any) => Promise.resolve(filedWhere(where))),
        findFirst: jest.fn(({ where }: any) => Promise.resolve(
          filedWhere(where).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null)),
      },
      // Prices somebody confirmed on the buy list, read when the goods are posted.
      auditLog: { findMany: jest.fn().mockResolvedValue([]) },
      user: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.people ?? []).filter((p) => {
          const alts: any[] = where.OR ?? [];
          return alts.some((a) => a.role === p.role && (!a.OR || a.OR.some((b: any) => b.branchId === (p.branchId ?? null))));
        }).map(({ id, email, name }) => ({ id, email, name })))),
        // Who sent the list, for the stamp on its PDF.
        findFirst: jest.fn(({ where }: any) => Promise.resolve({ name: where.id === USER ? 'Mia' : 'Someone' })),
      },
      rawMaterialInventory: {
        findMany:   jest.fn(({ where }: any) => Promise.resolve(stockRows().filter((x) =>
          where.rawMaterialId.in.includes(x.rawMaterialId)
          && (where.branchId == null || (typeof where.branchId === 'string' ? x.branchId === where.branchId : where.branchId.in.includes(x.branchId)))))),
        findUnique: jest.fn(({ where }: any) => Promise.resolve(stockRows().find((x) =>
          x.rawMaterialId === where.branchId_rawMaterialId.rawMaterialId && x.branchId === where.branchId_rawMaterialId.branchId) ?? null)),
      },
      // Tickets at kitchen and bar screens, filtered the way the orders table would filter them.
      orderItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.tickets ?? [])
          .map((t) => ({ branchId: BRANCH, status: 'PAID', usageOnReady: true, usagePostedAt: null, variantId: null, refundedQty: 0, ...t }))
          .filter((t) => t.usageOnReady === where.usageOnReady && t.usagePostedAt === where.usagePostedAt
            && where.order.tenantId === TENANT && where.order.deletedAt === null && where.order.status.in.includes(t.status)
            && (!where.order.branchId || where.order.branchId.in.includes(t.branchId)))
          .map((t) => ({
            productId: t.productId, variantId: t.variantId, quantity: t.quantity, refundedQty: t.refundedQty,
            modifiers: [], order: { branchId: t.branchId },
          })))),
      },
      // The recipes those tickets are read by: the same products the servings read.
      bomItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.products ?? [])
          .filter((p: any) => where.productId.in.includes(p.id))
          .flatMap((p: any) => (p.bomItems ?? []).map((b: any) => ({ productId: p.id, ...b }))))),
      },
      variantBomItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.products ?? [])
          .flatMap((p: any) => p.variants ?? [])
          .filter((v: any) => where.variantId.in.includes(v.id))
          .flatMap((v: any) => v.variantBomItems.map((b: any) => ({ variantId: v.id, ...b }))))),
      },
      modifierOption: { findMany: jest.fn().mockResolvedValue([]) },
      cycleCount: {
        findMany:  jest.fn(() => Promise.resolve(openCount ? [{ id: openCount.id, countNumber: openCount.countNumber, notes: openCount.notes }] : [])),
        findFirst: jest.fn(({ where }: any) => Promise.resolve(openCount && openCount.notes.startsWith(where.notes.startsWith) ? { id: openCount.id, countNumber: openCount.countNumber } : null)),
        create:    jest.fn(({ data }: any) => { openCount = { id: 'cc1', countNumber: data.countNumber, notes: data.notes, lines: [] }; createdCounts.push(data); return Promise.resolve({ id: 'cc1', countNumber: data.countNumber }); }),
      },
      cycleCountLine: {
        findMany:  jest.fn(() => Promise.resolve(openCount ? openCount.lines.map((l: any) => ({ countId: openCount!.id, ...l })) : [])),
        findFirst: jest.fn(({ where }: any) => Promise.resolve(openCount?.lines.find((l: any) => l.rawMaterialId === where.rawMaterialId) ?? null)),
        create:    jest.fn(({ data }: any) => { const l = { id: `ccl${(openCount?.lines.length ?? 0) + 1}`, ...data }; openCount?.lines.push(l); countLines.push(data); return Promise.resolve(l); }),
        update:    jest.fn(({ where, data }: any) => { const l = openCount?.lines.find((x: any) => x.id === where.id); if (l) Object.assign(l, data); countLines.push({ ...where, ...data }); return Promise.resolve(l); }),
      },
      // What each line still serves: the products, preps and add-ons that use an item.
      subRecipeItem: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.preps ?? []).filter((p) => where.rawMaterialId.in.includes(p.rawMaterialId)))),
      },
      product: {
        findMany: jest.fn(({ where }: any) => {
          if (opts.productsFail) return Promise.reject(new Error('connection reset'));
          // The menu ceiling asks for every recipe product, not the ones using an item.
          if (!where.OR) {
            return Promise.resolve((opts.products ?? [])
              .map((p: any) => ({ bomItems: [], variants: [], ...p }))
              .filter((p: any) => where.inventoryMode === undefined || p.inventoryMode === where.inventoryMode));
          }
          const ids: string[] = where.OR[0].bomItems.some.rawMaterialId.in;
          const uses = (bom: any[]) => bom.some((b: any) => ids.includes(b.rawMaterialId));
          return Promise.resolve((opts.products ?? [])
            .map((p: any) => ({ bomItems: [], variants: [], ...p }))
            .filter((p: any) => uses(p.bomItems) || p.variants.some((v: any) => uses(v.variantBomItems))));
        }),
      },
      modifierOptionIngredient: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.addOns ?? []).filter((a) => where.rawMaterialId.in.includes(a.rawMaterialId)))),
      },
      // Stock that came in, filtered the way the lots table would filter it.
      rawMaterialLot: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.lots ?? [])
          .map((l) => ({ branchId: BRANCH, referenceNumber: null, ...l }))
          .filter((l) => where.tenantId === TENANT && l.branchId === where.branchId
            && where.rawMaterialId.in.includes(l.rawMaterialId)
            && l.qtyReceived > where.qtyReceived.gt && l.createdAt > where.createdAt.gt)
          .map(({ rawMaterialId, createdAt, referenceNumber }) => ({ rawMaterialId, createdAt, referenceNumber })))),
      },
      rawMaterial: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve({ id: where.id, name: 'White Sugar' })),
        // How many ingredients carry no reorder level. Check stock reports it
        // because an ingredient without one can never appear on the list, so
        // "nothing is below its reorder level" and "nobody is watching" used
        // to look identical on screen.
        count: jest.fn().mockResolvedValue(opts.unmonitored ?? 0),
      },
      $transaction: jest.fn((ops: any) => Array.isArray(ops) ? Promise.all(ops) : ops(prisma)),
    };
    const inventory: any = {
      getLowStock: jest.fn().mockResolvedValue(opts.lowStock ?? []),
      receiveRawMaterial: jest.fn((_t: string, rmId: string, dto: any) => {
        received.push({ rawMaterialId: rmId, ...dto });
        return Promise.resolve(opts.receiveImpl ? opts.receiveImpl(rmId, dto) : { quantity: dto.quantity });
      }),
    };
    const simple: any = {
      create: jest.fn((_t: string, _u: string, dto: any) => {
        if (opts.ledgerFails) return Promise.reject(new Error('Period 2026-09 is closed.'));
        entries.push(dto);
        return Promise.resolve({ entryNumber: `JE-${entries.length}`, status: 'POSTED' });
      }),
    };
    const documents: any = {
      uploadBuffer: jest.fn((_t: string, type: string, id: string, buf: Buffer, mime: string, name: string, label: string, by: string) => {
        if (opts.uploadFails) return Promise.reject(new Error('R2 is down'));
        docs.push({ type, id, size: buf.length, mime, name, label, by, buf });
        return Promise.resolve({ id: 'doc1', filename: name });
      }),
      readFiled: jest.fn((_t: string, id: string) => opts.readFails
        ? Promise.reject(new Error('NoSuchKey'))
        : Promise.resolve(Buffer.from(`%PDF-filed:${id}`))),
    };
    const warehouse: any = { nextCountNumber: jest.fn().mockResolvedValue('CC-2026-000007') };
    const notified: any[] = [];
    const mailed: any[] = [];
    const notifications: any = { create: jest.fn((a: any) => { notified.push(a); return Promise.resolve({ id: `n${notified.length}` }); }) };
    const mail: any = { sendBuyListSent: jest.fn((a: any) => { if (opts.mailFails) return Promise.reject(new Error('Resend is down')); mailed.push(a); return Promise.resolve(); }) };
    const svc = new ProcureService(prisma, inventory, simple, documents, warehouse, notifications, mail) as any;
    return {
      notifications, svc, prisma, inventory, created, createdRequests, updatedLines, received, entries, docs, createdCounts, countLines, notified, mailed,
      req: () => request, open: () => openList, count: () => openCount,
    };
  }

  // ── one list ──────────────────────────────────────────────────────────────

  it('reuses the branch\'s open request instead of starting a second one', async () => {
    // Two open lists would split the shopping in half and guarantee two trips,
    // which is the exact thing this feature exists to remove.
    const { svc, prisma } = build();
    await svc.openRequest(TENANT, BRANCH, USER);
    expect(prisma.purchaseRequest.create).not.toHaveBeenCalled();
  });

  it('opens one when the branch has none', async () => {
    const { svc, prisma } = build({ open: null });
    await svc.openRequest(TENANT, BRANCH, USER);
    expect(prisma.purchaseRequest.create).toHaveBeenCalled();
    expect(prisma.purchaseRequest.create.mock.calls[0][0].data.requestNumber)
      .toMatch(/^REQ-\d{8}-001$/);
  });

  // ── building the list ─────────────────────────────────────────────────────

  it('numbers each line off the request, so it can carry through to the receipt', async () => {
    const { svc, created } = build({
      lines: [{ id: 'l1', rawMaterialId: 'rm-x', lineNumber: 'REQ-20260830-001-01' }],
    });
    await svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-sugar', qtyRequested: 5000 });
    expect(created[0].lineNumber).toBe('REQ-20260830-001-02');
  });

  it('does not reuse a control number after a line is removed', async () => {
    /*
      The suffix used to come from the line COUNT. Remove line 02 of three and
      the count is 2, so the next add produces -03 again -- a duplicate control
      number on one request. That number is the idempotency key the receive
      uses to know a line has already been posted to stock, so a duplicate
      means one of the two can never be received.
    */
    const { svc, created } = build({
      lines: [
        { id: 'l1', rawMaterialId: 'rm-a', lineNumber: 'REQ-20260830-001-01' },
        { id: 'l3', rawMaterialId: 'rm-c', lineNumber: 'REQ-20260830-001-03' },
      ],
    });
    await svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-new', qtyRequested: 1 });
    expect(created[0].lineNumber).toBe('REQ-20260830-001-04');
  });

  it('buys past the reorder level, not exactly to it', async () => {
    /*
      Low stock is `quantity <= lowStockAlert`, so restoring to exactly the
      reorder level leaves the item still flagged: it reappears on the next
      Check stock and never clears. A reorder level is when to buy, not how
      much to have.
    */
    const { svc, created } = build({
      lowStock: [{ rawMaterialId: 'rm-sugar', shortBy: 4000, kind: 'INGREDIENT' }],
    });
    await svc.pullLowStock(TENANT, BRANCH, USER);
    expect(Number(created[0].shortBy)).toBe(4000);        // why it is on the list
    expect(Number(created[0].qtyRequested)).toBe(8000);   // what to actually buy
  });

  it('raises an existing line rather than asking for the same thing twice', async () => {
    const { svc, prisma, created } = build({
      lines: [{ id: 'l1', rawMaterialId: 'rm-sugar', qtyRequested: 1000 }],
    });
    await svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-sugar', qtyRequested: 5000 });
    expect(created).toHaveLength(0);
    expect(prisma.purchaseRequestLine.update).toHaveBeenCalled();
  });

  it('refuses to put something the kitchen makes on a buy list', async () => {
    const { svc, prisma, created } = build();
    prisma.rawMaterial.findFirst.mockResolvedValueOnce({ id: 'rm-sauce', name: 'Teriyaki Sauce (ready)', subRecipeItems: [{ id: 'x' }] });
    await expect(svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-sauce', qtyRequested: 2000 }))
      .rejects.toThrow('Teriyaki Sauce (ready) is made in the kitchen, not bought. Record it on the prep board.');
    expect(created).toHaveLength(0);
  });

  it('a prep line already on a list from before can still be corrected', async () => {
    const { svc, prisma } = build({ lines: [{ id: 'l1', rawMaterialId: 'rm-sauce', qtyRequested: 1000 }] });
    prisma.rawMaterial.findFirst.mockResolvedValueOnce({ id: 'rm-sauce', name: 'Teriyaki Sauce (ready)', subRecipeItems: [{ id: 'x' }] });
    await svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-sauce', qtyRequested: 500 });
    expect(prisma.purchaseRequestLine.update).toHaveBeenCalled();
  });

  it('a prep left unbought on a closed list is not carried onto the next one', async () => {
    const { svc, created } = build({
      status: 'BOUGHT',
      openList: { id: 'open1', requestNumber: 'REQ-20260831-001', lines: [] },
      lines: [
        { id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-sug', qtyRequested: 1000, shortBy: null, packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'White Sugar', unit: 'g', subRecipeItems: [] } },
        { id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-sauce', qtyRequested: 2000, shortBy: null, packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'Teriyaki Sauce (ready)', unit: 'ml', subRecipeItems: [{ id: 'x' }] } },
      ],
    });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { closeRest: true, lines: [] });
    expect(res.carried.map((c: any) => c.name)).toEqual(['White Sugar']);
    expect(created.filter((c: any) => c.purchaseRequestId === 'open1').map((c: any) => c.rawMaterialId)).toEqual(['rm-sug']);
  });

  it('refuses to add to a request that has already gone out', async () => {
    const { svc } = build({ status: 'SENT' });
    await expect(svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-x', qtyRequested: 1 }))
      .rejects.toThrow(/already sent/i);
  });

  it('fills the list from what is already below its reorder level', async () => {
    const { svc, created } = build({
      lowStock: [
        { rawMaterialId: 'rm-sugar', shortBy: 4000, kind: 'INGREDIENT' },
        { rawMaterialId: 'rm-milk',  shortBy: 12000, kind: 'INGREDIENT' },
        { productId:     'p1',       shortBy: 5 },                          // a product, not ours
      ],
    });
    const res = await svc.pullLowStock(TENANT, BRANCH, USER);
    expect(res.added).toBe(2);
    expect(created.map((c) => c.rawMaterialId)).toEqual(['rm-sugar', 'rm-milk']);
    expect(Number(created[0].shortBy)).toBe(4000);
  });

  /*
    Exactly ON the line.

    This fixture used to sit in the test above labelled "not short", and it was
    skipped. The label was the bug: getLowStock only ever returns items it has
    already flagged, and its test is `onHand <= lowStockAlert` -- so a row it
    hands back with a shortfall of ZERO is an item resting exactly on its
    reorder level, not a healthy one.

    Skipping it meant one shop, one night, three different answers: the nightly
    email said "Straws - 6 pcs left", the printed slip said "SHORT 0 pcs", and
    Check stock said "Nothing is below its reorder level right now". A cafe
    weighing grams rarely lands on equality; a shop counting cups, lids and
    sachets lands on it constantly.
  */
  it('buys the ingredient sitting exactly on its reorder level', async () => {
    const { svc, created } = build({
      lowStock: [
        { rawMaterialId: 'rm-lids', shortBy: 0, lowStockAlert: 200, kind: 'INGREDIENT' },
      ],
    });
    const res = await svc.pullLowStock(TENANT, BRANCH, USER);
    expect(res.added).toBe(1);
    expect(created.map((c) => c.rawMaterialId)).toEqual(['rm-lids']);
  });

  it('asks for the reorder level itself when the shortfall is zero', async () => {
    // Doubling nothing is nothing, and a zero-quantity line is not a purchase.
    const { svc, created } = build({
      lowStock: [
        { rawMaterialId: 'rm-lids', shortBy: 0, lowStockAlert: 200, kind: 'INGREDIENT' },
      ],
    });
    await svc.pullLowStock(TENANT, BRANCH, USER);
    expect(Number(created[0].qtyRequested)).toBe(200);
  });

  it('still buys past the line when the item is genuinely below it', async () => {
    // The existing rule is unchanged: get above the level and leave cover.
    const { svc, created } = build({
      lowStock: [
        { rawMaterialId: 'rm-sugar', shortBy: 4000, lowStockAlert: 6000, kind: 'INGREDIENT' },
      ],
    });
    await svc.pullLowStock(TENANT, BRANCH, USER);
    expect(Number(created[0].qtyRequested)).toBe(8000);
  });

  /*
    An ingredient with NO reorder level can never appear on this list.

    The low-stock test is `quantity <= lowStockAlert` behind a `!= null` guard,
    so an unmonitored ingredient fails before the comparison — not when it runs
    low, not when it hits zero. Adding nothing therefore means two completely
    different things, and the screen said the reassuring one for both:
    "nothing is below its reorder level" reads as "you are fine" when the truth
    can be "nobody is watching any of these".

    A shop can pass a whole kitchen through the app or the onboarding workbook
    without filling that column once — it is optional in both — and then wonder
    why Check stock keeps coming back empty while the rice runs out. Proven on
    real data: 11 kitchen ingredients created, 0 returned by getLowStock.
  */
  describe('ingredients nobody is watching', () => {
    it('reports how many can never appear, so an empty list can be read correctly', async () => {
      const { svc } = build({ lowStock: [], unmonitored: 11 });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(0);
      expect(res.unmonitored).toBe(11);
    });

    it('still reports them when the check DID find something', async () => {
      // "Added 2" is not the all-clear it looks like if forty others are
      // invisible to the same check.
      const { svc } = build({
        lowStock: [{ rawMaterialId: 'rm-sugar', shortBy: 4000, kind: 'INGREDIENT' }],
        unmonitored: 40,
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(res.unmonitored).toBe(40);
    });

    it('says zero when every ingredient has a reorder level', async () => {
      const { svc } = build({ lowStock: [], unmonitored: 0 });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.unmonitored).toBe(0);
    });

    it('does not invent a reorder level for them', async () => {
      // Counting them is the fix. A threshold nobody chose is a number nobody
      // can trust, and it would put items on a buy list on no authority.
      const { svc, created } = build({ lowStock: [], unmonitored: 11 });
      await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(created).toHaveLength(0);
    });
  });

  /*
    What is already coming.

    Check stock deduped only against the open list. A list sent to the owners,
    or shopping bought and not yet posted, is not on the shelf -- so pressing
    Check stock again before the delivery arrived found the same sugar short
    and asked for it twice.
  */
  describe('what is already on the way', () => {
    // 2,000 g available against a 6,000 g level: 4,000 short, and the rule buys 8,000.
    const SUGAR = { rawMaterialId: 'rm-sugar', name: 'White Sugar', unit: 'g', quantity: 2000, shortBy: 4000, lowStockAlert: 6000, kind: 'INGREDIENT' };
    const onOpen = (created: any[]) => created.filter((c) => c.purchaseRequestId === 'open1');

    it('sent, then checked again: adds nothing, and says it is already coming', async () => {
      const { svc, created } = build({ lowStock: [SUGAR] });
      const first = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(first.added).toBe(1);
      expect(first.onTheWay).toEqual([]);

      await svc.sendRequest(TENANT, 'req1', USER);

      // The shelf has not changed -- the shopping has not come back yet.
      const again = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(again.requestId).toBe('open1');
      expect(again.added).toBe(0);
      expect(onOpen(created)).toHaveLength(0);
      // Named, so the screen can say which list it is on.
      expect(again.onTheWay).toEqual([
        { id: 'rm-sugar', name: 'White Sugar', unit: 'g', quantity: 2000, shortBy: 4000, coming: 8000,
          requestNumber: 'REQ-20260830-001', sentAt: expect.any(Date) },
      ]);
    });

    it('bought and not yet posted counts the packs bought, not what was asked', async () => {
      // 2,500 g short, so the rule wants 5,000 g. The list asked for 2,500 g, and five 1 kg
      // bags were bought: 5,000 g coming covers it; the 2,500 g asked for would not.
      const { svc, created } = build({
        lowStock: [{ ...SUGAR, quantity: 1000, shortBy: 2500, lowStockAlert: 3500 }],
        elsewhere: [{ id: 'reqB', status: 'BOUGHT', lines: [
          { rawMaterialId: 'rm-sugar', qtyRequested: 2500, packsBought: 5, packSize: 1000, receivedAt: null },
        ] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(0);
      expect(created.filter((c) => c.rawMaterialId)).toHaveLength(0);
      expect(res.onTheWay.map((x: any) => [x.id, x.coming])).toEqual([['rm-sugar', 5000]]);
    });

    it('a bought list\'s line nobody has recorded yet still counts what was asked', async () => {
      const { svc } = build({
        lowStock: [SUGAR],
        elsewhere: [{ id: 'reqB', status: 'BOUGHT', lines: [
          { rawMaterialId: 'rm-sugar', qtyRequested: 8000, packsBought: null, packSize: null, receivedAt: null },
        ] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(0);
      expect(res.onTheWay[0].coming).toBe(8000);
    });

    it('lines already posted, and closed or cancelled lists, are not coming', async () => {
      // Posted stock is already in the shelf figure; counting it again would hide a real shortage.
      const { svc, created } = build({
        lowStock: [SUGAR],
        elsewhere: [
          { id: 'reqB', status: 'BOUGHT', lines: [
            { rawMaterialId: 'rm-sugar', qtyRequested: 8000, packsBought: 8, packSize: 1000, receivedAt: new Date('2026-09-15T02:00:00Z') },
          ] },
          { id: 'reqR', status: 'RECEIVED', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 8000, receivedAt: null }] },
          { id: 'reqC', status: 'CANCELLED', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 8000, receivedAt: null }] },
        ],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(res.onTheWay).toEqual([]);
      expect(Number(created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(8000);
    });

    it('another branch\'s list is not coming here', async () => {
      const { svc, created } = build({
        lowStock: [SUGAR],
        elsewhere: [{ id: 'reqB2', status: 'SENT', branchId: 'b2', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 8000, receivedAt: null }] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(res.onTheWay).toEqual([]);
      expect(Number(created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(8000);
    });

    it('part of it coming: asks only for the rest', async () => {
      // 3,000 g sent leaves the sugar at 5,000 g -- still under 6,000. The rule wanted 8,000; 3,000 is coming.
      const { svc, created } = build({
        lowStock: [SUGAR],
        elsewhere: [{ id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 3000, receivedAt: null }] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(res.onTheWay).toEqual([]);
      const line = created.find((c) => c.rawMaterialId === 'rm-sugar');
      expect(Number(line.qtyRequested)).toBe(5000);
      expect(Number(line.shortBy)).toBe(4000);   // why it is on the list is unchanged
    });

    it('coming exactly up to the level is still low, so the rest is still asked for', async () => {
      // Low is `<=`: 2,000 + 4,000 lands ON the 6,000 g line.
      const { svc, created } = build({
        lowStock: [SUGAR],
        elsewhere: [{ id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 4000, receivedAt: null }] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(Number(created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(4000);
    });

    it('only what is coming for that item: other low items are bought as before', async () => {
      const { svc, created } = build({
        lowStock: [SUGAR, { rawMaterialId: 'rm-milk', name: 'Fresh Milk', unit: 'ml', quantity: 0, shortBy: 6000, lowStockAlert: 6000, kind: 'INGREDIENT' }],
        elsewhere: [{ id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 8000, receivedAt: null }] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(created.filter((c) => c.rawMaterialId).map((c) => [c.rawMaterialId, Number(c.qtyRequested)])).toEqual([['rm-milk', 12000]]);
      expect(res.onTheWay.map((x: any) => x.id)).toEqual(['rm-sugar']);
    });

    it('adds up every list coming to the branch, and can leave one out', async () => {
      const { prisma } = build({
        open: { status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 1000, receivedAt: null }] },
        elsewhere: [
          { id: 'reqB', status: 'BOUGHT', lines: [
            { rawMaterialId: 'rm-sugar', qtyRequested: 2500, packsBought: 3, packSize: 1000, receivedAt: null },
            { rawMaterialId: 'rm-milk', qtyRequested: 0.3, receivedAt: null },
          ] },
          { id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-milk', qtyRequested: 0.1, receivedAt: null }] },
        ],
      });
      const qty = (m: Map<string, { quantity: number }>) => Object.fromEntries([...m].map(([id, c]) => [id, c.quantity]));
      const all = await onTheWay(prisma, TENANT, BRANCH);
      expect(qty(all)).toEqual({ 'rm-sugar': 4000, 'rm-milk': 0.4 });
      // Named by the list bringing the most: 3,000 g of the sugar, 0.3 of the milk.
      expect(all.get('rm-sugar')!.requestNumber).toBe('REQ-reqB');
      expect(all.get('rm-milk')!.requestNumber).toBe('REQ-reqB');
      const without = await onTheWay(prisma, TENANT, BRANCH, 'req1');
      expect(qty(without)).toEqual({ 'rm-sugar': 3000, 'rm-milk': 0.4 });
    });

    it('names the list that brings most of it, with when it was sent', async () => {
      const monday  = new Date(Date.now() - 30 * 3_600_000);
      const tuesday = new Date(Date.now() - 6 * 3_600_000);
      const { svc } = build({
        lowStock: [SUGAR],
        elsewhere: [
          { id: 'reqS', requestNumber: 'REQ-20260915-001', status: 'SENT', sentAt: monday, lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 3000, receivedAt: null }] },
          { id: 'reqT', requestNumber: 'REQ-20260916-001', status: 'SENT', sentAt: tuesday, lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 6000, receivedAt: null }] },
        ],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(0);
      expect(res.onTheWay).toEqual([expect.objectContaining({ coming: 9000, requestNumber: 'REQ-20260916-001', sentAt: tuesday })]);
    });

    /*
      A list nobody closes.

      Nothing closes a sent list on its own. Stock posted from Receipts without
      the list, or received under Inventory, leaves it SENT; a line that fails
      to post leaves a bought one BOUGHT. Believed with no end date, it kept
      the sugar off every later list until somebody found and cancelled it.
    */
    describe('a list nobody closed', () => {
      const sentAt = new Date(Date.now() - 24 * 3_600_000);
      const SENT_SUGAR = { id: 'reqA', status: 'SENT', sentAt, lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 8000, receivedAt: null }] };

      it('stops counting once sugar has come in since it was sent', async () => {
        const { svc, created, prisma } = build({
          lowStock: [SUGAR],
          elsewhere: [SENT_SUGAR],
          // Bought on a receipt and posted, without the list.
          lots: [{ rawMaterialId: 'rm-sugar', qtyReceived: 8000, createdAt: new Date(sentAt.getTime() + 3_600_000), referenceNumber: 'REQ-20260916-002-01' }],
        });
        const res = await svc.pullLowStock(TENANT, BRANCH, USER);
        expect(res.added).toBe(1);
        expect(res.onTheWay).toEqual([]);
        expect(Number(created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(8000);
        // Read once, and only from the time of the list.
        expect(prisma.rawMaterialLot.findMany).toHaveBeenCalledTimes(1);
        expect(prisma.rawMaterialLot.findMany.mock.calls[0][0].where.createdAt.gt).toEqual(sentAt);
      });

      it('still counts when what came in was before the list, a write-off, or at another branch', async () => {
        const { svc } = build({
          lowStock: [SUGAR],
          elsewhere: [SENT_SUGAR],
          lots: [
            { rawMaterialId: 'rm-sugar', qtyReceived: 8000, createdAt: new Date(sentAt.getTime() - 3_600_000) },
            { rawMaterialId: 'rm-sugar', qtyReceived: -500, createdAt: new Date(sentAt.getTime() + 3_600_000) },
            { rawMaterialId: 'rm-sugar', qtyReceived: 8000, createdAt: new Date(sentAt.getTime() + 3_600_000), branchId: 'b2' },
            { rawMaterialId: 'rm-milk',  qtyReceived: 8000, createdAt: new Date(sentAt.getTime() + 3_600_000) },
          ],
        });
        const res = await svc.pullLowStock(TENANT, BRANCH, USER);
        expect(res.added).toBe(0);
        expect(res.onTheWay[0].coming).toBe(8000);
      });

      it('a bought list is measured from when it was bought, not sent', async () => {
        // An emergency bag between sending and buying: the list bought afterwards is still coming.
        const boughtAt = new Date(sentAt.getTime() + 6 * 3_600_000);
        const { svc } = build({
          lowStock: [SUGAR],
          elsewhere: [{ id: 'reqB', status: 'BOUGHT', sentAt, boughtAt, lines: [
            { rawMaterialId: 'rm-sugar', qtyRequested: 8000, packsBought: 8, packSize: 1000, receivedAt: null },
          ] }],
          lots: [{ rawMaterialId: 'rm-sugar', qtyReceived: 1000, createdAt: new Date(sentAt.getTime() + 3_600_000) }],
        });
        const res = await svc.pullLowStock(TENANT, BRANCH, USER);
        expect(res.added).toBe(0);
        expect(res.onTheWay[0].coming).toBe(8000);
      });

      it('the balance of a short delivery is not undone by its parent\'s own packs', async () => {
        // The parent's arrived packs are posted a moment before the balance is made; a
        // clock a little ahead puts them after it. Anything else that came in still counts.
        const boughtAt = new Date(Date.now() - 2 * 3_600_000);
        const later = new Date(boughtAt.getTime() + 1000);
        const balance = { id: 'reqBal', status: 'BOUGHT', sentAt: boughtAt, boughtAt,
          notes: '[BALANCEOF:REQ-20260910-100] [ONTHEWAY:2026-09-17] Balance of REQ-20260910-100: still coming',
          lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 8000, packsBought: 8, packSize: 1000, receivedAt: null }] };

        const own = build({
          lowStock: [SUGAR], elsewhere: [balance],
          lots: [{ rawMaterialId: 'rm-sugar', qtyReceived: 2000, createdAt: later, referenceNumber: 'REQ-20260910-100-01' }],
        });
        const kept = await own.svc.pullLowStock(TENANT, BRANCH, USER);
        expect(kept.added).toBe(0);
        expect(kept.onTheWay[0].coming).toBe(8000);

        const other = build({
          lowStock: [SUGAR], elsewhere: [balance],
          lots: [{ rawMaterialId: 'rm-sugar', qtyReceived: 2000, createdAt: later, referenceNumber: 'REQ-20260910-1000-01' }],
        });
        const dropped = await other.svc.pullLowStock(TENANT, BRANCH, USER);
        expect(dropped.added).toBe(1);
        expect(dropped.onTheWay).toEqual([]);
      });

      it('a sent list older than three days is not believed', async () => {
        const old = build({ lowStock: [SUGAR], elsewhere: [{ ...SENT_SUGAR, sentAt: new Date(Date.now() - 73 * 3_600_000) }] });
        const res = await old.svc.pullLowStock(TENANT, BRANCH, USER);
        expect(res.added).toBe(1);
        expect(res.onTheWay).toEqual([]);
        expect(Number(old.created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(8000);

        const recent = build({ lowStock: [SUGAR], elsewhere: [{ ...SENT_SUGAR, sentAt: new Date(Date.now() - 71 * 3_600_000) }] });
        expect((await recent.svc.pullLowStock(TENANT, BRANCH, USER)).added).toBe(0);
      });

      it('a bought list older than a week is not believed, unless it is an order still waiting for its parcel', async () => {
        const eightDays = new Date(Date.now() - 8 * 86_400_000);
        const line = { rawMaterialId: 'rm-sugar', qtyRequested: 8000, packsBought: 8, packSize: 1000, receivedAt: null };

        const trip = build({ lowStock: [SUGAR], elsewhere: [{ id: 'reqB', status: 'BOUGHT', sentAt: eightDays, boughtAt: eightDays, lines: [line] }] });
        expect((await trip.svc.pullLowStock(TENANT, BRANCH, USER)).added).toBe(1);

        const parcel = build({ lowStock: [SUGAR], elsewhere: [{ id: 'reqB', status: 'BOUGHT', sentAt: eightDays, boughtAt: eightDays, notes: '[ONTHEWAY:2026-09-09]', lines: [line] }] });
        const res = await parcel.svc.pullLowStock(TENANT, BRANCH, USER);
        expect(res.added).toBe(0);
        expect(res.onTheWay[0].coming).toBe(8000);

        // Only a tag Procure wrote, in front: a person's words further along are not one.
        const typed = build({ lowStock: [SUGAR], elsewhere: [{ id: 'reqB', status: 'BOUGHT', sentAt: eightDays, boughtAt: eightDays, notes: 'Shopee [ONTHEWAY:2026-09-09]', lines: [line] }] });
        expect((await typed.svc.pullLowStock(TENANT, BRANCH, USER)).added).toBe(1);
      });
    });

    it('a line left blank on an order waiting for its parcel was not ordered, so it is still needed', async () => {
      // Only the cups were ordered on Shopee. The sugar line was left blank; the order
      // does not close, and put the sugar back on the list, until the parcel is posted.
      const { svc, created } = build({
        lowStock: [SUGAR],
        elsewhere: [{ id: 'reqB', status: 'BOUGHT', notes: '[ONTHEWAY:2026-09-04]', lines: [
          { rawMaterialId: 'rm-cups',  qtyRequested: 100,  packsBought: 1, packSize: 100, receivedAt: null },
          { rawMaterialId: 'rm-sugar', qtyRequested: 8000, packsBought: null, packSize: null, receivedAt: null },
        ] }],
      });
      const res = await svc.pullLowStock(TENANT, BRANCH, USER);
      expect(res.added).toBe(1);
      expect(res.onTheWay).toEqual([]);
      expect(Number(created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(8000);
    });

    it('covered only when what is coming reaches what the rule wants, so the amount asked never jumps', async () => {
      // 4,000 g short: the rule wants 8,000 g. One gram past the reorder level used to
      // count as covered, and the delivery left the shelf a gram over the line.
      const ask = async (coming: number) => {
        const { svc, created } = build({
          lowStock: [SUGAR],
          elsewhere: [{ id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: coming, receivedAt: null }] }],
        });
        const res = await svc.pullLowStock(TENANT, BRANCH, USER);
        const line = created.find((c) => c.rawMaterialId === 'rm-sugar');
        return { asked: line ? Number(line.qtyRequested) : 0, covered: res.onTheWay.length === 1 };
      };
      expect(await ask(4001)).toEqual({ asked: 3999, covered: false });
      expect(await ask(7999)).toEqual({ asked: 1, covered: false });
      expect(await ask(8000)).toEqual({ asked: 0, covered: true });
    });

    it('exactly on the line, as much as the reorder level coming covers it', async () => {
      const onTheLine = { ...SUGAR, quantity: 6000, shortBy: 0 };
      const covered = build({ lowStock: [onTheLine], elsewhere: [{ id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 6000, receivedAt: null }] }] });
      expect((await covered.svc.pullLowStock(TENANT, BRANCH, USER)).added).toBe(0);

      const partly = build({ lowStock: [onTheLine], elsewhere: [{ id: 'reqS', status: 'SENT', lines: [{ rawMaterialId: 'rm-sugar', qtyRequested: 1000, receivedAt: null }] }] });
      expect((await partly.svc.pullLowStock(TENANT, BRANCH, USER)).added).toBe(1);
      expect(Number(partly.created.find((c) => c.rawMaterialId === 'rm-sugar').qtyRequested)).toBe(5000);
    });
  });

  // ── cutoff ────────────────────────────────────────────────────────────────

  it('sends an EMPTY request rather than staying silent', async () => {
    // Silence cannot be told apart from a dead cron or a shop that never
    // looked. An explicit all-clear is what makes "no request" mean something.
    const { svc } = build({ lines: [] });
    const res = await svc.sendRequest(TENANT, 'req1', USER);
    expect(res.status).toBe('SENT');
    expect(res.empty).toBe(true);
  });

  it('marks a request with lines as sent, not empty', async () => {
    const { svc } = build({ lines: [{ id: 'l1', rawMaterialId: 'rm-x' }] });
    const res = await svc.sendRequest(TENANT, 'req1', USER);
    expect(res.empty).toBe(false);
  });

  it('will not send the same request twice', async () => {
    const { svc } = build({ status: 'SENT' });
    await expect(svc.sendRequest(TENANT, 'req1', USER)).rejects.toThrow(/already sent/i);
  });

  describe('the day a sent list is for', () => {
    // Only the clock is faked: the service's promises and timers run as they do in the shop.
    const at = (iso: string) => jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
    });
    afterEach(() => jest.useRealTimers());

    it('is stamped on the list, by the rule a kitchen tap uses, so the closing job counts it as sent', async () => {
      at('2026-09-17T15:00:00+08:00');   // from 10:00 Manila: tomorrow's shopping
      const afternoon = build({ lines: [], open: { notes: '[RCPT:abc] Aling Nena' } });
      const res = await afternoon.svc.sendRequest(TENANT, 'req1', USER);
      expect(res.notes).toBe('[RCPT:abc] [PLAN:2026-09-18] Aling Nena');   // what was there stays
      expect(res.sentAt).toEqual(new Date('2026-09-17T15:00:00+08:00'));

      at('2026-09-17T09:30:00+08:00');   // before 10:00: this morning's shopping
      const morning = build({ lines: [] });
      expect((await morning.svc.sendRequest(TENANT, 'req1', USER)).notes).toBe('[PLAN:2026-09-17]');
    });
  });

  // ── shopping ──────────────────────────────────────────────────────────────

  it('records containers and price, not a converted quantity', async () => {
    // Whoever shops sees "3 bottles at PHP 540", never "2,250 ml". Doing the
    // maths here is what lets the spreadsheet be a backup rather than the only
    // place the conversion can happen.
    const { svc, updatedLines } = build({
      status: 'SENT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz' }],
    });
    await svc.recordBought(TENANT, 'req1', [
      { lineId: 'l1', packsBought: 3, packSize: 750, packCost: 540, brandNote: 'Da Vinci' },
    ]);
    expect(Number(updatedLines[0].packsBought)).toBe(3);
    expect(Number(updatedLines[0].packSize)).toBe(750);
    expect(updatedLines[0].brandNote).toBe('Da Vinci');
  });

  it('records where it was bought when told, and a later fix that does not mention the store leaves it alone', async () => {
    const { svc, updatedLines } = build({ status: 'SENT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz' }] });
    await svc.recordBought(TENANT, 'req1', [
      { lineId: 'l1', packsBought: 3, packSize: 750, packCost: 540, sourceKind: 'ONLINE', sourceName: '  Shopee   Monin PH ' },
    ]);
    expect(updatedLines[0]).toMatchObject({ sourceKind: 'ONLINE', sourceName: 'Shopee Monin PH' });

    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 3, packSize: 750, packCost: 520 }]);
    expect('sourceKind' in updatedLines[1]).toBe(false);
    expect('sourceName' in updatedLines[1]).toBe(false);

    // Said as empty: cleared.
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 3, packSize: 750, packCost: 520, sourceKind: null, sourceName: '   ' }]);
    expect(updatedLines[2]).toMatchObject({ sourceKind: null, sourceName: null });
  });

  it('staff record a walk-in buy on the open list: it is sent and bought in the same save, and the Bought alert goes', async () => {
    /*
      KJ, 2026-09-17: a barista who bought the ice does not wait for the
      owner's Send. The list reads as sent a moment before, by whoever
      recorded it -- and carries no [PLAN] tag, because it did not ask for
      the next shopping.
    */
    const { svc, req, updatedLines } = build({
      status: 'OPEN', lines: [
        { id: 'l1', rawMaterialId: 'rm-ice', packsBought: null, rawMaterial: { name: 'Ice' } },
        { id: 'l2', rawMaterialId: 'rm-sugar', packsBought: null, rawMaterial: { name: 'White Sugar' } },
      ],
    });
    const alerts = { bought: jest.fn() };
    svc.telegramAlerts = alerts;
    const before = Date.now();
    const res = await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000, packCost: 60 }], { userId: 'barista', role: 'CASHIER' });

    expect(res.status).toBe('BOUGHT');
    expect(req()).toMatchObject({ status: 'BOUGHT', sentById: 'barista' });
    expect(req().sentAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(req().boughtAt).toEqual(req().sentAt);
    expect(req().notes).toBeUndefined();   // nothing written to the notes: no [PLAN]
    expect(updatedLines.map((u) => u.id)).toEqual(['l1']);
    expect(alerts.bought).toHaveBeenCalledWith(TENANT, 'req1', 'barista', null);
  });

  describe('the lines a walk-in buy did not record', () => {
    /*
      The barista bought the ice, not the sugar beside it on the open list.
      Left blank on the now-BOUGHT list, onTheWay counted the sugar as coming
      for a week, so that night's closing list left it out; it only went back
      on a list when the owner posted the ice.
    */
    const ICE   = { id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-ice', qtyRequested: 10000, shortBy: null, packsBought: null, receivedAt: null, rawMaterial: { name: 'Ice' } };
    const SUGAR = { id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-sugar', qtyRequested: 2000, shortBy: 500, packsBought: null, receivedAt: null, rawMaterial: { name: 'White Sugar' } };
    const BARISTA = { userId: 'barista', role: 'CASHIER' };
    const ICE_BOUGHT = [{ lineId: 'l1', packsBought: 2, packSize: 5000, packCost: 60 }];

    it('go straight back on a fresh open list and come off the bought one, so they stay to buy', async () => {
      const { svc, prisma, created } = build({ status: 'OPEN', lines: [ICE, SUGAR] });
      const res = await svc.recordBought(TENANT, 'req1', ICE_BOUGHT, BARISTA);

      const carried = created.find((c) => c.purchaseRequestId === 'open1');
      expect(carried).toMatchObject({ rawMaterialId: 'rm-sugar' });
      expect(Number(carried.qtyRequested)).toBe(2000);
      expect(Number(carried.shortBy)).toBe(500);
      expect(created.some((c) => c.purchaseRequestId === 'open1' && c.rawMaterialId === 'rm-ice')).toBe(false);
      expect(prisma.purchaseRequestLine.deleteMany).toHaveBeenCalledWith({
        where: { purchaseRequestId: 'req1', id: { in: ['l2'] }, packsBought: null, receivedAt: null },
      });
      expect(res.status).toBe('BOUGHT');
      expect(res.lines.map((l: any) => l.id)).toEqual(['l1']);
    });

    it('a list that was already sent keeps its blanks: they go back when it is posted, as before', async () => {
      const { svc, prisma, created } = build({ status: 'SENT', open: { sentAt: new Date(), sentById: 'anne' }, lines: [ICE, SUGAR] });
      const res = await svc.recordBought(TENANT, 'req1', ICE_BOUGHT, BARISTA);
      expect(created.some((c) => c.purchaseRequestId === 'open1')).toBe(false);
      expect(prisma.purchaseRequestLine.deleteMany).not.toHaveBeenCalled();
      expect(res.lines.map((l: any) => l.id)).toEqual(['l1', 'l2']);
    });

    it('nothing left over, nothing moved', async () => {
      const { svc, prisma, created } = build({ status: 'OPEN', lines: [ICE] });
      await svc.recordBought(TENANT, 'req1', ICE_BOUGHT, BARISTA);
      expect(created.some((c) => c.purchaseRequestId === 'open1')).toBe(false);
      expect(prisma.purchaseRequestLine.deleteMany).not.toHaveBeenCalled();
    });

    it('when moving them fails, the purchase is still saved, the blanks stay where they were, and it is logged', async () => {
      const { svc, prisma, req } = build({ status: 'OPEN', lines: [ICE, SUGAR] });
      prisma.purchaseRequestLine.create.mockRejectedValueOnce(new Error('connection reset'));
      const logged = jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
      const res = await svc.recordBought(TENANT, 'req1', ICE_BOUGHT, BARISTA);
      expect(req().status).toBe('BOUGHT');
      expect(prisma.purchaseRequestLine.deleteMany).not.toHaveBeenCalled();
      expect(res.lines.map((l: any) => l.id)).toEqual(['l1', 'l2']);
      expect(logged).toHaveBeenCalledWith(expect.stringContaining('REQ-20260830-001'), expect.anything());
    });
  });

  it('staff still cannot say an open list was paid, whether or not the shop shows them costs', async () => {
    const line = { id: 'l1', rawMaterialId: 'rm-ice', packsBought: null, rawMaterial: { name: 'Ice' } };
    const row  = [{ lineId: 'l1', packsBought: 2, packSize: 5000, packCost: 60 }];
    const staff = { userId: 'barista', role: 'CASHIER' };
    await expect(build({ status: 'OPEN', lines: [line] }).svc.recordBought(TENANT, 'req1', row, staff, { onTheWay: true, paidFrom: 'CASH' }))
      .rejects.toThrow(/Only the owner or manager can say the order was paid/);
    const hidden = build({ status: 'OPEN', lines: [line], showCostsToStaff: false });
    await expect(hidden.svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000 }], staff, { onTheWay: true, paidFrom: 'CASH' }))
      .rejects.toThrow(/Only the owner or manager can say the order was paid/);
    expect(hidden.req().status).toBe('OPEN');
  });

  it('a list already sent keeps the moment and the person it was sent by when it is bought', async () => {
    const sentAt = new Date('2026-09-17T02:00:00Z');
    const { svc, prisma } = build({ status: 'SENT', open: { sentAt, sentById: 'anne' }, lines: [{ id: 'l1', rawMaterialId: 'rm-haz', packsBought: null, rawMaterial: { name: 'Hazelnut Syrup' } }] });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 750, packCost: 540 }], { userId: 'barista', role: 'CASHIER' });
    const data = prisma.purchaseRequest.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('sentAt');
    expect(data).not.toHaveProperty('sentById');
  });

  it('refuses to record shopping on a request that is closed or cancelled', async () => {
    for (const status of ['RECEIVED', 'CANCELLED']) {
      const { svc } = build({ status, lines: [{ id: 'l1' }] });
      await expect(svc.recordBought(TENANT, 'req1', [
        { lineId: 'l1', packsBought: 1, packSize: 100, packCost: 10 },
      ])).rejects.toThrow(`Nothing more can be recorded as bought on this request (it is ${status.toLowerCase()}).`);
    }
  });

  // ── posting to stock ──────────────────────────────────────────────────────

  const BOUGHT = [{
    id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-haz',
    packsBought: 3, packSize: 750, packCost: 540, brandNote: 'Da Vinci', sourceKind: 'ONLINE', sourceName: 'Shopee',
    receivedAt: null, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' },
  }];

  it('refuses to rewrite a line that is already in stock', async () => {
    /*
      A request sits at BOUGHT when one of its lines failed to post, and the
      bought-window admits BOUGHT — so the lines that DID post were still
      editable here. Changing packs or price then moved neither the shelf nor
      the books; it just left the request disagreeing with both. The screen
      always hid the boxes for a posted line; the server never checked.
    */
    const { svc } = build({
      status: 'BOUGHT',
      lines: [{ ...BOUGHT[0], receivedAt: new Date('2026-09-03T02:00:00Z') }],
    });

    await expect(
      svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 9, packSize: 750, packCost: 100 }]),
    ).rejects.toThrow(/already in stock/i);
  });

  it('posts the real cost even when staff are not allowed to see it', async () => {
    /*
      Hiding costs is a matter for screens, never for the posting. The read
      that serves a cook blanks the money; the write paths read the request
      raw. When those were the same call, a shop with the switch off would
      have posted its deliveries into stock at a cost of nothing.
    */
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT, showCostsToStaff: false });
    const res = await svc.receiveRequest(TENANT, 'req1', USER);

    expect(received[0].costPrice).toBeCloseTo(0.72);
    expect(res.posted).toHaveLength(1);
  });

  it('converts packs to units and price per unit when posting', async () => {
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER);

    expect(received[0].quantity).toBe(2250);          // 3 x 750
    expect(received[0].costPrice).toBeCloseTo(0.72);  // 540 / 750
    expect(res.posted).toHaveLength(1);
  });

  it('passes the line control number as the receive reference', async () => {
    // This is what makes "do not receive the same line twice" a database rule
    // instead of something a person has to remember.
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    await svc.receiveRequest(TENANT, 'req1', USER);
    expect(received[0].referenceNumber).toBe('REQ-20260830-001-01');
  });

  it('reports a duplicate as skipped rather than posting it again', async () => {
    const { svc, res } = { ...build({
      status: 'BOUGHT', lines: BOUGHT,
      receiveImpl: () => ({ duplicate: true, quantity: 2250 }),
    }), res: undefined as any };
    const out = await svc.receiveRequest(TENANT, 'req1', USER);
    expect(out.posted).toHaveLength(0);
    expect(out.skipped[0].reason).toMatch(/already received/i);
  });

  const UNBOUGHT = {
    id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-x', qtyRequested: 200, shortBy: 50,
    packsBought: null, packSize: null, packCost: null, receivedAt: null,
    rawMaterial: { name: 'Dried Lemon', unit: 'g' },
  };

  it('carries a line nobody bought onto the open list, and says so, instead of dropping it', async () => {
    /*
      The screen has always promised "anything left blank stays on the list
      for next time". The server closed the request and the line vanished.
      Now it goes onto the branch's open list with its own control number.
    */
    const { svc, created, res: _r } = { ...build({ status: 'BOUGHT', lines: [...BOUGHT, UNBOUGHT] }), res: null };
    const res = await svc.receiveRequest(TENANT, 'req1', USER);
    expect(res.posted).toHaveLength(1);
    expect(res.skipped[0].reason).toMatch(/nothing was bought/i);
    expect(res.request.status).toBe('RECEIVED');
    expect(res.carried).toEqual([expect.objectContaining({ name: 'Dried Lemon', qtyRequested: 200, alreadyThere: false })]);
    const carried = created.find((c) => c.rawMaterialId === 'rm-x' && c.purchaseRequestId === 'open1');
    expect(Number(carried.qtyRequested)).toBe(200);
    expect(Number(carried.shortBy)).toBe(50);
    expect(carried.lineNumber).toMatch(/-01$/);
  });

  it('leaves a carried line alone when somebody already put it back on the list', async () => {
    const { svc, created } = build({
      status: 'BOUGHT', lines: [...BOUGHT, UNBOUGHT],
      openList: { id: 'open1', requestNumber: 'REQ-20260831-001', status: 'OPEN', lines: [{ id: 'o1', lineNumber: 'REQ-20260831-001-01', rawMaterialId: 'rm-x' }] },
    });
    const res = await svc.receiveRequest(TENANT, 'req1', USER);
    expect(res.carried[0].alreadyThere).toBe(true);
    expect(created.some((c) => c.rawMaterialId === 'rm-x')).toBe(false);
  });

  describe('carrying blanks back from an order that waited for its parcel', () => {
    // Ordered Sep 4 (Manila midnight, as a typed "Bought on" date is stored), posted days later.
    const ORDERED = { notes: '[ONTHEWAY:2026-09-04] Shopee order 2609041234', boughtAt: new Date('2026-09-03T16:00:00Z'), sentAt: new Date('2026-09-03T01:00:00Z') };
    const OAT = { ...UNBOUGHT, id: 'l3', lineNumber: 'REQ-20260830-001-03', rawMaterialId: 'rm-oat', rawMaterial: { name: 'Oat Milk', unit: 'ml' } };
    const onOpenList = (created: any[]) => created.filter((c) => c.purchaseRequestId === 'open1').map((c) => c.rawMaterialId);

    it('leaves off a line whose ingredient came in at the branch after the order, and still carries the rest', async () => {
      const { svc, created } = build({
        status: 'BOUGHT', open: ORDERED, lines: [...BOUGHT, UNBOUGHT, OAT],
        lots: [
          { rawMaterialId: 'rm-x', qtyReceived: 500, createdAt: new Date('2026-09-05T03:00:00Z') },    // the lemons, bought at the grocery since
          { rawMaterialId: 'rm-oat', qtyReceived: -200, createdAt: new Date('2026-09-05T03:00:00Z') }, // a write-off is stock leaving, not coming in
        ],
      });
      const res = await svc.receiveRequest(TENANT, 'req1', USER);
      expect(res.request.status).toBe('RECEIVED');
      expect(res.carried.map((c: any) => c.name)).toEqual(['Oat Milk']);
      expect(onOpenList(created)).toEqual(['rm-oat']);
    });

    it('stock that came in before the order was bought, or at another branch, does not stand in for it', async () => {
      const { svc, created } = build({
        status: 'BOUGHT', open: ORDERED, lines: [...BOUGHT, UNBOUGHT],
        lots: [
          { rawMaterialId: 'rm-x', qtyReceived: 500, createdAt: new Date('2026-09-03T10:00:00Z') },
          { rawMaterialId: 'rm-x', qtyReceived: 500, createdAt: new Date('2026-09-05T03:00:00Z'), branchId: 'b2' },
        ],
      });
      const res = await svc.receiveRequest(TENANT, 'req1', USER);
      expect(res.carried.map((c: any) => c.name)).toEqual(['Dried Lemon']);
      expect(onOpenList(created)).toEqual(['rm-x']);
    });

    it('a grocery trip, not on the way, carries its blanks back as before', async () => {
      const { svc, created, prisma } = build({
        status: 'BOUGHT', open: { notes: null, boughtAt: ORDERED.boughtAt }, lines: [...BOUGHT, UNBOUGHT],
        lots: [{ rawMaterialId: 'rm-x', qtyReceived: 500, createdAt: new Date('2026-09-05T03:00:00Z') }],
      });
      const res = await svc.receiveRequest(TENANT, 'req1', USER);
      expect(res.carried.map((c: any) => c.name)).toEqual(['Dried Lemon']);
      expect(onOpenList(created)).toEqual(['rm-x']);
      expect(prisma.rawMaterialLot.findMany).not.toHaveBeenCalled();
    });

    it('a balance of a short delivery does not take its parent\'s own packs, posted a moment before it, as the item coming in', async () => {
      const balance = {
        notes: '[BALANCEOF:REQ-20260829-004] [ONTHEWAY:2026-09-04] Balance of REQ-20260829-004: still coming',
        boughtAt: new Date('2026-09-04T02:00:00.000Z'), sentAt: new Date('2026-09-04T02:00:00.000Z'),
      };
      const stillComing = { ...BOUGHT[0], id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-x', qtyRequested: 750, shortBy: null, rawMaterial: { name: 'Dried Lemon', unit: 'g' } };
      const { svc, created } = build({
        status: 'BOUGHT', open: balance, lines: [...BOUGHT, stillComing],
        // The parent's lemons, stamped a millisecond after the balance by a clock that runs a little ahead.
        lots: [{ rawMaterialId: 'rm-x', qtyReceived: 1500, createdAt: new Date('2026-09-04T02:00:00.001Z'), referenceNumber: 'REQ-20260829-004-02' }],
      });
      const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }], closeRest: true });
      expect(res.request.status).toBe('RECEIVED');
      expect(res.carried.map((c: any) => c.name)).toEqual(['Dried Lemon']);
      expect(onOpenList(created)).toEqual(['rm-x']);
    });
  });

  it('one failing line does not cost the rest of the delivery', async () => {
    const { svc } = build({
      status: 'BOUGHT',
      lines: [
        ...BOUGHT,
        { id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-bad',
          packsBought: 1, packSize: 100, packCost: 10, receivedAt: null,
          rawMaterial: { name: 'Locked Item', unit: 'g' } },
      ],
      receiveImpl: (rmId: string) => {
        if (rmId === 'rm-bad') throw new Error('That accounting period is closed.');
        return { quantity: 1 };
      },
    });
    const res = await svc.receiveRequest(TENANT, 'req1', USER);
    expect(res.posted).toHaveLength(1);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].reason).toMatch(/period is closed/i);
  });

  it('does not close a request that still has failures', async () => {
    // A partly posted request reading RECEIVED would hide the lines that did
    // not make it.
    const { svc } = build({
      status: 'BOUGHT', lines: BOUGHT,
      receiveImpl: () => { throw new Error('nope'); },
    });
    const res = await svc.receiveRequest(TENANT, 'req1', USER);
    expect(res.request.status).not.toBe('RECEIVED');
  });

  it('defaults to CASH, the way an MSME actually pays', async () => {
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    await svc.receiveRequest(TENANT, 'req1', USER);
    expect(received[0].paymentMethod).toBe('CASH');
    expect(received[0].vendorId).toBeUndefined();   // no vendor anywhere in this flow
  });

  it('records OWNER_FUNDED when the owner paid out of pocket', async () => {
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    await svc.receiveRequest(TENANT, 'req1', USER, 'OWNER_FUNDED');
    expect(received[0].paymentMethod).toBe('OWNER_FUNDED');
  });

  it('refuses to cancel something already in stock', async () => {
    const { svc } = build({ status: 'RECEIVED' });
    await expect(svc.cancel(TENANT, 'req1')).rejects.toThrow(/already in stock/i);
  });

  // ── the receive card learns four things ───────────────────────────────────

  const SECOND = {
    id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-sug',
    packsBought: 2, packSize: 1000, packCost: 85, brandNote: null,
    receivedAt: null, rawMaterial: { name: 'White Sugar', unit: 'g' },
  };

  it('posts on the day the goods came, with the person\'s note on the lot and the request', async () => {
    // A Saturday market run typed on Monday landed in Monday's books.
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { receivedAt: '2026-09-05', note: 'Aling Nena, no receipt' });
    expect(received[0].receivedAt).toBe('2026-09-05');
    expect(received[0].note).toMatch(/Aling Nena/);
    expect(res.request.notes).toMatch(/Aling Nena, no receipt/);
  });

  it('refuses a date that is not one', async () => {
    const { svc } = build({ status: 'BOUGHT', lines: BOUGHT });
    await expect(svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { receivedAt: 'last saturday' })).rejects.toThrow(/real date/i);
  });

  it('posts only the ticked lines and keeps the request open for the rest', async () => {
    // Half the trip was paid from the till and half from the owner's wallet:
    // post the till lines, then the others with the other pocket.
    const { svc, received, updatedLines } = build({ status: 'BOUGHT', lines: [...BOUGHT, SECOND] });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }] });
    expect(received.map((r) => r.rawMaterialId)).toEqual(['rm-haz']);
    expect(res.posted).toHaveLength(1);
    expect(res.request.status).toBe('BOUGHT');                       // sugar still waiting
    expect(updatedLines.some((u) => u.id === 'l2')).toBe(false);
    expect(res.carried).toEqual([]);
  });

  it('refuses a line that is not on the request', async () => {
    const { svc } = build({ status: 'BOUGHT', lines: BOUGHT });
    await expect(svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'someone-elses' }] })).rejects.toThrow(/not on this request/i);
  });

  it('closes on request and sends what was not posted back to the shopping list', async () => {
    // "The rest isn't coming" -- but it is still needed, so it goes back on the list.
    const { svc, created } = build({ status: 'BOUGHT', lines: [...BOUGHT, { ...SECOND, qtyRequested: 2000 }, UNBOUGHT] });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }], closeRest: true });
    expect(res.request.status).toBe('RECEIVED');
    expect(res.carried.map((c) => c.name).sort()).toEqual(['Dried Lemon', 'White Sugar']);
    const onOpen = created.filter((c) => c.purchaseRequestId === 'open1').map((c) => c.lineNumber);
    expect(onOpen).toHaveLength(2);
    expect(onOpen[0]).toMatch(/^REQ-\d{8}-\d{3}-01$/);
    expect(onOpen[1]).toMatch(/^REQ-\d{8}-\d{3}-02$/);
  });

  it('the shop\'s bank is a pocket of its own', async () => {
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    await svc.receiveRequest(TENANT, 'req1', USER, 'BANK');
    expect(received[0].paymentMethod).toBe('BANK');
  });

  // ── what came short ───────────────────────────────────────────────────────

  it('a short line posts what arrived, and the rest becomes a follow-up already on the way', async () => {
    const { svc, received, updatedLines, createdRequests } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1', packsArrived: 2 }] });

    expect(received[0].quantity).toBe(1500);                          // 2 x 750, not 3 x 750
    expect(Number(updatedLines.find((u) => u.id === 'l1').packsBought)).toBe(2);   // the line now says what is on the shelf
    expect(res.short).toEqual([expect.objectContaining({ name: 'Hazelnut Syrup', packsBought: 3, packsArrived: 2, outcome: 'STILL_COMING' })]);

    const follow = createdRequests.find((r) => r.status === 'BOUGHT');
    expect(res.followUp).toEqual({ id: 'follow1', requestNumber: follow.requestNumber, lines: 1 });
    expect(follow.notes).toMatch(/\[BALANCEOF:REQ-20260830-001\]/);
    expect(follow.notes).toMatch(/\[ONTHEWAY:\d{4}-\d{2}-\d{2}\]/);
    expect(follow.notes).toMatch(/still coming/);
    const line = follow.lines[0];
    expect(Number(line.packsBought)).toBe(1);
    expect(Number(line.packSize)).toBe(750);
    expect(Number(line.packCost)).toBe(540);
    // The balance comes from the same store as the rest of the order.
    expect(line).toMatchObject({ sourceKind: 'ONLINE', sourceName: 'Shopee' });
    expect(Number(line.qtyRequested)).toBe(750);
    expect(line.lineNumber).toBe(`${follow.requestNumber}-01`);
    expect(res.request.notes).toMatch(/bought 3, 2 arrived, 1 still coming/);
    expect(res.request.status).toBe('RECEIVED');
  });

  it('refuses more arriving than was bought, and says what to change', async () => {
    const { svc, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1', packsArrived: 4 }] });
    expect(received).toHaveLength(0);
    expect(res.failed[0].reason).toMatch(/Change Packs first/);
    expect(res.request.status).toBe('BOUGHT');
  });

  it('a lost pack is expensed from the same pocket -- twice over when the owner paid', async () => {
    const { svc, entries } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'OWNER_FUNDED', {
      lines: [{ lineId: 'l1', packsArrived: 2 }], closeShort: [{ lineId: 'l1', outcome: 'LOST' }],
    });
    expect(res.followUp).toBeNull();
    expect(entries.map((e) => e.type)).toEqual(['EXPENSE', 'OWNER_CONTRIBUTION']);
    expect(entries[0]).toMatchObject({ amount: 540, category: 'OTHER', source: 'CASH' });
    expect(entries[0].note).toMatch(/Hazelnut Syrup — 1 pack paid for and lost/);
    expect(res.charges[0].entryNumber).toBe('JE-1');
    expect(res.request.notes).toMatch(/1 lost, expensed/);
  });

  it('a refunded pack posts nothing more: the pocket was only charged for what came', async () => {
    const { svc, entries, received } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', {
      lines: [{ lineId: 'l1', packsArrived: 2 }], closeShort: [{ lineId: 'l1', outcome: 'REFUNDED' }],
    });
    expect(received[0].quantity).toBe(1500);
    expect(entries).toEqual([]);
    expect(res.followUp).toBeNull();
    expect(res.request.notes).toMatch(/1 refunded/);
  });

  it('nothing arrived: the line closes empty and the whole order is the follow-up', async () => {
    const { svc, received, updatedLines, createdRequests } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1', packsArrived: 0 }] });
    expect(received).toHaveLength(0);
    expect(res.posted).toHaveLength(0);
    const l1 = updatedLines.find((u) => u.id === 'l1');
    expect(Number(l1.packsBought)).toBe(0);
    expect(l1.receivedAt).toBeInstanceOf(Date);
    expect(Number(createdRequests.find((r) => r.status === 'BOUGHT').lines[0].packsBought)).toBe(3);
    expect(res.request.status).toBe('RECEIVED');
  });

  // ── charges that came with the goods ──────────────────────────────────────

  it('posts the charges with the goods, from the same pocket, freight as a cost of the goods', async () => {
    const { svc, entries } = build({ status: 'BOUGHT', lines: BOUGHT });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'BANK', {
      receivedAt: '2026-09-05',
      charges: [{ description: 'Shopee shipping', amount: 80, category: 'FREIGHT' }, { description: 'Parking', amount: 20 }],
    });
    expect(entries).toEqual([
      expect.objectContaining({ type: 'EXPENSE', amount: 80, category: 'FREIGHT', source: 'BANK', date: '2026-09-05' }),
      expect.objectContaining({ type: 'EXPENSE', amount: 20, category: 'OTHER',   source: 'BANK' }),
    ]);
    expect(entries[0].note).toMatch(/REQ-20260830-001: Shopee shipping/);
    expect(res.charges.map((c) => c.entryNumber)).toEqual(['JE-1', 'JE-2']);
  });

  it('does not post a charge when nothing reached the shelf in the same call', async () => {
    // A charge posted twice is worse than one posted late.
    const { svc, entries } = build({ status: 'BOUGHT', lines: [{ ...BOUGHT[0], receivedAt: new Date() }] });
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { charges: [{ description: 'Shipping', amount: 80 }] });
    expect(entries).toEqual([]);
    expect(res.charges[0].error).toMatch(/nothing was posted/i);
  });

  // ── recording: who, and what ──────────────────────────────────────────────

  it('refuses a zero price when recording, and says why', async () => {
    const { svc } = build({ status: 'SENT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz', rawMaterial: { name: 'Hazelnut Syrup' } }] });
    await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 750, packCost: 0 }]))
      .rejects.toThrow(/average cost down/i);
  });

  it('lets staff type the price only when the shop shows them costs; otherwise they record without one', async () => {
    const line = { id: 'l1', rawMaterialId: 'rm-haz', packsBought: null, rawMaterial: { name: 'Hazelnut Syrup' } };
    const row  = [{ lineId: 'l1', packsBought: 1, packSize: 750, packCost: 540 }];

    // KJ, 2026-09-21: a shop that hides costs no longer refuses them -- packs and size, no price.
    const hidden = build({ status: 'SENT', lines: [line], showCostsToStaff: false });
    const blind = await hidden.svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 750 }], { userId: 'cook', role: 'GENERAL_EMPLOYEE' });
    expect(blind.status).toBe('BOUGHT');
    expect(hidden.updatedLines[0]).toMatchObject({ id: 'l1', packCost: null });

    const shown = build({ status: 'SENT', lines: [line], showCostsToStaff: true });
    const res = await shown.svc.recordBought(TENANT, 'req1', row, { userId: 'cook', role: 'GENERAL_EMPLOYEE' });
    expect(res.status).toBe('BOUGHT');
    expect(shown.updatedLines[0].id).toBe('l1');
    expect(Number(shown.updatedLines[0].packCost)).toBe(540);
    // Shown costs, so a price is still asked for.
    const noPrice = build({ status: 'SENT', lines: [line], showCostsToStaff: true });
    await expect(noPrice.svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 1, packSize: 750 }], { userId: 'cook', role: 'GENERAL_EMPLOYEE' }))
      .rejects.toThrow(/What did one pack cost\?/);
  });

  describe('staff on a shop that hides purchase costs (KJ, 2026-09-21)', () => {
    /*
      Cafe Carolina: purchase costs are not shown to staff. A barista who
      bought ice nearby used to be refused outright, so the ice never reached
      the list. Now they record packs and size; the price is last time's, for
      the owner to check against the receipt, and posting stays the owner's.
    */
    const ICE = {
      id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-ice', qtyRequested: 10000, shortBy: null,
      packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'Ice', unit: 'g', costPrice: 0.012 },
    };
    const MILK = {
      id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-milk', qtyRequested: 2000, shortBy: null,
      packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'Fresh Milk', unit: 'ml', costPrice: 0.095 },
    };
    const LAST_ICE = [{ rawMaterialId: 'rm-ice', packSize: 5000, packCost: 60, brandNote: null, receivedAt: new Date('2026-09-18T02:00:00Z') }];
    const BARISTA = { userId: 'barista', role: 'CASHIER' };
    const OWNER   = { userId: USER, role: 'BUSINESS_OWNER' };
    const PEOPLE  = [{ id: 'owner', email: null, name: 'Carol', role: 'BUSINESS_OWNER' }];
    const hidden  = (lines: any[], more: any = {}) => build({ status: 'OPEN', lines, showCostsToStaff: false, lastPacks: LAST_ICE, people: PEOPLE, ...more });

    /** Every non-empty value under a money-sounding key, anywhere in what came back. */
    const moneyIn = (x: any, path = ''): string[] => {
      if (x == null || typeof x !== 'object') return [];
      return Object.entries(x).flatMap(([k, v]) => {
        const here = `${path}.${k}`;
        if (/cost|price|amount|total|value|paid/i.test(k) && v != null && typeof v !== 'boolean') return [here];
        return typeof v === 'object' ? moneyIn(v, here) : [];
      });
    };

    it('records packs and size with no price: saved, the price filled from last time, and none of it sent back', async () => {
      const { svc, req, updatedLines } = hidden([ICE]);
      const res = await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000 }], BARISTA);

      expect(res.status).toBe('BOUGHT');
      expect(updatedLines[0]).toMatchObject({ id: 'l1' });
      expect(Number(updatedLines[0].packCost)).toBe(60);           // last time's, same bag
      expect(lastPricedLines(req().notes)).toEqual(new Set(['l1'])); // marked for the owner to check
      // Nothing that comes back to the barista carries a peso.
      expect(moneyIn(res)).toEqual([]);
      expect(res.costsHidden).toBe(true);
      expect(res.lines[0].packCost).toBeNull();
      expect(res.lines[0].rawMaterial.costPrice).toBeNull();
    });

    it('the owner sees the filled-in price, and which lines it is on', async () => {
      const { svc } = hidden([ICE]);
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000 }], BARISTA);

      const seen = await svc.get(TENANT, 'req1', 'BUSINESS_OWNER');
      expect(Number(seen.lines[0].packCost)).toBe(60);
      expect(lastPricedLines(seen.notes)).toEqual(new Set(['l1']));
      // The barista reading the same request still sees no price.
      const blind = await svc.get(TENANT, 'req1', 'CASHIER');
      expect(blind.lines[0].packCost).toBeNull();
      expect(moneyIn(blind)).toEqual([]);
    });

    it('a different bag is priced per unit from last time; a first-time item is left without a price', async () => {
      const { svc, req, updatedLines } = hidden([ICE, MILK]);
      await svc.recordBought(TENANT, 'req1', [
        { lineId: 'l1', packsBought: 1, packSize: 8000 },   // an 8 kg bag this time
        { lineId: 'l2', packsBought: 2, packSize: 1000 },   // never bought before
      ], BARISTA);
      expect(Number(updatedLines.find((u) => u.id === 'l1').packCost)).toBe(96);   // 60 / 5000 g x 8000 g
      expect(updatedLines.find((u) => u.id === 'l2').packCost).toBeNull();
      expect(lastPricedLines(req().notes)).toEqual(new Set(['l1']));   // only the one that has a price to check
    });

    it('a price the client sends anyway is set aside, and nobody is asked whether it is right', async () => {
      const { svc, updatedLines } = hidden([ICE]);
      const sanity = { checkIngredientCosts: jest.fn(), enforce: jest.fn(), recordConfirmed: jest.fn() };
      svc.sanity = sanity;
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000, packCost: 1 }], BARISTA,
        { sanity: { optedIn: true } as any });
      expect(Number(updatedLines[0].packCost)).toBe(60);
      expect(sanity.checkIngredientCosts).not.toHaveBeenCalled();   // the question names what it usually costs
    });

    it('the owner still hears it: the bell and the Telegram alert', async () => {
      const { svc, notified } = hidden([ICE]);
      const alerts = { bought: jest.fn() };
      svc.telegramAlerts = alerts;
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000 }], BARISTA);
      expect(alerts.bought).toHaveBeenCalledWith(TENANT, 'req1', 'barista', null);
      expect(notified).toHaveLength(1);
      expect(notified[0]).toMatchObject({ userId: 'owner', title: 'Bought: REQ-20260830-001 — post it to stock' });
      expect(notified[0].body).not.toMatch(/₱|\d+\.\d\d/);
    });

    it('staff still get one go at a line', async () => {
      const { svc } = hidden([{ ...ICE, packsBought: 2, packSize: 5000, packCost: 60 }], { status: 'BOUGHT' });
      await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 3, packSize: 5000 }], BARISTA))
        .rejects.toThrow(/already recorded/i);
    });

    it('posting a line with no price is refused in plain words; the rest posts and the request stays open', async () => {
      const { svc, req, received } = hidden([ICE, MILK], { status: 'BOUGHT' });
      Object.assign(req().lines[0], { packsBought: 2, packSize: 5000, packCost: 60 });
      Object.assign(req().lines[1], { packsBought: 2, packSize: 1000, packCost: null });

      const res = await svc.receiveRequest(TENANT, 'req1', USER);
      expect(res.failed).toEqual([{ line: 'REQ-20260830-001-02', name: 'Fresh Milk', reason: 'Add the price from the receipt before posting.' }]);
      expect(received.map((r) => r.rawMaterialId)).toEqual(['rm-ice']);
      expect(req().status).toBe('BOUGHT');   // not closed: the milk is still to post
      expect(req().lines[1].receivedAt).toBeNull();
    });

    it('the owner adds the price from the receipt, then posts: the line is off the check list and in stock at that price', async () => {
      const { svc, req, received } = hidden([ICE, MILK]);
      await svc.recordBought(TENANT, 'req1', [
        { lineId: 'l1', packsBought: 2, packSize: 5000 },
        { lineId: 'l2', packsBought: 2, packSize: 1000 },
      ], BARISTA);
      expect(lastPricedLines(req().notes)).toEqual(new Set(['l1']));

      // Posting before the milk has a price posts nothing of the milk.
      const early = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l2' }] });
      expect(early.failed[0].reason).toBe('Add the price from the receipt before posting.');
      expect(received).toEqual([]);

      // The receipt says the ice was 65 a bag and the milk 95 a litre.
      await svc.recordBought(TENANT, 'req1', [
        { lineId: 'l1', packsBought: 2, packSize: 5000, packCost: 65 },
        { lineId: 'l2', packsBought: 2, packSize: 1000, packCost: 95 },
      ], OWNER);
      expect(lastPricedLines(req().notes)).toEqual(new Set());
      expect(req().notes ?? '').not.toMatch(/LASTPRICE/);

      const res = await svc.receiveRequest(TENANT, 'req1', USER);
      expect(res.failed).toEqual([]);
      expect(received.find((r) => r.rawMaterialId === 'rm-ice').costPrice).toBeCloseTo(65 / 5000);
      expect(received.find((r) => r.rawMaterialId === 'rm-milk').costPrice).toBeCloseTo(0.095);
      expect(req().status).toBe('RECEIVED');
    });

    it('the owner fixing one line leaves the other still marked to check', async () => {
      const both = [{ rawMaterialId: 'rm-milk', packSize: 1000, packCost: 90, brandNote: null, receivedAt: new Date('2026-09-18T02:00:00Z') }, ...LAST_ICE];
      const { svc, req } = hidden([ICE, MILK], { lastPacks: both });
      await svc.recordBought(TENANT, 'req1', [
        { lineId: 'l1', packsBought: 2, packSize: 5000 },
        { lineId: 'l2', packsBought: 2, packSize: 1000 },
      ], BARISTA);
      expect(lastPricedLines(req().notes)).toEqual(new Set(['l1', 'l2']));
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l2', packsBought: 2, packSize: 1000, packCost: 95 }], OWNER);
      expect(lastPricedLines(req().notes)).toEqual(new Set(['l1']));
    });

    it('a shop that shows costs to staff keeps the old way: they type the price, nothing is marked', async () => {
      const { svc, req, updatedLines } = build({ status: 'OPEN', lines: [ICE], lastPacks: LAST_ICE });
      const res = await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 5000, packCost: 62 }], BARISTA);
      expect(Number(updatedLines[0].packCost)).toBe(62);
      expect(req().notes).toBeUndefined();
      expect(res.costsHidden).toBeUndefined();
    });

    it('last time\'s price, per unit', () => {
      expect(priceFromLastTime({ packSize: 750, packCost: 540 }, 750)).toBe(540);
      expect(priceFromLastTime({ packSize: 750, packCost: 540 }, 1000)).toBe(720);
      expect(priceFromLastTime({ packSize: 3, packCost: 100 }, 1)).toBe(33.33);
      expect(priceFromLastTime(undefined, 750)).toBeNull();
      expect(priceFromLastTime({ packSize: 750, packCost: null }, 750)).toBeNull();
      expect(priceFromLastTime({ packSize: 750, packCost: 540 }, 0)).toBeNull();
    });
  });

  it('gives staff one go at a line; a manager may change it', async () => {
    const line = { ...BOUGHT[0] };   // already recorded
    const row  = [{ lineId: 'l1', packsBought: 9, packSize: 750, packCost: 540 }];
    const staff = build({ status: 'BOUGHT', lines: [line] });
    await expect(staff.svc.recordBought(TENANT, 'req1', row, { userId: 'cook', role: 'GENERAL_EMPLOYEE' }))
      .rejects.toThrow(/already recorded/i);
    const manager = build({ status: 'BOUGHT', lines: [line] });
    await expect(manager.svc.recordBought(TENANT, 'req1', row, { userId: 'mgr', role: 'BRANCH_MANAGER' })).resolves.toBeTruthy();
  });

  it('marks an online order as on the way, dated the day it was ordered', async () => {
    const { svc, req } = build({ status: 'SENT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz', packsBought: null, rawMaterial: { name: 'Hazelnut Syrup' } }] });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }],
      { userId: USER, role: 'BUSINESS_OWNER' }, { boughtAt: '2026-09-04', onTheWay: true, note: 'Shopee order 2609041234' });
    expect(req().notes).toMatch(/\[ONTHEWAY:2026-09-04\]/);
    expect(req().notes).toMatch(/Shopee order 2609041234/);
    expect(req().boughtAt.toISOString()).toBe('2026-09-03T16:00:00.000Z');   // midnight in Manila
  });

  // ── remembered, and filed ─────────────────────────────────────────────────

  it('remembers what an ingredient cost last time, and hides that price from staff who may not see it', async () => {
    const lastPacks = [{ rawMaterialId: 'rm-haz', packSize: 750, packCost: 540, brandNote: 'Da Vinci', receivedAt: new Date('2026-09-01T02:00:00Z') }];
    const line = { id: 'l1', rawMaterialId: 'rm-haz', packsBought: null, packCost: null, rawMaterial: { name: 'Hazelnut Syrup', costPrice: 0.72 } };

    const owner = build({ status: 'SENT', lines: [line], lastPacks });
    const seen = await owner.svc.get(TENANT, 'req1', 'BUSINESS_OWNER');
    expect(seen.lines[0].lastPack).toMatchObject({ packSize: 750, packCost: 540, brandNote: 'Da Vinci' });

    const cook = build({ status: 'SENT', lines: [line], lastPacks, showCostsToStaff: false });
    const blind = await cook.svc.get(TENANT, 'req1', 'CASHIER');
    expect(blind.lines[0].lastPack).toMatchObject({ packSize: 750, packCost: null });
  });

  it('files the photo against the request, labelled, by whoever is holding it', async () => {
    const { svc, docs } = build({ status: 'SENT', lines: [] });
    const out = await svc.attachPhoto(TENANT, 'req1', 'cook', { imageBase64: Buffer.from('jpg-bytes').toString('base64'), label: 'Delivery receipt' });
    expect(docs[0]).toMatchObject({ type: 'PurchaseRequest', id: 'req1', size: 9, mime: 'image/jpeg', name: 'delivery-receipt-REQ-20260830-001-1.jpg', label: 'Delivery receipt', by: 'cook' });
    expect(out).toEqual({ id: 'doc1', filename: 'delivery-receipt-REQ-20260830-001-1.jpg', label: 'Delivery receipt' });
  });

  // ── Telegram alerts ───────────────────────────────────────────────────────

  describe('Telegram alerts', () => {
    const alertsOn = (svc: any) => {
      const alerts = { buyListSent: jest.fn(), bought: jest.fn(), purchasePhoto: jest.fn(), postedToStock: jest.fn() };
      svc.telegramAlerts = alerts;
      return alerts;
    };

    it("sending a list alerts, in the email's words, naming who sent it", async () => {
      const { svc } = build({ lines: [{ id: 'l1', rawMaterialId: 'rm-haz', qtyRequested: 1500, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' } }], people: [{ id: 'o1', email: null, name: 'Anne', role: 'BUSINESS_OWNER' }] });
      const alerts = alertsOn(svc);
      await svc.sendRequest(TENANT, 'req1', USER);
      expect(alerts.buyListSent).toHaveBeenCalledWith(TENANT, 'req1', [expect.objectContaining({ name: 'Hazelnut Syrup' })], USER, null);
    });

    it('the first recording of what was bought alerts; a correction to a bought request does not', async () => {
      const first = build({ status: 'SENT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz' }] });
      const a1 = alertsOn(first.svc);
      await first.svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 3, packSize: 750, packCost: 540 }], { userId: USER, role: 'BUSINESS_OWNER' });
      expect(a1.bought).toHaveBeenCalledWith(TENANT, 'req1', USER, null);

      const again = build({ status: 'BOUGHT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz', packsBought: 3, packSize: 750, packCost: 540 }] });
      const a2 = alertsOn(again.svc);
      await again.svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 3, packSize: 750, packCost: 500 }], { userId: USER, role: 'BUSINESS_OWNER' });
      expect(a2.bought).not.toHaveBeenCalled();
    });

    it('a second trip that fills lines nobody had filled alerts, saying what it added', async () => {
      const { svc } = build({ status: 'BOUGHT', lines: [
        { id: 'l1', rawMaterialId: 'rm-haz', packsBought: 3, packSize: 750, packCost: 540 },
        { id: 'l2', rawMaterialId: 'rm-beans', packsBought: null, packSize: null, packCost: null },
      ] });
      const alerts = alertsOn(svc);
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l2', packsBought: 2, packSize: 1000, packCost: 850 }], { userId: USER, role: 'BUSINESS_OWNER' });
      expect(alerts.bought).toHaveBeenCalledWith(TENANT, 'req1', USER, { items: 1, value: 1700 });
    });

    it('a bulk sheet upload does not alert once per request', async () => {
      const { svc } = build({ status: 'SENT', lines: [{ id: 'l1', rawMaterialId: 'rm-haz' }] });
      const alerts = alertsOn(svc);
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 3, packSize: 750, packCost: 540 }], { userId: USER, role: 'BUSINESS_OWNER' }, { quiet: true });
      expect(alerts.bought).not.toHaveBeenCalled();
    });

    it('a filed photo is forwarded as filed, bytes and all', async () => {
      const { svc } = build({ status: 'SENT', lines: [] });
      const alerts = alertsOn(svc);
      await svc.attachPhoto(TENANT, 'req1', 'cook', { imageBase64: Buffer.from('jpg-bytes').toString('base64'), label: 'Delivery receipt' });
      expect(alerts.purchasePhoto).toHaveBeenCalledWith(TENANT, 'req1', Buffer.from('jpg-bytes'), 'image/jpeg', 'Delivery receipt', 'cook');
    });

    it('closing a request into stock alerts once; a post that leaves it open does not', async () => {
      const { svc } = build({ status: 'BOUGHT', lines: BOUGHT });
      const alerts = alertsOn(svc);
      await svc.receiveRequest(TENANT, 'req1', USER);
      expect(alerts.postedToStock).toHaveBeenCalledWith(TENANT, 'req1', USER);

      const open = build({ status: 'BOUGHT', lines: [BOUGHT[0], { ...BOUGHT[0], id: 'l2', lineNumber: 'REQ-20260830-001-02' }] });
      const a2 = alertsOn(open.svc);
      await open.svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }] });
      expect(a2.postedToStock).not.toHaveBeenCalled();
    });
  });

  // ── what the shelf says ───────────────────────────────────────────────────

  const ASKED = [{ id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-haz', qtyRequested: 1500, packsBought: null, packCost: null, receivedAt: null, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' } }];

  it('tells every line what is on the shelf at this branch', async () => {
    const { svc } = build({ status: 'OPEN', lines: ASKED, onHand: [{ rawMaterialId: 'rm-haz', quantity: 750 }] });
    const seen = await svc.get(TENANT, 'req1', 'GENERAL_EMPLOYEE');
    expect(seen.lines[0].onHand).toBe(750);
    expect(seen.lines[0].counted).toBeNull();
  });

  it('remembers every ingredient\'s pack for the picker, price included only for those who may see it', async () => {
    const lastPacks = [{ rawMaterialId: 'rm-haz', packSize: 750, packCost: 540, brandNote: 'Da Vinci', receivedAt: new Date() }];
    const owner = await build({ lastPacks }).svc.packMemory(TENANT, 'BUSINESS_OWNER');
    expect(owner).toEqual([expect.objectContaining({ rawMaterialId: 'rm-haz', packSize: 750, packCost: 540 })]);
    const cook = await build({ lastPacks, showCostsToStaff: false }).svc.packMemory(TENANT, 'GENERAL_EMPLOYEE');
    expect(cook[0]).toMatchObject({ packSize: 750, packCost: null });
  });

  it('"remaining: 1 bottle" starts a cycle count for this list, snapshotting what Clerque had', async () => {
    const { svc, createdCounts, countLines } = build({ status: 'SENT', lines: ASKED, onHand: [{ rawMaterialId: 'rm-haz', quantity: 2250 }] });
    const out = await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 750);
    expect(createdCounts[0]).toMatchObject({ branchId: BRANCH, countNumber: 'CC-2026-000007', status: 'OPEN', startedById: 'cook' });
    expect(createdCounts[0].notes).toMatch(/^\[REQ:REQ-20260830-001\]/);
    expect(countLines[0]).toMatchObject({ rawMaterialId: 'rm-haz' });
    // The line number, and when it was counted: a post can then tell whether a newer count has adjusted the item since.
    expect(countLines[0].notes).toMatch(/^\[AT:\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z\] REQ-20260830-001-01$/);
    expect(Number(countLines[0].expectedQty)).toBe(2250);
    expect(Number(countLines[0].countedQty)).toBe(750);
    expect(Number(countLines[0].varianceQty)).toBe(-1500);
    expect(out).toMatchObject({ countNumber: 'CC-2026-000007', expectedQty: 2250, countedQty: 750, variance: -1500, unit: 'ml' });
  });

  it('a second count on the same line keeps the snapshot and changes only the count', async () => {
    const { svc, createdCounts, countLines, count } = build({ status: 'OPEN', lines: ASKED, onHand: [{ rawMaterialId: 'rm-haz', quantity: 2250 }] });
    await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 750, new Date('2026-09-22T00:30:00Z'));
    const out = await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 1500, new Date('2026-09-22T02:00:00Z'));
    expect(createdCounts).toHaveLength(1);                       // one count per list
    expect(Number(countLines[1].countedQty)).toBe(1500);
    expect(Number(countLines[1].varianceQty)).toBe(-750);        // against the SAME 2250
    expect(out.expectedQty).toBe(2250);
    expect(count()!.lines).toHaveLength(1);
    // And the same moment: the difference is still measured against the book as it was then.
    expect(countLines[0].notes).toBe('[AT:2026-09-22T00:30:00.000Z] REQ-20260830-001-01');
    expect(countLines[1].notes).toBe('[AT:2026-09-22T00:30:00.000Z] REQ-20260830-001-01');
  });

  it('the request then shows what was counted, next to what Clerque says', async () => {
    const { svc } = build({ status: 'OPEN', lines: ASKED, onHand: [{ rawMaterialId: 'rm-haz', quantity: 2250 }] });
    await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 750);
    const seen = await svc.get(TENANT, 'req1', 'GENERAL_EMPLOYEE');
    expect(seen.lines[0].counted).toEqual({ qty: 750, expected: 2250, countId: 'cc1', countNumber: 'CC-2026-000007' });
    expect(seen.lines[0].onHand).toBe(2250);
  });

  it('counting stops once the list is bought, and never goes below zero', async () => {
    const bought = build({ status: 'BOUGHT', lines: ASKED });
    await expect(bought.svc.recordCount(TENANT, 'req1', 'l1', 'cook', 1)).rejects.toThrow(/already been bought/i);
    const open = build({ status: 'OPEN', lines: ASKED });
    await expect(open.svc.recordCount(TENANT, 'req1', 'l1', 'cook', -1)).rejects.toThrow(/negative/i);
    await expect(open.svc.recordCount(TENANT, 'req1', 'nope', 'cook', 1)).rejects.toThrow(/not on this request/i);
  });

  // A drink that waits at the bar screen, 30 ml of the syrup a cup.
  const HAZEL_LATTE = { id: 'p-hazel', name: 'Hazelnut Latte', inventoryMode: 'RECIPE_BASED', bomItems: [{ rawMaterialId: 'rm-haz', quantity: 30, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' } }] };

  it('a count started while tickets wait expects the shelf less what they hold -- this branch, live orders, not yet made', async () => {
    const { svc, countLines } = build({
      status: 'OPEN', lines: ASKED, products: [HAZEL_LATTE], onHand: [{ rawMaterialId: 'rm-haz', quantity: 2250 }],
      tickets: [
        { productId: 'p-hazel', quantity: 5 },                               // 150 ml held here
        { productId: 'p-hazel', quantity: 10, branchId: 'b2' },              // another branch's bar
        { productId: 'p-hazel', quantity: 20, status: 'VOIDED' },            // will never be made
        { productId: 'p-hazel', quantity: 4, usagePostedAt: new Date() },    // already taken at ready
        { productId: 'p-hazel', quantity: 3, refundedQty: 3 },               // refunded in full
      ],
    });
    const out = await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 2000);
    expect(Number(countLines[0].expectedQty)).toBe(2100);
    expect(out).toMatchObject({ expectedQty: 2100, countedQty: 2000, variance: -100 });
  });

  it('with nothing waiting the count expects the book, and a book already below zero is expected as it is', async () => {
    const none = build({ status: 'OPEN', lines: ASKED, products: [HAZEL_LATTE], onHand: [{ rawMaterialId: 'rm-haz', quantity: 2250 }] });
    expect((await none.svc.recordCount(TENANT, 'req1', 'l1', 'cook', 2000)).expectedQty).toBe(2250);

    // A tap takes nothing from an empty book, so the hold cannot lower it; the count must still lift it to what was seen.
    const below = build({
      status: 'OPEN', lines: ASKED, products: [HAZEL_LATTE], onHand: [{ rawMaterialId: 'rm-haz', quantity: -600 }],
      tickets: [{ productId: 'p-hazel', quantity: 5 }],
    });
    expect(await below.svc.recordCount(TENANT, 'req1', 'l1', 'cook', 0)).toMatchObject({ expectedQty: -600, variance: 600 });
  });

  // ── send to the owners, and they hear it ──────────────────────────────────

  const PEOPLE = [
    { id: 'owner', email: 'anne@carolina.test', name: 'Anne', role: 'BUSINESS_OWNER', branchId: null },
    { id: 'mgr',   email: null,                 name: 'Mia',  role: 'BRANCH_MANAGER', branchId: BRANCH },
    { id: 'other', email: 'x@y.test',           name: 'Ben',  role: 'BRANCH_MANAGER', branchId: 'b2' },
    { id: 'cook',  email: 'c@y.test',           name: 'Jo',   role: 'GENERAL_EMPLOYEE', branchId: BRANCH },
  ];
  const SENT_LINES = [
    { id: 'l1', rawMaterialId: 'rm-haz', qtyRequested: 1500, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' } },
    { id: 'l2', rawMaterialId: 'rm-sug', qtyRequested: 500,  rawMaterial: { name: 'White Sugar',    unit: 'g' } },
  ];

  it('sending the list tells the owner and this branch\'s manager, in packs where the pack is known', async () => {
    const { svc, notified, mailed } = build({
      status: 'OPEN', lines: SENT_LINES, people: PEOPLE,
      lastPacks: [{ rawMaterialId: 'rm-haz', packSize: 750, packCost: 540, brandNote: null, receivedAt: new Date() }],
    });
    const res = await svc.sendRequest(TENANT, 'req1', USER);
    expect(res.status).toBe('SENT');
    expect(notified.map((n) => n.userId).sort()).toEqual(['mgr', 'owner']);      // not the cook, not the other branch
    expect(notified[0]).toMatchObject({ kind: 'INFO', title: 'Buy list REQ-20260830-001 sent', link: '/procure/requests?view=REQ-20260830-001' });
    expect(notified[0].body).toBe('Hazelnut Syrup 2 packs (1,500 ml) · White Sugar 500 g');
    expect(mailed).toHaveLength(1);                                             // the manager has no email
    expect(mailed[0]).toMatchObject({ to: 'anne@carolina.test', name: 'Anne', requestNumber: 'REQ-20260830-001' });
    expect(mailed[0].lines[0]).toEqual({ name: 'Hazelnut Syrup', amount: '2 packs (1,500 ml)', serves: null });   // in no recipe here
  });

  it('an empty list is still announced: silence would mean nothing', async () => {
    const { svc, notified } = build({ status: 'OPEN', lines: [], people: PEOPLE.slice(0, 1) });
    const res = await svc.sendRequest(TENANT, 'req1', USER);
    expect(res.empty).toBe(true);
    expect(notified[0].body).toMatch(/all-clear/);
  });

  it('a mailer that is down never blocks the send', async () => {
    const { svc, notified } = build({ status: 'OPEN', lines: SENT_LINES, people: PEOPLE.slice(0, 1), mailFails: true });
    const res = await svc.sendRequest(TENANT, 'req1', USER);
    expect(res.status).toBe('SENT');
    expect(notified).toHaveLength(1);
  });

  describe('the bell when staff record what was bought', () => {
    // Two lines on a sent list; the cook records the first, the second is still blank.
    const staffBuys = () => {
      const b = build({
        status: 'SENT', people: PEOPLE, open: { branch: { name: 'Main' } },
        lines: [
          { id: 'l1', rawMaterialId: 'rm-haz', packsBought: null, rawMaterial: { name: 'Hazelnut Syrup' } },
          { id: 'l2', rawMaterialId: 'rm-sug', packsBought: null, rawMaterial: { name: 'White Sugar' } },
        ],
      });
      b.prisma.user.findFirst.mockImplementation(({ where }: any) => Promise.resolve({ name: where.id === 'cook' ? 'Jo' : 'Someone' }));
      return b;
    };
    const HAZ = [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }];
    const COOK = { userId: 'cook', role: 'GENERAL_EMPLOYEE' };

    it('rings once for each owner and this branch\'s manager, pointing at the request', async () => {
      const { svc, notified } = staffBuys();
      await svc.recordBought(TENANT, 'req1', HAZ, COOK);
      expect(notified.map((n) => n.userId).sort()).toEqual(['mgr', 'owner']);   // not the cook, not the other branch
      for (const n of notified) {
        expect(n).toEqual({
          tenantId: TENANT, userId: n.userId, kind: 'INFO',
          title: 'Bought: REQ-20260830-001 — post it to stock',
          body: '1 item, recorded by Jo · Main',
          link: '/procure/requests?view=REQ-20260830-001',
          dedupeKey: `req-bought-REQ-20260830-001-${n.userId}`,
        });
      }
    });

    it('a second save on the bought request rings nothing new', async () => {
      const { svc, notified } = staffBuys();
      await svc.recordBought(TENANT, 'req1', HAZ, COOK);
      expect(notified).toHaveLength(2);
      // A later trip filling the blank line, then the manager correcting a price: no new bell.
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l2', packsBought: 1, packSize: 1000, packCost: 91 }], COOK);
      await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 520 }], { userId: 'mgr', role: 'BRANCH_MANAGER' });
      expect(notified).toHaveLength(2);
    });

    it('no bell when the owner or manager records it themselves', async () => {
      const owner = staffBuys();
      await owner.svc.recordBought(TENANT, 'req1', HAZ, { userId: 'owner', role: 'BUSINESS_OWNER' });
      expect(owner.notified).toEqual([]);
      const mgr = staffBuys();
      await mgr.svc.recordBought(TENANT, 'req1', HAZ, { userId: 'mgr', role: 'BRANCH_MANAGER' });
      expect(mgr.notified).toEqual([]);
    });

    it('a bell that cannot be written never fails the save', async () => {
      const { svc, notifications, req } = staffBuys();
      notifications.create.mockRejectedValue(new Error('database down'));
      const res = await svc.recordBought(TENANT, 'req1', HAZ, COOK);
      expect(res.status).toBe('BOUGHT');
      expect(req().status).toBe('BOUGHT');
    });
  });

  // ── the buy list as a PDF: for the group chat, and filed in Clerque ───────

  const PDF_LINES = [
    { id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-haz', qtyRequested: 1500, shortBy: null, packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' } },
    { id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-sug', qtyRequested: 500,  shortBy: null, packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null, rawMaterial: { name: 'White Sugar',    unit: 'g' } },
  ];

  it('sending files the list as a PDF on the request, and mails the owner the same file', async () => {
    const { svc, docs, mailed } = build({ status: 'OPEN', lines: PDF_LINES, people: PEOPLE.slice(0, 1) });
    const warn = jest.spyOn(svc.logger, 'warn');
    await svc.sendRequest(TENANT, 'req1', USER);

    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      type: 'PurchaseRequest', id: 'req1', mime: 'application/pdf',
      name: 'buy-list-REQ-20260830-001-sent.pdf', label: 'Buy list — as sent', by: USER,
    });
    expect(docs[0].buf.subarray(0, 5).toString()).toBe('%PDF-');
    // The file in the group chat and the file in Clerque are the same file.
    expect(Buffer.compare(mailed[0].pdf, docs[0].buf)).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('an empty list is sent but files no PDF', async () => {
    const { svc, docs, mailed } = build({ status: 'OPEN', lines: [], people: PEOPLE.slice(0, 1) });
    await svc.sendRequest(TENANT, 'req1', USER);
    expect(docs).toHaveLength(0);
    expect(mailed[0].pdf).toBeNull();
  });

  it('the copy as sent is filed once', async () => {
    const { svc, docs } = build({ status: 'SENT', lines: PDF_LINES, filed: [{ label: 'Buy list — as sent', filename: 'buy-list-REQ-20260830-001-sent.pdf' }] });
    expect(await svc.fileRequestPdf(TENANT, 'req1', 'sent', USER)).toBeNull();
    expect(docs).toHaveLength(0);
  });

  it('a receipt photo or another request\'s copy does not count as this list filed', async () => {
    const { svc, docs } = build({ status: 'SENT', lines: PDF_LINES, filed: [
      { label: 'Receipt', filename: 'receipt-REQ-20260830-001-1.jpg', mimeType: 'image/jpeg' },
      { label: 'Buy list — as sent', filename: 'buy-list-REQ-20260830-002-sent.pdf', entityId: 'req2' },
    ] });
    await svc.fileRequestPdf(TENANT, 'req1', 'sent', USER);
    expect(docs.map((d: any) => d.name)).toEqual(['buy-list-REQ-20260830-001-sent.pdf']);
  });

  it('storage that will not take the PDF never blocks the send', async () => {
    const { svc, notified, mailed } = build({ status: 'OPEN', lines: PDF_LINES, people: PEOPLE.slice(0, 1), uploadFails: true });
    const warn = jest.spyOn(svc.logger, 'warn');
    const res = await svc.sendRequest(TENANT, 'req1', USER);
    expect(res.status).toBe('SENT');
    expect(notified).toHaveLength(1);
    expect(mailed[0].pdf).toBeNull();          // nothing filed, so nothing that differs from the filed copy is mailed
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not file the sent buy list/));
  });

  const BOUGHT_PDF = PDF_LINES.map((l, i) => ({ ...l, packsBought: 2, packSize: i === 0 ? 750 : 1000, packCost: i === 0 ? 540 : 85 }));

  it('posting the last line files the copy as booked; a later post files a new version', async () => {
    const first = build({ status: 'BOUGHT', lines: BOUGHT_PDF });
    await first.svc.receiveRequest(TENANT, 'req1', USER, 'CASH');
    expect(first.docs).toHaveLength(1);
    expect(first.docs[0]).toMatchObject({ mime: 'application/pdf', label: 'Buy list — as booked', name: 'buy-list-REQ-20260830-001-booked.pdf' });

    const later = build({
      status: 'RECEIVED', lines: [{ ...BOUGHT_PDF[0], receivedAt: new Date() }, BOUGHT_PDF[1]],
      filed: [{ label: 'Buy list — as booked', filename: 'buy-list-REQ-20260830-001-booked.pdf' }],
    });
    await later.svc.receiveRequest(TENANT, 'req1', USER, 'CASH');
    expect(later.docs.map((d: any) => d.name)).toEqual(['buy-list-REQ-20260830-001-booked-2.pdf']);
  });

  it('a deleted booked copy does not hand its version number to the next one', async () => {
    const { svc, docs } = build({
      status: 'RECEIVED', lines: [{ ...BOUGHT_PDF[0], receivedAt: new Date() }, BOUGHT_PDF[1]],
      filed: [{ label: 'Buy list — as booked', filename: 'buy-list-REQ-20260830-001-booked-2.pdf' }],   // version 1 was deleted
    });
    await svc.receiveRequest(TENANT, 'req1', USER, 'CASH');
    expect(docs.map((d: any) => d.name)).toEqual(['buy-list-REQ-20260830-001-booked-3.pdf']);
  });

  it('a later call that closes a line with nothing arriving files a new booked version too', async () => {
    // Nothing reaches the shelf, but the line now says "lost" -- the owner's copy must say so.
    const { svc, docs, received } = build({
      status: 'RECEIVED', lines: [{ ...BOUGHT_PDF[0], receivedAt: new Date() }, BOUGHT_PDF[1]],
      filed: [{ label: 'Buy list — as booked', filename: 'buy-list-REQ-20260830-001-booked.pdf' }],
    });
    await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l2', packsArrived: 0 }], closeShort: [{ lineId: 'l2', outcome: 'LOST' }] });
    expect(received).toHaveLength(0);
    expect(docs.map((d: any) => d.name)).toEqual(['buy-list-REQ-20260830-001-booked-2.pdf']);
  });

  it('a post that leaves the request open files no booked copy', async () => {
    const half = [{ ...PDF_LINES[0], packsBought: 2, packSize: 750, packCost: 540 }, { ...PDF_LINES[1], packsBought: 1, packSize: 1000, packCost: 85 }];
    const { svc, docs } = build({ status: 'BOUGHT', lines: half });
    await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }] });
    expect(docs).toHaveLength(0);
  });

  const SENT_COPY  = { id: 'doc-sent',   label: 'Buy list — as sent',   filename: 'buy-list-REQ-20260830-001-sent.pdf' };
  const BOOKED_OLD = { id: 'doc-booked', label: 'Buy list — as booked', filename: 'buy-list-REQ-20260830-001-booked.pdf', createdAt: new Date('2026-08-30T10:00:00Z') };

  it('the kitchen gets this request\'s filed copy as sent, byte for byte, even when costs are hidden from them', async () => {
    const { svc, prisma } = build({
      status: 'SENT', lines: PDF_LINES, showCostsToStaff: false,
      filed: [SENT_COPY, { ...SENT_COPY, id: 'doc-other', entityId: 'req2', createdAt: new Date('2026-08-31T10:00:00Z') }],
    });
    const out = await svc.requestPdf(TENANT, 'req1', 'sent', 'GENERAL_EMPLOYEE');
    expect(out.buffer.toString()).toBe('%PDF-filed:doc-sent');
    expect(out.filename).toBe('REQ-20260830-001-buy-list.pdf');
    expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({
      tenantId: TENANT, entityType: 'PurchaseRequest', entityId: 'req1', label: 'Buy list — as sent', mimeType: 'application/pdf',
    });
    expect(svc.documents.readFiled).toHaveBeenCalledWith(TENANT, 'doc-sent');
  });

  it('the booked copy with prices never reaches someone costs are hidden from; it is drawn without them', async () => {
    const { svc } = build({ status: 'RECEIVED', lines: PDF_LINES, showCostsToStaff: false, filed: [BOOKED_OLD] });
    const out = await svc.requestPdf(TENANT, 'req1', 'booked', 'CASHIER');
    expect(svc.documents.readFiled).not.toHaveBeenCalled();
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.buffer.toString()).not.toMatch(/^%PDF-filed/);
    expect(out.filename).toBe('REQ-20260830-001-in-stock.pdf');
  });

  it('the owner gets the filed booked copy', async () => {
    const { svc } = build({ status: 'RECEIVED', lines: PDF_LINES, filed: [BOOKED_OLD], open: { updatedAt: new Date('2026-08-30T09:59:00Z') } });
    const out = await svc.requestPdf(TENANT, 'req1', 'booked', 'BUSINESS_OWNER');
    expect(out.buffer.toString()).toBe('%PDF-filed:doc-booked');
  });

  it('a booked copy older than the request\'s last change is drawn again, not served stale', async () => {
    // The re-filing after a later post failed (storage down): the filed copy no longer says what happened.
    const { svc } = build({ status: 'RECEIVED', lines: PDF_LINES, filed: [BOOKED_OLD], open: { updatedAt: new Date('2026-08-30T11:00:00Z') } });
    const out = await svc.requestPdf(TENANT, 'req1', 'booked', 'BUSINESS_OWNER');
    expect(svc.documents.readFiled).not.toHaveBeenCalled();
    expect(out.buffer.toString()).not.toMatch(/^%PDF-filed/);
  });

  it('a request sent before copies were filed is drawn now', async () => {
    const { svc } = build({ status: 'SENT', lines: PDF_LINES });
    const out = await svc.requestPdf(TENANT, 'req1', 'sent', 'BUSINESS_OWNER');
    expect(svc.documents.readFiled).not.toHaveBeenCalled();
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(out.buffer.toString()).not.toMatch(/^%PDF-filed/);
  });

  it('a filed copy whose file is gone is drawn now, and the gap is logged', async () => {
    const { svc } = build({ status: 'SENT', lines: PDF_LINES, filed: [SENT_COPY], readFails: true });
    const warn = jest.spyOn(svc.logger, 'warn');
    const out = await svc.requestPdf(TENANT, 'req1', 'sent', 'BUSINESS_OWNER');
    expect(svc.documents.readFiled).toHaveBeenCalledTimes(1);
    expect(out.buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/doc-sent .*could not be read: NoSuchKey/));
  });

  it('a buy-list PDF on the request does not shift the photo numbering', async () => {
    const { svc } = build({ status: 'SENT', lines: [], filed: [SENT_COPY, { label: 'Receipt', filename: 'receipt-REQ-20260830-001-1.jpg', mimeType: 'image/jpeg' }] });
    const out = await svc.attachPhoto(TENANT, 'req1', 'cook', { imageBase64: Buffer.from('jpg').toString('base64') });
    expect(out.filename).toBe('receipt-REQ-20260830-001-2.jpg');
  });

  // ── what each line still serves ───────────────────────────────────────────

  const rm = (id: string, name: string, unit = 'g') => ({ id, name, unit });
  const SAUCE = rm('rm-sauce', 'Spaghetti Sauce');
  const NOODLES = rm('rm-noodle', 'Spaghetti Noodles');
  const BEANS = rm('rm-beans', 'Coffee Beans');
  const SYRUP = rm('rm-syrup', 'White Sugar Syrup', 'ml');
  const on = (x: { id: string; name: string; unit: string }, quantity: number) => ({ rawMaterialId: x.id, quantity, rawMaterial: x });
  const MENU = [
    { id: 'p-spag', name: 'Spaghetti', inventoryMode: 'RECIPE_BASED', bomItems: [on(SAUCE, 200), on(NOODLES, 100)] },
    { id: 'p-lasagna', name: 'Lasagna', inventoryMode: 'RECIPE_BASED', bomItems: [on(SAUCE, 500)] },
    { id: 'p-americano', name: 'Americano', inventoryMode: 'RECIPE_BASED', bomItems: [], variants: [
      { id: 'v12', name: '12oz', variantBomItems: [on(BEANS, 18)] },
      { id: 'v16', name: '16oz', variantBomItems: [on(BEANS, 36)] },
    ] },
    { id: 'p-latte', name: 'Iced Latte', inventoryMode: 'RECIPE_BASED', bomItems: [on(SYRUP, 30)] },
  ];
  const STOCK = [
    { rawMaterialId: SAUCE.id, quantity: 2000 }, { rawMaterialId: NOODLES.id, quantity: 300 },
    { rawMaterialId: BEANS.id, quantity: 900 },  { rawMaterialId: SYRUP.id, quantity: 1200 },
  ];
  const stockOf = (id: string) => STOCK.find((x) => x.rawMaterialId === id)?.quantity ?? 0;
  const lineFor = (id: string, x: { id: string; name: string; unit: string }, n = '01') => ({
    id, lineNumber: `REQ-20260830-001-${n}`, rawMaterialId: x.id, qtyRequested: 1000, shortBy: null,
    packsBought: null, packSize: null, packCost: null, brandNote: null, receivedAt: null, rawMaterial: x,
  });

  it('a shared ingredient lists every dish it serves, tightest first, joined by "or" and never added up', async () => {
    const { svc } = build({ status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK });
    const [line] = (await svc.get(TENANT, 'req1', 'GENERAL_EMPLOYEE')).lines;
    expect(line.serves.dishes.map((d: any) => [d.name, d.perServing, d.byThisItem])).toEqual([['Lasagna', 500, 4], ['Spaghetti', 200, 10]]);
    expect(servesSentences(line.serves)).toEqual([
      'By this item alone: enough for 4 Lasagna or 10 Spaghetti.',
      // 300 g of noodles at 100 g a plate: the till says 3, and so does the list.
      'The till shows 3 Spaghetti left — Spaghetti Noodles runs out first.',
    ]);
  });

  it('a product the till counts as finished stock still uses its recipe, so it is counted, with no till figure to compare', async () => {
    // A sale deducts the recipe whenever one exists (orders.service), whatever the product's inventory mode.
    const burger = { id: 'p-burger', name: 'Burger', inventoryMode: 'UNIT_BASED', bomItems: [on(SAUCE, 50)] };
    const { svc } = build({ status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: [burger], onHand: STOCK });
    const [line] = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    expect(line.serves.dishes).toEqual([expect.objectContaining({ name: 'Burger', byThisItem: 40, sellableNow: 40, limitedBy: null })]);
    expect(servesSentences(line.serves)).toEqual(['By this item alone: enough for 40 Burger.']);
  });

  it('decimal quantities count exact servings, not one short', async () => {
    // 1.2 kg at 0.4 kg a plate is 3 plates (plain division says 2.9999999999999996); a count of 2.8 kg is 7, not 6.
    const RICE = rm('rm-rice', 'Rice', 'kg');
    const bowl = { id: 'p-bowl', name: 'Rice Bowl', inventoryMode: 'RECIPE_BASED', bomItems: [on(RICE, 0.4)] };
    const { svc } = build({
      status: 'OPEN', lines: [lineFor('l1', RICE)], products: [bowl], onHand: [{ rawMaterialId: RICE.id, quantity: 1.2 }],
      openCount: { id: 'cc1', countNumber: 'CC-1', notes: '[REQ:REQ-20260830-001] Counted', lines: [{ id: 'ccl1', rawMaterialId: RICE.id, countedQty: 2.8, expectedQty: 1.2 }] },
    });
    const [line] = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    expect(line.serves.dishes[0]).toMatchObject({ byThisItem: 3, sellableNow: 3, byCounted: 7 });
  });

  it('"the menu can sell now" is the POS tile\'s own number for the same product and stock', async () => {
    const { svc } = build({ status: 'SENT', lines: [lineFor('l1', SAUCE), lineFor('l2', BEANS, '02')], products: MENU, onHand: STOCK });
    const lines = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    const spag = lines[0].serves.dishes.find((d: any) => d.productId === 'p-spag');
    const tile = productCeiling({ variants: [], ...MENU[0] } as any, stockOf);
    expect([spag.sellableNow, spag.limitedBy]).toEqual([tile.maxProducible, tile.limitedBy!.name]);

    // A size with its own recipe is its own dish, judged by that size's ceiling on the till.
    const americano = productCeiling(MENU[2] as any, stockOf);
    expect(lines[1].serves.dishes.map((d: any) => [d.name, d.byThisItem, d.sellableNow])).toEqual([
      ['Americano (16oz)', 25, americano.variantCeilings.find((v) => v.variantId === 'v16')!.maxProducible],
      ['Americano (12oz)', 50, americano.variantCeilings.find((v) => v.variantId === 'v12')!.maxProducible],
    ]);
  });

  it('an item in no recipe says so; one that goes into a prep says which, and what the prep serves; add-ons are named, not counted', async () => {
    const CUPS = rm('rm-cups', 'Cups 16oz', 'pcs');
    const SUGAR = rm('rm-sugar', 'White Sugar');
    const MILK = rm('rm-milk', 'Full Cream Milk', 'ml');
    const { svc } = build({
      status: 'OPEN', lines: [lineFor('l1', CUPS), lineFor('l2', SUGAR, '02'), lineFor('l3', MILK, '03')],
      products: MENU, onHand: STOCK,
      preps: [{ rawMaterialId: SUGAR.id, parent: { id: SYRUP.id, name: 'White Sugar Syrup' } }],
      addOns: [{ rawMaterialId: MILK.id, option: { name: 'Extra milk' } }],
    });
    const [cups, sugar, milk] = (await svc.get(TENANT, 'req1', 'CASHIER')).lines;
    expect(servesSentences(cups.serves)).toEqual(['Not in any recipe.']);
    expect(sugar.serves.goesInto).toEqual([{ prepName: 'White Sugar Syrup', dishes: [{ name: 'Iced Latte', byThisItem: 40 }] }]);
    expect(servesSentences(sugar.serves)).toEqual(['Goes into White Sugar Syrup (it has enough for 40 Iced Latte).']);
    expect(servesSentences(milk.serves)).toEqual(['Used only as an add-on, not counted: Extra milk.']);
  });

  it('a count typed while building the list is worked out too, beside Clerque\'s own figure', async () => {
    const { svc } = build({
      status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK,
      openCount: { id: 'cc1', countNumber: 'CC-1', notes: '[REQ:REQ-20260830-001] Counted', lines: [{ id: 'ccl1', rawMaterialId: SAUCE.id, countedQty: 1000, expectedQty: 2000 }] },
    });
    const [line] = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    expect(line.serves.dishes.map((d: any) => [d.name, d.byThisItem, d.byCounted])).toEqual([['Lasagna', 4, 2], ['Spaghetti', 10, 5]]);
    expect(servesSentences(line.serves)[1]).toBe('By the count: 2 Lasagna or 5 Spaghetti.');
  });

  it('tickets waiting at this branch lower what the list says is on hand, what it serves and the till\'s number', async () => {
    // Two Spaghetti at the kitchen screen hold 400 g of sauce and 200 g of noodles.
    const { svc } = build({ status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK, tickets: [{ productId: 'p-spag', quantity: 2 }] });
    const [line] = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    expect([line.onHand, line.heldQty]).toEqual([1600, 400]);
    expect(line.serves.dishes.map((d: any) => [d.name, d.byThisItem])).toEqual([['Lasagna', 3], ['Spaghetti', 8]]);

    const held: Record<string, number> = { [SAUCE.id]: 400, [NOODLES.id]: 200 };
    const tile = productCeiling({ variants: [], ...MENU[0] } as any, (id) => stockOf(id) - (held[id] ?? 0));
    const spag = line.serves.dishes.find((d: any) => d.productId === 'p-spag');
    expect([spag.sellableNow, spag.limitedBy]).toEqual([tile.maxProducible, 'Spaghetti Noodles']);
    expect(spag.sellableNow).toBe(1);
  });

  it('a ticket at another branch, on a voided order, already made or refunded holds nothing: the list reads as with none waiting', async () => {
    const plain = build({ status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK });
    const [before] = (await plain.svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    const { svc } = build({
      status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK,
      tickets: [
        { productId: 'p-spag', quantity: 2, branchId: 'b2' },
        { productId: 'p-lasagna', quantity: 1, status: 'VOIDED' },
        { productId: 'p-spag', quantity: 3, usagePostedAt: new Date() },
        { productId: 'p-lasagna', quantity: 2, refundedQty: 2, status: 'COMPLETED' },
      ],
    });
    const [line] = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
    expect([line.onHand, line.heldQty]).toEqual([2000, 0]);
    expect(line).toEqual(before);
  });

  it('lists at two branches each take off only their own branch\'s tickets, read once for both', async () => {
    const { svc, prisma } = build({
      products: MENU,
      onHand: [
        { rawMaterialId: SAUCE.id, quantity: 2000 }, { rawMaterialId: NOODLES.id, quantity: 300 },
        { rawMaterialId: SAUCE.id, quantity: 2000, branchId: 'b2' }, { rawMaterialId: NOODLES.id, quantity: 300, branchId: 'b2' },
      ],
      tickets: [
        { productId: 'p-spag', quantity: 2 },                                    // 400 g sauce at b1
        { productId: 'p-lasagna', quantity: 1, branchId: 'b2' },                 // 500 g sauce at b2
        { productId: 'p-lasagna', quantity: 3, branchId: 'b2', status: 'VOIDED' },
      ],
    });
    const [atMain, atCourt] = await svc.enrich(TENANT, [
      { branchId: BRANCH, requestNumber: 'REQ-A', status: 'OPEN', lines: [lineFor('l1', SAUCE)] },
      { branchId: 'b2',   requestNumber: 'REQ-B', status: 'SENT', lines: [lineFor('l2', SAUCE)] },
    ]);
    expect([atMain.lines[0].onHand, atMain.lines[0].heldQty]).toEqual([1600, 400]);
    expect(atMain.lines[0].serves.dishes.map((d: any) => [d.name, d.byThisItem])).toEqual([['Lasagna', 3], ['Spaghetti', 8]]);
    expect([atCourt.lines[0].onHand, atCourt.lines[0].heldQty]).toEqual([1500, 500]);
    expect(atCourt.lines[0].serves.dishes.map((d: any) => [d.name, d.byThisItem])).toEqual([['Lasagna', 3], ['Spaghetti', 7]]);
    // The servings reuse the hold the list's own figure took off.
    expect(prisma.orderItem.findMany).toHaveBeenCalledTimes(1);
  });

  it('a request already bought or in stock carries no servings, and does not pay for working them out', async () => {
    for (const status of ['BOUGHT', 'RECEIVED']) {
      const { svc, prisma } = build({ status, lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK });
      const [line] = (await svc.get(TENANT, 'req1', 'BUSINESS_OWNER')).lines;
      expect(line.serves).toBeNull();
      expect(prisma.product.findMany).not.toHaveBeenCalled();
    }
  });

  it('when servings cannot be worked out the list still loads, without them, and the failure is logged', async () => {
    const { svc } = build({ status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK, productsFail: true });
    const warn = jest.spyOn(svc.logger, 'warn');
    const req = await svc.get(TENANT, 'req1', 'BUSINESS_OWNER');
    expect(req.lines[0].onHand).toBe(2000);
    expect(req.lines[0].serves).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/could not work out what the buy list still serves: connection reset/));
  });

  it('the owner email says what each item still serves', async () => {
    const { svc, mailed } = build({ status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK, people: PEOPLE.slice(0, 1) });
    await svc.sendRequest(TENANT, 'req1', USER);
    expect(mailed[0].lines[0].serves).toBe('enough for 4 Lasagna or 10 Spaghetti');
  });

  it('the owner email counts what this branch\'s waiting tickets hold, and nobody else\'s', async () => {
    const { svc, mailed } = build({
      status: 'OPEN', lines: [lineFor('l1', SAUCE)], products: MENU, onHand: STOCK, people: PEOPLE.slice(0, 1),
      tickets: [{ productId: 'p-spag', quantity: 2 }, { productId: 'p-lasagna', quantity: 1, branchId: 'b2' }, { productId: 'p-lasagna', quantity: 1, status: 'VOIDED' }],
    });
    await svc.sendRequest(TENANT, 'req1', USER);
    expect(mailed[0].lines[0].serves).toBe('enough for 3 Lasagna or 8 Spaghetti');
  });

  // ── what is capping the menu ──────────────────────────────────────────────

  const ceilingRows = (out: any) => out.ingredients.map((i: any) => [i.name, i.stock, i.heldQty, i.servingsLeft]);

  it('the menu ceiling reads stock less what tickets waiting at this branch hold', async () => {
    const { svc } = build({ products: MENU, onHand: STOCK, tickets: [{ productId: 'p-spag', quantity: 2 }] });
    const out = await svc.menuCeiling(TENANT, BRANCH);
    expect(ceilingRows(out)).toEqual([
      ['Spaghetti Noodles', 100, 200, 1],
      ['Spaghetti Sauce', 1600, 400, 3],
      ['White Sugar Syrup', 1200, 0, 40],
    ]);
  });

  it('a ticket at another branch or on a voided order leaves the menu ceiling as it is with none waiting', async () => {
    const none = await build({ products: MENU, onHand: STOCK }).svc.menuCeiling(TENANT, BRANCH);
    expect(ceilingRows(none)).toEqual([
      ['Spaghetti Noodles', 300, 0, 3],
      ['Spaghetti Sauce', 2000, 0, 4],
      ['White Sugar Syrup', 1200, 0, 40],
    ]);
    const { svc } = build({
      products: MENU, onHand: STOCK,
      tickets: [{ productId: 'p-spag', quantity: 2, branchId: 'b2' }, { productId: 'p-lasagna', quantity: 1, status: 'VOIDED' }],
    });
    expect(await svc.menuCeiling(TENANT, BRANCH)).toEqual(none);
  });

  // ── paid ahead: the shop's own GR/IR ──────────────────────────────────────

  const ORDERED = [
    { id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-haz', qtyRequested: 1500, packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'Hazelnut Syrup', unit: 'ml' } },
    { id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-sug', qtyRequested: 1000, packsBought: null, packSize: null, packCost: null, receivedAt: null, rawMaterial: { name: 'White Sugar',    unit: 'g' } },
  ];
  const OWNER = { userId: USER, role: 'BUSINESS_OWNER' };

  it('paid on order day: the money leaves the pocket into 1063, the fees too, and the request remembers', async () => {
    const { svc, entries, req } = build({ status: 'SENT', lines: ORDERED });
    // The harness keeps one request object; give the update the lines it will read back.
    const res = await svc.recordBought(TENANT, 'req1', [
      { lineId: 'l1', packsBought: 2, packSize: 750,  packCost: 540 },
      { lineId: 'l2', packsBought: 1, packSize: 1000, packCost: 85 },
    ], OWNER, { paidFrom: 'BANK', boughtAt: '2026-09-04', charges: [{ description: 'Shopee shipping', amount: 80, category: 'FREIGHT' }] });

    expect(entries[0]).toMatchObject({ type: 'PAID_AHEAD', amount: 1165, source: 'BANK', date: '2026-09-04' });
    expect(entries[1]).toMatchObject({ type: 'EXPENSE', amount: 80, category: 'FREIGHT', source: 'BANK', date: '2026-09-04' });
    expect(res.paidAhead).toMatchObject({ pocket: 'BANK', total: 1165, posted: 1165 });
    expect(req().notes).toMatch(/\[ONTHEWAY:2026-09-04\]/);
    expect(req().notes).toMatch(/\[PREPAID:BANK\]/);
    expect(req().notes).toMatch(/\[ADV:1165\.00\]/);
  });

  it('a corrected price posts only the difference against what was paid ahead', async () => {
    const { svc, entries, req } = build({
      status: 'BOUGHT',
      open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1165.00]' },
      lines: [{ ...ORDERED[0], packsBought: 2, packSize: 750, packCost: 540 }, { ...ORDERED[1], packsBought: 1, packSize: 1000, packCost: 85 }],
    });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 500 }], OWNER, { paidFrom: 'BANK' });
    expect(entries).toEqual([expect.objectContaining({ type: 'PAID_AHEAD_REFUND', amount: 80, source: 'BANK' })]);
    expect(req().notes).toMatch(/\[ADV:1085\.00\]/);
  });

  it('owner-funded paid ahead is the owner putting money in, then the business paying it out', async () => {
    const { svc, entries } = build({ status: 'SENT', lines: [ORDERED[0]] });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }], OWNER, { paidFrom: 'OWNER_FUNDED' });
    expect(entries.map((e) => [e.type, e.amount, e.source])).toEqual([['PAID_AHEAD', 1080, 'CASH'], ['OWNER_CONTRIBUTION', 1080, 'CASH']]);
  });

  const PREPAID_BOUGHT = { open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1620.00]' }, status: 'BOUGHT', lines: BOUGHT };

  it('receiving a paid-ahead order takes the goods from 1063, never the pocket; a fee at the door comes from the same pocket', async () => {
    const { svc, received, entries } = build(PREPAID_BOUGHT);
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { charges: [{ description: 'COD handling', amount: 20 }] });
    expect(received[0].paymentMethod).toBe('PREPAID');
    expect(entries).toEqual([expect.objectContaining({ type: 'EXPENSE', amount: 20, source: 'BANK' })]);
    expect(res.request.status).toBe('RECEIVED');
  });

  it('a refunded pack on a paid-ahead order comes back to the pocket that paid', async () => {
    const { svc, entries } = build(PREPAID_BOUGHT);
    const res = await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1', packsArrived: 2 }], closeShort: [{ lineId: 'l1', outcome: 'REFUNDED' }] });
    expect(entries).toEqual([expect.objectContaining({ type: 'PAID_AHEAD_REFUND', amount: 540, source: 'BANK' })]);
    expect(res.charges[0]).toMatchObject({ description: 'Hazelnut Syrup — 1 pack refunded', entryNumber: 'JE-1' });
    expect(res.followUp).toBeNull();
  });

  it('a lost or never-coming pack on a paid-ahead order is written off, not charged again', async () => {
    for (const outcome of ['LOST', 'NOT_COMING'] as const) {
      const { svc, entries } = build(PREPAID_BOUGHT);
      await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1', packsArrived: 2 }], closeShort: [{ lineId: 'l1', outcome }] });
      expect(entries).toEqual([expect.objectContaining({ type: 'PAID_AHEAD_WRITE_OFF', amount: 540 })]);
    }
  });

  it('the balance of a paid-ahead order is paid ahead too', async () => {
    const { svc, createdRequests } = build(PREPAID_BOUGHT);
    await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1', packsArrived: 2 }] });
    const follow = createdRequests.find((r) => r.status === 'BOUGHT');
    expect(follow.notes).toMatch(/\[PREPAID:BANK\]/);
  });


  // -- what the tags are allowed to say -------------------------------------

  /*
    [PREPAID:] is an instruction to the ledger: it sends the arrival to 1063
    instead of charging a pocket. Everything below keeps that instruction in
    Procure's own hands -- it may only be written by money that actually
    posted, only by someone allowed to spend, and never by text typed into a
    note box.
  */

  it('leaves the order un-paid when the ledger refuses the advance', async () => {
    const { svc, req } = build({ status: 'SENT', lines: ORDERED, ledgerFails: true });
    const res = await svc.recordBought(TENANT, 'req1', [
      { lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 },
    ], OWNER, { paidFrom: 'BANK', boughtAt: '2026-09-04' });

    // Tagged anyway, the arrival would take 1080 out of a clearing account
    // that was never filled: goods on the shelf and no money out anywhere.
    expect(req().notes ?? '').not.toMatch(/\[PREPAID:/);
    expect(req().notes ?? '').not.toMatch(/\[ADV:/);
    expect(res.paidAhead.posted).toBe(0);
    expect(res.paidAhead.entries[0].error).toMatch(/closed/i);
  });

  it('posts the whole amount on the retry after the month is opened', async () => {
    const { svc, entries, req } = build({
      status: 'BOUGHT',
      open: { notes: '[ONTHEWAY:2026-09-04]' },   // the failed attempt left no advance
      lines: [{ ...ORDERED[0], packsBought: 2, packSize: 750, packCost: 540 }],
    });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }], OWNER, { paidFrom: 'BANK' });
    expect(entries).toEqual([expect.objectContaining({ type: 'PAID_AHEAD', amount: 1080 })]);
    expect(req().notes).toMatch(/\[ADV:1080\.00\]/);
  });

  it('does not read a tag out of the note somebody typed', async () => {
    const { svc, received, req } = build({ status: 'SENT', lines: [ORDERED[0]] });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }], OWNER,
      { note: '[PREPAID:CASH] Shopee 2609091234' });
    expect(req().notes ?? '').not.toMatch(/\[PREPAID:/);

    // And the delivery is charged to the pocket the owner picked, not to 1063.
    await svc.receiveRequest(TENANT, 'req1', USER, 'BANK', {});
    expect(received[0].paymentMethod).toBe('BANK');
  });

  it('will not let staff say the order was paid, or add a fee', async () => {
    const staff = { userId: 'cook', role: 'GENERAL_EMPLOYEE' };
    const { svc, entries } = build({ status: 'SENT', lines: ORDERED });
    await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }], staff, { paidFrom: 'CASH' }))
      .rejects.toThrow(/owner or manager/i);
    await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }], staff, { charges: [{ description: 'fee', amount: 5000 }] }))
      .rejects.toThrow(/owner or manager/i);
    expect(entries).toEqual([]);
  });

  it('will not let staff rewrite an order that was already paid for', async () => {
    const { svc } = build({
      status: 'BOUGHT',
      open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1080.00]' },
      lines: [{ ...ORDERED[0], packsBought: null }],
    });
    await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 600 }],
      { userId: 'cook', role: 'GENERAL_EMPLOYEE' }, {})).rejects.toThrow(/already paid for/i);
  });

  it('posts a corrected price against the advance even when no pocket is sent', async () => {
    // The screen stops offering the pocket tiles once an order is prepaid,
    // so the correction arrives with none. The request remembers which one.
    const { svc, entries, req } = build({
      status: 'BOUGHT',
      open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1080.00]' },
      lines: [{ ...ORDERED[0], packsBought: 2, packSize: 750, packCost: 540 }],
    });
    await svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 600 }], OWNER, {});
    expect(entries).toEqual([expect.objectContaining({ type: 'PAID_AHEAD', amount: 120, source: 'BANK' })]);
    expect(req().notes).toMatch(/\[ADV:1200\.00\]/);
  });

  it('refuses to pay an order from a second pocket', async () => {
    const { svc } = build({
      status: 'BOUGHT',
      open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1080.00]' },
      lines: [{ ...ORDERED[0], packsBought: 2, packSize: 750, packCost: 540 }],
    });
    await expect(svc.recordBought(TENANT, 'req1', [{ lineId: 'l1', packsBought: 2, packSize: 750, packCost: 540 }], OWNER, { paidFrom: 'CASH' }))
      .rejects.toThrow(/already paid from the shop bank/i);
  });

  // -- what is still waiting in 1063 ----------------------------------------

  const TWO_PREPAID = {
    status: 'BOUGHT',
    open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1250.00]' },
    lines: [
      { ...ORDERED[0], packsBought: 2, packSize: 750,  packCost: 540 },   // 1080
      { ...ORDERED[1], packsBought: 2, packSize: 1000, packCost: 85 },    //  170
    ],
  };

  it('counts the advance down to what has not been posted yet', async () => {
    const { svc, req } = build(TWO_PREPAID);
    await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }] });
    // 1080 of the 1250 went onto the shelf out of 1063; 170 is still there.
    expect(req().notes).toMatch(/\[ADV:170\.00\]/);
  });

  it('does not invent a refund when a price is corrected after a partial delivery', async () => {
    /*
      Measured against the whole order, the second line alone looked like a
      1080 over-payment and posted a refund that never happened.
    */
    const h = build(TWO_PREPAID);
    await h.svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }] });
    h.entries.length = 0;
    await h.svc.recordBought(TENANT, 'req1', [{ lineId: 'l2', packsBought: 2, packSize: 1000, packCost: 85 }], OWNER, {});
    expect(h.entries).toEqual([]);
    expect(h.req().notes).toMatch(/\[ADV:170\.00\]/);
  });

  it('will not close an order that was paid for while packs are still unaccounted for', async () => {
    const { svc, entries } = build(TWO_PREPAID);
    await expect(svc.receiveRequest(TENANT, 'req1', USER, 'CASH', { lines: [{ lineId: 'l1' }], closeRest: true }))
      .rejects.toThrow(/White Sugar/);
    // Nothing posted: the owner is asked to say what became of it first.
    expect(entries).toEqual([]);
  });

  it('will not cancel an order whose money is still in 1063', async () => {
    const { svc } = build(TWO_PREPAID);
    await expect(svc.cancel(TENANT, 'req1')).rejects.toThrow(/paid for ahead/i);
  });

  it('sends the balance away with its share of the advance', async () => {
    const { svc, createdRequests, req } = build(TWO_PREPAID);
    await svc.receiveRequest(TENANT, 'req1', USER, 'CASH', {
      lines: [{ lineId: 'l1', packsArrived: 1 }, { lineId: 'l2' }],
      closeShort: [{ lineId: 'l1', outcome: 'STILL_COMING' }],
    });
    const follow = createdRequests.find((r) => r.status === 'BOUGHT');
    expect(follow.notes).toMatch(/\[ADV:540\.00\]/);   // the pack still coming
    expect(req().notes).toMatch(/\[ADV:0\.00\]/);      // nothing left on the original
  });

  it('keeps the pocket the order was paid from, whatever the caller sends', async () => {
    // The receipts screen carries its own "who paid" picker and defaults it.
    // Re-reading an order page onto a request paid from the bank used to
    // move the tag, and a refund later went back to the wrong pocket.
    const { svc, entries, req } = build({
      status: 'BOUGHT',
      open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1080.00]' },
      lines: [{ ...ORDERED[0], packsBought: 2, packSize: 750, packCost: 540 }],
    });
    await svc.payAhead(TENANT, { ...req(), lines: req().lines }, USER, 'OWNER_FUNDED', '2026-09-05', []);
    expect(req().notes).toMatch(/\[PREPAID:BANK\]/);
    expect(entries).toEqual([]);   // nothing changed, so nothing to post
  });

  it('does not hand the order total to staff who are not shown costs', async () => {
    const { svc } = build({
      status: 'BOUGHT',
      showCostsToStaff: false,
      open: { notes: '[ONTHEWAY:2026-09-04] [PREPAID:BANK] [ADV:1080.00] Shopee 123' },
      lines: [{ ...ORDERED[0], packsBought: 2, packSize: 750, packCost: 540 }],
    });
    const seen = await svc.get(TENANT, 'req1', 'GENERAL_EMPLOYEE');
    expect(seen.costsHidden).toBe(true);
    expect(seen.notes ?? '').not.toMatch(/\[ADV:/);
    expect(seen.notes).toMatch(/\[PREPAID:BANK\]/);   // which pocket is not an amount
    expect(seen.notes).toMatch(/Shopee 123/);
  });

  it('takes the next control number when two lists are started in the same instant', async () => {
    const { svc, prisma } = build({ open: null });
    let first = true;
    const real = prisma.purchaseRequest.create;
    prisma.purchaseRequest.create = jest.fn((args: any) => {
      if (first && !args.data.status) {
        first = false;
        const clash: any = new Error('Unique constraint failed');
        clash.code = 'P2002';
        clash.constructor = { name: 'PrismaClientKnownRequestError' };
        Object.setPrototypeOf(clash, PrismaKnownError.prototype);
        return Promise.reject(clash);
      }
      return real(args);
    });
    const opened = await svc.openRequest(TENANT, BRANCH, USER);
    expect(opened).toBeTruthy();
    expect(prisma.purchaseRequest.create).toHaveBeenCalledTimes(2);
  });

  it('will not file a photo on a cancelled request', async () => {
    const { svc } = build({ status: 'CANCELLED', lines: [] });
    await expect(svc.attachPhoto(TENANT, 'req1', 'cook', { imageBase64: Buffer.from('x').toString('base64') })).rejects.toThrow(/cancelled/i);
  });
  // ── a list a kitchen or bar screen added to ───────────────────────────────

  describe('telling the owners a sent list changed', () => {
    const lines = [
      { id: 'l1', rawMaterialId: 'rm-milk', qtyRequested: 3000, rawMaterial: { name: 'Fresh milk', unit: 'ml' } },
      { id: 'l2', rawMaterialId: 'rm-sug',  qtyRequested: 500,  rawMaterial: { name: 'White Sugar', unit: 'g' } },
      { id: 'l3', rawMaterialId: 'rm-tis',  qtyRequested: 4,    rawMaterial: { name: 'Tissue roll', unit: 'roll' } },
    ];
    const req = { id: 'req1', requestNumber: 'REQ-20260917-002', branchId: BRANCH, branch: { name: 'Main' }, lines };
    const packs = [{ rawMaterialId: 'rm-milk', packSize: 1000, packCost: 95, brandNote: null, receivedAt: new Date() }];

    it('names only what changed, says what a raised line was, and mails nobody', async () => {
      const { svc, notified, mailed } = build({ people: PEOPLE, lastPacks: packs });
      const alerts = { buyListUpdated: jest.fn(), buyListSent: jest.fn() };
      svc.telegramAlerts = alerts;
      const told = await svc.tellTheOwners(TENANT, req, null, 'pairer', {
        mode: 'updated',
        changed: [{ rawMaterialId: 'rm-milk', was: 2000 }, { rawMaterialId: 'rm-tis', was: null }],
        byLabel: 'Kitchen screen',
        newItems: { ids: ['rm-tis'], screen: 'Kitchen screen' },
      });
      expect(told.sort()).toEqual(['Anne', 'Mia']);
      expect(notified.map((n) => n.userId).sort()).toEqual(['mgr', 'owner']);
      expect(notified[0]).toMatchObject({
        title: 'Buy list REQ-20260917-002 updated — Main',
        body:  'Fresh milk 3 packs (3,000 ml) (was 2 packs (2,000 ml)) · Tissue roll (new item from the Kitchen screen) 4 roll',
        link:  '/procure/requests?view=REQ-20260917-002',
        dedupeKey: `req-updated-REQ-20260917-002-${notified[0].userId}`,
      });
      expect(mailed).toEqual([]);
      expect(alerts.buyListSent).not.toHaveBeenCalled();
      expect(alerts.buyListUpdated).toHaveBeenCalledWith(TENANT, 'req1', [
        { name: 'Fresh milk', amount: '3 packs (3,000 ml) (was 2 packs (2,000 ml))', serves: null },
        { name: 'Tissue roll (new item from the Kitchen screen)', amount: '4 roll', serves: null },
      ], 'Kitchen screen');
    });

    it('says a line is a starting amount, so the owner does not read a kilo of it as a forecast', async () => {
      const { svc, notified } = build({ people: PEOPLE, lastPacks: packs });
      const alerts = { buyListUpdated: jest.fn(), buyListSent: jest.fn() };
      svc.telegramAlerts = alerts;
      await svc.tellTheOwners(TENANT, req, null, 'pairer', {
        mode: 'updated',
        changed: [{ rawMaterialId: 'rm-sug', was: null }],
        byLabel: 'Kitchen screen',
        startingIds: ['rm-sug'],
      });
      expect(notified[0].body).toBe('White Sugar 500 g (starting amount: out, no sales history yet)');
      expect(alerts.buyListUpdated).toHaveBeenCalledWith(TENANT, 'req1', [
        { name: 'White Sugar', amount: '500 g (starting amount: out, no sales history yet)', serves: null },
      ], 'Kitchen screen');
    });

    it('an update that changed nothing tells nobody', async () => {
      const { svc, notified } = build({ people: PEOPLE });
      expect(await svc.tellTheOwners(TENANT, req, null, 'pairer', { mode: 'updated', changed: [] })).toEqual([]);
      expect(notified).toEqual([]);
    });

    it('sent mode returns who was told, and a screen is named on Telegram instead of the person who paired it', async () => {
      const { svc } = build({ people: PEOPLE.slice(0, 1) });
      const alerts = { buyListSent: jest.fn() };
      svc.telegramAlerts = alerts;
      expect(await svc.tellTheOwners(TENANT, req, null, 'pairer', { byLabel: 'Kitchen screen' })).toEqual(['Anne']);
      expect(alerts.buyListSent).toHaveBeenCalledWith(TENANT, 'req1', expect.any(Array), 'pairer', 'Kitchen screen');
    });

    it('nobody to tell, or a failure telling them, returns no names', async () => {
      expect(await build({ people: [] }).svc.tellTheOwners(TENANT, req)).toEqual([]);
      const broken = build({ people: PEOPLE });
      broken.notifications.create.mockRejectedValue(new Error('database down'));
      jest.spyOn(broken.svc.logger, 'warn').mockImplementation(() => undefined);
      expect(await broken.svc.tellTheOwners(TENANT, req)).toEqual([]);
    });
  });

  it('amountWords says an amount the way the list always has', () => {
    expect(amountWords(1500, 'ml', 750)).toBe('2 packs (1,500 ml)');
    expect(amountWords(750, 'ml', 750)).toBe('1 pack (750 ml)');
    expect(amountWords(500, 'g', null)).toBe('500 g');
    expect(amountWords(1000, 'g', 300)).toBe('1,000 g');          // not a whole number of packs
    expect(amountWords(1500, 'ml', 1000)).toBe('1.5 packs (1,500 ml)');
  });

  it('namesInWords lists people the way a sentence does', () => {
    expect(namesInWords(['Anne'])).toBe('Anne');
    expect(namesInWords(['Anne', 'Mia'])).toBe('Anne and Mia');
    expect(namesInWords(['Anne', 'Mia', 'Jo'])).toBe('Anne, Mia and Jo');
    expect(namesInWords([])).toBe('');
  });
});
