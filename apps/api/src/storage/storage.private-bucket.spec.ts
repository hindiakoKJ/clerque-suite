import { Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { StorageService } from './storage.service';
import { isPrivateKey, unguessableArchiveKey } from './private-keys';

/**
 * Backups and audit archives never sit in the public photo bucket, and their
 * keys cannot be guessed.
 *
 * Product photos need a public bucket so browsers can load them, and R2 makes
 * a whole bucket public or none of it. The nightly backup (staff with their
 * government ID numbers and pay, customers, payslips, books) and the audit
 * archive were written to that same bucket at `backups/<day>/<slug>.json`,
 * where the day is guessable and the slug is the company code staff type at
 * sign-in. So: an optional private bucket for those keys, and a random folder
 * in every key.
 */
describe('StorageService — backups go to the private bucket', () => {
  const S3_ENV = {
    S3_BUCKET:            'clerque-prod',
    S3_ACCESS_KEY_ID:     'key',
    S3_SECRET_ACCESS_KEY: 'secret',
    S3_ENDPOINT:          'https://acct.r2.cloudflarestorage.com',
  };

  function make(env: Record<string, string | undefined>) {
    const svc = new StorageService({ get: (k: string) => env[k] } as any, {} as any) as any;
    const sent: Array<{ name: string; input: any }> = [];
    svc.s3 = {
      send: jest.fn(async (cmd: any) => {
        sent.push({ name: cmd.constructor.name, input: cmd.input });
        if (cmd.constructor.name === 'ListObjectsV2Command') return { Contents: [] };
        if (cmd.constructor.name === 'GetObjectCommand') return { Body: Readable.from([Buffer.from('{}')]) };
        return {};
      }),
    };
    return { svc: svc as StorageService, sent };
  }

  afterEach(() => jest.restoreAllMocks());

  it('writes, lists, reads and deletes backups and audit archives in BACKUP_S3_BUCKET', async () => {
    const { svc, sent } = make({ ...S3_ENV, BACKUP_S3_BUCKET: 'clerque-backups' });
    await svc.putBuffer(Buffer.from('{}'), 'backups/2026-10-20/0123abcd/carolina-cafe.json');
    await svc.putBuffer(Buffer.from('{}'), 'audit-archive/2026-10-20/carolina-cafe.json');
    await svc.list('backups/');
    await svc.getStream('backups/2026-10-20/0123abcd/carolina-cafe.json');
    await svc.delete('backups/2026-10-20/0123abcd/carolina-cafe.json');
    expect(sent.length).toBe(6); // put, put, list, get, head, delete
    for (const s of sent) expect(s.input.Bucket).toBe('clerque-backups');
  });

  it('keeps product photos, logos and documents in the main bucket', async () => {
    const { svc, sent } = make({ ...S3_ENV, BACKUP_S3_BUCKET: 'clerque-backups' });
    await svc.putBuffer(Buffer.from('x'), 'public/products/t1/abc.jpg');
    await svc.getStream('tenants/t1/purchaserequest/req1/ab12cd34ef56.pdf');
    await svc.list('public/');
    for (const s of sent) expect(s.input.Bucket).toBe('clerque-prod');
  });

  it('a key that only looks similar is not treated as a backup', () => {
    expect(isPrivateKey('backups/2026-10-20/x/shop.json')).toBe(true);
    expect(isPrivateKey('audit-archive/2026-10-20/shop.json')).toBe(true);
    expect(isPrivateKey('public/backups/photo.jpg')).toBe(false);
    expect(isPrivateKey('backupsX/shop.json')).toBe(false);
  });

  it('falls back to S3_BUCKET when no backup bucket is set, as before', async () => {
    const { svc, sent } = make({ ...S3_ENV });
    await svc.putBuffer(Buffer.from('{}'), 'backups/2026-10-20/0123abcd/carolina-cafe.json');
    expect(sent[0].input.Bucket).toBe('clerque-prod');
  });

  it('warns at boot when backups would share a public photo bucket', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    make({ ...S3_ENV, S3_PUBLIC_URL: 'https://pub-123.r2.dev' });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('BACKUP_S3_BUCKET'));

    warn.mockClear();
    make({ ...S3_ENV, S3_PUBLIC_URL: 'https://pub-123.r2.dev', BACKUP_S3_BUCKET: 'clerque-backups' });
    make({ ...S3_ENV });   // private main bucket: nothing to warn about
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('unguessableArchiveKey', () => {
  it('puts a 128-bit random folder between the day and the slug', () => {
    const key = unguessableArchiveKey('backups', '2026-10-20', 'carolina-cafe');
    expect(key).toMatch(/^backups\/2026-10-20\/[0-9a-f]{32}\/carolina-cafe\.json$/);
    expect(key).not.toBe('backups/2026-10-20/carolina-cafe.json');
  });

  it('never gives the same key twice', () => {
    const keys = new Set(
      Array.from({ length: 50 }, () => unguessableArchiveKey('audit-archive', '2026-10-20', 'carolina-cafe')),
    );
    expect(keys.size).toBe(50);
  });
});
