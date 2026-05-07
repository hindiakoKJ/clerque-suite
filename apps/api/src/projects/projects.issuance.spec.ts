/**
 * Tests for MaterialIssuance JE wiring (Sprint 10):
 * - Issuance posts Dr 1052 WIP / Cr 1051 RM Inventory
 * - Period-close guard rejects issuance if posting date is in a closed period
 * - JE silently skipped when 1052 / 1051 missing (legacy COA tenants)
 * - entryNumber derived from issuanceNumber (race-safe)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';

const TENANT  = 'tenant-A';
const PROJECT = 'proj-1';
const BRANCH  = 'branch-A';
const USER    = 'user-actor';

function makePrismaMock() {
  return {
    project: {
      findFirst: jest.fn().mockResolvedValue({
        id: PROJECT, tenantId: TENANT, projectCode: 'PRJ-2026-000001',
        status: 'ACTIVE',
      }),
    },
    branch: {
      findFirst: jest.fn().mockResolvedValue({ id: BRANCH }),
    },
    rawMaterial: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'rm-1', name: 'Cement bag', costPrice: 250 },
      ]),
    },
    rawMaterialInventory: {
      findUnique: jest.fn().mockResolvedValue({ quantity: 100 }),
      update:     jest.fn(),
    },
    materialIssuance: {
      findFirst: jest.fn(),
      create:    jest.fn().mockResolvedValue({
        id: 'iss-1', issuanceNumber: 'ISS-2026-000001',
        lines: [],
      }),
    },
    account: {
      findMany: jest.fn(),
    },
    journalEntry: {
      create: jest.fn(),
    },
    $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      // Re-use the same mock on the tx — flat shape simulates Prisma behaviour.
      return cb({
        project:               makePrismaMock().project,
        branch:                { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
        rawMaterial:           { findMany: jest.fn().mockResolvedValue([{ id: 'rm-1', name: 'Cement bag', costPrice: 250 }]) },
        rawMaterialInventory:  { findUnique: jest.fn().mockResolvedValue({ quantity: 100 }), update: jest.fn() },
        materialIssuance:      {
          findFirst: jest.fn(),
          create:    jest.fn().mockResolvedValue({
            id: 'iss-1', issuanceNumber: 'ISS-2026-000001', lines: [],
          }),
        },
        account: { findMany: jest.fn() },  // overridden per-test
        journalEntry: { create: jest.fn() },  // overridden per-test
      });
    }),
  };
}

function makePeriodsMock(opts: { open: boolean } = { open: true }) {
  return {
    assertDateIsOpen: jest.fn(opts.open
      ? () => Promise.resolve()
      : () => { throw new BadRequestException('Period is closed'); }),
  };
}

describe('ProjectsService.issueMaterials — JE posting', () => {
  let svc:    ProjectsService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let periods: ReturnType<typeof makePeriodsMock>;

  beforeEach(async () => {
    prisma  = makePrismaMock();
    periods = makePeriodsMock({ open: true });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AccountingPeriodsService, useValue: periods },
      ],
    }).compile();
    svc = module.get(ProjectsService);
  });

  it('posts JE with Dr 1052 / Cr 1051 when both accounts exist', async () => {
    let capturedJe: any = null;
    prisma.$transaction = jest.fn(async (cb: any) => cb({
      project:               { findFirst: jest.fn().mockResolvedValue({ id: PROJECT, tenantId: TENANT, projectCode: 'PRJ-2026-000001', status: 'ACTIVE' }) },
      branch:                { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterial:           { findMany: jest.fn().mockResolvedValue([{ id: 'rm-1', name: 'Cement bag', costPrice: 250 }]) },
      rawMaterialInventory:  { findUnique: jest.fn().mockResolvedValue({ quantity: 100 }), update: jest.fn() },
      materialIssuance:      {
        findFirst: jest.fn(),
        create:    jest.fn().mockResolvedValue({ id: 'iss-1', issuanceNumber: 'ISS-2026-000001', lines: [] }),
      },
      account: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'acct-1052', code: '1052' },  // WIP
          { id: 'acct-1051', code: '1051' },  // Raw Materials
        ]),
      },
      journalEntry: {
        create: jest.fn().mockImplementation((arg: any) => {
          capturedJe = arg;
          return Promise.resolve({ id: 'je-1' });
        }),
      },
    }));

    await svc.issueMaterials(TENANT, PROJECT, USER, {
      branchId: BRANCH,
      lines: [{ rawMaterialId: 'rm-1', quantity: 10 }],  // 10 × ₱250 = ₱2,500
    });

    // JE was posted
    expect(capturedJe).not.toBeNull();
    expect(capturedJe.data.tenantId).toBe(TENANT);
    expect(capturedJe.data.status).toBe('POSTED');
    expect(capturedJe.data.source).toBe('SYSTEM');
    expect(capturedJe.data.entryNumber).toBe('JE-ISS-2026-000001');  // race-safe derived from issuance #

    // Two lines: Dr WIP + Cr Raw Materials
    const lines = capturedJe.data.lines.create;
    expect(lines).toHaveLength(2);
    const debitLine  = lines.find((l: any) => Number(l.debit) > 0);
    const creditLine = lines.find((l: any) => Number(l.credit) > 0);
    expect(debitLine.accountId).toBe('acct-1052');
    expect(creditLine.accountId).toBe('acct-1051');
    expect(Number(debitLine.debit)).toBe(2500);
    expect(Number(creditLine.credit)).toBe(2500);
  });

  it('refuses issuance if posting date falls in a closed period', async () => {
    periods.assertDateIsOpen = jest.fn(() => {
      throw new BadRequestException('Period closed for May 2026');
    });
    prisma.$transaction = jest.fn(async (cb: any) => cb({
      project:               { findFirst: jest.fn().mockResolvedValue({ id: PROJECT, tenantId: TENANT, projectCode: 'PRJ-2026-000001', status: 'ACTIVE' }) },
      branch:                { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterial:           { findMany: jest.fn().mockResolvedValue([{ id: 'rm-1', name: 'Cement bag', costPrice: 250 }]) },
      rawMaterialInventory:  { findUnique: jest.fn().mockResolvedValue({ quantity: 100 }), update: jest.fn() },
      materialIssuance:      {
        findFirst: jest.fn(),
        create:    jest.fn().mockResolvedValue({ id: 'iss-1', issuanceNumber: 'ISS-2026-000001', lines: [] }),
      },
      account: { findMany: jest.fn() },
      journalEntry: { create: jest.fn() },
    }));

    await expect(svc.issueMaterials(TENANT, PROJECT, USER, {
      branchId: BRANCH,
      lines: [{ rawMaterialId: 'rm-1', quantity: 10 }],
    })).rejects.toThrow(BadRequestException);

    expect(periods.assertDateIsOpen).toHaveBeenCalledWith(TENANT, expect.any(Date));
  });

  it('silently skips JE when 1052 or 1051 are missing (legacy COA tenant)', async () => {
    let jeCreateCalls = 0;
    prisma.$transaction = jest.fn(async (cb: any) => cb({
      project:               { findFirst: jest.fn().mockResolvedValue({ id: PROJECT, tenantId: TENANT, projectCode: 'PRJ-2026-000001', status: 'ACTIVE' }) },
      branch:                { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterial:           { findMany: jest.fn().mockResolvedValue([{ id: 'rm-1', name: 'Cement bag', costPrice: 250 }]) },
      rawMaterialInventory:  { findUnique: jest.fn().mockResolvedValue({ quantity: 100 }), update: jest.fn() },
      materialIssuance:      {
        findFirst: jest.fn(),
        create:    jest.fn().mockResolvedValue({ id: 'iss-1', issuanceNumber: 'ISS-2026-000001', lines: [] }),
      },
      account: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'acct-1052', code: '1052' },   // WIP only — RM account missing
        ]),
      },
      journalEntry: {
        create: jest.fn().mockImplementation(() => { jeCreateCalls++; return Promise.resolve({}); }),
      },
    }));

    // Should not throw — issuance succeeds, JE silently skipped
    const result = await svc.issueMaterials(TENANT, PROJECT, USER, {
      branchId: BRANCH,
      lines: [{ rawMaterialId: 'rm-1', quantity: 10 }],
    });
    expect(result).toBeTruthy();
    expect(jeCreateCalls).toBe(0);  // no JE created
  });

  it('rejects issuance to a CANCELLED project', async () => {
    prisma.$transaction = jest.fn(async (cb: any) => cb({
      project: { findFirst: jest.fn().mockResolvedValue({ id: PROJECT, tenantId: TENANT, status: 'CANCELLED' }) },
      branch: { findFirst: jest.fn() },
      rawMaterial: { findMany: jest.fn() },
      rawMaterialInventory: { findUnique: jest.fn(), update: jest.fn() },
      materialIssuance: { findFirst: jest.fn(), create: jest.fn() },
      account: { findMany: jest.fn() },
      journalEntry: { create: jest.fn() },
    }));
    await expect(svc.issueMaterials(TENANT, PROJECT, USER, {
      branchId: BRANCH,
      lines: [{ rawMaterialId: 'rm-1', quantity: 10 }],
    })).rejects.toThrow(BadRequestException);
  });

  it('rejects issuance when not enough stock at branch', async () => {
    prisma.$transaction = jest.fn(async (cb: any) => cb({
      project:               { findFirst: jest.fn().mockResolvedValue({ id: PROJECT, tenantId: TENANT, projectCode: 'PRJ-2026-000001', status: 'ACTIVE' }) },
      branch:                { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterial:           { findMany: jest.fn().mockResolvedValue([{ id: 'rm-1', name: 'Cement bag', costPrice: 250 }]) },
      rawMaterialInventory:  { findUnique: jest.fn().mockResolvedValue({ quantity: 5 }), update: jest.fn() },  // only 5 on hand
      materialIssuance:      { findFirst: jest.fn(), create: jest.fn() },
      account: { findMany: jest.fn() },
      journalEntry: { create: jest.fn() },
    }));
    await expect(svc.issueMaterials(TENANT, PROJECT, USER, {
      branchId: BRANCH,
      lines: [{ rawMaterialId: 'rm-1', quantity: 10 }],  // need 10
    })).rejects.toThrow(BadRequestException);
  });
});
