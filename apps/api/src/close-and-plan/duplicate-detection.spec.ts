/**
 * Unit specs for duplicate-detection helper.
 *
 * Covers the 4-criteria check + the edge cases laid out in the
 * SecAudit/operations doc:
 *   - same SKU, intentionally different lots (different expiries) → not dupes
 *   - same morning + afternoon delivery → flagged (owner overrides)
 *   - cross-branch double receive → NOT dupes (branchId differs)
 *   - quantity within ±5% → match
 *   - quantity beyond ±5% → no match
 */
import { detectDuplicateLot } from './duplicate-detection';

function mockPrisma(lots: any[]) {
  return {
    rawMaterialLot: {
      findMany: jest.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(
          lots.filter((l) =>
            l.tenantId === where.tenantId &&
            l.branchId === where.branchId &&
            l.rawMaterialId === where.rawMaterialId &&
            l.receivedAt >= where.receivedAt.gte &&
            l.receivedAt <= where.receivedAt.lte &&
            Number(l.qtyRemaining) > 0,
          ),
        );
      }),
    },
  } as any;
}

const RM_NAME = { rawMaterial: { name: 'Whole Milk 1L' } };
const baseLot = (overrides: any) => ({
  id:            'lot-1',
  tenantId:      't1',
  branchId:      'b1',
  rawMaterialId: 'rm-milk',
  qtyReceived:   8,
  qtyRemaining:  8,
  receivedAt:    new Date('2026-05-20T10:00:00Z'),
  expirationDate: new Date('2026-05-27T00:00:00Z'),
  ...RM_NAME,
  ...overrides,
});

describe('detectDuplicateLot', () => {
  it('flags an exact same-day same-qty same-expiry receive', async () => {
    const existing = [baseLot({})];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8,
      expirationDate: new Date('2026-05-27T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T10:12:00Z'), // 12 min after
    });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('lot-1');
    expect(result[0].score).toBeGreaterThan(0.9);
  });

  it('flags a qty-within-5% match', async () => {
    const existing = [baseLot({ qtyReceived: 8, qtyRemaining: 8 })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8.3, // ~4% above
      expirationDate: new Date('2026-05-27T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T11:00:00Z'),
    });
    expect(result).toHaveLength(1);
  });

  it('does NOT flag qty beyond ±5%', async () => {
    const existing = [baseLot({ qtyReceived: 8, qtyRemaining: 8 })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    12, // 50% above
      expirationDate: new Date('2026-05-27T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T11:00:00Z'),
    });
    expect(result).toHaveLength(0);
  });

  it('does NOT flag a same-supplier-different-week delivery (>24h apart)', async () => {
    const existing = [baseLot({ receivedAt: new Date('2026-05-20T10:00:00Z') })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8,
      expirationDate: new Date('2026-05-31T00:00:00Z'),
      receivedAt:     new Date('2026-05-24T10:00:00Z'), // 4 days later
    });
    expect(result).toHaveLength(0);
  });

  it('does NOT flag cross-branch double receive', async () => {
    const existing = [baseLot({ branchId: 'b2' })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1', // different branch
      rawMaterialId:  'rm-milk',
      qtyReceived:    8,
      expirationDate: new Date('2026-05-27T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T10:12:00Z'),
    });
    expect(result).toHaveLength(0);
  });

  it('does NOT flag morning + afternoon when expiries differ by >2 days', async () => {
    const existing = [baseLot({ expirationDate: new Date('2026-05-27T00:00:00Z') })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8,
      // 5 days later expiry → legitimate fresh delivery
      expirationDate: new Date('2026-06-01T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T16:00:00Z'),
    });
    expect(result).toHaveLength(0);
  });

  it('flags both null-expiry lots when other criteria match (non-perishables)', async () => {
    const existing = [baseLot({ expirationDate: null })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8,
      expirationDate: null,
      receivedAt:     new Date('2026-05-20T11:00:00Z'),
    });
    expect(result).toHaveLength(1);
  });

  it('skips depleted lots (qtyRemaining=0)', async () => {
    const existing = [baseLot({ qtyRemaining: 0 })];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8,
      expirationDate: new Date('2026-05-27T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T11:00:00Z'),
    });
    expect(result).toHaveLength(0);
  });

  it('orders multiple candidates by confidence DESC', async () => {
    // Both within ±5% qty, both within 24h, both with same expiry —
    // both should match. The one closer in TIME ranks higher.
    const existing = [
      baseLot({ id: 'lot-old',    receivedAt: new Date('2026-05-20T08:00:00Z'), qtyReceived: 7.8, qtyRemaining: 7.8 }),
      baseLot({ id: 'lot-recent', receivedAt: new Date('2026-05-20T10:00:00Z'), qtyReceived: 8.0, qtyRemaining: 8.0 }),
    ];
    const result = await detectDuplicateLot(mockPrisma(existing), {
      tenantId:       't1',
      branchId:       'b1',
      rawMaterialId:  'rm-milk',
      qtyReceived:    8.0,
      expirationDate: new Date('2026-05-27T00:00:00Z'),
      receivedAt:     new Date('2026-05-20T10:15:00Z'),
    });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('lot-recent'); // closer in time + qty
    expect(result[1].id).toBe('lot-old');
    expect(result[0].score).toBeGreaterThan(result[1].score);
  });
});
