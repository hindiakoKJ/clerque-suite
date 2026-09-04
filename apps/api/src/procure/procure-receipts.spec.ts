import { ProcureReceiptsService } from './procure-receipts.service';

/**
 * A receipt becomes a request, then stock, then expenses, then a filed photo.
 *
 * What is pinned here is the posting, not the reading: that the person's
 * corrected lines are what land, that two printed lines of one ingredient
 * become one delivery, that a near-duplicate name is refused rather than
 * created, that a retry replays instead of re-posting, and that an
 * owner-funded expense is two honest entries. The model never appears; it is
 * mocked to a canned reading so `parse` can be checked for what it does with
 * the reading -- match, derive, never write.
 */
describe('ProcureReceiptsService', () => {
  const TENANT = 't1';
  const USER   = 'u1';
  const BRANCH = 'b1';

  const MATERIALS = [
    { id: 'wings', name: 'Chicken wings', unit: 'pc', category: 'INGREDIENT', costPrice: 11 },
    { id: 'sugar', name: 'Sugar',         unit: 'g',  category: 'INGREDIENT', costPrice: 0.09 },
    { id: 'milk',  name: 'Fresh Milk',    unit: 'ml', category: 'INGREDIENT', costPrice: 0.088 },
  ];

  function build(opts: {
    aiText?: string;
    existingByKey?: any;
    receiveImpl?: (rmId: string, dto: any) => any;
    twin?: { id: string; name: string; isActive: boolean } | null;
  } = {}) {
    const requests: any[] = [];
    const received: Array<{ rmId: string; dto: any }> = [];
    const entries: any[] = [];
    const docs: any[] = [];
    const createdMaterials: any[] = [];
    let seq = 0;

    const prisma: any = {
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterial: {
        findMany:  jest.fn().mockResolvedValue(MATERIALS),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.id) return Promise.resolve(MATERIALS.find((m) => m.id === where.id) ?? null);
          // the case-insensitive twin check for a NEW ingredient
          return Promise.resolve(opts.twin ?? null);
        }),
      },
      purchaseRequest: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.notes?.startsWith) return Promise.resolve(opts.existingByKey ?? null);
          return Promise.resolve(requests[requests.length - 1] ?? null);
        }),
        create: jest.fn().mockImplementation(({ data }: any) => {
          const lines = (data.lines?.create ?? []).map((l: any, i: number) => ({
            id: `line${i + 1}`, ...l, receivedAt: null,
            rawMaterial: MATERIALS.find((m) => m.id === l.rawMaterialId) ?? createdMaterials.find((m) => m.id === l.rawMaterialId),
          }));
          const req = { id: `req${++seq}`, ...data, lines, branch: { id: BRANCH, name: 'Main' } };
          requests.push(req);
          return Promise.resolve(req);
        }),
        update: jest.fn().mockImplementation(({ data }: any) => {
          const req = requests[requests.length - 1];
          Object.assign(req, data);
          return Promise.resolve(req);
        }),
      },
      purchaseRequestLine: {
        create: jest.fn().mockImplementation(({ data }: any) => {
          const req = requests[requests.length - 1] ?? opts.existingByKey;
          const l = { id: `line-new-${Math.random().toString(36).slice(2, 6)}`, ...data, receivedAt: null,
                      rawMaterial: MATERIALS.find((m) => m.id === data.rawMaterialId) };
          if (req) req.lines.push(l);
          return Promise.resolve(l);
        }),
        update: jest.fn().mockImplementation(({ where, data }: any) => {
          const req = requests[requests.length - 1];
          const l = req.lines.find((x: any) => x.id === where.id);
          if (l) Object.assign(l, data);
          return Promise.resolve(l);
        }),
      },
    };

    const inventory: any = {
      receiveRawMaterial: jest.fn().mockImplementation((_t: string, rmId: string, dto: any) => {
        received.push({ rmId, dto });
        return Promise.resolve(opts.receiveImpl ? opts.receiveImpl(rmId, dto) : { totalValue: 1 });
      }),
      createRawMaterial: jest.fn().mockImplementation((_t: string, dto: any) => {
        const m = { id: `new-${dto.name.toLowerCase().replace(/\s+/g, '-')}`, name: dto.name, unit: dto.unit, category: dto.category ?? 'INGREDIENT', costPrice: null };
        createdMaterials.push(m);
        return Promise.resolve(m);
      }),
    };

    // The real ProcureService's receive loop, driven by the mocks above.
    const { ProcureService } = jest.requireActual('./procure.service');
    const procure = new ProcureService(prisma, inventory);
    jest.spyOn(procure as any, 'nextNumber').mockResolvedValue('REQ-20260902-001');

    const ai: any = { call: jest.fn().mockResolvedValue(opts.aiText ?? '{"lines":[]}') };
    const documents: any = {
      uploadBuffer: jest.fn().mockImplementation((_t: string, type: string, id: string, buf: Buffer, mime: string, name: string) => {
        docs.push({ type, id, size: buf.length, mime, name });
        return Promise.resolve({ id: 'doc1', filename: name });
      }),
    };
    const simple: any = {
      create: jest.fn().mockImplementation((_t: string, _u: string, dto: any) => {
        entries.push(dto);
        return Promise.resolve({ entryNumber: `JE-${entries.length}` });
      }),
    };

    const svc = new ProcureReceiptsService(prisma, inventory, procure, ai, documents, simple);
    return { svc, prisma, inventory, ai, received, entries, docs, requests, createdMaterials };
  }

  const READING = JSON.stringify({
    vendor: 'Puregold', dateText: '09/02/2026', dateIso: '2026-09-02', referenceNumber: 'OR 4471', total: 1217.95,
    lines: [
      { description: 'CHICKEN WINGS 5.810KG', quantity: 5.81, unit: 'kg', unitPrice: 195, lineTotal: 1132.95, kind: 'ingredient', confidence: 0.95 },
      { description: 'WHITE SUGAR 1KG',        quantity: 1,    unit: 'kg', unitPrice: 85,  lineTotal: 85,      kind: 'ingredient', confidence: 0.9 },
      { description: 'DELIVERY FEE',           quantity: null, unit: null, unitPrice: null, lineTotal: 0,      kind: 'expense', expenseCategory: 'TRANSPORT', confidence: 0.8 },
    ],
  });

  // ── parse ──────────────────────────────────────────────────────────────────

  describe('parse — a suggestion, never a posting', () => {
    it('matches each printed line to the shop\'s own ingredient and writes nothing', async () => {
      const { svc, ai, received, requests } = build({ aiText: READING });
      const r = await svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=', mediaType: 'image/jpeg' });

      expect(ai.call).toHaveBeenCalledTimes(1);
      expect(r.vendor).toBe('Puregold');
      expect(r.lines[0].match?.rawMaterialId).toBe('wings');
      expect(r.lines[1].match?.rawMaterialId).toBe('sugar');
      expect(r.lines[2].match).toBeNull();          // an expense is not on the shelf
      expect(received).toEqual([]);
      expect(requests).toEqual([]);
    });

    /*
      A long receipt arrives as strips.

      The phone used to squeeze a metre of thermal paper into one 1,600px
      frame, which left the print about two pixels tall — unreadable, and the
      failure looked like a stupid model rather than like us sending a smudge.
      Now it cuts the photo into overlapping strips at full width, and they
      are read together as ONE receipt.
    */
    it('sends every strip of a long receipt, in order, and says they are one receipt', async () => {
      const { svc, ai } = build({ aiText: READING });
      await svc.parse(TENANT, USER, {
        images: [
          { base64: 'dG9w', mediaType: 'image/jpeg' },
          { base64: 'bWlk', mediaType: 'image/jpeg' },
          { base64: 'Ym90', mediaType: 'image/jpeg' },
        ],
      });

      const content = ai.call.mock.calls[0][0].messages[0].content;
      expect(content.filter((c: any) => c.type === 'image').map((c: any) => c.source.data))
        .toEqual(['dG9w', 'bWlk', 'Ym90']);
      const instruction = content.find((c: any) => c.type === 'text').text;
      expect(instruction).toContain('3 images are ONE receipt');
      expect(instruction).toMatch(/overlap/i);
    });

    it('lets an owner read one receipt with the other provider, to compare', async () => {
      const { svc, ai } = build({ aiText: READING });
      await svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=', provider: 'anthropic' }, 'BUSINESS_OWNER');
      expect(ai.call.mock.calls[0][0].provider).toBe('anthropic');
    });

    it('ignores the same request from anyone else — it decides who gets billed', async () => {
      const { svc, ai } = build({ aiText: READING });
      await svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=', provider: 'anthropic' }, 'BRANCH_MANAGER');
      // Ignored, not refused: the read still happens, on the house provider.
      expect(ai.call.mock.calls[0][0].provider).toBeUndefined();
    });

    it('still takes a single photo the old way, and does not talk about strips', async () => {
      const { svc, ai } = build({ aiText: READING });
      await svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=', mediaType: 'image/png' });

      const content = ai.call.mock.calls[0][0].messages[0].content;
      const images = content.filter((c: any) => c.type === 'image');
      expect(images).toHaveLength(1);
      expect(images[0].source.media_type).toBe('image/png');
      expect(content.find((c: any) => c.type === 'text').text).not.toMatch(/strip|ONE receipt/i);
    });

    it('refuses a read with no photo at all', async () => {
      const { svc } = build();
      await expect(svc.parse(TENANT, USER, {} as any)).rejects.toThrow(/photo of the receipt is required/i);
    });

    it('measures the size limit across ALL the strips, not one at a time', async () => {
      // Four strips, each comfortably under the cap, together over it. Checked
      // one at a time this would sail through and fail at the provider.
      const big = 'A'.repeat(2_100_000);
      const { svc } = build();
      await expect(svc.parse(TENANT, USER, {
        images: [{ base64: big }, { base64: big }, { base64: big }, { base64: big }],
      })).rejects.toThrow(/too large/i);
    });

    it('derives the pack the way the importer would, and asks where it cannot', async () => {
      const { svc } = build({ aiText: READING });
      const r = await svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=' });
      // kg on the receipt, pc on the shelf: weight and count do not convert
      expect(r.lines[0].pack?.needsPackSize).toBe(true);
      // kg on the receipt, g on the shelf: 1000
      expect(r.lines[1].pack).toMatchObject({ packsBought: 1, packSize: 1000, packCost: 85, needsPackSize: false });
      expect(r.summary).toMatchObject({ lines: 3, matched: 2, unmatched: 0, expenses: 1, needsPack: 1 });
    });

    it('sends the photo to the reader with the line-item prompt, cached', async () => {
      const { svc, ai } = build({ aiText: READING });
      await svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=', mediaType: 'image/png' });
      const call = ai.call.mock.calls[0][0];
      expect(call.action).toBe('procure_receipt_lines');
      expect(call.cacheSystem).toBe(true);
      expect(call.messages[0].content[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } });
    });

    it('turns an unreadable photo into a plain sentence, not a 500', async () => {
      const { svc } = build({ aiText: 'Sorry, this is blurry.' });
      await expect(svc.parse(TENANT, USER, { imageBase64: 'aGVsbG8=' })).rejects.toThrow(/could not be read/);
    });
  });

  // ── confirm ────────────────────────────────────────────────────────────────

  const CONFIRM = {
    vendor: 'Puregold', receiptDate: '2026-09-02', referenceNumber: 'OR 4471',
    paymentMethod: 'CASH' as const,
    lines: [
      { rawMaterialId: 'sugar', packsBought: 1, packSize: 1000, packCost: 85 },
      { rawMaterialId: 'wings', packsBought: 5.81, packSize: 18, packCost: 195, acceptCostChange: true },
    ],
    expenses: [{ description: 'Delivery fee', amount: 50, category: 'TRANSPORT' as const }],
  };

  it('creates a BOUGHT request and receives every line on the receipt\'s date with its own reference', async () => {
    const { svc, prisma, received, requests } = build();
    const r = await svc.confirm(TENANT, USER, BRANCH, CONFIRM);

    // Created BOUGHT (the shopping already happened), then flipped to
    // RECEIVED by the posting -- the mock mutates one object, so read the
    // create call for what it was born as.
    expect(prisma.purchaseRequest.create.mock.calls[0][0].data.status).toBe('BOUGHT');
    expect(requests[0].requestNumber).toBe('REQ-20260902-001');
    expect(received).toHaveLength(2);
    expect(received[0]).toMatchObject({
      rmId: 'sugar',
      dto: { quantity: 1000, costPrice: 0.085, paymentMethod: 'CASH', referenceNumber: 'REQ-20260902-001-01', receivedAt: '2026-09-02' },
    });
    expect(received[0].dto.note).toContain('Puregold');
    expect(r.posted).toHaveLength(2);
    expect(r.request.status).toBe('RECEIVED');
  });

  it('passes "the price really changed" through only for the line that said so', async () => {
    const { svc, received } = build();
    await svc.confirm(TENANT, USER, BRANCH, CONFIRM);
    const sugar = received.find((x) => x.rmId === 'sugar')!;
    const wings = received.find((x) => x.rmId === 'wings')!;
    expect(sugar.dto.acceptCostChange).toBeUndefined();
    expect(wings.dto.acceptCostChange).toBe(true);
  });

  it('turns two printed lines of one ingredient into one delivery', async () => {
    /*
      The chicken-wings receipt: two weighed lines at the same price. The
      request has one line per ingredient by construction, and this IS one
      delivery of chicken -- so the packs add up and nothing is lost.
    */
    const { svc, received, requests } = build();
    await svc.confirm(TENANT, USER, BRANCH, {
      ...CONFIRM, expenses: [],
      lines: [
        { rawMaterialId: 'wings', packsBought: 5.81, packSize: 18, packCost: 195 },
        { rawMaterialId: 'wings', packsBought: 5.97, packSize: 18, packCost: 195 },
      ],
    });
    expect(requests[0].lines).toHaveLength(1);
    expect(received).toHaveLength(1);
    expect(received[0].dto.quantity).toBeCloseTo(11.78 * 18, 6);
    expect(received[0].dto.costPrice).toBeCloseTo(195 / 18, 6);
  });

  it('restates unlike packs of one ingredient in its own unit at the blended cost', async () => {
    const { svc, received, requests } = build();
    await svc.confirm(TENANT, USER, BRANCH, {
      ...CONFIRM, expenses: [],
      lines: [
        { rawMaterialId: 'sugar', packsBought: 1, packSize: 1000, packCost: 85 },   // a 1 kg bag
        { rawMaterialId: 'sugar', packsBought: 2, packSize: 500,  packCost: 45 },   // two 500 g bags
      ],
    });
    // one pack of 2000 g for P175: the pesos that land are the pesos paid
    expect(requests[0].lines).toHaveLength(1);
    expect(Number(requests[0].lines[0].packsBought)).toBe(1);
    expect(Number(requests[0].lines[0].packSize)).toBe(2000);
    expect(Number(requests[0].lines[0].packCost)).toBe(175);
    expect(received[0].dto.quantity).toBe(2000);
    expect(received[0].dto.costPrice).toBeCloseTo(175 / 2000, 10);
    expect(received[0].dto.quantity * received[0].dto.costPrice).toBeCloseTo(175, 6);
    expect(requests[0].lines[0].brandNote).toMatch(/combined/);
  });

  it('posts an expense line as a simple entry on the receipt\'s date', async () => {
    const { svc, entries } = build();
    const r = await svc.confirm(TENANT, USER, BRANCH, CONFIRM);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: 'EXPENSE', amount: 50, date: '2026-09-02', category: 'TRANSPORT', source: 'CASH' });
    expect(r.expenses[0].entryNumber).toBe('JE-1');
  });

  it('an owner-funded expense is the owner putting money in, then the business spending it', async () => {
    const { svc, entries } = build();
    await svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, paymentMethod: 'OWNER_FUNDED' });
    // the spend first, so a failure leaves nothing one-sided behind; then the money that funded it
    expect(entries.map((e) => e.type)).toEqual(['EXPENSE', 'OWNER_CONTRIBUTION']);
    expect(entries[0].amount).toBe(50);
    expect(entries[1].amount).toBe(50);
  });

  it('files the photo against the request it made', async () => {
    const { svc, docs } = build();
    const r = await svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, imageBase64: 'aGVsbG8=', mediaType: 'image/png' });
    expect(docs[0]).toMatchObject({ type: 'PurchaseRequest', id: 'req1', mime: 'image/png', name: 'receipt-REQ-20260902-001.png' });
    expect(r.document).toEqual({ id: 'doc1', filename: 'receipt-REQ-20260902-001.png' });
  });

  it('creates an ingredient the shop did not have, then receives it', async () => {
    const { svc, inventory, received, createdMaterials } = build();
    const r = await svc.confirm(TENANT, USER, BRANCH, {
      ...CONFIRM, expenses: [],
      lines: [{ create: { name: 'Chicken breast', unit: 'g' }, packsBought: 2, packSize: 1000, packCost: 240 }],
    });
    expect(inventory.createRawMaterial).toHaveBeenCalledWith(TENANT, { name: 'Chicken breast', unit: 'g', category: undefined });
    expect(received[0].rmId).toBe(createdMaterials[0].id);
    expect(r.created).toEqual([{ id: createdMaterials[0].id, name: 'Chicken breast', unit: 'g' }]);
  });

  it('two new lines with one name are one new ingredient, created once', async () => {
    const { svc, inventory, received } = build();
    await svc.confirm(TENANT, USER, BRANCH, {
      ...CONFIRM, expenses: [],
      lines: [
        { create: { name: 'Chicken breast', unit: 'g' }, packsBought: 1.2, packSize: 1000, packCost: 240 },
        { create: { name: 'chicken breast', unit: 'g' }, packsBought: 0.8, packSize: 1000, packCost: 240 },
      ],
    });
    expect(inventory.createRawMaterial).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(1);
    expect(received[0].dto.quantity).toBeCloseTo(2000, 6);
  });

  it('creates nothing when a later line is going to be refused', async () => {
    // line 1 is new and fine; line 2 names a twin. Nothing may be created.
    const { svc, inventory } = build({ twin: { id: 'wings', name: 'Chicken wings', isActive: true } });
    await expect(svc.confirm(TENANT, USER, BRANCH, {
      ...CONFIRM, expenses: [],
      lines: [
        { create: { name: 'Kamote', unit: 'g' }, packsBought: 1, packSize: 1000, packCost: 60 },
        { create: { name: 'CHICKEN WINGS', unit: 'pc' }, packsBought: 1, packSize: 1, packCost: 195 },
      ],
    })).rejects.toThrow(/already exists/);
    expect(inventory.createRawMaterial).not.toHaveBeenCalled();
  });

  it('refuses to create a second ingredient that differs only by capitalisation', async () => {
    /*
      The exact entry that produced "Chicken Wings" beside "Chicken wings".
      A receipt is the easiest place to make a third, so the existing one is
      named and the person is sent to pick it.
    */
    const { svc, inventory } = build({ twin: { id: 'wings', name: 'Chicken wings', isActive: true } });
    await expect(svc.confirm(TENANT, USER, BRANCH, {
      ...CONFIRM, expenses: [],
      lines: [{ create: { name: 'CHICKEN WINGS', unit: 'pc' }, packsBought: 1, packSize: 1, packCost: 195 }],
    })).rejects.toThrow(/"Chicken wings" already exists/);
    expect(inventory.createRawMaterial).not.toHaveBeenCalled();
  });

  it('replays a retry instead of posting the delivery twice', async () => {
    const existing = { id: 'reqX', requestNumber: 'REQ-20260902-001', status: 'RECEIVED', lines: [] };
    const { svc, received, requests } = build({ existingByKey: existing });
    const r = await svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, idempotencyKey: 'abc-123' });
    expect(r.duplicate).toBe(true);
    expect(r.request.id).toBe('reqX');
    expect(received).toEqual([]);
    expect(requests).toEqual([]);
  });

  it('a replay of a request that never got its lines posted finishes the job', async () => {
    /*
      The first attempt made the request and then the connection dropped. The
      retry carries the same key; instead of "already done", it receives the
      lines that never landed -- and only those, because each line's reference
      is its own guard against a second posting.
    */
    const stuck = {
      id: 'reqX', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-20260902-001', status: 'BOUGHT',
      lines: [{ id: 'lineA', lineNumber: 'REQ-20260902-001-01', rawMaterialId: 'sugar', packsBought: 1, packSize: 1000, packCost: 85, brandNote: null, receivedAt: null,
                rawMaterial: MATERIALS[1] }],
    };
    const { svc, prisma, received } = build({ existingByKey: stuck });
    // get() inside receiveRequest reads the request back by id
    prisma.purchaseRequest.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.notes?.startsWith || where.id ? stuck : null));
    prisma.purchaseRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ ...stuck, ...data }));
    prisma.purchaseRequestLine.update.mockResolvedValue({});

    const r = await svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, idempotencyKey: 'abc-123' });
    expect(r.duplicate).toBe(true);
    // both resubmitted lines land: sugar (already on the request) and wings (added on the replay)
    expect(received.map((x) => x.rmId).sort()).toEqual(['sugar', 'wings']);
    expect(received.find((x) => x.rmId === 'sugar')!.dto.referenceNumber).toBe('REQ-20260902-001-01');
    expect(prisma.purchaseRequestLine.create).toHaveBeenCalledTimes(1);
    expect(r.posted).toHaveLength(2);
  });

  it('a replay carries the corrected numbers and "the price really changed" onto the waiting line', async () => {
    const stuck = {
      id: 'reqX', tenantId: TENANT, branchId: BRANCH, requestNumber: 'REQ-20260902-001', status: 'BOUGHT',
      lines: [{ id: 'lineW', lineNumber: 'REQ-20260902-001-01', rawMaterialId: 'wings', packsBought: 5.81, packSize: 1, packCost: 195, brandNote: null, receivedAt: null,
                rawMaterial: MATERIALS[0] }],
    };
    const { svc, prisma, received } = build({ existingByKey: stuck });
    prisma.purchaseRequest.findFirst.mockImplementation(({ where }: any) =>
      Promise.resolve(where.notes?.startsWith || where.id ? stuck : null));
    prisma.purchaseRequest.update.mockImplementation(({ data }: any) => Promise.resolve({ ...stuck, ...data }));
    prisma.purchaseRequestLine.update.mockImplementation(({ data }: any) => { Object.assign(stuck.lines[0], data); return Promise.resolve(stuck.lines[0]); });

    await svc.confirm(TENANT, USER, BRANCH, {
      paymentMethod: 'CASH', idempotencyKey: 'abc-123',
      lines: [{ rawMaterialId: 'wings', packsBought: 5.81, packSize: 18, packCost: 195, acceptCostChange: true }],
    });
    // the stored line now says 18 per kilo, and the guard override travelled with it
    expect(Number(stuck.lines[0].packSize)).toBe(18);
    expect(received[0].dto.quantity).toBeCloseTo(5.81 * 18, 6);
    expect(received[0].dto.acceptCostChange).toBe(true);
  });

  it('an owner-funded expense posts the expense first, and says so if the contribution fails', async () => {
    const { svc, entries } = build();
    let n = 0;
    const simple: any = (svc as any).simple;
    simple.create.mockImplementation((_t: string, _u: string, dto: any) => {
      entries.push(dto);
      if (dto.type === 'OWNER_CONTRIBUTION') return Promise.reject(new Error('Accounts not set up.'));
      return Promise.resolve({ entryNumber: `JE-${++n}` });
    });
    const r = await svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, paymentMethod: 'OWNER_FUNDED', lines: [] });
    expect(entries.map((e) => e.type)).toEqual(['EXPENSE', 'OWNER_CONTRIBUTION']);
    expect(r.expenses[0].entryNumber).toBe('JE-1');
    expect(r.expenses[0].error).toMatch(/owner contribution did not/);
  });

  it('a receipt that is all expenses still closes its request', async () => {
    const { svc, received, entries, requests } = build();
    const r = await svc.confirm(TENANT, USER, BRANCH, {
      paymentMethod: 'CASH', receiptDate: '2026-09-02', lines: [],
      expenses: [{ description: 'Parking', amount: 40, category: 'TRANSPORT' }],
    });
    expect(received).toEqual([]);
    expect(entries).toHaveLength(1);
    expect(requests[0].status).toBe('RECEIVED');
    expect(r.request.status).toBe('RECEIVED');
  });

  it('stamps the key on the request so the replay can find it', async () => {
    const { svc, requests } = build();
    await svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, idempotencyKey: 'abc-123' });
    expect(requests[0].notes).toMatch(/^\[RCPT:abc-123\]/);
    expect(requests[0].notes).toContain('Puregold');
  });

  it('keeps the request BOUGHT, not RECEIVED, when a line fails to post', async () => {
    const { svc } = build({
      receiveImpl: (rmId) => { if (rmId === 'wings') throw new Error('Period is locked.'); return { totalValue: 1 }; },
    });
    const r = await svc.confirm(TENANT, USER, BRANCH, CONFIRM);
    expect(r.posted).toHaveLength(1);
    expect(r.failed).toEqual([expect.objectContaining({ name: 'Chicken wings', reason: 'Period is locked.' })]);
    expect(r.request.status).toBe('BOUGHT');
  });

  it('refuses a receipt with nothing on it, and a line that names two ingredients', async () => {
    const { svc } = build();
    await expect(svc.confirm(TENANT, USER, BRANCH, { paymentMethod: 'CASH', lines: [] }))
      .rejects.toThrow(/Nothing to post/);
    await expect(svc.confirm(TENANT, USER, BRANCH, {
      paymentMethod: 'CASH',
      lines: [{ rawMaterialId: 'sugar', create: { name: 'X', unit: 'g' }, packsBought: 1, packSize: 1, packCost: 1 }],
    })).rejects.toThrow(/either an existing ingredient or a new one/);
  });

  it('refuses a date that is not a date', async () => {
    const { svc } = build();
    await expect(svc.confirm(TENANT, USER, BRANCH, { ...CONFIRM, receiptDate: '2026-13-45' }))
      .rejects.toThrow(/real date/);
  });
});
