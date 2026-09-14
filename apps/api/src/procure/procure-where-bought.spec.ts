import { ProcureService } from './procure.service';
import { usuallyFrom, usuallyFromText, sourceText, sourceKey, sourceKindFromLabel } from '@repo/shared-types';

/**
 * Where things are bought.
 *
 * The owner's question is "where do we usually get this, and is that the cheap
 * place?". The answer has to count one purchase once -- a short delivery's
 * balance is the same purchase -- treat two spellings of one store as one
 * store, and show money only to people who may see purchase costs.
 */
describe('where it was bought', () => {
  describe('the words', () => {
    it('says a store with its kind, a kind alone, or nothing', () => {
      expect(sourceText('GROCERY', 'Puregold')).toBe('Puregold (grocery)');
      expect(sourceText('MARKET', null)).toBe('Palengke');
      expect(sourceText('MARKET', 'palengke')).toBe('palengke');
      expect(sourceText('NOT_A_KIND', '  ')).toBeNull();
      expect(sourceKey('ONLINE', ' Shopee  Monin ')).toBe(sourceKey('GROCERY', 'shopee monin'));
      expect(sourceKindFromLabel('Supermarket')).toBe('GROCERY');
      expect(sourceKindFromLabel('sari-sari')).toBeNull();
    });

    it('usually from is the most frequent store, ties to the most recent, shown the way it was last typed', () => {
      const d = (day: number) => new Date(Date.UTC(2026, 8, day));
      const u = usuallyFrom([
        { sourceKind: 'GROCERY', sourceName: 'PUREGOLD', on: d(1) },
        { sourceKind: 'MARKET', sourceName: null, on: d(3) },
        { sourceKind: 'GROCERY', sourceName: 'Puregold', on: d(5) },
        { sourceKind: null, sourceName: null, on: d(6) },
        { sourceKind: 'MARKET', sourceName: null, on: d(7) },
      ]);
      // Two each; the palengke was used last. Two of five is not "usually".
      expect(u).toEqual({ kind: 'MARKET', name: null, times: 2, of: 5 });
      expect(usuallyFromText(u)).toBe('From Palengke 2 of the last 5 buys');
      expect(usuallyFromText({ kind: 'GROCERY', name: 'Puregold', times: 3, of: 4 })).toBe('Usually from Puregold (grocery): 3 of the last 4 buys');
      expect(usuallyFrom([{ sourceKind: 'GROCERY', sourceName: 'puregold', on: d(1) }, { sourceKind: 'GROCERY', sourceName: 'Puregold ', on: d(2) }]))
        .toEqual({ kind: 'GROCERY', name: 'Puregold', times: 2, of: 2 });
      expect(usuallyFromText(usuallyFrom([{ sourceKind: 'ONLINE', sourceName: 'Shopee', on: d(1) }]))).toBe('Last bought from Shopee (online)');
      expect(usuallyFrom([{ sourceKind: null, sourceName: null, on: d(1) }])).toBeNull();
    });
  });

  describe('the report', () => {
    const TENANT = 't1';
    const at = (day: string) => new Date(`${day}T00:00:00+08:00`);
    const MILK = { name: 'Full Cream Milk', unit: 'ml' };
    const SUGAR = { name: 'White Sugar', unit: 'g' };
    // Newest first, the way the query orders them.
    const ROWS = [
      // The balance of a short Shopee delivery: its money counts, it is not a second buy.
      { rawMaterialId: 'milk', rawMaterial: MILK, packsBought: 1, packSize: 1000, packCost: 90, sourceKind: 'ONLINE', sourceName: 'Shopee', purchaseRequest: { id: 'r5', boughtAt: at('2026-09-12'), notes: '[BALANCEOF:REQ-20260911-001] [ONTHEWAY:2026-09-12]' } },
      { rawMaterialId: 'milk', rawMaterial: MILK, packsBought: 2, packSize: 1000, packCost: 90, sourceKind: 'ONLINE', sourceName: 'shopee', purchaseRequest: { id: 'r4', boughtAt: at('2026-09-11'), notes: null } },
      { rawMaterialId: 'sugar', rawMaterial: SUGAR, packsBought: 2, packSize: 1000, packCost: 70, sourceKind: 'MARKET', sourceName: null, purchaseRequest: { id: 'r3', boughtAt: at('2026-09-10'), notes: null } },
      { rawMaterialId: 'milk', rawMaterial: MILK, packsBought: 3, packSize: 1000, packCost: 86, sourceKind: 'GROCERY', sourceName: 'Puregold', purchaseRequest: { id: 'r3', boughtAt: at('2026-09-10'), notes: null } },
      { rawMaterialId: 'milk', rawMaterial: MILK, packsBought: 1, packSize: 1000, packCost: 88, sourceKind: 'GROCERY', sourceName: 'PUREGOLD', purchaseRequest: { id: 'r2', boughtAt: at('2026-09-08'), notes: null } },
      { rawMaterialId: 'milk', rawMaterial: MILK, packsBought: 1, packSize: 1000, packCost: 95, sourceKind: null, sourceName: null, purchaseRequest: { id: 'r1', boughtAt: at('2026-09-01'), notes: null } },
    ];

    function build(showCostsToStaff = true) {
      const prisma: any = {
        tenant: { findUnique: jest.fn().mockResolvedValue({ showPurchaseCostsToStaff: showCostsToStaff }) },
        branch: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT ? { id: where.id } : null)) },
        purchaseRequestLine: { findMany: jest.fn().mockResolvedValue(ROWS) },
      };
      return { svc: new ProcureService(prisma, {} as never), prisma };
    }

    it('per item: buys counted once, spellings joined, usually-from, cheapest place, and what went without a store', async () => {
      const { svc, prisma } = build();
      const res = await svc.whereBought(TENANT, { from: '2026-09-01', to: '2026-09-14' }, 'BUSINESS_OWNER');

      const where = prisma.purchaseRequestLine.findMany.mock.calls[0][0].where;
      expect(where.purchaseRequest).toMatchObject({ tenantId: TENANT, status: { in: ['BOUGHT', 'RECEIVED'] } });
      expect(where.purchaseRequest.boughtAt.gte).toEqual(at('2026-09-01'));
      expect(where.purchaseRequest.boughtAt.lt).toEqual(at('2026-09-15'));

      expect(res.totals).toEqual({ buys: 5, withStore: 4, trips: 4, stores: 3, spend: 90 + 180 + 140 + 258 + 88 + 95 });
      const milk = res.items.find((i) => i.rawMaterialId === 'milk')!;
      expect(milk).toMatchObject({ buys: 4, withoutStore: 1, spend: 90 + 180 + 258 + 88 + 95 });
      // Puregold twice (two spellings), Shopee once (its balance is not a second buy).
      expect(milk.usuallyFrom).toEqual({ kind: 'GROCERY', name: 'Puregold', times: 2, of: 4 });
      expect(milk.stores.map((x) => [x.name, x.times, x.lastPackCost, x.bestPerUnit, x.spend])).toEqual([
        ['Puregold', 2, 86, 0.086, 258 + 88],
        // Shown as last typed on a real purchase; the balance's spelling does not count.
        ['shopee', 1, 90, 0.09, 270],
      ]);
      expect(milk.cheapestKey).toBe('name:puregold');
      expect(res.stores.map((x) => [x.name ?? x.kind, x.trips, x.buys, x.items])).toEqual([
        ['Puregold', 2, 2, 1],
        ['shopee', 1, 1, 1],
        ['MARKET', 1, 1, 1],
      ]);
    });

    it('staff on a shop that hides purchase costs see where, not what it cost', async () => {
      const { svc } = build(false);
      const res = await svc.whereBought(TENANT, { from: '2026-09-01', to: '2026-09-14' }, 'GENERAL_EMPLOYEE');
      expect(res.showMoney).toBe(false);
      expect(res.totals.spend).toBeNull();
      const milk = res.items.find((i) => i.rawMaterialId === 'milk')!;
      expect(milk.spend).toBeNull();
      expect(milk.cheapestKey).toBeNull();
      expect(milk.stores.every((x) => x.lastPackCost === null && x.bestPerUnit === null && x.spend === null)).toBe(true);
      expect(milk.usuallyFrom?.name).toBe('Puregold');
      expect(res.stores.every((x) => x.spend === null)).toBe(true);
    });

    it('refuses dates that are backwards or more than a year apart, and a branch from another shop', async () => {
      const { svc } = build();
      await expect(svc.whereBought(TENANT, { from: '2026-09-14', to: '2026-09-01' })).rejects.toThrow('The From date is after the To date.');
      await expect(svc.whereBought(TENANT, { from: '2025-01-01', to: '2026-09-01' })).rejects.toThrow('A year at most. Narrow the dates.');
      await expect(svc.whereBought('other', { branchId: 'b1' })).rejects.toThrow('Branch not found in your organization.');
    });

    it('with no dates, looks at the last 90 days up to today', async () => {
      const { svc } = build();
      const res = await svc.whereBought(TENANT, {}, 'BUSINESS_OWNER');
      expect((Date.parse(res.to) - Date.parse(res.from)) / 86_400_000).toBe(89);
    });
  });

  describe('usually from, on a list being built', () => {
    it('weighs the last ten buys per branch and item, and a failed read leaves the list without it', async () => {
      const rows = Array.from({ length: 12 }, (_, i) => ({
        rawMaterialId: 'milk',
        sourceKind: i < 10 ? 'GROCERY' : 'ONLINE',
        sourceName: i < 10 ? (i < 4 ? 'Puregold' : 'S&R') : 'Shopee',
        purchaseRequest: { branchId: 'b1', boughtAt: new Date(Date.UTC(2026, 8, 12 - i)) },
      }));
      const prisma: any = { purchaseRequestLine: { findMany: jest.fn().mockResolvedValue(rows) } };
      const svc: any = new ProcureService(prisma, {} as never);
      const map = await svc.usualSources('t1', ['b1'], ['milk']);
      expect(map.get('b1:milk')).toEqual({ kind: 'GROCERY', name: 'S&R', times: 6, of: 10 });
      const where = prisma.purchaseRequestLine.findMany.mock.calls[0][0].where;
      expect(where.purchaseRequest.OR).toEqual([{ notes: null }, { NOT: { notes: { contains: '[BALANCEOF:' } } }]);

      prisma.purchaseRequestLine.findMany.mockRejectedValueOnce(new Error('connection reset'));
      await expect(svc.usualSources('t1', ['b1'], ['milk'])).resolves.toBeNull();
    });
  });
});
