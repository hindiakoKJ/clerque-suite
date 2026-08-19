/**
 * TenantService.updateProfile — Magnet Books ledgerMode (FULL | SIMPLE).
 *
 *   - persists `ledgerMode` when the owner sends it
 *   - leaves it untouched when omitted
 *   - DTO rejects anything other than 'FULL' | 'SIMPLE'
 */

import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { TenantService } from './tenant.service';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';

const TENANT_ID = 'tenant-1';

function buildPrismaMock() {
  return {
    tenant: {
      // getProfile() guard — just needs a non-null row.
      findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID, name: 'Magnet Shop' }),
      update:     jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: TENANT_ID, name: 'Magnet Shop', ...data })),
    },
  };
}

async function makeService() {
  const prismaMock = buildPrismaMock();
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      TenantService,
      { provide: PrismaService,        useValue: prismaMock },
      { provide: TaxCalculatorService, useValue: {} },
      { provide: AuditService,         useValue: { log: jest.fn() } },
    ],
  }).compile();
  return { svc: moduleRef.get(TenantService), prisma: prismaMock };
}

describe('TenantService.updateProfile — ledgerMode', () => {
  it('persists ledgerMode SIMPLE when provided', async () => {
    const { svc, prisma } = await makeService();
    await svc.updateProfile(TENANT_ID, { ledgerMode: 'SIMPLE' });

    expect(prisma.tenant.update).toHaveBeenCalledTimes(1);
    const args = prisma.tenant.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: TENANT_ID });
    expect(args.data).toEqual({ ledgerMode: 'SIMPLE' });
  });

  it('getProfile selects ledgerMode so Settings reflects the saved choice on reload', async () => {
    const { svc, prisma } = await makeService();
    await svc.getProfile(TENANT_ID);

    const args = prisma.tenant.findUnique.mock.calls[0][0];
    expect(args.select).toMatchObject({ ledgerMode: true });
  });

  it('omits ledgerMode when not provided', async () => {
    const { svc, prisma } = await makeService();
    await svc.updateProfile(TENANT_ID, { name: 'Renamed Shop' });

    const args = prisma.tenant.update.mock.calls[0][0];
    expect(args.data).toEqual({ name: 'Renamed Shop' });
    expect(args.data).not.toHaveProperty('ledgerMode');
  });
});

describe('UpdateTenantProfileDto — ledgerMode validation', () => {
  it('rejects values other than FULL | SIMPLE', async () => {
    const dto = Object.assign(new UpdateTenantProfileDto(), { ledgerMode: 'FANCY' });
    const errors = await validate(dto);
    expect(errors.map((e) => e.property)).toContain('ledgerMode');
  });

  it('accepts FULL and SIMPLE, and allows omission', async () => {
    for (const ledgerMode of ['FULL', 'SIMPLE'] as const) {
      const errors = await validate(Object.assign(new UpdateTenantProfileDto(), { ledgerMode }));
      expect(errors).toHaveLength(0);
    }
    expect(await validate(new UpdateTenantProfileDto())).toHaveLength(0);
  });
});
