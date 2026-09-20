import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TenantService } from './tenant.service';
import { TenantLogoService } from './tenant-logo.service';
import { UpdateReceiptConfigDto } from './dto/update-receipt-config.dto';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';

jest.mock('@repo/shared-types', () => {
  const actual = jest.requireActual('@repo/shared-types');
  return { ...actual, planFeaturesFor: jest.fn(actual.planFeaturesFor) };
});
const sharedTypes = require('@repo/shared-types');

const TENANT_ID = 'tenant-1';
const OLD_LOGO  = '/api/v1/products/photos/' + 'a'.repeat(24);
const NEW_LOGO  = '/api/v1/products/photos/' + 'b'.repeat(24);

/**
 * Receipt header, footer and logo link.
 *
 * Settings used to send these to PATCH /tenant/profile, which threw all three
 * away and still said "Receipt template saved". They now save, through the
 * same plan gate as PATCH /tenant/receipt-config, and a logo is only ever a
 * short link.
 */
async function makeService(stored: { receiptLogoUrl?: string | null } = {}) {
  const prisma = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        id: TENANT_ID, name: 'Shop', planCode: 'CLERQUE',
        receiptHeaderNote: null, receiptFooterNote: null,
        receiptLogoUrl: stored.receiptLogoUrl ?? null,
      }),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({
        id: TENANT_ID, name: 'Shop',
        receiptHeaderNote: null, receiptFooterNote: null, receiptLogoUrl: stored.receiptLogoUrl ?? null,
        ...data,
      })),
    },
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const logo  = { releaseReplacedLogo: jest.fn().mockResolvedValue(undefined) };
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      TenantService,
      { provide: PrismaService,        useValue: prisma },
      { provide: TaxCalculatorService, useValue: {} },
      { provide: AuditService,         useValue: audit },
      { provide: TenantLogoService,    useValue: logo },
    ],
  }).compile();
  return { svc: moduleRef.get(TenantService), prisma, audit, logo };
}

describe('Receipt template saves', () => {
  afterEach(() => {
    (sharedTypes.planFeaturesFor as jest.Mock).mockImplementation(jest.requireActual('@repo/shared-types').planFeaturesFor);
  });

  it('PATCH /tenant/profile now saves header, footer and logo link instead of dropping them', async () => {
    const { svc, prisma } = await makeService();
    const out: any = await svc.updateProfile(TENANT_ID, {
      receiptHeaderNote: 'Open 7am',
      receiptFooterNote: 'Salamat!',
      receiptLogoUrl:    NEW_LOGO,
    }, 'owner-1');

    const receiptWrite = prisma.tenant.update.mock.calls
      .map((c: any[]) => c[0].data)
      .find((d: any) => 'receiptHeaderNote' in d);
    expect(receiptWrite).toEqual({ receiptHeaderNote: 'Open 7am', receiptFooterNote: 'Salamat!', receiptLogoUrl: NEW_LOGO });
    expect(out).toMatchObject({ receiptHeaderNote: 'Open 7am', receiptFooterNote: 'Salamat!', receiptLogoUrl: NEW_LOGO });
  });

  it('PATCH /tenant/profile still applies the plan gate to receipt fields', async () => {
    (sharedTypes.planFeaturesFor as jest.Mock).mockReturnValue({ receiptCustomization: 'none' });
    const { svc, prisma } = await makeService();
    await expect(svc.updateProfile(TENANT_ID, { receiptHeaderNote: 'Hi', name: 'Renamed' }, 'owner-1'))
      .rejects.toThrow(ForbiddenException);
    // Refused before anything was written, the name included.
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('a profile save without receipt fields does not touch the receipt template', async () => {
    const { svc, prisma, logo } = await makeService({ receiptLogoUrl: OLD_LOGO });
    await svc.updateProfile(TENANT_ID, { name: 'Renamed' }, 'owner-1');
    expect(prisma.tenant.update).toHaveBeenCalledTimes(1);
    expect(prisma.tenant.update.mock.calls[0][0].data).toEqual({ name: 'Renamed' });
    expect(logo.releaseReplacedLogo).not.toHaveBeenCalled();
  });

  it('the service refuses an inline data: logo from any caller', async () => {
    const { svc, prisma } = await makeService();
    await expect(svc.updateReceiptConfig(TENANT_ID, { logoUrl: 'data:image/png;base64,iVBORw0KGgo=' }, 'owner-1'))
      .rejects.toThrow(BadRequestException);
    expect(prisma.tenant.update).not.toHaveBeenCalled();
  });

  it('changing the logo link releases the old uploaded file', async () => {
    const { svc, logo } = await makeService({ receiptLogoUrl: OLD_LOGO });
    await svc.updateReceiptConfig(TENANT_ID, { logoUrl: NEW_LOGO }, 'owner-1');
    expect(logo.releaseReplacedLogo).toHaveBeenCalledWith(TENANT_ID, OLD_LOGO, NEW_LOGO);
  });

  it('saving only the header leaves the logo and its file alone', async () => {
    const { svc, prisma, logo } = await makeService({ receiptLogoUrl: OLD_LOGO });
    await svc.updateReceiptConfig(TENANT_ID, { headerNote: 'Hi' }, 'owner-1');
    expect(prisma.tenant.update.mock.calls[0][0].data).toEqual({ receiptHeaderNote: 'Hi' });
    expect(logo.releaseReplacedLogo).not.toHaveBeenCalled();
  });

  it('the audit row describes an old inline logo instead of copying it', async () => {
    const inline = `data:image/png;base64,${'A'.repeat(200_000)}`;
    const { svc, audit } = await makeService({ receiptLogoUrl: inline });
    await svc.updateReceiptConfig(TENANT_ID, { logoUrl: null }, 'owner-1');
    const entry = audit.log.mock.calls[0][0];
    expect(entry.before.receiptLogoUrl).toMatch(/^inline image \(\d+ characters, not shown\)$/);
    expect(JSON.stringify(entry).length).toBeLessThan(1000);
  });
});

describe('Receipt config and profile DTOs', () => {
  const errorsFor = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body) as object)).map((e) => e.property);

  it.each([
    'data:image/png;base64,iVBORw0KGgo=',
    'http://example.com/logo.png',
    'javascript:alert(1)',
    `https://cdn.example.com/${'a'.repeat(500)}.png`,
  ])('refuses logo %s on both routes', async (value) => {
    expect(await errorsFor(UpdateReceiptConfigDto, { logoUrl: value })).toEqual(['logoUrl']);
    expect(await errorsFor(UpdateTenantProfileDto, { receiptLogoUrl: value })).toEqual(['receiptLogoUrl']);
  });

  it.each([NEW_LOGO, 'https://cdn.example.com/logo.png', '/uploads/public/branding/t-1/' + 'c'.repeat(24) + '.png', null, ''])(
    'accepts logo %p (a short link, or clearing)',
    async (value) => {
      expect(await errorsFor(UpdateReceiptConfigDto, { logoUrl: value })).toEqual([]);
      expect(await errorsFor(UpdateTenantProfileDto, { receiptLogoUrl: value })).toEqual([]);
    },
  );

  it('caps the header at 200 and the footer at 300 characters', async () => {
    expect(await errorsFor(UpdateReceiptConfigDto, { headerNote: 'a'.repeat(201), footerNote: 'b'.repeat(301) }))
      .toEqual(['headerNote', 'footerNote']);
    expect(await errorsFor(UpdateReceiptConfigDto, { headerNote: 'a'.repeat(200), footerNote: 'b'.repeat(300) }))
      .toEqual([]);
  });
});
