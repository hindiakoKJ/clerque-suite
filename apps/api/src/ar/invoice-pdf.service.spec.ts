/**
 * Smoke test for InvoicePdfService — verifies it produces a non-empty PDF
 * buffer that starts with the %PDF- magic header.
 *
 * We mock Prisma to a single happy-path invoice + tenant.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { InvoicePdfService } from './invoice-pdf.service';
import { PrismaService } from '../prisma/prisma.service';

const TENANT = 'tenant-1';
const INV    = 'inv-1';

function decimal(n: number) { return { toString: () => n.toString() } as any; }

function makePrismaMock() {
  return {
    aRInvoice: {
      findFirst: jest.fn().mockResolvedValue({
        id: INV, tenantId: TENANT,
        invoiceNumber: 'INV-00042',
        reference: 'PO-2026-001',
        invoiceDate: new Date('2026-05-01'),
        postingDate: new Date('2026-05-01'),
        dueDate:     new Date('2026-05-31'),
        termsDays: 30,
        subtotal: decimal(10000),
        vatAmount: decimal(1200),
        totalAmount: decimal(11200),
        paidAmount: decimal(0),
        balanceAmount: decimal(11200),
        status: 'OPEN',
        customer: {
          name: 'Customer Inc.', tin: '111-222-333-00000',
          address: '1 Sample St, Manila', contactEmail: 'ar@customer.test',
        },
        lines: [
          {
            description: 'Consulting hours — April', quantity: decimal(10),
            unitPrice: decimal(1000), taxAmount: decimal(1200), lineTotal: decimal(11200),
            account: { code: '4000', name: 'Consulting Revenue' },
          },
        ],
      }),
    },
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({
        name: 'Acme PH', businessName: 'Acme Philippines Inc.',
        tin: '123-456-789-00000', tinNumber: '123-456-789-00000',
        address: '1 Ayala Ave', registeredAddress: '1 Ayala Ave, Makati',
        taxStatus: 'VAT', contactEmail: 'billing@acme.ph', contactPhone: '+63 2 8123 4567',
      }),
    },
  };
}

describe('InvoicePdfService.renderInvoicePdf', () => {
  let svc: InvoicePdfService;
  let prisma: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    prisma = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicePdfService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = module.get(InvoicePdfService);
  });

  it('produces a non-empty PDF buffer that starts with %PDF-', async () => {
    const buf = await svc.renderInvoicePdf(TENANT, INV);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(500);   // anything smaller is suspicious
    expect(buf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('404s when invoice does not exist for the tenant', async () => {
    prisma.aRInvoice.findFirst.mockResolvedValueOnce(null);
    await expect(svc.renderInvoicePdf(TENANT, 'nope')).rejects.toThrow(/not found/i);
  });
});
