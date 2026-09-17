import { PrepRotationScheduler } from './prep-rotation.scheduler';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * The sauce alert during service: who hears it, and how often.
 *
 * Runs against the REAL NotificationsService over an in-memory notifications
 * table, and the fakes honour the branch and the ingredients each query asks
 * for, so "once per sauce per day, and again after a move -- at that branch"
 * is proved by the dedupe the app actually uses.
 *
 * One alert per sauce CHAIN (Level 1 and the stages behind it, prep-chain.ts),
 * in the same words as the station screen's card.
 */
describe('PrepRotationScheduler — sauce alerts during service', () => {
  const TENANT = 't1';
  const MAIN = 'b1';
  const NAGA = 'b2';
  // 10:00 Manila on 14 Sep.
  const T0 = new Date('2026-09-14T02:00:00Z');
  const hours = (h: number) => new Date(T0.getTime() + h * 3600_000);

  const frozen = (onHand: number, par: number | null = null) => ({
    id: 'rm-frozen', name: 'Teriyaki Sauce (frozen)', unit: 'ml', onHand, parLevel: par, level: 2, kind: 'MAKE',
    serves: [], station: { id: 's1', name: 'Kitchen', kind: 'KITCHEN' }, batchesWithPrep: 5, rootLimitedBy: 'Soy sauce',
    components: [{ rawMaterialId: 'rm-soy', name: 'Soy sauce', unit: 'ml', quantity: 600, onHand: 5000, isPrep: false }],
  });
  const ready = (onHand: number, par: number | null = 400) => ({
    id: 'rm-ready', name: 'Teriyaki Sauce (ready)', unit: 'ml', onHand, parLevel: par, level: 1, kind: 'MOVE',
    serves: [{ productId: 'p1', productName: 'Teriyaki Wings', servingsLeft: 10 }], station: { id: 's1', name: 'Kitchen', kind: 'KITCHEN' },
    batchesWithPrep: 2, rootLimitedBy: 'Soy sauce',
    components: [{ rawMaterialId: 'rm-frozen', name: 'Teriyaki Sauce (frozen)', unit: 'ml', quantity: 2000, onHand: 4000, isPrep: true }],
  });
  // The bar's prep, so the shop has a bar and a barista's scope means something.
  const breve = (onHand = 1800) => ({
    id: 'rm-breve', name: 'Breve Milk', unit: 'ml', onHand, parLevel: 400, level: 1, kind: 'MAKE',
    serves: [], station: { id: 's2', name: 'Bar', kind: 'BAR' },
    components: [{ rawMaterialId: 'rm-milk', name: 'Fresh Milk', unit: 'ml', quantity: 1000, onHand: 9000, isPrep: false }],
  });

  const PEOPLE = [
    { id: 'owner',   role: 'BUSINESS_OWNER',   branchId: null, personaKey: null },
    { id: 'mgr',     role: 'BRANCH_MANAGER',   branchId: MAIN, personaKey: null },
    { id: 'mgr-b2',  role: 'BRANCH_MANAGER',   branchId: NAGA, personaKey: null },
    { id: 'cook',    role: 'GENERAL_EMPLOYEE', branchId: MAIN, personaKey: 'LINE_COOK' },
    // A barista is the cashier: the BARISTA persona is built on CASHIER.
    { id: 'barista', role: 'CASHIER',          branchId: MAIN, personaKey: 'BARISTA' },
    { id: 'cashier', role: 'CASHIER',          branchId: MAIN, personaKey: null },
  ];

  /** A stock lot. qtyReceived below zero is a write-off marker; a batch or a delivery is positive (the default). */
  type Lot = { branchId: string; rawMaterialId: string; createdAt: Date; qtyReceived?: number };
  /** A batch with a use-by date, for the use-by alerts. */
  type Batch = { id: string; branchId: string; rawMaterialId: string; qtyRemaining: number; receivedAt: Date; expirationDate: Date | null };
  function build(opts: { boards: Record<string, any[]>; watched?: number; lots?: Lot[]; branches?: Array<{ id: string; name: string }>; batches?: Batch[] }) {
    const table: any[] = [];
    const boards = { ...opts.boards };
    const lots: Lot[] = [...(opts.lots ?? [])];
    let clock = T0;
    const prisma: any = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: TENANT }]) },
      rawMaterial: { count: jest.fn().mockResolvedValue(opts.watched ?? 1) },
      branch: { findMany: jest.fn().mockResolvedValue(opts.branches ?? [{ id: MAIN, name: 'Main' }]) },
      user: { findMany: jest.fn(({ where }: any) => Promise.resolve(PEOPLE.filter((p) => where.role.in.includes(p.role)))) },
      rawMaterialLot: {
        // Batches with a use-by in the window the scheduler asks about.
        count: jest.fn(({ where }: any) => Promise.resolve((opts.batches ?? []).filter((b) => b.expirationDate
          && b.expirationDate >= where.expirationDate.gte && b.expirationDate <= where.expirationDate.lte && b.qtyRemaining > 0).length)),
        // Which items have a dated batch here (distinct).
        findMany: jest.fn(({ where }: any) => Promise.resolve([...new Set((opts.batches ?? [])
          .filter((b) => b.branchId === where.branchId && where.rawMaterialId.in.includes(b.rawMaterialId) && b.qtyRemaining > 0 && b.expirationDate)
          .map((b) => b.rawMaterialId))].map((rawMaterialId) => ({ rawMaterialId })))),
        // Newest lot per ingredient, for the branch, ingredients and lot sign asked about -- like the database.
        groupBy: jest.fn(({ where }: any) => {
          const hits = lots.filter((l) => l.branchId === where.branchId && where.rawMaterialId.in.includes(l.rawMaterialId)
            && (where.qtyReceived?.gt == null || (l.qtyReceived ?? 1) > where.qtyReceived.gt));
          const newest = new Map<string, Date>();
          for (const l of hits) if (!newest.has(l.rawMaterialId) || newest.get(l.rawMaterialId)! < l.createdAt) newest.set(l.rawMaterialId, l.createdAt);
          return Promise.resolve([...newest].map(([rawMaterialId, createdAt]) => ({ rawMaterialId, _max: { createdAt } })));
        }),
      },
      notification: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(table.find((n) =>
          n.tenantId === where.tenantId && n.userId === where.userId && n.title === where.title
          && n.body === where.body && n.link === where.link && n.createdAt >= where.createdAt.gte) ?? null)),
        create: jest.fn(({ data }: any) => { const row = { id: `n${table.length + 1}`, createdAt: clock, ...data }; table.push(row); return Promise.resolve(row); }),
      },
    };
    const subRecipes: any = {
      list: jest.fn((_t: string, branchId: string) => Promise.resolve(boards[branchId] ?? [])),
      // The per-item read the station screen shares, over the same batches.
      batchesOnHand: jest.fn((_t: string, branchId: string, items: Array<{ id: string }>) => Promise.resolve(new Map(items.map((i) => [i.id,
        (opts.batches ?? []).filter((b) => b.branchId === branchId && b.rawMaterialId === i.id && b.qtyRemaining > 0)
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())])))),
    };
    const notifications = new NotificationsService(prisma);
    const svc = new PrepRotationScheduler(prisma, subRecipes, notifications);
    return {
      svc, table, prisma, subRecipes, notifications,
      run: (at: Date) => { clock = at; return svc.alertTenant(TENANT, at); },
      setBoard: (branchId: string, b: any[]) => { boards[branchId] = b; },
      addLot: (l: Lot) => { lots.push(l); },
    };
  }

  it('tells the owner, this branch\'s manager and the kitchen -- one alert each -- and nobody else', async () => {
    const { run, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    expect(await run(T0)).toBe(3);
    expect(table.map((n) => n.userId).sort()).toEqual(['cook', 'mgr', 'owner']);   // not the barista, not a plain cashier
    expect(table[0]).toMatchObject({
      kind: 'WARNING', link: `/procure/batches?branch=${MAIN}`,
      title: 'Teriyaki Sauce (ready): refill from Level 2',
      body: 'Refill Level 1 from Level 2 (Teriyaki Sauce (frozen)).',
    });
  });

  it('the bar\'s prep reaches the barista, who works on a till account', async () => {
    const { run, table } = build({ boards: { [MAIN]: [frozen(4000), ready(3000), breve(380)] } });
    await run(T0);
    expect(table.map((n) => n.userId).sort()).toEqual(['barista', 'mgr', 'owner']);   // not the cook, not a plain cashier
    expect(table[0].title).toBe('Breve Milk: make a batch');
  });

  it('says it once a day, however the line moves between runs', async () => {
    const { run, setBoard, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    setBoard(MAIN, [frozen(4000), ready(250), breve()]);   // sales between half-hours
    await run(hours(0.5));
    setBoard(MAIN, [frozen(4000), ready(120), breve()]);
    await run(hours(1));
    expect(table).toHaveLength(3);
  });

  it('a move yesterday does not make today\'s first alert a repeat, or silence it', async () => {
    const { run, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] }, lots: [{ branchId: MAIN, rawMaterialId: 'rm-ready', createdAt: hours(-20) }] });
    await run(T0);
    await run(hours(0.5));
    expect(table).toHaveLength(3);
  });

  it('says it again after the sauce was moved and ran low a second time', async () => {
    const { run, setBoard, addLot, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    addLot({ branchId: MAIN, rawMaterialId: 'rm-ready', createdAt: hours(3) });   // 13:00: moved across
    setBoard(MAIN, [frozen(2000), ready(350), breve()]);                        // evening rush drains it again
    await run(hours(8));
    expect(table).toHaveLength(6);
  });

  it('a move at another branch does not repeat this branch\'s alert', async () => {
    const branches = [{ id: MAIN, name: 'Main' }, { id: NAGA, name: 'Naga' }];
    const { run, addLot, table } = build({ branches, boards: { [MAIN]: [frozen(4000), ready(380), breve()], [NAGA]: [frozen(4000), ready(3000), breve()] } });
    await run(T0);
    addLot({ branchId: NAGA, rawMaterialId: 'rm-ready', createdAt: hours(1) });
    await run(hours(2));
    expect(table.map((n) => n.title)).toEqual(Array(3).fill('Teriyaki Sauce (ready): refill from Level 2 (Main)'));
  });

  it('says it again when what to do changes, not when the same instruction just gets more urgent', async () => {
    const { run, setBoard, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    // The line runs dry: still "refill from Level 2", so no second alert.
    setBoard(MAIN, [frozen(4000), ready(0), breve()]);
    await run(hours(0.5));
    // The freezer is empty too: now Level 2 has to be made first, which is new news.
    setBoard(MAIN, [frozen(0), ready(0), breve()]);
    await run(hours(1));
    const owner = table.filter((n) => n.userId === 'owner');
    expect(owner.map((n) => [n.kind, n.title, n.body])).toEqual([
      ['WARNING', 'Teriyaki Sauce (ready): refill from Level 2', 'Refill Level 1 from Level 2 (Teriyaki Sauce (frozen)).'],
      ['WARNING', 'Teriyaki Sauce (ready): make Level 2 now', 'Make a batch of Level 2 (Teriyaki Sauce (frozen)).'],
    ]);
  });

  it('one alert per chain per person, however many of its stages need doing', async () => {
    // The ready tub is under par AND the frozen one is under its own par: one chain, one instruction.
    const { run, table, notifications } = build({ boards: { [MAIN]: [frozen(1000, 2000), ready(380), breve()] } });
    const create = jest.spyOn(notifications, 'create');
    expect(await run(T0)).toBe(3);
    expect(table.map((n) => n.userId).sort()).toEqual(['cook', 'mgr', 'owner']);
    expect(new Set(table.map((n) => n.title))).toEqual(new Set(['Teriyaki Sauce (ready): make Level 2 now']));
    expect(create.mock.calls.every(([a]) => a.dedupeKey === 'prep-chain-rm-ready')).toBe(true);
  });

  it('a kitchen sauce whose next step is a stage the bar makes is told to the bar, not the kitchen that cannot record it', async () => {
    // The kitchen's teriyaki is cooked from the bar's syrup, which is short of one refill; the bar pours that syrup into drinks.
    const syrup = {
      ...breve(1500), id: 'rm-syrup', name: 'Simple syrup',
      components: [{ rawMaterialId: 'rm-sugar', name: 'Sugar', unit: 'g', quantity: 500, onHand: 9000, isPrep: false }],
    };
    const glaze = { ...ready(380), kind: 'MAKE', components: [{ rawMaterialId: 'rm-syrup', name: 'Simple syrup', unit: 'ml', quantity: 2000, onHand: 1500, isPrep: true }] };
    const { run, table } = build({ boards: { [MAIN]: [glaze, syrup] } });
    await run(T0);
    expect(table.map((n) => n.userId).sort()).toEqual(['barista', 'mgr', 'owner']);   // not the cook
    expect(table[0]).toMatchObject({ title: 'Teriyaki Sauce (ready): make Level 2 now', body: 'Make a batch of Level 2 (Simple syrup).' });
  });

  it('sends no per-item rotation alert any more: a backup under par is said as its chain\'s next step', async () => {
    const { run, table } = build({ boards: { [MAIN]: [frozen(1000, 2000), ready(3000), breve()] } });
    expect(await run(T0)).toBe(3);
    expect(table.some((n) => /cook the next batch today|move one across/.test(n.title))).toBe(false);
    expect(table[0]).toMatchObject({ kind: 'INFO', title: 'Teriyaki Sauce (ready): make Level 2 now', body: 'Make a batch of Level 2 (Teriyaki Sauce (frozen)).' });
  });

  it('no par anywhere in the chain means no alert, even at two servings left', async () => {
    const twoLeft = { ...ready(300, null), serves: [{ productId: 'p1', productName: 'Teriyaki Wings', servingsLeft: 2 }] };
    const { run, table } = build({ boards: { [MAIN]: [frozen(4000), twoLeft] } });
    expect(await run(T0)).toBe(0);
    expect(table).toHaveLength(0);
  });

  it('a write-off does not make the same alert new; a batch on any stage of the chain does', async () => {
    const { run, addLot, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    // A spoiled tub thrown out: a negative marker lot on the ready sauce.
    addLot({ branchId: MAIN, rawMaterialId: 'rm-ready', createdAt: hours(1), qtyReceived: -500 });
    await run(hours(2));
    expect(table).toHaveLength(3);
    // A batch of the frozen stage behind it: the chain has moved, so the same words are news again.
    addLot({ branchId: MAIN, rawMaterialId: 'rm-frozen', createdAt: hours(3), qtyReceived: 2000 });
    await run(hours(4));
    expect(table).toHaveLength(6);
  });

  it('starts fresh the next day', async () => {
    const { run, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    await run(hours(24));
    expect(table).toHaveLength(6);
  });

  it('stays silent for a sauce with no par level, and about an empty backup that has none', async () => {
    const noPar = build({ boards: { [MAIN]: [frozen(0), ready(0, null)] } });
    expect(await noPar.run(T0)).toBe(0);
    const emptyBackup = build({ boards: { [MAIN]: [frozen(0), ready(3000)] } });
    expect(await emptyBackup.run(T0)).toBe(0);
    expect(emptyBackup.table).toHaveLength(0);
  });

  it('does not read the board at all for a shop with no prep that has a par level', async () => {
    const { run, subRecipes } = build({ boards: { [MAIN]: [frozen(0), ready(0)] }, watched: 0 });
    expect(await run(T0)).toBe(0);
    expect(subRecipes.list).not.toHaveBeenCalled();
  });

  it('names the branch when the shop has more than one, links to it, and tells only that branch\'s manager and kitchen', async () => {
    const branches = [{ id: MAIN, name: 'Main' }, { id: NAGA, name: 'Naga' }];
    const { run, table } = build({ branches, boards: { [MAIN]: [frozen(4000), ready(3000), breve()], [NAGA]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    expect(table.map((n) => [n.userId, n.title, n.link]).sort()).toEqual([
      ['mgr-b2', 'Teriyaki Sauce (ready): refill from Level 2 (Naga)', `/procure/batches?branch=${NAGA}`],
      ['owner', 'Teriyaki Sauce (ready): refill from Level 2 (Naga)', `/procure/batches?branch=${NAGA}`],
    ]);
  });

  // ── use-by ───────────────────────────────────────────────────────────────

  const tub = (id: string, qty: number, madeHoursAgo: number, useByInHours: number | null): Batch => ({
    id, branchId: MAIN, rawMaterialId: 'rm-ready', qtyRemaining: qty,
    receivedAt: hours(-madeHoursAgo), expirationDate: useByInHours == null ? null : hours(useByInHours),
  });

  it('says a batch is due soon, once a day, to the people who hear about that sauce, with no quantity in the words', async () => {
    // 3000 ml above par, so the rotation is quiet; the older 1000 ml tub is due at 4 PM (6 hours from 10 AM).
    const { run, table } = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(3000), breve()] }, batches: [tub('old', 1000, 30, 6), tub('new', 2000, 2, 72)] });
    expect(await run(T0)).toBe(3);
    expect(table.map((n) => n.userId).sort()).toEqual(['cook', 'mgr', 'owner']);
    expect(table[0]).toMatchObject({ kind: 'WARNING', title: 'Teriyaki Sauce (ready): use it first', link: `/procure/batches?branch=${MAIN}` });
    expect(table[0].body).toMatch(/^Use by 4:00\sPM\. Use this batch first\.$/);
    // Half an hour and some sales later: the same words, so no repeat.
    const again = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(3000), breve()] }, batches: [tub('old', 1000, 30, 6), tub('new', 2000, 2, 72)] });
    await again.run(T0);
    again.setBoard(MAIN, [frozen(4000), ready(2800), breve()]);
    await again.run(hours(0.5));
    expect(again.table).toHaveLength(3);
  });

  it('a batch already used up by the newer stock on hand is not called due; one past its use-by is', async () => {
    // 500 ml on hand is read as the newest tub: the old one is gone, whatever its lot still says.
    const usedUp = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(500), breve()] }, batches: [tub('old', 1000, 30, 6), tub('new', 2000, 2, 72)] });
    expect(await usedUp.run(T0)).toBe(0);
    const past = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(2500), breve()] }, batches: [tub('old', 1000, 30, -2), tub('new', 2000, 2, 72)] });
    expect(await past.run(T0)).toBe(3);
    expect(past.table[0]).toMatchObject({ kind: 'ERROR', title: 'Teriyaki Sauce (ready): past its use-by' });
    expect(past.table[0].body).toMatch(/^Past its use-by \(8:00\sAM\)\. Check it; if it is thrown out, take it off under Stock on hand\.$/);
  });

  it('a second batch passing its use-by is news, and the words carry the newest date', async () => {
    // Tub A past its use-by at 8 AM and still counted; tub B due at 4 PM. At 10 AM: past use-by, and B due.
    const batches = [tub('a', 1000, 30, -2), tub('b', 1000, 20, 6), tub('c', 1000, 1, 90)];
    const { run, table, setBoard } = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(3000), breve()] }, batches });
    await run(T0);
    expect(table.filter((n) => n.userId === 'owner').map((n) => n.body)).toEqual([
      expect.stringMatching(/^Past its use-by \(8:00\sAM\)\. .* Another batch is due by 4:00\sPM\.$/),
    ]);
    // 4:30 PM: B has passed its use-by too, while A is still counted. A new alert, dated 4 PM.
    setBoard(MAIN, [frozen(4000), ready(3000), breve()]);
    await run(hours(6.5));
    const owner = table.filter((n) => n.userId === 'owner');
    expect(owner).toHaveLength(2);
    expect(owner[1].body).toMatch(/^Past its use-by \(4:00\sPM\)\. Check it/);
  });

  it('a batch four days gone next to one just gone carries the fresh date', async () => {
    const batches = [tub('stale', 1000, 200, -96), tub('fresh', 1000, 20, -1), tub('c', 1000, 1, 90)];
    const { run, table } = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(3000), breve()] }, batches });
    await run(T0);
    expect(table[0].body).toMatch(/^Past its use-by \(9:00\sAM\)\./);
  });

  it('leaves a use-by more than three days gone to the station screen, and skips the board when nothing is dated', async () => {
    const stale = build({ watched: 0, boards: { [MAIN]: [frozen(4000), ready(2500)] }, batches: [tub('old', 1000, 200, -100), tub('new', 2000, 2, 72)] });
    expect(await stale.run(T0)).toBe(0);
    expect(stale.subRecipes.list).not.toHaveBeenCalled();
  });

  it('one tenant failing does not stop the next', async () => {
    const { svc, prisma } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    prisma.tenant.findMany.mockResolvedValue([{ id: 'broken' }, { id: TENANT }]);
    const spy = jest.spyOn(svc, 'alertTenant').mockRejectedValueOnce(new Error('boom'));
    await svc.run();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
