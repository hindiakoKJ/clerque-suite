/**
 * Branch closing time (Branch.closesAt) through the tenant branches API.
 *
 *   - the DTOs accept "HH:mm" 00:00-23:59 or null, and refuse anything else,
 *     checked through the same ValidationPipe options main.ts uses
 *   - the body types became classes, so forbidNonWhitelisted now applies:
 *     every field the Branches page already sends must still get through
 *   - POST/PATCH stay owner-only; the list returns closesAt
 *   - update sets, clears (null) or leaves (omitted) the closing time, and
 *     stays scoped to the caller's tenant
 */

import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtPayload } from '@repo/shared-types';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';
import { PrismaService } from '../prisma/prisma.service';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';

const TENANT_ID = 'tenant-1';
const BRANCH_ID = 'branch-1';

// Same options as the global pipe in main.ts, so these tests see what a real
// request sees.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

function run(metatype: new () => object, body: unknown) {
  const meta: ArgumentMetadata = { type: 'body', metatype, data: '' };
  return pipe.transform(body, meta);
}

async function rejectionMessages(metatype: new () => object, body: unknown): Promise<string[]> {
  try {
    await run(metatype, body);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return ((err as BadRequestException).getResponse() as { message: string[] }).message;
  }
  throw new Error(`expected ${JSON.stringify(body)} to be rejected`);
}

describe('Branch DTOs — closesAt validation', () => {
  const VALID = ['00:00', '06:30', '09:05', '21:00', '23:59'];
  const INVALID: unknown[] = ['24:00', '9:00', '21:60', '21:00:00', '9pm', '21.00', ' 21:00', '', 2100, true];

  describe.each([
    ['CreateBranchDto', CreateBranchDto],
    ['UpdateBranchDto', UpdateBranchDto],
  ] as const)('%s', (_name, Dto) => {
    it.each(VALID)('accepts "%s"', async (closesAt) => {
      const out = await run(Dto, { name: 'Main', closesAt });
      expect(out).toMatchObject({ closesAt });
    });

    it('accepts null (not set / clear it)', async () => {
      const out = await run(Dto, { name: 'Main', closesAt: null });
      expect((out as { closesAt: unknown }).closesAt).toBeNull();
    });

    it('accepts the field being left out', async () => {
      const out = await run(Dto, { name: 'Main' });
      expect((out as { closesAt?: unknown }).closesAt).toBeUndefined();
    });

    it.each(INVALID)('refuses %p', async (closesAt) => {
      const messages = await rejectionMessages(Dto, { name: 'Main', closesAt });
      expect(messages.some((m) => m.startsWith('closesAt'))).toBe(true);
    });

    it('still refuses fields nobody declared', async () => {
      const messages = await rejectionMessages(Dto, { name: 'Main', tenantId: 'someone-else' });
      expect(messages).toContain('property tenantId should not exist');
    });
  });

  it('create lets through everything the Branches page sends', async () => {
    const body = { name: 'Main', address: 'Naga City', closesAt: '21:00' };
    await expect(run(CreateBranchDto, body)).resolves.toMatchObject(body);
  });

  it('update lets through everything the Branches page sends', async () => {
    const edit = { name: 'Main', address: null, closesAt: null };
    await expect(run(UpdateBranchDto, edit)).resolves.toMatchObject(edit);
    await expect(run(UpdateBranchDto, { isActive: false })).resolves.toMatchObject({ isActive: false });
  });

  it('update refuses a non-boolean isActive', async () => {
    const messages = await rejectionMessages(UpdateBranchDto, { isActive: 'yes' });
    expect(messages.some((m) => m.startsWith('isActive'))).toBe(true);
  });
});

