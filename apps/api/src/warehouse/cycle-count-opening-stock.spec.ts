import { WarehouseService } from './warehouse.service';

/**
 * A shop's FIRST count has to be postable.
 *
 * Posting wrote `rawMaterialInventory.update` against a compound key, which
 * throws P2025 when no row exists — and a shop that has never received an
 * ingredient has no row for it. So the one moment a count matters most, the
 * opening count on a fresh tenant, failed on its first line. Cafe Carolina
 * has 53 ingredients and zero inventory rows.
 *
 * It matters more than it looks because counting is the ONLY way an
 * ingredient's quantity can be corrected at all: `adjust` takes a productId
 * and validates against Product, so it never reaches raw materials. Refusing
 * to create the row left no route to opening stock except recording purchases
 * that never happened.
 */
describe('WarehouseService — posting a count creates stock that does not exist yet', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  function build(opts: { existing?: Set<string>; lines?: any[]; live?: Record<string, number>; periods?: any } = {}) {
    const existing = opts.existing ?? new Set<string>();
    /* What is on the shelf RIGHT NOW, for rows that already exist. */
    const liveQty = new Map<string, number>(Object.entries(opts.live ?? {}));
    const upserts: Array<{ rawMaterialId: string; qty: number; created: boolean }> = [];
    const events: any[] = [];

    const tx: any = {
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cc1', tenantId: TENANT, branchId: BRANCH, status: 'OPEN',
          lines: opts.lines ?? [
            { id: 'l1', rawMaterialId: 'beans', countedQty: '4200', expectedQty: '0' },
            { id: 'l2', rawMaterialId: 'milk',  countedQty: '9000', expectedQty: '0' },
          ],
        }),
        update: jest.fn(({ data }: any) => Promise.resolve({ id: 'cc1', ...data, lines: [] })),
      },
      rawMaterialInventory: {
        /*
          Posting reads the LIVE quantity and applies the variance to it rather
          than writing the counted figure over the top — a count is not instant
          and the till keeps selling while someone walks the stockroom. An
          absent row reads as an empty shelf, which is what these opening-stock
          fixtures describe.
        */
        findUnique: jest.fn(({ where }: any) => {
          const rm = where.branchId_rawMaterialId.rawMaterialId;
          return Promise.resolve(existing.has(rm) ? { quantity: liveQty.get(rm) ?? 0 } : null);
        }),
        upsert: jest.fn(({ where, create, update }: any) => {
          const rm = where.branchId_rawMaterialId.rawMaterialId;
          const created = !existing.has(rm);
          upserts.push({
            rawMaterialId: rm,
            qty: Number(created ? create.quantity : update.quantity),
            created,
          });
          existing.add(rm);
          return Promise.resolve({});
        }),
        // deliberately absent: if the service still called update(), this would
        // throw exactly as Prisma does when the row is missing
      },
      cycleCountLine: { update: jest.fn().mockResolvedValue({}) },
      /*
        The books' side of a count. Only created when the line's material has a
        cost price — a variance the books cannot value is a stock fact, not an
        entry — so fixtures without one legitimately produce none.
      */
      accountingEvent: {
        create: jest.fn(({ data }: any) => { events.push(data); return Promise.resolve({}); }),
      },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    /*
      Posting a count writes to the books, so it honours the period lock the
      same way receiveRawMaterial and writeOffRawMaterial do. This path was
      reimplemented against Prisma directly and never checked, so a count
      could restate a month that was already closed and reconciled.
    */
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new WarehouseService(prisma, opts.periods ?? periods) as any;
    return { svc, tx, upserts, events, periods };
  }

  it('posts an opening count on a tenant with no stock rows at all', async () => {
    const { svc, upserts } = build();               // nothing exists yet
    await svc.postCycleCount(TENANT, 'cc1', 'u1');

    expect(upserts).toHaveLength(2);
    expect(upserts.every((u) => u.created)).toBe(true);
    expect(upserts.map((u) => u.qty)).toEqual([4200, 9000]);
  });

  it('sets the counted quantity, not the variance', async () => {
    // A count says what IS there. Writing the difference would compound.
    const { svc, upserts } = build({ existing: new Set(['beans']) });
    await svc.postCycleCount(TENANT, 'cc1', 'u1');

    expect(upserts.find((u) => u.rawMaterialId === 'beans')!.qty).toBe(4200);
  });

  it('stamps the new row with the tenant', async () => {
    // RawMaterialInventory has no tenantId of its own on the unique key, so a
    // create that omitted it would either fail or orphan the row.
    const { svc, tx } = build();
    await svc.postCycleCount(TENANT, 'cc1', 'u1');

    for (const call of tx.rawMaterialInventory.upsert.mock.calls) {
      expect(call[0].create.tenantId).toBe(TENANT);
      expect(call[0].create.branchId).toBe(BRANCH);
    }
  });

  it('still skips a line that counted exactly what was expected', async () => {
    const { svc, upserts } = build({
      lines: [{ id: 'l1', rawMaterialId: 'beans', countedQty: '4200', expectedQty: '4200' }],
    });
    await svc.postCycleCount(TENANT, 'cc1', 'u1');
    expect(upserts).toHaveLength(0);
  });

  it('still refuses a negative count', async () => {
    const { svc } = build({
      lines: [{ id: 'l1', rawMaterialId: 'beans', countedQty: '-5', expectedQty: '0' }],
    });
    await expect(svc.postCycleCount(TENANT, 'cc1', 'u1')).rejects.toThrow(/negative/i);
  });

  it('still refuses to post a count that is not OPEN', async () => {
    const { svc, tx } = build();
    tx.cycleCount.findFirst.mockResolvedValue({
      id: 'cc1', tenantId: TENANT, branchId: BRANCH, status: 'POSTED', lines: [],
    });
    await expect(svc.postCycleCount(TENANT, 'cc1', 'u1')).rejects.toThrow(/OPEN/i);
  });

  /*
    A count is not instant. Someone walks the stockroom with a tablet while the
    till keeps selling, so `expectedQty` — captured when the count STARTED — is
    already stale by the time anyone presses Post.

    Writing the counted figure straight over the quantity silently reversed
    every sale made in between: the shelf jumped back up while COGS had already
    relieved the stock, and nothing anywhere said so. The variance is still
    measured against the snapshot, because that IS what the counter found; it
    is the application that has to be relative.
  */
  describe('sales that happen DURING the count', () => {
    it('keeps them, instead of undoing them', async () => {
      // Started at 5000. Counter finds 4800 — 200 g genuinely missing.
      // While counting, the till sold 300 g, so live is 4700.
      // The shelf should end at 4700 - 200 = 4500, not at the counted 4800.
      const { svc, upserts } = build({
        existing: new Set(['beans']),
        live: { beans: 4700 },
        lines: [{ id: 'l1', rawMaterialId: 'beans', countedQty: '4800', expectedQty: '5000' }],
      });
      await svc.postCycleCount(TENANT, 'cc1', 'u1');
      expect(upserts).toHaveLength(1);
      expect(upserts[0].qty).toBe(4500);
    });

    it('lands exactly on the counted figure when nothing moved', async () => {
      // The ordinary case, and the behaviour that existed before: live equals
      // expected, so live + variance is the counted number.
      const { svc, upserts } = build({
        existing: new Set(['beans']),
        live: { beans: 5000 },
        lines: [{ id: 'l1', rawMaterialId: 'beans', countedQty: '4800', expectedQty: '5000' }],
      });
      await svc.postCycleCount(TENANT, 'cc1', 'u1');
      expect(upserts[0].qty).toBe(4800);
    });

    it('still values the variance against what the counter actually found', async () => {
      // 200 g missing is what gets written off, whatever sold in the meantime.
      // Charging the books for the intervening sales as well would double-count
      // them: COGS already relieved that stock.
      const { svc, events } = build({
        existing: new Set(['beans']),
        live: { beans: 4700 },
        lines: [{
          id: 'l1', rawMaterialId: 'beans', countedQty: '4800', expectedQty: '5000',
          rawMaterial: {
            id: 'beans', name: 'Espresso Beans', unit: 'g',
            costPrice: '1.85', category: 'INGREDIENT',
          },
        }],
      });
      await svc.postCycleCount(TENANT, 'cc1', 'u1');
      expect(events).toHaveLength(1);
      expect(Number((events[0].payload as any).quantity)).toBe(-200);
    });

    it('cannot drive the shelf below empty', async () => {
      // A big shortfall against a nearly-empty live shelf settles at zero
      // rather than inventing negative stock every later number then inherits.
      const { svc, upserts } = build({
        existing: new Set(['beans']),
        live: { beans: 50 },
        lines: [{ id: 'l1', rawMaterialId: 'beans', countedQty: '100', expectedQty: '5000' }],
      });
      await svc.postCycleCount(TENANT, 'cc1', 'u1');
      expect(upserts[0].qty).toBe(0);
    });
  });
});

