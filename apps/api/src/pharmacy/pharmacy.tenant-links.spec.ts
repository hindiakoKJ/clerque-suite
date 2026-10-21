import { ForbiddenException } from '@nestjs/common';
import { PharmacyService } from './pharmacy.service';

/**
 * A prescription's customer must be this shop's own (tenant isolation check,
 * 21 Oct 2026, finding P3): the prescription reads the customer's name back.
 * The stand-in database holds this shop's customers only.
 */
const TENANT = 't-botika';

function build() {
  const prisma: any = {
    customer: {
      findFirst: jest.fn(({ where }: any) => Promise.resolve(where.tenantId === TENANT && where.id === 'c-lolo' ? { id: 'c-lolo' } : null)),
    },
    prescription: { create: jest.fn(({ data }: any) => Promise.resolve({ id: 'rx-new', ...data })) },
  };
  return { svc: new PharmacyService(prisma), prisma };
}

const RX = {
  rxNumber: 'RX-1', patientName: 'Lolo Ben', prescribingDoctor: 'Dr. Reyes',
  doctorPrcLicense: 'PRC-123', issuedAt: '2026-10-20',
} as any;

describe('PharmacyService.createPrescription', () => {
  it('refuses another shop\'s customer', async () => {
    const { svc, prisma } = build();
    await expect(svc.createPrescription(TENANT, { ...RX, customerId: 'c-other-shop' })).rejects.toThrow(ForbiddenException);
    expect(prisma.prescription.create).not.toHaveBeenCalled();
  });

  it('still files a prescription for this shop\'s customer, or a walk-in with none', async () => {
    const { svc, prisma } = build();
    await svc.createPrescription(TENANT, { ...RX, customerId: 'c-lolo' });
    await svc.createPrescription(TENANT, RX);
    expect(prisma.prescription.create.mock.calls.map((c: any) => c[0].data.customerId)).toEqual(['c-lolo', null]);
  });
});
