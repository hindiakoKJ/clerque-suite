import { BackupScheduler } from './backup.scheduler';
import { BackupService } from './backup.service';

/**
 * Nightly backups are written at a key nobody can guess, and read back the
 * same way as before.
 *
 * The key was `backups/<day>/<slug>.json`. The day is guessable and the slug
 * is the company code staff type at sign-in, so anyone who reached the bucket
 * could fetch a whole shop. A random folder now sits between the day and the
 * slug, which the reader already copes with: it keeps keys that end in
 * `/<slug>.json` and reads the day from the front.
 */
describe('Backups — unguessable keys', () => {
  const ENV = process.env;
  beforeEach(() => {
    process.env = { ...ENV };
    delete process.env.BACKUP_WEBHOOK_URL;
  });
  afterAll(() => { process.env = ENV; });
  afterEach(() => jest.restoreAllMocks());

  function scheduler() {
    const prisma: any = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't1', slug: 'carolina-cafe', isDemoTenant: false }]) },
    };
    const storage: any = { getDriver: () => 'S3', putBuffer: jest.fn().mockResolvedValue(undefined) };
    // The payload is not what this is about.
    jest.spyOn(BackupScheduler.prototype as any, 'buildPayload').mockResolvedValue({ tenantId: 't1' });
    return { svc: new BackupScheduler(prisma, storage), storage };
  }

  it('writes each shop\'s backup under a random folder, not at backups/<day>/<slug>.json', async () => {
    const { svc, storage } = scheduler();
    const out = await svc.backupAllTenants();
    expect(out.uploaded).toBe(1);
    const key: string = storage.putBuffer.mock.calls[0][1];
    expect(key).toMatch(/^backups\/\d{4}-\d{2}-\d{2}\/[0-9a-f]{32}\/carolina-cafe\.json$/);
  });

  it('gives a re-run a new key rather than the same guessable one', async () => {
    const { svc, storage } = scheduler();
    await svc.backupAllTenants();
    await svc.backupAllTenants();
    const [a, b] = storage.putBuffer.mock.calls.map((c: any[]) => c[1]);
    expect(a).not.toBe(b);
  });

  describe('reading back', () => {
    const obj = (key: string, iso: string) => ({ key, size: 2048, lastModified: new Date(iso) });

    function service(objects: Array<{ key: string; size: number; lastModified: Date }>) {
      const storage: any = { getDriver: () => 'S3', list: jest.fn().mockResolvedValue(objects) };
      return new BackupService({} as any, storage);
    }

    it('lists new-shape and older keys for the shop, and nothing of a shop whose slug only starts the same', async () => {
      const svc = service([
        obj('backups/2026-10-19/carolina-cafe.json', '2026-10-18T18:00:00Z'),
        obj('backups/2026-10-20/0123456789abcdef0123456789abcdef/carolina-cafe.json', '2026-10-19T18:00:00Z'),
        obj('backups/2026-10-20/fedcba9876543210fedcba9876543210/carolina-cafe-2.json', '2026-10-19T18:00:00Z'),
      ]);
      const rows = await svc.listForTenantSlug('carolina-cafe');
      expect(rows.map((r) => r.date)).toEqual(['2026-10-20', '2026-10-19']);
    });

    it('picks the later write when one day holds two copies', async () => {
      const svc = service([
        obj('backups/2026-10-20/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/carolina-cafe.json', '2026-10-19T18:00:00Z'),
        obj('backups/2026-10-20/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/carolina-cafe.json', '2026-10-20T03:00:00Z'),
        obj('backups/2026-10-19/cccccccccccccccccccccccccccccccc/carolina-cafe.json', '2026-10-18T18:00:00Z'),
      ]);
      const latest = await svc.resolveSnapshotKey('carolina-cafe');
      expect(latest.key).toContain('bbbbbbbb');
      const sameDay = await svc.resolveSnapshotKey('carolina-cafe', '2026-10-20');
      expect(sameDay.key).toContain('bbbbbbbb');
    });
  });
});
