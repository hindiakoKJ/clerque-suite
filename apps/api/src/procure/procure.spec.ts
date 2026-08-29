import { ProcureService } from './procure.service';

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
    receiveImpl?: (rmId: string, dto: any) => any;
  } = {}) {
    const created: any[] = [];
    const updatedLines: any[] = [];
    const received: any[] = [];
    let request = opts.open === null ? null : {
      id: 'req1', tenantId: TENANT, branchId: BRANCH,
      requestNumber: 'REQ-20260830-001',
      status: opts.status ?? 'OPEN',
      lines: opts.lines ?? [],
      ...(opts.open ?? {}),
    };

    const prisma: any = {
      purchaseRequest: {
        findFirst: jest.fn().mockResolvedValue(request),
        create:    jest.fn(({ data }: any) => {
          request = { id: 'req1', lines: [], ...data };
          created.push(data);
          return Promise.resolve(request);
        }),
        update: jest.fn(({ data }: any) => {
          request = { ...request, ...data };
          return Promise.resolve(request);
        }),
      },
      purchaseRequestLine: {
        create:     jest.fn(({ data }: any) => { created.push(data); return Promise.resolve(data); }),
        update:     jest.fn(({ where, data }: any) => { updatedLines.push({ ...where, ...data }); return Promise.resolve({}); }),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      rawMaterial: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve({ id: where.id, name: 'White Sugar' })),
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
    const svc = new ProcureService(prisma, inventory) as any;
    return { svc, prisma, inventory, created, updatedLines, received, req: () => request };
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
    const { svc, created } = build({ lines: [{ id: 'l1', rawMaterialId: 'rm-x' }] });
    await svc.addLine(TENANT, 'req1', { rawMaterialId: 'rm-sugar', qtyRequested: 5000 });
    expect(created[0].lineNumber).toBe('REQ-20260830-001-02');
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
        { rawMaterialId: 'rm-ok',    shortBy: 0,    kind: 'INGREDIENT' },  // not short
        { productId:     'p1',       shortBy: 5 },                          // a product, not ours
      ],
    });
    const res = await svc.pullLowStock(TENANT, BRANCH, USER);
    expect(res.added).toBe(2);
    expect(created.map((c) => c.rawMaterialId)).toEqual(['rm-sugar', 'rm-milk']);
    expect(Number(created[0].shortBy)).toBe(4000);
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

  it('skips a line nobody bought, without failing the rest', async () => {
    const { svc } = build({
      status: 'BOUGHT',
      lines: [
        ...BOUGHT,
        { id: 'l2', lineNumber: 'REQ-20260830-001-02', rawMaterialId: 'rm-x',
          packsBought: null, packSize: null, packCost: null, receivedAt: null,
          rawMaterial: { name: 'Dried Lemon', unit: 'g' } },
      ],
    });
    const res = await svc.receiveRequest(TENANT, 'req1', USER);
    expect(res.posted).toHaveLength(1);
    expect(res.skipped[0].reason).toMatch(/nothing was bought/i);
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
});
