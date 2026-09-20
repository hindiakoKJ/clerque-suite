import { ConflictException, ForbiddenException, InternalServerErrorException } from '@nestjs/common';
import { TenantLogoService, LOGO_FILE_MARKER } from './tenant-logo.service';
import { brandingInitials, describeLogoForAudit, isAllowedLogoLink } from './logo-link';

jest.mock('@repo/shared-types', () => {
  const actual = jest.requireActual('@repo/shared-types');
  return { ...actual, planFeaturesFor: jest.fn(actual.planFeaturesFor) };
});
const sharedTypes = require('@repo/shared-types');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 1)]);
const png = () => ({ buffer: PNG, size: PNG.length, mimetype: 'image/png' });
const HEX_A = 'a'.repeat(24);

/**
 * The logo service on the two storage drivers whose links carry the tenant
 * in the path (local disk and S3/R2), plus the rules every screen relies on.
 * The DB driver, which production runs, is covered over HTTP in
 * tenant-logo.http.spec.ts.
 */
function build(driver: 'LOCAL' | 'S3', current: string | null, opts: { swap?: number } = {}) {
  const prisma: any = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ planCode: 'CLERQUE', receiptLogoUrl: current, name: 'Shop', businessName: null }),
      updateMany: jest.fn().mockResolvedValue({ count: opts.swap ?? 1 }),
    },
    productPhoto: { findFirst: jest.fn() },
  };
  const storage: any = {
    driverName:   driver,
    putBuffer:    jest.fn().mockResolvedValue(undefined),
    getPublicUrl: jest.fn((key: string) => (driver === 'S3' ? `https://cdn.example.com/${key}` : `/uploads/${key}`)),
    delete:       jest.fn().mockResolvedValue(true),
  };
  const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
  return { svc: new TenantLogoService(prisma, storage, audit), prisma, storage, audit };
}

