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

  function build(opts: { existing?: Set<string>; lines?: any[] } = {}) {
    const existing = opts.existing ?? new Set<string>();
    const upserts: Array<{ rawMaterialId: string; qty: number; created: boolean }> = [];

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
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const svc = new WarehouseService(prisma) as any;
    return { svc, tx, upserts };
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
});
