/**
 * Race-condition tests for stock-transfer state machine.
 *
 * The atomic status-conditional updateMany pattern ensures that two
 * concurrent send/cancel/receive calls on the same transfer cannot both
 * decrement (or refund) inventory. The "winner" is the first call whose
 * updateMany matches; the loser sees count=0 and aborts.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WarehouseService } from './warehouse.service';
import { PrismaService } from '../prisma/prisma.service';

function makePrismaMock() {
  // Simulated row-level state machine: callbacks read these to decide
  // whether their conditional updateMany matched (count=1) or not (count=0).
  let transferStatus: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED' = 'DRAFT';
  let inventory = 100; // raw material on hand at source
  let sentAt: Date | null = null; // tracked independently of status

  const stockTransferUpdateMany = jest.fn(async ({ where, data }: any) => {
    const required = where.status;
    let matches = false;
    if (typeof required === 'string') {
      matches = transferStatus === required;
    } else if (required && Array.isArray(required.in)) {
      matches = required.in.includes(transferStatus);
    }
    if (matches) {
      transferStatus = data.status;
      // Track sentAt: set when transitioning to IN_TRANSIT, preserve through CANCELLED
      if (data.status === 'IN_TRANSIT' && data.sentAt) sentAt = data.sentAt;
      if (data.sentAt === null) sentAt = null; // explicit reset
      return { count: 1 };
    }
    return { count: 0 };
  });

  const stockTransferFindFirst = jest.fn(async () => ({ status: transferStatus }));
  const stockTransferFindFirstOrThrow = jest.fn(async () => ({
    id: 't-1', tenantId: 'tenant-1',
    fromBranchId: 'branch-A', toBranchId: 'branch-B',
    sentAt,
    lines: [{ id: 'line-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
  }));

  const rmInvFindUnique = jest.fn(async () => ({ quantity: inventory }));
  const rmInvUpdate = jest.fn(async ({ data }: any) => {
    if (data.quantity?.decrement) inventory -= data.quantity.decrement;
    if (data.quantity?.increment) inventory += data.quantity.increment;
    return {};
  });
  const stockTransferUpdate = jest.fn(async ({ data }: any) => {
    if (data.status) transferStatus = data.status;
    return {};
  });

  return {
    prisma: {
      stockTransfer: {
        updateMany:        stockTransferUpdateMany,
        findFirst:         stockTransferFindFirst,
        findFirstOrThrow:  stockTransferFindFirstOrThrow,
        update:            stockTransferUpdate,
      },
      rawMaterialInventory: {
        findUnique: rmInvFindUnique,
        update: rmInvUpdate,
        upsert: jest.fn(async ({ update }: any) => {
          if (update?.quantity?.increment) inventory += update.quantity.increment;
          return {};
        }),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        return cb({
          stockTransfer: {
            updateMany: stockTransferUpdateMany,
            findFirst: stockTransferFindFirst,
            findFirstOrThrow: stockTransferFindFirstOrThrow,
            update: stockTransferUpdate,
          },
          rawMaterialInventory: {
            findUnique: rmInvFindUnique,
            update: rmInvUpdate,
            upsert: jest.fn(async ({ update }: any) => {
              if (update?.quantity?.increment) inventory += update.quantity.increment;
              return {};
            }),
          },
        });
      }),
    },
    state: {
      get status() { return transferStatus; },
      get inventory() { return inventory; },
      get sentAt() { return sentAt; },
      setStatus(s: typeof transferStatus) {
        transferStatus = s;
        // When test forces IN_TRANSIT, also stamp sentAt for cancel flow
        if (s === 'IN_TRANSIT' && !sentAt) sentAt = new Date();
      },
      setInventory(n: number) { inventory = n; },
      setSentAt(d: Date | null) { sentAt = d; },
    },
    spies: { stockTransferUpdateMany, rmInvUpdate },
  };
}

describe('WarehouseService — transfer race conditions', () => {
  let service: WarehouseService;
  let mock: ReturnType<typeof makePrismaMock>;

  beforeEach(async () => {
    mock = makePrismaMock();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WarehouseService,
        { provide: PrismaService, useValue: mock.prisma },
      ],
    }).compile();
    service = module.get(WarehouseService);
  });

  describe('sendTransfer', () => {
    it('decrements source inventory exactly once for two concurrent sends', async () => {
      const startInv = mock.state.inventory;
      const [a, b] = await Promise.allSettled([
        service.sendTransfer('tenant-1', 't-1'),
        service.sendTransfer('tenant-1', 't-1'),
      ]);
      const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
      const rejected  = [a, b].filter((r) => r.status === 'rejected');

      // Exactly one wins, exactly one loses
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Inventory decremented by 10 (line.quantity), not 20
      expect(mock.state.inventory).toBe(startInv - 10);
      // Status is IN_TRANSIT now
      expect(mock.state.status).toBe('IN_TRANSIT');
    });

    it('rejects send when status is already IN_TRANSIT', async () => {
      mock.state.setStatus('IN_TRANSIT');
      await expect(service.sendTransfer('tenant-1', 't-1'))
        .rejects.toThrow(BadRequestException);
      // No inventory change on rejection
      expect(mock.state.inventory).toBe(100);
    });

    it('rolls status back to DRAFT on insufficient stock', async () => {
      mock.state.setInventory(5); // line needs 10
      await expect(service.sendTransfer('tenant-1', 't-1'))
        .rejects.toThrow(BadRequestException);
      // Atomic claim flipped status briefly but rolls back
      expect(mock.state.status).toBe('DRAFT');
    });
  });

  describe('cancelTransfer', () => {
    it('refunds inventory exactly once for two concurrent cancels (when in transit)', async () => {
      mock.state.setStatus('IN_TRANSIT');
      mock.state.setInventory(90); // already deducted at send
      const [a, b] = await Promise.allSettled([
        service.cancelTransfer('tenant-1', 't-1'),
        service.cancelTransfer('tenant-1', 't-1'),
      ]);
      const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
      const rejected  = [a, b].filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      // Inventory refunded by 10, not 20
      expect(mock.state.inventory).toBe(100);
      expect(mock.state.status).toBe('CANCELLED');
    });

    it('does not refund inventory if cancel happens while DRAFT (no send was performed)', async () => {
      mock.state.setStatus('DRAFT');
      mock.state.setInventory(100);
      // findFirstOrThrow with sentAt=null → no refund branch
      mock.prisma.stockTransfer.findFirstOrThrow = jest.fn(async () => ({
        id: 't-1', tenantId: 'tenant-1',
        fromBranchId: 'branch-A', toBranchId: 'branch-B',
        sentAt: null,
        lines: [{ id: 'line-1', rawMaterialId: 'rm-1', quantity: 10, unitCost: 5 }],
      }));
      await service.cancelTransfer('tenant-1', 't-1');
      expect(mock.state.inventory).toBe(100); // unchanged
      expect(mock.state.status).toBe('CANCELLED');
    });

    it('rejects cancel when already RECEIVED', async () => {
      mock.state.setStatus('RECEIVED');
      await expect(service.cancelTransfer('tenant-1', 't-1'))
        .rejects.toThrow(BadRequestException);
    });
  });

  describe('receiveTransfer', () => {
    it('rejects receive when status is not IN_TRANSIT', async () => {
      mock.state.setStatus('DRAFT');
      await expect(service.receiveTransfer('tenant-1', 't-1', 'user-1'))
        .rejects.toThrow(BadRequestException);
    });

    it('allows exactly one receive when called twice concurrently', async () => {
      mock.state.setStatus('IN_TRANSIT');
      const [a, b] = await Promise.allSettled([
        service.receiveTransfer('tenant-1', 't-1', 'user-1'),
        service.receiveTransfer('tenant-1', 't-1', 'user-1'),
      ]);
      const fulfilled = [a, b].filter((r) => r.status === 'fulfilled');
      expect(fulfilled).toHaveLength(1);
      expect(mock.state.status).toBe('RECEIVED');
    });
  });
});