/**
 * A count restates stock AND writes to the books, so it cannot land in a month
 * that is already closed and reconciled.
 *
 * `receiveRawMaterial` and `writeOffRawMaterial` both check before any write.
 * This path was reimplemented against Prisma directly and never did, so the
 * one movement large enough to restate a whole shelf was the one movement that
 * could quietly move last month's numbers.
 */
describe('WarehouseService.postCycleCount — the period lock', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';

  function build(periods: any) {
    const upserts: any[] = [];
    const tx: any = {
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'cc1', tenantId: TENANT, branchId: BRANCH, status: 'OPEN',
          lines: [{ id: 'l1', rawMaterialId: 'beans', countedQty: '4200', expectedQty: '0' }],
        }),
        update: jest.fn().mockResolvedValue({ id: 'cc1', lines: [] }),
      },
      rawMaterialInventory: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn((a: any) => { upserts.push(a); return Promise.resolve({}); }),
      },
      cycleCountLine:  { update: jest.fn().mockResolvedValue({}) },
      accountingEvent: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    return { svc: new WarehouseService(prisma, periods) as any, upserts };
  }

  it('refuses to post into a closed month', async () => {
    const periods = { assertDateIsOpen: jest.fn().mockRejectedValue(new Error('Period is closed.')) };
    const { svc } = build(periods);
    await expect(svc.postCycleCount(TENANT, 'cc1', 'u1')).rejects.toThrow(/closed/i);
  });

  it('writes nothing when the month is closed', async () => {
    // Half a posted count is worse than none: stock would have moved for some
    // ingredients and not others, with no record of where it stopped.
    const periods = { assertDateIsOpen: jest.fn().mockRejectedValue(new Error('Period is closed.')) };
    const { svc, upserts } = build(periods);
    await svc.postCycleCount(TENANT, 'cc1', 'u1').catch(() => undefined);
    expect(upserts).toHaveLength(0);
  });

  it('checks once for the whole count, not once per line', async () => {
    const periods = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const { svc } = build(periods);
    await svc.postCycleCount(TENANT, 'cc1', 'u1');
    expect(periods.assertDateIsOpen).toHaveBeenCalledTimes(1);
  });

  it('posts normally when the month is open', async () => {
    const periods = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const { svc, upserts } = build(periods);
    await svc.postCycleCount(TENANT, 'cc1', 'u1');
    expect(upserts).toHaveLength(1);
  });
});
