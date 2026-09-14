import { PrepRotationScheduler } from './prep-rotation.scheduler';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * The sauce alert during service: who hears it, and how often.
 *
 * Runs against the REAL NotificationsService over an in-memory notifications
 * table, and the fakes honour the branch and the ingredients each query asks
 * for, so "once per sauce per day, and again after a move -- at that branch"
 * is proved by the dedupe the app actually uses.
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

  type Lot = { branchId: string; rawMaterialId: string; createdAt: Date };
  function build(opts: { boards: Record<string, any[]>; watched?: number; lots?: Lot[]; branches?: Array<{ id: string; name: string }> }) {
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
        // Newest lot per ingredient, for the branch and ingredients asked about -- like the database.
        groupBy: jest.fn(({ where }: any) => {
          const hits = lots.filter((l) => l.branchId === where.branchId && where.rawMaterialId.in.includes(l.rawMaterialId));
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
    const subRecipes: any = { list: jest.fn((_t: string, branchId: string) => Promise.resolve(boards[branchId] ?? [])) };
    const svc = new PrepRotationScheduler(prisma, subRecipes, new NotificationsService(prisma));
    return {
      svc, table, prisma, subRecipes,
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
      title: 'Teriyaki Sauce (ready): move one across',
      body: 'Move one batch across from Teriyaki Sauce (frozen).',
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
    expect(table.map((n) => n.title)).toEqual(Array(3).fill('Teriyaki Sauce (ready) (Main): move one across'));
  });

  it('says when the line runs out, even though it already said to move one across today', async () => {
    const { run, setBoard, table } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    await run(T0);
    setBoard(MAIN, [frozen(4000), ready(0), breve()]);
    await run(hours(0.5));
    const owner = table.filter((n) => n.userId === 'owner');
    expect(owner.map((n) => [n.kind, n.title])).toEqual([
      ['WARNING', 'Teriyaki Sauce (ready): move one across'],
      ['ERROR', 'Teriyaki Sauce (ready) is out: move one across'],
    ]);
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
      ['mgr-b2', 'Teriyaki Sauce (ready) (Naga): move one across', `/procure/batches?branch=${NAGA}`],
      ['owner', 'Teriyaki Sauce (ready) (Naga): move one across', `/procure/batches?branch=${NAGA}`],
    ]);
  });

  it('one tenant failing does not stop the next', async () => {
    const { svc, prisma } = build({ boards: { [MAIN]: [frozen(4000), ready(380), breve()] } });
    prisma.tenant.findMany.mockResolvedValue([{ id: 'broken' }, { id: TENANT }]);
    const spy = jest.spyOn(svc, 'alertTenant').mockRejectedValueOnce(new Error('boom'));
    await svc.run();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
