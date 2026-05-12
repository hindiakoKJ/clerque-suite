/**
 * Unit tests for Bir2307Service.generateForVendor — Sprint 22.
 *
 * Happy path: 3 APBill rows for one vendor with mixed ATC codes inside Q1.
 * Asserts the per-ATC grouping + sum-of-bases + sum-of-withheld.
 *
 * Mocks: PrismaService is shaped just-enough for BirService.get2307Data,
 *        which Bir2307Service delegates to.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { Bir2307Service } from './bir-2307.service';
import { BirService } from './bir.service';
import { PrismaService } from '../prisma/prisma.service';

const TENANT = 'tenant-1';
const VENDOR = 'vendor-1';

function decimal(n: number) { return { toString: () => n.toString() } as any; }

function makePrismaMock() {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ isBirRegistered: true }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        businessName: 'Acme PH', name: 'Acme PH',
        tinNumber: '123-456-789-00000', registeredAddress: '1 Ayala Ave, Makati',
      }),
    },
    vendor: {
      findFirstOrThrow: jest.fn().mockResolvedValue({
        name: 'Vendor One Inc.', tin: '987-654-321-00000',
        address: '5 BGC, Taguig', defaultAtcCode: 'WC158',
      }),
      findMany: jest.fn(),
    },
    aPBill: {
      findMany: jest.fn(),
      groupBy:  jest.fn(),
    },
  };
}

describe('Bir2307Service.generateForVendor', () => {
  let svc:    Bir2307Service;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Bir2307Service,
        BirService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = module.get(Bir2307Service);
  });

  it('groups bills by ATC code, sums tax base and tax withheld', async () => {
    // 3 bills in Q1 2026: two on ATC WC158 (Jan + Feb), one on WC160 (Mar).
    prisma.aPBill.findMany.mockResolvedValue([
      {
        billDate: new Date(Date.UTC(2026, 0, 15)),  // Jan
        totalAmount: decimal(11200), subtotal: decimal(10000),
        vatAmount: decimal(1200), whtAmount: decimal(200),
        whtAtcCode: 'WC158',
      },
      {
        billDate: new Date(Date.UTC(2026, 1, 10)),  // Feb
        totalAmount: decimal(5600),  subtotal: decimal(5000),
        vatAmount: decimal(600),  whtAmount: decimal(100),
        whtAtcCode: 'WC158',
      },
      {
        billDate: new Date(Date.UTC(2026, 2, 20)),  // Mar
        totalAmount: decimal(22400), subtotal: decimal(20000),
        vatAmount: decimal(2400), whtAmount: decimal(2000),
        whtAtcCode: 'WC160',
      },
    ]);

    const data = await svc.generateForVendor(TENANT, VENDOR, 2026, 1);

    expect(data.year).toBe(2026);
    expect(data.quarter).toBe(1);
    expect(data.payee.vendorId).toBe(VENDOR);
    expect(data.payee.registeredName).toBe('Vendor One Inc.');
    expect(data.payor.registeredName).toBe('Acme PH');
    expect(data.billCount).toBe(3);

    // Two ATC groups
    expect(data.atcRows).toHaveLength(2);
    const wc158 = data.atcRows.find((r) => r.atcCode === 'WC158')!;
    const wc160 = data.atcRows.find((r) => r.atcCode === 'WC160')!;
    expect(wc158).toBeDefined();
    expect(wc160).toBeDefined();

    expect(wc158.totalTaxBase).toBe(15000);
    expect(wc158.totalWithheld).toBe(300);
    expect(wc158.months).toHaveLength(2);

    expect(wc160.totalTaxBase).toBe(20000);
    expect(wc160.totalWithheld).toBe(2000);
    expect(wc160.months).toHaveLength(1);

    expect(data.grandTotalTaxBase).toBe(35000);
    expect(data.grandTotalWithheld).toBe(2300);
  });

  it('returns an empty atcRows array when no WHT bills exist for the period', async () => {
    prisma.aPBill.findMany.mockResolvedValue([]);
    const data = await svc.generateForVendor(TENANT, VENDOR, 2026, 2);
    expect(data.billCount).toBe(0);
    expect(data.atcRows).toEqual([]);
    expect(data.grandTotalWithheld).toBe(0);
  });
});
