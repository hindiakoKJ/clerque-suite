import { StorageService } from './storage.service';

/**
 * Writable is not durable.
 *
 * Railway, Render, Vercel and Heroku all give you a writable working
 * directory that is discarded on the next deploy. The LOCAL driver therefore
 * passed every check it was asked to make — ./uploads was writable, the file
 * wrote, the URL resolved, the photo rendered — and then a routine push
 * erased every product image with no error anywhere. The failure only shows
 * up as "I uploaded photos, why aren't they showing", days later, with
 * nothing in the logs tying it to the deploy that caused it.
 *
 * So on those hosts we take Postgres instead. ProductPhoto already exists and
 * needs no configuration, which makes the safe default free.
 */
describe('StorageService — picking a driver that keeps the file', () => {
  const ENV = process.env;

  beforeEach(() => { process.env = { ...ENV }; });
  afterAll(() => { process.env = ENV; });

  function make(env: Record<string, string | undefined> = {}) {
    const config: any = { get: (k: string) => env[k] };
    const prisma: any = {};
    const svc = new StorageService(config, prisma) as any;
    return svc.driver as string;
  }

  const HOSTS: Array<[string, string]> = [
    ['RAILWAY_GIT_COMMIT_SHA', 'abc123'],
    ['RAILWAY_ENVIRONMENT',    'production'],
    ['RAILWAY_PROJECT_ID',     'p_1'],
    // the ones Railway actually sets, which the first version of this check
    // missed -- so photos went on being wiped by every deploy
    ['RAILWAY_ENVIRONMENT_NAME', 'production'],
    ['RAILWAY_PROJECT_NAME',     'clerque'],
    ['RAILWAY_SERVICE_ID',       'svc_1'],
    ['RAILWAY_PUBLIC_DOMAIN',    'api.up.railway.app'],
    ['RENDER',                 'true'],
    ['VERCEL',                 '1'],
    ['DYNO',                   'web.1'],
  ];

  it.each(HOSTS)('uses the database on an ephemeral host (%s)', (key, value) => {
    process.env[key] = value;
    expect(make()).toBe('DB');
  });

  it('still uses local disk on a normal machine', () => {
    for (const k of Object.keys(process.env)) if (k.startsWith('RAILWAY_')) delete process.env[k];
    for (const [k] of HOSTS) delete process.env[k];
    // ./uploads is writable in the repo, so this is the developer's case
    expect(['LOCAL', 'DB']).toContain(make());
  });

  it('S3 always wins, even on an ephemeral host', () => {
    // A configured bucket is durable wherever it runs, and switching drivers
    // later would strand every file already uploaded.
    process.env.RAILWAY_ENVIRONMENT = 'production';
    expect(make({
      S3_BUCKET:            'clerque-media',
      S3_ACCESS_KEY_ID:     'key',
      S3_SECRET_ACCESS_KEY: 'secret',
      S3_ENDPOINT:          'https://acct.r2.cloudflarestorage.com',
    })).toBe('S3');
  });

  it('an explicit STORAGE_DRIVER=DB is honoured anywhere', () => {
    for (const k of Object.keys(process.env)) if (k.startsWith('RAILWAY_')) delete process.env[k];
    for (const [k] of HOSTS) delete process.env[k];
    expect(make({ STORAGE_DRIVER: 'DB' })).toBe('DB');
  });

  it('serves DB-stored photos from a path the browser can reach', () => {
    process.env.RAILWAY_ENVIRONMENT = 'production';
    const config: any = { get: () => undefined };
    const svc = new StorageService(config, {} as any);
    const url = svc.getPublicUrl('public/products/t1/deadbeefcafe.jpg');

    // resolveAssetUrl on the client strips /api/v1 off the API origin before
    // appending, so the prefix has to be carried on the path itself.
    expect(url).toBe('/api/v1/products/photos/deadbeefcafe');
    expect(url).not.toContain('.jpg');   // mimeType column is the source of truth
  });
});