describe('TenantController — branches', () => {
  const user = { sub: 'owner-1', tenantId: TENANT_ID, role: 'BUSINESS_OWNER' } as unknown as JwtPayload;

  function makeController() {
    const svc = {
      createBranch: jest.fn().mockResolvedValue({}),
      updateBranch: jest.fn().mockResolvedValue({}),
    };
    return { ctrl: new TenantController(svc as unknown as TenantService), svc };
  }

  it('create passes closesAt through, and null when left out', async () => {
    const { ctrl, svc } = makeController();
    await ctrl.createBranch(user, { name: ' Main ', address: '  ', closesAt: '21:00' });
    expect(svc.createBranch).toHaveBeenCalledWith(TENANT_ID, { name: 'Main', address: null, closesAt: '21:00' });

    await ctrl.createBranch(user, { name: 'Cubao' });
    expect(svc.createBranch).toHaveBeenLastCalledWith(TENANT_ID, { name: 'Cubao', address: null, closesAt: null });
  });

  it('update passes a cleared closing time (null) to the service for the caller tenant', async () => {
    const { ctrl, svc } = makeController();
    await ctrl.updateBranch(user, BRANCH_ID, { closesAt: null });
    expect(svc.updateBranch).toHaveBeenCalledWith(TENANT_ID, BRANCH_ID, { closesAt: null });
  });

  it('only owners (and super admin) can create or edit branches; everyone who could list still can', () => {
    const roles = (fn: unknown) => Reflect.getMetadata(ROLES_KEY, fn as object);
    expect(roles(TenantController.prototype.createBranch)).toEqual(['BUSINESS_OWNER', 'SUPER_ADMIN']);
    expect(roles(TenantController.prototype.updateBranch)).toEqual(['BUSINESS_OWNER', 'SUPER_ADMIN']);
    expect(roles(TenantController.prototype.getBranches)).toEqual(expect.arrayContaining(['CASHIER', 'BUSINESS_OWNER']));
  });
});

describe('TenantService — branch closing time', () => {
  function buildPrismaMock() {
    return {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ id: TENANT_ID, planCode: 'SUITE_T3' }),
      },
      branch: {
        findMany:   jest.fn().mockResolvedValue([]),
        count:      jest.fn().mockResolvedValue(0),
        create:     jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: BRANCH_ID, ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUnique: jest.fn().mockResolvedValue({ id: BRANCH_ID, closesAt: '21:00' }),
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

  it('list returns closesAt, still only for the caller tenant', async () => {
    const { svc, prisma } = await makeService();
    await svc.getBranches(TENANT_ID);
    const args = prisma.branch.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ tenantId: TENANT_ID });
    expect(args.select).toMatchObject({ closesAt: true });
  });

  it('create stores the closing time and returns it', async () => {
    const { svc, prisma } = await makeService();
    await svc.createBranch(TENANT_ID, { name: 'Main', address: null, closesAt: '21:00' });
    const args = prisma.branch.create.mock.calls[0][0];
    expect(args.data).toMatchObject({ tenantId: TENANT_ID, closesAt: '21:00' });
    expect(args.select).toMatchObject({ closesAt: true });
  });

  it('create without a closing time stores null', async () => {
    const { svc, prisma } = await makeService();
    await svc.createBranch(TENANT_ID, { name: 'Main', address: null });
    expect(prisma.branch.create.mock.calls[0][0].data.closesAt).toBeNull();
  });

  it('update sets the closing time, scoped to the caller tenant, and returns it', async () => {
    const { svc, prisma } = await makeService();
    const out = await svc.updateBranch(TENANT_ID, BRANCH_ID, { closesAt: '21:00' });
    const args = prisma.branch.updateMany.mock.calls[0][0];
    expect(args.where).toEqual({ id: BRANCH_ID, tenantId: TENANT_ID });
    expect(args.data).toEqual({ closesAt: '21:00' });
    expect(prisma.branch.findUnique.mock.calls[0][0].select).toMatchObject({ closesAt: true });
    expect(out).toMatchObject({ closesAt: '21:00' });
  });

  it('update with null clears the closing time', async () => {
    const { svc, prisma } = await makeService();
    await svc.updateBranch(TENANT_ID, BRANCH_ID, { name: 'Main', address: null, closesAt: null });
    expect(prisma.branch.updateMany.mock.calls[0][0].data).toEqual({ name: 'Main', address: null, closesAt: null });
  });

  it('update without closesAt leaves it alone (the active toggle must not wipe it)', async () => {
    const { svc, prisma } = await makeService();
    await svc.updateBranch(TENANT_ID, BRANCH_ID, { isActive: false });
    const data = prisma.branch.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ isActive: false });
    expect('closesAt' in data).toBe(false);
  });

  it('update of a branch in another tenant writes nothing and says not found', async () => {
    const { svc, prisma } = await makeService();
    prisma.branch.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(svc.updateBranch(TENANT_ID, 'other-tenant-branch', { closesAt: '21:00' }))
      .rejects.toThrow('Branch not found.');
    expect(prisma.branch.findUnique).not.toHaveBeenCalled();
  });

  it.each(['24:00', '9:00', '21:00:00', ''])('the service itself refuses "%s" before touching the database', async (closesAt) => {
    const { svc, prisma } = await makeService();
    await expect(svc.updateBranch(TENANT_ID, BRANCH_ID, { closesAt })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createBranch(TENANT_ID, { name: 'Main', address: null, closesAt })).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.branch.updateMany).not.toHaveBeenCalled();
    expect(prisma.branch.create).not.toHaveBeenCalled();
  });
});
