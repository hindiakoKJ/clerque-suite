/**
 * LaundryService — focused on the cross-tenant TOCTOU fixes
 * (updateMachineStatus, togglePromo, deletePromo) plus the LAUNDRY-only
 * business-type gate and the status-transition guards.
 *
 * Heavy intake / multi-line ticket math is exercised separately in
 * laundry.intake.spec.ts (TODO when v2 ticket creation is stabilised).
 */
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { LaundryService } from './laundry.service';

const TENANT_A = 'tenant-a';

function makePrismaMock() {
  const mock: any = {
    tenant: { findUnique: jest.fn() },
    laundryOrder: {
      findFirst:  jest.fn(),
      findUnique: jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
    },
    customer: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    laundryMachine: {
      findFirst:  jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
      findUnique: jest.fn(),
    },
    laundryPromo: {
      findFirst:  jest.fn(),
      update:     jest.fn(),
      updateMany: jest.fn(),
      delete:     jest.fn(),
      deleteMany: jest.fn(),
      findUnique: jest.fn(),
    },
  };
  // Inline $transaction — just runs the callback against the same mock (the
  // claim() implementation passes `tx` but tests don't distinguish).
  mock.$transaction = jest.fn((cb: any) =>
    typeof cb === 'function' ? cb(mock) : Promise.resolve(cb),
  );
  return mock;
}

