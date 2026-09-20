import {
  CanActivate, ExecutionContext, INestApplication, UnauthorizedException, ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TenantController } from './tenant.controller';
import { TenantBrandingController } from './tenant-branding.controller';
import { TenantService } from './tenant.service';
import { TenantLogoService, LOGO_FILE_MARKER } from './tenant-logo.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtOrDeviceTokenAuthGuard } from '../auth/guards/jwt-or-device-token.guard';
import { DisplayPairingService } from '../display-pairing/display-pairing.service';
import { GlobalExceptionFilter } from '../common/filters/prisma-exception.filter';

/**
 * The business logo over real HTTP: multer, the global ValidationPipe as
 * main.ts sets it, RolesGuard, and the device-token guard. Only the JWT
 * signature check, the database and the storage driver are faked.
 *
 * Tenant isolation is the thread through all of it: the business is always
 * the one in the token or the device pairing. Every request below also names
 * another tenant in the query or body, and that tenant must never be touched.
 */

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 7),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(32, 2)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(32, 3)]);

const DEVICE_TOKEN = 'ab'.repeat(16); // 32 hex, the pairing token shape

/** Stands in for passport: the test says who is signed in. */
class FakeJwtGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers['x-test-user'];
    if (!raw) throw new UnauthorizedException();
    req.user = JSON.parse(String(raw));
    return true;
  }
}

const OWNER   = { sub: 'owner-1',   tenantId: 't-1', role: 'BUSINESS_OWNER', isSuperAdmin: false };
const CASHIER = { sub: 'cashier-1', tenantId: 't-1', role: 'CASHIER',        isSuperAdmin: false };
const ADMIN   = { sub: 'admin-1',   tenantId: 't-1', role: 'SUPER_ADMIN',    isSuperAdmin: true };
const API_KEY = { sub: 'key-1',     tenantId: 't-1', role: 'SERVICE',        isSuperAdmin: false };
const as = (u: object) => JSON.stringify(u);