describe('TenantLogoService', () => {
  afterEach(() => {
    (sharedTypes.planFeaturesFor as jest.Mock).mockImplementation(jest.requireActual('@repo/shared-types').planFeaturesFor);
  });

  it('local disk: deletes the replaced file when it is this tenant\'s own logo', async () => {
    const { svc, storage, prisma } = build('LOCAL', `/uploads/public/branding/t-1/${HEX_A}.png`);
    const out = await svc.upload('t-1', 'owner-1', png());

    expect(out.logoUrl).toMatch(/^\/uploads\/public\/branding\/t-1\/[0-9a-f]{24}\.png$/);
    expect(storage.delete).toHaveBeenCalledWith(`public/branding/t-1/${HEX_A}.png`);
    // The path already proves whose it is; no database lookup needed.
    expect(prisma.productPhoto.findFirst).not.toHaveBeenCalled();
  });

  it('local disk: leaves another tenant\'s logo file alone', async () => {
    const { svc, storage } = build('LOCAL', `/uploads/public/branding/t-2/${HEX_A}.png`);
    await svc.upload('t-1', 'owner-1', png());
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('local disk: leaves a product photo alone', async () => {
    const { svc, storage } = build('LOCAL', `/uploads/public/products/t-1/${HEX_A}.png`);
    await svc.upload('t-1', 'owner-1', png());
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('S3/R2: deletes the replaced file by its key', async () => {
    const { svc, storage } = build('S3', `https://cdn.example.com/public/branding/t-1/${HEX_A}.webp`);
    const out = await svc.upload('t-1', 'owner-1', png());
    expect(out.logoUrl).toMatch(/^https:\/\/cdn\.example\.com\/public\/branding\/t-1\/[0-9a-f]{24}\.png$/);
    expect(storage.delete).toHaveBeenCalledWith(`public/branding/t-1/${HEX_A}.webp`);
  });

  it('a pasted https link on another host is never deleted', async () => {
    const { svc, storage } = build('S3', `https://elsewhere.example.com/public/branding/t-1/${HEX_A}.png`);
    await svc.upload('t-1', 'owner-1', png());
    expect(storage.delete).not.toHaveBeenCalled();
  });

  it('writes the file with the logo marker the photo clean-up must skip', async () => {
    const { svc, storage } = build('LOCAL', null);
    await svc.upload('t-1', 'owner-1', png());
    expect(storage.putBuffer.mock.calls[0][2]).toMatchObject({ tenantId: 't-1', originalName: `${LOGO_FILE_MARKER}.png` });
  });

  it('when another save changed the logo meanwhile, keeps theirs and removes the new file', async () => {
    const { svc, storage, audit } = build('LOCAL', null, { swap: 0 });
    await expect(svc.upload('t-1', 'owner-1', png())).rejects.toThrow(ConflictException);
    const newKey = storage.putBuffer.mock.calls[0][1];
    expect(storage.delete).toHaveBeenCalledWith(newKey);
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('refuses to save a link no screen would show (e.g. an http:// public URL) and removes the file', async () => {
    const { svc, storage, prisma, audit } = build('S3', null);
    storage.getPublicUrl.mockImplementation((key: string) => `http://cdn.example.com/${key}`);
    await expect(svc.upload('t-1', 'owner-1', png())).rejects.toThrow(InternalServerErrorException);
    expect(storage.delete).toHaveBeenCalledWith(storage.putBuffer.mock.calls[0][1]);
    expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('a failed delete of the old file does not fail the upload', async () => {
    const { svc, storage } = build('LOCAL', `/uploads/public/branding/t-1/${HEX_A}.png`);
    storage.delete.mockRejectedValue(new Error('disk gone'));
    await expect(svc.upload('t-1', 'owner-1', png())).resolves.toEqual({ logoUrl: expect.any(String) });
  });

  it('keeps the plan gate: no logo on a plan without full receipt customization', async () => {
    (sharedTypes.planFeaturesFor as jest.Mock).mockReturnValue({ receiptCustomization: 'headerFooter' });
    const { svc, storage } = build('LOCAL', null);
    await expect(svc.upload('t-1', 'owner-1', png())).rejects.toThrow(ForbiddenException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('refuses an account with no business', async () => {
    const { svc, storage } = build('LOCAL', null);
    await expect(svc.upload(null, 'admin-1', png())).rejects.toThrow(ForbiddenException);
    await expect(svc.getBranding(undefined)).rejects.toThrow(ForbiddenException);
    expect(storage.putBuffer).not.toHaveBeenCalled();
  });

  it('logs a description of an old inline logo, never the image itself', async () => {
    const inline = `data:image/png;base64,${'A'.repeat(5000)}`;
    const { svc, audit } = build('LOCAL', inline);
    await svc.upload('t-1', 'owner-1', png());
    const entry = audit.log.mock.calls[0][0];
    expect(JSON.stringify(entry).length).toBeLessThan(600);
    expect(entry.before.receiptLogoUrl).toMatch(/^inline image/);
  });

  it('removing when there is no logo changes nothing', async () => {
    const { svc, prisma, storage } = build('LOCAL', null);
    await expect(svc.remove('t-1', 'owner-1')).resolves.toEqual({ logoUrl: null });
    expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
    expect(storage.delete).not.toHaveBeenCalled();
  });
});

describe('logo link rules', () => {
  it.each([
    ['/api/v1/products/photos/' + HEX_A, true],
    ['/uploads/public/branding/t-1/' + HEX_A + '.png', true],
    ['https://cdn.example.com/public/branding/t-1/logo.png', true],
    ['data:image/png;base64,iVBORw0KGgo=', false],
    ['DATA:image/png;base64,iVBORw0KGgo=', false],
    ['http://example.com/logo.png', false],
    ['javascript:alert(1)', false],
    ['/api/v1/../admin', false],
    ['/somewhere/else.png', false],
    ['https://cdn.example.com/logo.png" onerror="x', false],
    [`https://cdn.example.com/${'a'.repeat(500)}`, false],
    [null, false],
  ])('%s -> %s', (value, ok) => {
    expect(isAllowedLogoLink(value)).toBe(ok);
  });

  it.each([
    ['Kape Tayo', 'Name', 'KT'],
    ['magnet', 'Name', 'MA'],
    ["Aling Nena's Sari-Sari Store", 'Name', 'AN'],
    [null, 'Other Shop', 'OS'],
    ['   ', 'Other Shop', 'OS'],
    ['---', 'Solo', 'SO'],
    ['7 Eleven', 'Name', '7E'],
    ['Ñora Café', 'Name', 'ÑC'],
    [null, '***', ''],
  ])('initials of %p / %p are %p', (businessName, name, expected) => {
    expect(brandingInitials(businessName, name)).toBe(expected);
  });

  it('audit descriptions keep short links and never copy an inline image', () => {
    expect(describeLogoForAudit('/api/v1/products/photos/' + HEX_A)).toBe('/api/v1/products/photos/' + HEX_A);
    expect(describeLogoForAudit(null)).toBeNull();
    expect(describeLogoForAudit('data:image/png;base64,AAAA')).toBe('inline image (26 characters, not shown)');
  });
});