describe('LaundryService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: LaundryService;

  beforeEach(() => {
    prisma = makePrismaMock();
    const numberingMock = {
      next: jest.fn().mockResolvedValue('CLA-2026-000001'),
    } as any;
    service = new LaundryService(prisma as any, numberingMock);
  });

  // ─────────────────────────────────────────────────────────────────
  // Business-type gate
  // ─────────────────────────────────────────────────────────────────

  describe('LAUNDRY-only business-type gate', () => {
    it('rejects non-LAUNDRY tenants from updateStatus', async () => {
      prisma.tenant.findUnique.mockResolvedValue({ businessType: 'COFFEE_SHOP' });
      await expect(
        service.updateStatus(TENANT_A, 'order-1', 'WASHING' as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('rejects when tenant is missing', async () => {
      prisma.tenant.findUnique.mockResolvedValue(null);
      await expect(
        service.updateStatus(TENANT_A, 'order-1', 'WASHING' as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // updateStatus — flow guards
  // ─────────────────────────────────────────────────────────────────

  describe('updateStatus — workflow rules', () => {
    beforeEach(() => {
      prisma.tenant.findUnique.mockResolvedValue({ businessType: 'LAUNDRY' });
    });

    it('rejects 404 when order is in another tenant', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue(null);
      await expect(service.updateStatus(TENANT_A, 'order-b', 'WASHING' as any))
        .rejects.toThrow(NotFoundException);
    });

    it('rejects reverting from CLAIMED', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({ id: 'o1', status: 'CLAIMED' });
      await expect(service.updateStatus(TENANT_A, 'o1', 'WASHING' as any))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects setting CLAIMED via updateStatus (must use claim endpoint)', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({ id: 'o1', status: 'WASHING' });
      await expect(service.updateStatus(TENANT_A, 'o1', 'CLAIMED' as any))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects backwards transitions (FOLDING → WASHING)', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({ id: 'o1', status: 'FOLDING' });
      await expect(service.updateStatus(TENANT_A, 'o1', 'WASHING' as any))
        .rejects.toThrow(BadRequestException);
    });

    it('allows forward transition and stamps readyAt on READY_FOR_PICKUP', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({ id: 'o1', status: 'FOLDING', readyAt: null });
      prisma.laundryOrder.update.mockResolvedValue({ id: 'o1', status: 'READY_FOR_PICKUP' });

      await service.updateStatus(TENANT_A, 'o1', 'READY_FOR_PICKUP' as any);

      const args = prisma.laundryOrder.update.mock.calls[0][0] as any;
      expect(args.data.status).toBe('READY_FOR_PICKUP');
      expect(args.data.readyAt).toBeInstanceOf(Date);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // claim — links to POS Order
  // ─────────────────────────────────────────────────────────────────

  describe('claim', () => {
    beforeEach(() => {
      prisma.tenant.findUnique.mockResolvedValue({ businessType: 'LAUNDRY' });
    });

    it('rejects double-claim', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({ id: 'o1', status: 'CLAIMED' });
      await expect(service.claim(TENANT_A, 'o1', 'u1', 'pos-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('rejects claim on cancelled', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({ id: 'o1', status: 'CANCELLED' });
      await expect(service.claim(TENANT_A, 'o1', 'u1', 'pos-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('updates status to CLAIMED and links posOrderId via atomic updateMany', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({
        id: 'o1', status: 'READY_FOR_PICKUP', customerId: 'c1', isDelivery: false,
      });
      prisma.laundryOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.laundryOrder.findUnique.mockResolvedValue({ id: 'o1' });

      await service.claim(TENANT_A, 'o1', 'u-cashier', 'pos-123');

      // Atomic, status-conditional updateMany — no fallthrough to legacy update().
      const args = prisma.laundryOrder.updateMany.mock.calls[0][0] as any;
      expect(args.where).toMatchObject({ id: 'o1', tenantId: TENANT_A });
      expect(args.where.status).toEqual({ notIn: ['CLAIMED', 'CANCELLED'] });
      expect(args.data.status).toBe('CLAIMED');
      expect(args.data.releasedBy).toBe('u-cashier');
      expect(args.data.orderId).toBe('pos-123');
      expect(args.data.claimedAt).toBeInstanceOf(Date);
      expect(prisma.laundryOrder.update).not.toHaveBeenCalled();
    });

    it('increments customer loyalty visits on claim (when customerId attached)', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({
        id: 'o1', status: 'READY_FOR_PICKUP', customerId: 'c1', isDelivery: false,
      });
      prisma.laundryOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.laundryOrder.findUnique.mockResolvedValue({ id: 'o1' });

      await service.claim(TENANT_A, 'o1', 'u-cashier', 'pos-123');

      expect(prisma.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'c1', tenantId: TENANT_A },
        data:  { loyaltyVisits: { increment: 1 } },
      });
    });

    it('walk-in (no customerId) does not bump loyalty', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({
        id: 'o1', status: 'READY_FOR_PICKUP', customerId: null, isDelivery: false,
      });
      prisma.laundryOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.laundryOrder.findUnique.mockResolvedValue({ id: 'o1' });

      await service.claim(TENANT_A, 'o1', 'u-cashier', 'pos-123');
      expect(prisma.customer.updateMany).not.toHaveBeenCalled();
    });

    it('delivery ticket: claim sets deliveryStatus = DELIVERED', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({
        id: 'o1', status: 'READY_FOR_PICKUP', customerId: 'c1', isDelivery: true,
      });
      prisma.laundryOrder.updateMany.mockResolvedValue({ count: 1 });
      prisma.laundryOrder.findUnique.mockResolvedValue({ id: 'o1' });

      await service.claim(TENANT_A, 'o1', 'u-cashier', 'pos-123');
      const args = prisma.laundryOrder.updateMany.mock.calls[0][0] as any;
      expect(args.data.deliveryStatus).toBe('DELIVERED');
    });

    it('count=0 (concurrent already-claimed) throws BadRequestException', async () => {
      prisma.laundryOrder.findFirst.mockResolvedValue({
        id: 'o1', status: 'READY_FOR_PICKUP', customerId: 'c1', isDelivery: false,
      });
      prisma.laundryOrder.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.claim(TENANT_A, 'o1', 'u-cashier', 'pos-123'))
        .rejects.toThrow(BadRequestException);
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // updateMachineStatus — TOCTOU fix
  // ─────────────────────────────────────────────────────────────────

  describe('updateMachineStatus — TOCTOU fix', () => {
    it('uses atomic updateMany scoped by id + tenantId', async () => {
      prisma.laundryMachine.findFirst.mockResolvedValue({ id: 'm1', status: 'IDLE' });
      prisma.laundryMachine.updateMany.mockResolvedValue({ count: 1 });
      prisma.laundryMachine.findUnique.mockResolvedValue({ id: 'm1' });

      await service.updateMachineStatus(TENANT_A, 'm1', 'RUNNING' as any);

      expect(prisma.laundryMachine.updateMany).toHaveBeenCalledWith({
        where: { id: 'm1', tenantId: TENANT_A },
        data:  { status: 'RUNNING' },
      });
      expect(prisma.laundryMachine.update).not.toHaveBeenCalled();
    });

    it('rejects setting IDLE while RUNNING', async () => {
      prisma.laundryMachine.findFirst.mockResolvedValue({ id: 'm1', status: 'RUNNING' });
      await expect(service.updateMachineStatus(TENANT_A, 'm1', 'IDLE' as any))
        .rejects.toThrow(BadRequestException);
    });

    it('cross-tenant id is rejected at the findFirst stage', async () => {
      prisma.laundryMachine.findFirst.mockResolvedValue(null);
      await expect(service.updateMachineStatus(TENANT_A, 'm-from-b', 'IDLE' as any))
        .rejects.toThrow(NotFoundException);
      expect(prisma.laundryMachine.updateMany).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // togglePromo / deletePromo — TOCTOU fix
  // ─────────────────────────────────────────────────────────────────

  describe('togglePromo / deletePromo — TOCTOU fix', () => {
    it('togglePromo uses atomic updateMany scoped by id + tenantId', async () => {
      prisma.laundryPromo.updateMany.mockResolvedValue({ count: 1 });
      prisma.laundryPromo.findUnique.mockResolvedValue({ id: 'p1' });

      await service.togglePromo(TENANT_A, 'p1', false);

      expect(prisma.laundryPromo.updateMany).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId: TENANT_A },
        data:  { isActive: false },
      });
      expect(prisma.laundryPromo.update).not.toHaveBeenCalled();
    });

    it('togglePromo throws 404 when count=0 (cross-tenant id)', async () => {
      prisma.laundryPromo.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.togglePromo(TENANT_A, 'p-from-b', true))
        .rejects.toThrow(NotFoundException);
    });

    it('deletePromo uses atomic deleteMany scoped by id + tenantId', async () => {
      prisma.laundryPromo.deleteMany.mockResolvedValue({ count: 1 });
      await service.deletePromo(TENANT_A, 'p1');

      expect(prisma.laundryPromo.deleteMany).toHaveBeenCalledWith({
        where: { id: 'p1', tenantId: TENANT_A },
      });
      expect(prisma.laundryPromo.delete).not.toHaveBeenCalled();
    });

    it('deletePromo throws 404 when count=0', async () => {
      prisma.laundryPromo.deleteMany.mockResolvedValue({ count: 0 });
      await expect(service.deletePromo(TENANT_A, 'p-from-b'))
        .rejects.toThrow(NotFoundException);
    });
  });
});