describe('Business logo over HTTP', () => {
  let app: INestApplication;
  let tenants: Record<string, { name: string; businessName: string | null; planCode: string; receiptLogoUrl: string | null }>;
  let photos: Array<{ id: string; tenantId: string; originalName: string | null }>;
  let puts: Array<{ key: string; opts: any; bytes: number }>;
  let storage: any;
  let tenantService: any;

  beforeEach(async () => {
    tenants = {
      't-1': { name: 'Kape Tayo Inc', businessName: 'Kape Tayo', planCode: 'CLERQUE', receiptLogoUrl: null },
      't-2': { name: 'Other Shop',    businessName: null,        planCode: 'CLERQUE', receiptLogoUrl: null },
    };
    photos = [];
    puts = [];

    const prisma: any = {
      tenant: {
        findUnique: jest.fn(async ({ where }: any) => (tenants[where.id] ? { ...tenants[where.id] } : null)),
        updateMany: jest.fn(async ({ where, data }: any) => {
          const row = tenants[where.id];
          if (!row || row.receiptLogoUrl !== where.receiptLogoUrl) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
      productPhoto: {
        findFirst: jest.fn(async ({ where }: any) => photos.find((p) =>
          p.id === where.id
          && p.tenantId === where.tenantId
          && (p.originalName ?? '').startsWith(where.originalName.startsWith)) ?? null),
      },
    };
    // Behaves like the DB driver, which is what production runs.
    storage = {
      driverName:   'DB',
      putBuffer:    jest.fn(async (buf: Buffer, key: string, opts: any) => {
        puts.push({ key, opts, bytes: buf.length });
        photos.push({ id: key.split('/').pop()!.replace(/\.[^.]+$/, ''), tenantId: opts.tenantId, originalName: opts.originalName });
      }),
      getPublicUrl: jest.fn((key: string) => `/api/v1/products/photos/${key.split('/').pop()!.replace(/\.[^.]+$/, '')}`),
      delete:       jest.fn(async () => true),
    };
    tenantService = {
      updateReceiptConfig: jest.fn(async () => ({ ok: true })),
      updateProfile:       jest.fn(async () => ({ ok: true })),
    };
    const pairing = {
      resolveToken: jest.fn(async (token: string) => (token === DEVICE_TOKEN
        ? { tenantId: 't-1', createdById: 'cashier-1', stationId: null, role: 'CUSTOMER_DISPLAY' }
        : null)),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [TenantController, TenantBrandingController],
      providers: [
        TenantLogoService,
        JwtOrDeviceTokenAuthGuard,
        { provide: JwtAuthGuard,          useClass: FakeJwtGuard },
        { provide: TenantService,         useValue: tenantService },
        { provide: PrismaService,         useValue: prisma },
        { provide: StorageService,        useValue: storage },
        { provide: AuditService,          useValue: { log: jest.fn(async () => undefined) } },
        { provide: DisplayPairingService, useValue: pairing },
      ],
    })
      .overrideGuard(JwtAuthGuard).useClass(FakeJwtGuard)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // Exactly as main.ts registers them.
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  const upload = (user: object | null, file: Buffer, filename: string, contentType: string) => {
    const req = request(app.getHttpServer()).post('/api/v1/tenant/logo?tenantId=t-2');
    if (user) req.set('x-test-user', as(user));
    return req.field('tenantId', 't-2').attach('file', file, { filename, contentType });
  };

  describe('POST /tenant/logo', () => {
    it('stores a PNG under the owner\'s own branding folder and saves only the short link', async () => {
      const res = await upload(OWNER, PNG, 'logo.png', 'image/png').expect(200);

      expect(res.body).toEqual({ logoUrl: expect.stringMatching(/^\/api\/v1\/products\/photos\/[0-9a-f]{24}$/) });
      expect(puts).toHaveLength(1);
      expect(puts[0].key).toMatch(/^public\/branding\/t-1\/[0-9a-f]{24}\.png$/);
      expect(puts[0].opts).toMatchObject({ contentType: 'image/png', tenantId: 't-1', originalName: `${LOGO_FILE_MARKER}.png` });
      expect(tenants['t-1'].receiptLogoUrl).toBe(res.body.logoUrl);
      // The tenant named in the query and the form field is untouched.
      expect(tenants['t-2'].receiptLogoUrl).toBeNull();
    });

    it.each([
      ['JPEG', JPEG, 'logo.jpg',  'image/jpeg', 'jpg'],
      ['WEBP', WEBP, 'logo.webp', 'image/webp', 'webp'],
    ])('accepts a %s', async (_label, bytes, filename, mime, ext) => {
      await upload(OWNER, bytes, filename, mime).expect(200);
      expect(puts[0].key.endsWith(`.${ext}`)).toBe(true);
      expect(puts[0].opts.contentType).toBe(mime);
    });

    it('refuses an SVG, and says so in plain words', async () => {
      const res = await upload(OWNER, SVG, 'logo.svg', 'image/svg+xml').expect(400);
      expect(res.body.message.join(' ')).toMatch(/SVG logos are not accepted/);
      expect(puts).toHaveLength(0);
    });

    it('refuses a GIF', async () => {
      await upload(OWNER, GIF, 'logo.gif', 'image/gif').expect(400);
      expect(puts).toHaveLength(0);
    });

    it('refuses an SVG that claims to be a PNG (checked by its bytes)', async () => {
      const res = await upload(OWNER, SVG, 'logo.png', 'image/png').expect(400);
      expect(res.body.message.join(' ')).toMatch(/not a PNG, JPEG or WEBP/);
      expect(puts).toHaveLength(0);
    });

    it('accepts exactly 1 MB and refuses one byte more with a plain message', async () => {
      const oneMb = Buffer.concat([PNG.subarray(0, 8), Buffer.alloc(1024 * 1024 - 8, 1)]);
      await upload(OWNER, oneMb, 'big.png', 'image/png').expect(200);

      const tooBig = Buffer.concat([oneMb, Buffer.from([0])]);
      const res = await upload(OWNER, tooBig, 'bigger.png', 'image/png').expect(413);
      expect(res.body.code).toBe('LOGO_TOO_LARGE');
      expect(res.body.message).toEqual(['The logo must be 1 MB or smaller.']);
      expect(puts).toHaveLength(1);
    });

    it('refuses a request with no file', async () => {
      await request(app.getHttpServer()).post('/api/v1/tenant/logo')
        .set('x-test-user', as(OWNER)).field('note', 'no file').expect(400);
      expect(puts).toHaveLength(0);
    });

    it.each([
      ['a cashier', CASHIER],
      ['a super admin (RolesGuard lets them through @Roles, the route does not)', ADMIN],
      ['an API key', API_KEY],
    ])('refuses %s', async (_label, user) => {
      await upload(user, PNG, 'logo.png', 'image/png').expect(403);
      expect(puts).toHaveLength(0);
      expect(tenants['t-1'].receiptLogoUrl).toBeNull();
    });

    it('refuses anyone not signed in', async () => {
      await upload(null, PNG, 'logo.png', 'image/png').expect(401);
    });

    it('deletes the previous logo file when a new one replaces it', async () => {
      const first = await upload(OWNER, PNG, 'one.png', 'image/png').expect(200);
      await upload(OWNER, JPEG, 'two.jpg', 'image/jpeg').expect(200);

      // On the DB driver the row id is all a key needs.
      expect(storage.delete).toHaveBeenCalledTimes(1);
      expect(storage.delete).toHaveBeenCalledWith(`public/branding/t-1/${first.body.logoUrl.split('/').pop()}`);
      expect(tenants['t-1'].receiptLogoUrl).not.toBe(first.body.logoUrl);
    });

    it('never deletes another business\'s logo, even when the old link points at it', async () => {
      photos.push({ id: 'c'.repeat(24), tenantId: 't-2', originalName: `${LOGO_FILE_MARKER}.png` });
      tenants['t-1'].receiptLogoUrl = `/api/v1/products/photos/${'c'.repeat(24)}`;

      await upload(OWNER, PNG, 'logo.png', 'image/png').expect(200);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('never deletes one of the business\'s own product photos pasted in as the logo link', async () => {
      photos.push({ id: 'd'.repeat(24), tenantId: 't-1', originalName: 'latte.jpg' });
      tenants['t-1'].receiptLogoUrl = `/api/v1/products/photos/${'d'.repeat(24)}`;

      await upload(OWNER, PNG, 'logo.png', 'image/png').expect(200);
      expect(storage.delete).not.toHaveBeenCalled();
    });

    it('replaces an old inline data: logo without trying to delete anything', async () => {
      tenants['t-1'].receiptLogoUrl = `data:image/png;base64,${'A'.repeat(300_000)}`;
      const res = await upload(OWNER, PNG, 'logo.png', 'image/png').expect(200);
      expect(tenants['t-1'].receiptLogoUrl).toBe(res.body.logoUrl);
      expect(storage.delete).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /tenant/logo', () => {
    it('clears the link and deletes the stored file', async () => {
      const up = await upload(OWNER, PNG, 'logo.png', 'image/png').expect(200);
      const res = await request(app.getHttpServer()).delete('/api/v1/tenant/logo?tenantId=t-2')
        .set('x-test-user', as(OWNER)).expect(200);

      expect(res.body).toEqual({ logoUrl: null });
      expect(tenants['t-1'].receiptLogoUrl).toBeNull();
      expect(storage.delete).toHaveBeenCalledWith(`public/branding/t-1/${up.body.logoUrl.split('/').pop()}`);
    });

    it('refuses a cashier', async () => {
      tenants['t-1'].receiptLogoUrl = '/api/v1/products/photos/' + 'e'.repeat(24);
      await request(app.getHttpServer()).delete('/api/v1/tenant/logo').set('x-test-user', as(CASHIER)).expect(403);
      expect(tenants['t-1'].receiptLogoUrl).not.toBeNull();
    });
  });

  describe('GET /tenant/branding', () => {
    it('a cashier gets name, business name, logo link and initials', async () => {
      tenants['t-1'].receiptLogoUrl = '/api/v1/products/photos/' + 'f'.repeat(24);
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding?tenantId=t-2')
        .set('x-test-user', as(CASHIER)).expect(200);

      expect(res.body).toEqual({
        name:         'Kape Tayo Inc',
        businessName: 'Kape Tayo',
        logoUrl:      '/api/v1/products/photos/' + 'f'.repeat(24),
        initials:     'KT',
      });
    });

    it('a paired screen with only a device token gets its own business', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding?tenantId=t-2')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`).expect(200);
      expect(res.body.name).toBe('Kape Tayo Inc');
    });

    it('also accepts the device token in X-Device-Token', async () => {
      await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('X-Device-Token', DEVICE_TOKEN).expect(200);
    });

    it('refuses a revoked or unknown device token', async () => {
      await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('Authorization', `Bearer ${'0'.repeat(32)}`).expect(401);
    });

    it('does not fall back to a stored pairing when an expired sign-in token was sent', async () => {
      // A browser once paired for t-1, now signed in for another business
      // whose token has expired. The pairing must not answer for it: a 401
      // makes the page refresh the sign-in and ask again.
      tenants['t-1'].receiptLogoUrl = '/api/v1/products/photos/' + 'f'.repeat(24);
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.expired.signature')
        .set('X-Device-Token', DEVICE_TOKEN)
        .expect(401);
      expect(JSON.stringify(res.body)).not.toContain('Kape Tayo');
      expect(JSON.stringify(res.body)).not.toContain('photos');
    });

    it('a valid sign-in wins over a stored pairing from another business', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('x-test-user', as({ ...CASHIER, tenantId: 't-2' }))
        .set('X-Device-Token', DEVICE_TOKEN)
        .expect(200);
      expect(res.body.name).toBe('Other Shop');
    });

    it('a paired screen sending its pairing token in both headers still works', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('Authorization', `Bearer ${DEVICE_TOKEN}`)
        .set('X-Device-Token', DEVICE_TOKEN)
        .expect(200);
      expect(res.body.name).toBe('Kape Tayo Inc');
    });

    it('refuses an API key', async () => {
      await request(app.getHttpServer()).get('/api/v1/tenant/branding').set('x-test-user', as(API_KEY)).expect(403);
    });

    it('treats an old inline data: logo as no logo', async () => {
      tenants['t-1'].receiptLogoUrl = `data:image/png;base64,${'A'.repeat(1000)}`;
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('x-test-user', as(CASHIER)).expect(200);
      expect(res.body.logoUrl).toBeNull();
      expect(res.body.initials).toBe('KT');
    });

    it('initials fall back to the tenant name when the business name is blank', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/tenant/branding')
        .set('x-test-user', as({ ...CASHIER, tenantId: 't-2' })).expect(200);
      expect(res.body).toMatchObject({ businessName: null, initials: 'OS', logoUrl: null });
    });
  });

  describe('logo links through the settings routes', () => {
    it.each([
      ['an inline data: image', 'data:image/png;base64,iVBORw0KGgo='],
      ['an http:// link',       'http://example.com/logo.png'],
      ['a javascript: link',    'javascript:alert(1)'],
      ['a link over 512 characters', `https://cdn.example.com/${'a'.repeat(500)}.png`],
    ])('PATCH /tenant/receipt-config refuses %s', async (_label, logoUrl) => {
      await request(app.getHttpServer()).patch('/api/v1/tenant/receipt-config')
        .set('x-test-user', as(OWNER)).send({ logoUrl }).expect(400);
      expect(tenantService.updateReceiptConfig).not.toHaveBeenCalled();
    });

    it('PATCH /tenant/receipt-config accepts a short link and clearing', async () => {
      await request(app.getHttpServer()).patch('/api/v1/tenant/receipt-config')
        .set('x-test-user', as(OWNER)).send({ logoUrl: '/api/v1/products/photos/' + 'a'.repeat(24), headerNote: 'Hi' }).expect(200);
      await request(app.getHttpServer()).patch('/api/v1/tenant/receipt-config')
        .set('x-test-user', as(OWNER)).send({ logoUrl: null }).expect(200);
      expect(tenantService.updateReceiptConfig).toHaveBeenNthCalledWith(1, 't-1', expect.objectContaining({ headerNote: 'Hi' }), 'owner-1');
    });

    it('PATCH /tenant/profile refuses an inline data: logo', async () => {
      await request(app.getHttpServer()).patch('/api/v1/tenant/profile')
        .set('x-test-user', as(OWNER)).send({ receiptLogoUrl: 'data:image/png;base64,iVBORw0KGgo=' }).expect(400);
      expect(tenantService.updateProfile).not.toHaveBeenCalled();
    });
  });
});
