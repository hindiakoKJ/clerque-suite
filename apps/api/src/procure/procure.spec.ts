import { ProcureService } from './procure.service';
import { Prisma } from '@prisma/client';

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
    /** RawMaterialInventory rows at the branch. */
    onHand?: Array<{ rawMaterialId: string; quantity: number }>;
    /** A cycle count already started from this list. */
    openCount?: { id: string; countNumber: string; notes: string; lines: any[] } | null;
    /** The owners and managers on the account. */
    people?: Array<{ id: string; email: string | null; name: string; role: string; branchId?: string | null }>;
    /** A mailer that fails, to prove a send never depends on it. */
    mailFails?: boolean;
    /** A ledger that refuses -- a locked month, a chart with no 1063. */
    ledgerFails?: boolean;
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
        // What each ingredient held and cost the last time it was received.
        findMany:   jest.fn().mockResolvedValue(opts.lastPacks ?? []),
      },
      document: { count: jest.fn().mockResolvedValue(0) },
      user: {
        findMany: jest.fn(({ where }: any) => Promise.resolve((opts.people ?? []).filter((p) => {
          const alts: any[] = where.OR ?? [];
          return alts.some((a) => a.role === p.role && (!a.OR || a.OR.some((b: any) => b.branchId === (p.branchId ?? null))));
        }).map(({ id, email, name }) => ({ id, email, name })))),
      },
      rawMaterialInventory: {
        findMany:   jest.fn(({ where }: any) => Promise.resolve((opts.onHand ?? []).filter((x) => where.rawMaterialId.in.includes(x.rawMaterialId)).map((x) => ({ branchId: BRANCH, ...x })))),
        findUnique: jest.fn(({ where }: any) => Promise.resolve((opts.onHand ?? []).find((x) => x.rawMaterialId === where.branchId_rawMaterialId.rawMaterialId) ?? null)),
      },
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
        docs.push({ type, id, size: buf.length, mime, name, label, by });
        return Promise.resolve({ id: 'doc1', filename: name });
      }),
    };
    const warehouse: any = { nextCountNumber: jest.fn().mockResolvedValue('CC-2026-000007') };
    const notified: any[] = [];
    const mailed: any[] = [];
    const notifications: any = { create: jest.fn((a: any) => { notified.push(a); return Promise.resolve({ id: `n${notified.length}` }); }) };
    const mail: any = { sendBuyListSent: jest.fn((a: any) => { if (opts.mailFails) return Promise.reject(new Error('Resend is down')); mailed.push(a); return Promise.resolve(); }) };
    const svc = new ProcureService(prisma, inventory, simple, documents, warehouse, notifications, mail) as any;
    return {
      svc, prisma, inventory, created, createdRequests, updatedLines, received, entries, docs, createdCounts, countLines, notified, mailed,
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

  it('refuses to record shopping against a request that was never sent', async () => {
    const { svc } = build({ status: 'OPEN', lines: [{ id: 'l1' }] });
    await expect(svc.recordBought(TENANT, 'req1', [
      { lineId: 'l1', packsBought: 1, packSize: 100, packCost: 10 },
    ])).rejects.toThrow(/has to be sent/i);
  });

  // ── posting to stock ──────────────────────────────────────────────────────

  const BOUGHT = [{
    id: 'l1', lineNumber: 'REQ-20260830-001-01', rawMaterialId: 'rm-haz',
    packsBought: 3, packSize: 750, packCost: 540, brandNote: 'Da Vinci',
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

  it('lets staff record what they bought only when the shop shows them costs', async () => {
    const line = { id: 'l1', rawMaterialId: 'rm-haz', packsBought: null, rawMaterial: { name: 'Hazelnut Syrup' } };
    const row  = [{ lineId: 'l1', packsBought: 1, packSize: 750, packCost: 540 }];

    const hidden = build({ status: 'SENT', lines: [line], showCostsToStaff: false });
    await expect(hidden.svc.recordBought(TENANT, 'req1', row, { userId: 'cook', role: 'GENERAL_EMPLOYEE' }))
      .rejects.toThrow(/owner or manager records/i);

    const shown = build({ status: 'SENT', lines: [line], showCostsToStaff: true });
    const res = await shown.svc.recordBought(TENANT, 'req1', row, { userId: 'cook', role: 'GENERAL_EMPLOYEE' });
    expect(res.status).toBe('BOUGHT');
    expect(shown.updatedLines[0].id).toBe('l1');
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
    expect(countLines[0]).toMatchObject({ rawMaterialId: 'rm-haz', notes: 'REQ-20260830-001-01' });
    expect(Number(countLines[0].expectedQty)).toBe(2250);
    expect(Number(countLines[0].countedQty)).toBe(750);
    expect(Number(countLines[0].varianceQty)).toBe(-1500);
    expect(out).toMatchObject({ countNumber: 'CC-2026-000007', expectedQty: 2250, countedQty: 750, variance: -1500, unit: 'ml' });
  });

  it('a second count on the same line keeps the snapshot and changes only the count', async () => {
    const { svc, createdCounts, countLines, count } = build({ status: 'OPEN', lines: ASKED, onHand: [{ rawMaterialId: 'rm-haz', quantity: 2250 }] });
    await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 750);
    const out = await svc.recordCount(TENANT, 'req1', 'l1', 'cook', 1500);
    expect(createdCounts).toHaveLength(1);                       // one count per list
    expect(Number(countLines[1].countedQty)).toBe(1500);
    expect(Number(countLines[1].varianceQty)).toBe(-750);        // against the SAME 2250
    expect(out.expectedQty).toBe(2250);
    expect(count()!.lines).toHaveLength(1);
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
    expect(mailed[0].lines[0]).toEqual({ name: 'Hazelnut Syrup', amount: '2 packs (1,500 ml)' });
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
});
