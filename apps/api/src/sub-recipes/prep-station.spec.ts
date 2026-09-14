import { lotsStillHere, useByOf, prepStatusOf, useBySentences, PREP_STATUS_ORDER, type PrepLot, type UseBy } from '@repo/shared-types';
import { SubRecipesService } from './sub-recipes.service';

/**
 * The station screen's pre-made items: how much of each batch is taken to be
 * still here, what is past its use-by or due, and which item needs looking at
 * first -- and the read itself, scoped to one station.
 */
describe('pre-made items on the station screen', () => {
  // 10:00 Manila on 14 Sep.
  const NOW = new Date('2026-09-14T02:00:00Z');
  const h = (n: number) => new Date(NOW.getTime() + n * 3600_000);
  const lot = (id: string, qty: number, madeHoursAgo: number, useByInHours: number | null): PrepLot => ({
    id, rawMaterialId: 'rm', qtyRemaining: qty, receivedAt: h(-madeHoursAgo), expirationDate: useByInHours == null ? null : h(useByInHours),
  });
  const NONE: UseBy = { expired: null, soon: null };

  describe('the estimate', () => {
    it('reads what is on hand as the newest batches, never more than a batch holds or than is on hand', () => {
      const lots = [lot('a', 1000, 48, -1), lot('b', 1000, 24, 10), lot('c', 1000, 1, 70)];
      expect(lotsStillHere(2500, lots).map((x) => [x.lot.id, x.qty])).toEqual([['c', 1000], ['b', 1000], ['a', 500]]);
      expect(lotsStillHere(800, lots).map((x) => [x.lot.id, x.qty])).toEqual([['c', 800]]);
      expect(lotsStillHere(-5, lots)).toEqual([]);
      // A batch that says it has more left than the stock does is capped by the stock.
      expect(lotsStillHere(300, [lot('x', 5000, 1, 5)]).map((x) => x.qty)).toEqual([300]);
    });

    it('splits what is still here into past its use-by and due within the window', () => {
      const lots = [lot('a', 1000, 48, -1), lot('b', 1000, 24, 10), lot('c', 1000, 1, 70), lot('d', 500, 2, null)];
      expect(useByOf(3500, lots, NOW)).toEqual({
        expired: { qty: 1000, at: h(-1).toISOString(), lotIds: ['a'] },
        soon:    { qty: 1000, at: h(10).toISOString(), lotIds: ['b'] },
      });
      // Only the newest two tubs left: nothing is past its use-by any more.
      expect(useByOf(1500, lots, NOW)).toEqual({ expired: null, soon: null });
      expect(useByOf(3500, lots, NOW, 6).soon).toBeNull();
    });

    it('says it in words, today as a time and another day with its date', () => {
      const words = useBySentences({ expired: { qty: 400, at: h(-26).toISOString(), lotIds: ['a'] }, soon: { qty: 1250.5, at: h(6).toISOString(), lotIds: ['b'] } }, 'ml', NOW);
      expect(words[0]).toMatch(/^About 400 ml past its use-by \(Sep 13, 8:00\sAM\)\.$/);
      expect(words[1]).toMatch(/^About 1,250\.5 ml to use by 4:00\sPM\.$/);
    });
  });

  describe('what needs looking at first', () => {
    const ready = (onHand: number, par: number | null) => ({ onHand, parLevel: par });
    const rot = (state: string) => ({ state } as never);
    it('past its use-by, then out, then the rotation\'s do-now, then due soon, then low, then fine, then no par', () => {
      const expired: UseBy = { expired: { qty: 1, at: '', lotIds: [] }, soon: null };
      const soon: UseBy = { expired: null, soon: { qty: 1, at: '', lotIds: [] } };
      expect(prepStatusOf(ready(0, 400), rot('COOK_NOW'), expired)).toBe('EXPIRED');
      expect(prepStatusOf(ready(0, 400), rot('COOK_NOW'), NONE)).toBe('OUT');
      expect(prepStatusOf(ready(300, 400), rot('TOP_UP'), soon)).toBe('DO_NOW');
      expect(prepStatusOf(ready(3000, 400), rot('OK'), soon)).toBe('SOON');
      // A parked backup has no rotation row of its own: judged against its own par.
      expect(prepStatusOf(ready(1000, 2000), null, NONE)).toBe('LOW');
      expect(prepStatusOf(ready(3000, 400), rot('OK'), NONE)).toBe('OK');
      expect(prepStatusOf(ready(3000, null), rot('NO_PAR'), NONE)).toBe('NO_PAR');
      // No par and nothing on hand is not a warning: a one-tub backup is empty after every move.
      expect(prepStatusOf(ready(0, null), null, NONE)).toBe('NO_PAR');
      expect(prepStatusOf(ready(0, null), null, expired)).toBe('EXPIRED');
      const order = ['EXPIRED', 'OUT', 'DO_NOW', 'SOON', 'LOW', 'OK', 'NO_PAR'] as const;
      expect([...order].sort((a, b) => PREP_STATUS_ORDER[a] - PREP_STATUS_ORDER[b])).toEqual([...order]);
    });
  });

  describe('the read, for one station', () => {
    const KITCHEN = { id: 's-kitchen', name: 'Kitchen', kind: 'KITCHEN' };
    const BAR = { id: 's-bar', name: 'Bar', kind: 'BAR' };
    const row = (over: any) => ({
      unit: 'ml', kind: 'MAKE', movesFrom: null, batches: 1, limitedBy: null, rootLimitedBy: null, batchesWithPrep: 1,
      serves: [], components: [], level: null, parLevel: null, ...over,
    });
    const BOARD = [
      row({ id: 'rm-ready', name: 'Teriyaki Sauce (ready)', onHand: 300, parLevel: 400, level: 1, kind: 'MOVE', station: KITCHEN,
        serves: [{ productId: 'p1', productName: 'Teriyaki Wings', servingsLeft: 6 }],
        components: [{ rawMaterialId: 'rm-frozen', name: 'Teriyaki Sauce (frozen)', unit: 'ml', quantity: 2000, onHand: 4000, isPrep: true }] }),
      row({ id: 'rm-frozen', name: 'Teriyaki Sauce (frozen)', onHand: 4000, parLevel: 2000, level: 2, station: KITCHEN,
        components: [{ rawMaterialId: 'rm-soy', name: 'Soy sauce', unit: 'ml', quantity: 600, onHand: 5000, isPrep: false }] }),
      row({ id: 'rm-breve', name: 'Breve Milk', onHand: 50, parLevel: 400, level: 1, station: BAR,
        components: [{ rawMaterialId: 'rm-milk', name: 'Fresh Milk', unit: 'ml', quantity: 1000, onHand: 9000, isPrep: false }] }),
      row({ id: 'rm-garlic', name: 'Garlic Confit', onHand: 800, station: null }),
    ];

    const LOTS = [
      { id: 'old', rawMaterialId: 'rm-frozen', qtyRemaining: 2000, receivedAt: h(-80), expirationDate: h(-3) },
      { id: 'new', rawMaterialId: 'rm-frozen', qtyRemaining: 2000, receivedAt: h(-5), expirationDate: h(300) },
    ];
    function build(stationBranch: string | null = 'b1', lots: any[] = LOTS) {
      const prisma: any = {
        station: { findFirst: jest.fn(({ where }: any) => Promise.resolve(
          where.tenantId === 't1' ? [{ ...KITCHEN, branchId: stationBranch }, { ...BAR, branchId: stationBranch }].find((s) => s.id === where.id) ?? null : null)) },
        branch: { findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === 't1' ? { id: where.id ?? 'b-first', name: 'Main' } : null)) },
        // One item at a time, newest first, a page at a time -- like the database.
        rawMaterialLot: { findMany: jest.fn(({ where, skip, take }: any) => Promise.resolve(lots
          .filter((l) => where.tenantId === 't1' && where.branchId && l.rawMaterialId === where.rawMaterialId)
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime() || (a.id < b.id ? 1 : -1))
          .slice(skip, skip + take))) },
      };
      const svc = new SubRecipesService(prisma, {} as never);
      const list = jest.spyOn(svc, 'list').mockResolvedValue(BOARD as never);
      return { svc, prisma, list };
    }

    it('shows this station\'s items worst first, then the unrouted ones, and never another station\'s', async () => {
      const { svc, prisma, list } = build();
      const res = await svc.stationPrep('t1', KITCHEN.id, null, NOW);
      expect(list).toHaveBeenCalledWith('t1', 'b1', null);
      expect(res.station).toEqual(KITCHEN);
      expect(res.rows.map((r) => [r.name, r.status, r.assigned])).toEqual([
        ['Teriyaki Sauce (frozen)', 'EXPIRED', true],       // the old 2000 ml tub is past its use-by
        ['Teriyaki Sauce (ready)', 'DO_NOW', true],         // at 300 of 400, and a tub can be moved across
        ['Garlic Confit', 'NO_PAR', false],
      ]);
      const ready = res.rows[1];
      expect(ready.rotation).toMatchObject({ state: 'TOP_UP', canDoNow: true });
      expect(ready.serves).toEqual({ productId: 'p1', productName: 'Teriyaki Wings', servingsLeft: 6 });
      expect(res.rows[0].useBy.expired).toMatchObject({ qty: 2000, lotIds: ['old'] });
      const lotWheres = prisma.rawMaterialLot.findMany.mock.calls.map((c: any) => c[0].where);
      expect(lotWheres.every((w: any) => w.tenantId === 't1' && w.branchId === 'b1' && w.qtyRemaining.gt === 0)).toBe(true);
      expect(lotWheres.map((w: any) => w.rawMaterialId).sort()).toEqual(['rm-frozen', 'rm-garlic', 'rm-ready']);
    });

    it('finds an old batch past its use-by behind many newer ones, and stops reading once on hand is covered', async () => {
      // 120 tiny newer tubs of ready sauce (1 ml each) cover 120 of the 300 on hand; the old 2 L tub holds the rest.
      const many = Array.from({ length: 120 }, (_, i) => ({ id: `t${String(i).padStart(3, '0')}`, rawMaterialId: 'rm-ready', qtyRemaining: 1, receivedAt: h(-1 - i / 100), expirationDate: h(200) }));
      const lots = [...many, { id: 'ancient', rawMaterialId: 'rm-ready', qtyRemaining: 2000, receivedAt: h(-900), expirationDate: h(-10) },
        { id: 'older-still', rawMaterialId: 'rm-ready', qtyRemaining: 5000, receivedAt: h(-2000), expirationDate: h(-1500) }];
      const { svc, prisma } = build('b1', lots);
      const res = await svc.stationPrep('t1', KITCHEN.id, null, NOW);
      const ready = res.rows.find((r) => r.id === 'rm-ready')!;
      expect(ready.status).toBe('EXPIRED');
      expect(ready.useBy.expired).toMatchObject({ qty: 180, lotIds: ['ancient'] });
      // Three pages for the ready sauce (50, 50, then the page holding the old tub), and no fourth.
      const pages = prisma.rawMaterialLot.findMany.mock.calls.filter((c: any) => c[0].where.rawMaterialId === 'rm-ready');
      expect(pages.map((c: any) => c[0].skip)).toEqual([0, 50, 100]);
    });

    it('reads the caller\'s branch before the station\'s, then the station\'s, then the first branch, and refuses another shop\'s station', async () => {
      // One Bar station for the whole shop, stamped with the first branch: Branch B's barista sees Branch B.
      const shared = build('b-main');
      await shared.svc.stationPrep('t1', BAR.id, 'b-B', NOW);
      expect(shared.list).toHaveBeenCalledWith('t1', 'b-B', null);
      const ownerNoBranch = build('b-main');
      await ownerNoBranch.svc.stationPrep('t1', BAR.id, null, NOW);
      expect(ownerNoBranch.list).toHaveBeenCalledWith('t1', 'b-main', null);
      const noBranch = build(null);
      await noBranch.svc.stationPrep('t1', BAR.id, 'b-caller', NOW);
      expect(noBranch.list).toHaveBeenCalledWith('t1', 'b-caller', null);
      const first = build(null);
      await first.svc.stationPrep('t1', BAR.id, null, NOW);
      expect(first.list).toHaveBeenCalledWith('t1', 'b-first', null);
      await expect(build().svc.stationPrep('t2', KITCHEN.id, null, NOW)).rejects.toThrow('Station not found.');
    });
  });
});
