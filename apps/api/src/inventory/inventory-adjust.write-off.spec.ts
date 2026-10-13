/**
 * InventoryService.adjust() — product write-offs record and book correctly.
 *
 *   1. The reasonCode reaches the INVENTORY_ADJUSTMENT payload, so the journal
 *      books DAMAGE/EXPIRY to 5070 and THEFT/COUNT_CORRECTION to 5060 instead
 *      of every write-off landing in 5010.
 *   2. Stock leaves at the shelf's moving-average cost (InventoryItem.avgCost),
 *      falling back to the catalog costPrice only when there is none.
 *   3. The approving supervisor is recorded: on the event, on the Movement Log
 *      line, and in an audit row.
 *   4. The supervisor PIN goes through the shop-wide wrong-PIN count shared
 *      with the till (auth/pin-attempts), and the requester can never approve
 *      their own write-off.
 */
import * as bcrypt from 'bcryptjs';
import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { InventoryService, writeOffLogReason } from './inventory.service';
import { supervisorPinAttempts } from '../auth/pin-attempts';

const TENANT = 'tenant-a';
const REQUESTER = 'mgr-requester';

// Cost 4 keeps the hashing fast; bcrypt.compare reads the cost from the hash.
const USERS = [
  { id: 'sup-maria', name: 'Maria Santos', role: 'BRANCH_MANAGER', isActive: true, supervisorPinHash: bcrypt.hashSync('4291', 4) },
  // The person removing the stock also holds a supervisor PIN.
  { id: REQUESTER,   name: 'Rey Cruz',     role: 'BUSINESS_OWNER', isActive: true, supervisorPinHash: bcrypt.hashSync('7351', 4) },
  // Not a role that may approve, even with a PIN on file.
  { id: 'cashier-1', name: 'Ana Reyes',    role: 'CASHIER',        isActive: true, supervisorPinHash: bcrypt.hashSync('5862', 4) },
];

type UserRow = (typeof USERS)[number];

/** user.findMany that honours the filters the service sends (role, active, NOT id). */
function findManyHonouringWhere(rows: UserRow[]) {
  return jest.fn(async ({ where }: { where: Record<string, any> }) =>
    rows.filter((u) =>
      u.isActive === where.isActive
      && (!where.role?.in || where.role.in.includes(u.role))
      && u.supervisorPinHash != null
      && (!where.NOT?.id || u.id !== where.NOT.id),
    ),
  );
}

function makeHarness(opts: { avgCost?: number | null; costPrice?: number | null; users?: UserRow[] } = {}) {
  const tx = {
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'item-1', quantity: 20,
        avgCost: opts.avgCost === undefined ? 42.5 : opts.avgCost,
      }),
      upsert: jest.fn(async ({ update }: any) => ({ id: 'item-1', quantity: update.quantity })),
    },
    inventoryLog: { create: jest.fn().mockResolvedValue({ id: 'log-77' }) },
    accountingEvent: { create: jest.fn().mockResolvedValue({ id: 'evt-1' }) },
  };
  const users = opts.users ?? USERS;
  const prisma = {
    product: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'prod-1', tenantId: TENANT, name: 'Ensaymada',
        costPrice: opts.costPrice === undefined ? 50 : opts.costPrice,
      }),
    },
    branch: { findFirst: jest.fn().mockResolvedValue({ id: 'branch-1' }) },
    user: {
      findMany: findManyHonouringWhere(users),
      findFirst: jest.fn(async ({ where }: any) => users.find((u) => u.id === where.id) ?? null),
    },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const svc = new InventoryService(prisma as any, {} as any, undefined, audit as any);
  return { svc, prisma, tx, audit };
}

function writeOff(overrides: Record<string, unknown> = {}) {
  return {
    productId: 'prod-1', branchId: 'branch-1',
    quantity: -4, type: 'STOCK_OUT',
    reasonCode: 'DAMAGE', reason: 'Damaged / spoiled',
    supervisorPin: '4291',
    ...overrides,
  } as any;
}

function payloadOf(tx: ReturnType<typeof makeHarness>['tx']): Record<string, any> {
  expect(tx.accountingEvent.create).toHaveBeenCalledTimes(1);
  return tx.accountingEvent.create.mock.calls[0][0].data.payload;
}

describe('InventoryService.adjust — product write-offs', () => {
  beforeEach(() => supervisorPinAttempts.clear());
  afterAll(() => supervisorPinAttempts.clear());

  describe('reasonCode reaches the accounting event', () => {
    it.each(['DAMAGE', 'EXPIRY', 'THEFT', 'COUNT_CORRECTION', 'SAMPLE', 'OTHER'])(
      'carries %s into the INVENTORY_ADJUSTMENT payload',
      async (code) => {
        const h = makeHarness();
        await h.svc.adjust(TENANT, REQUESTER, writeOff({ reasonCode: code }));
        const p = payloadOf(h.tx);
        expect(p.reasonCode).toBe(code);
        expect(p.adjustmentType).toBe('STOCK_OUT');
        expect(p.quantity).toBe(-4);
      },
    );

    it('a stock-in that sent no reasonCode carries none (the journal keeps its default)', async () => {
      const h = makeHarness();
      await h.svc.adjust(TENANT, REQUESTER, { productId: 'prod-1', branchId: 'branch-1', quantity: 3, type: 'STOCK_IN' } as any);
      expect(payloadOf(h.tx)).not.toHaveProperty('reasonCode');
      expect(payloadOf(h.tx)).not.toHaveProperty('approvedById');
    });

    it('an "Initial count" stock-in keeps COUNT_CORRECTION off the payload (stays owner capital, not 5060)', async () => {
      const h = makeHarness();
      await h.svc.adjust(TENANT, REQUESTER, {
        productId: 'prod-1', branchId: 'branch-1', quantity: 3, type: 'STOCK_IN',
        reason: 'Initial count', reasonCode: 'COUNT_CORRECTION', paymentMethod: 'OWNER_FUNDED',
      } as any);
      const p = payloadOf(h.tx);
      expect(p).not.toHaveProperty('reasonCode');
      expect(p.paymentMethod).toBe('OWNER_FUNDED');
    });
  });

  describe('valuation', () => {
    it('values a DAMAGE write-off at the shelf avgCost, not the catalog costPrice', async () => {
      const h = makeHarness({ avgCost: 42.5, costPrice: 50 });
      await h.svc.adjust(TENANT, REQUESTER, writeOff({ quantity: -4, reasonCode: 'DAMAGE' }));
      const p = payloadOf(h.tx);
      expect(p.totalValue).toBe(170);   // 4 × 42.50 avgCost (costPrice would say 200)
      expect(p.unitCost).toBe(42.5);
      expect(p.costPrice).toBe(50);     // the catalog cost is still reported
    });

    it('falls back to costPrice when the shelf has no moving-average cost yet', async () => {
      const h = makeHarness({ avgCost: null, costPrice: 50 });
      await h.svc.adjust(TENANT, REQUESTER, writeOff({ quantity: -4 }));
      expect(payloadOf(h.tx).totalValue).toBe(200);
    });

    it('treats an avgCost of 0 as real: stock that cost nothing writes off at nothing', async () => {
      const h = makeHarness({ avgCost: 0, costPrice: 50 });
      await h.svc.adjust(TENANT, REQUESTER, writeOff({ quantity: -4 }));
      expect(payloadOf(h.tx).totalValue).toBe(0);
    });
  });

  describe('the approver is recorded', () => {
    it('on the event payload, the Movement Log line and an audit row', async () => {
      const h = makeHarness();
      await h.svc.adjust(TENANT, REQUESTER, writeOff());

      const p = payloadOf(h.tx);
      expect(p.approvedById).toBe('sup-maria');
      expect(p.approvedByName).toBe('Maria Santos');
      expect(p.approvedByRole).toBe('BRANCH_MANAGER');

      const logData = h.tx.inventoryLog.create.mock.calls[0][0].data;
      expect(logData.reason).toBe('Damaged / spoiled (DAMAGE) — approved by Maria Santos');
      expect(logData.createdById).toBe(REQUESTER);

      expect(h.audit.log).toHaveBeenCalledTimes(1);
      const row = h.audit.log.mock.calls[0][0];
      expect(row).toMatchObject({
        tenantId:    TENANT,
        action:      'SETTING_CHANGED',
        entityType:  'STOCK_WRITE_OFF',
        entityId:    'log-77',
        performedBy: REQUESTER,
      });
      expect(row.after).toMatchObject({
        productId: 'prod-1', reasonCode: 'DAMAGE', quantity: -4, totalValue: 170,
        requestedById: REQUESTER, approvedById: 'sup-maria', approvedByName: 'Maria Santos',
      });
      expect(row.description).toContain('approved by Maria Santos');
    });

    it('writes no write-off audit row for a stock-in', async () => {
      const h = makeHarness();
      await h.svc.adjust(TENANT, REQUESTER, { productId: 'prod-1', branchId: 'branch-1', quantity: 3, type: 'STOCK_IN' } as any);
      expect(h.audit.log).not.toHaveBeenCalled();
    });

    it('keeps the write-off when the audit row fails after commit (no double send)', async () => {
      const h = makeHarness();
      h.audit.log.mockRejectedValueOnce(new Error('db hiccup'));
      await expect(h.svc.adjust(TENANT, REQUESTER, writeOff())).resolves.toBeDefined();
      expect(h.tx.accountingEvent.create).toHaveBeenCalledTimes(1);
    });

    it('builds the log reason from the code alone when no label was sent', () => {
      expect(writeOffLogReason(undefined, 'THEFT', { id: 'x', name: 'Jo', role: 'SALES_LEAD' }))
        .toBe('THEFT — approved by Jo');
    });
  });

  describe('supervisor PIN: shared lock-out', () => {
    it('refuses a wrong PIN and writes nothing', async () => {
      const h = makeHarness();
      await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '0000' })))
        .rejects.toThrow(ForbiddenException);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.audit.log).not.toHaveBeenCalled();
    });

    it('counts each wrong PIN toward the shop-wide limit: after 5, even the right PIN waits', async () => {
      const h = makeHarness();
      for (let i = 0; i < 5; i++) {
        await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '1111' })))
          .rejects.toThrow('Supervisor PIN not recognised.');
      }
      const locked = await h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '4291' })).catch((e) => e);
      expect(locked).toBeInstanceOf(HttpException);
      expect((locked as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(((locked as HttpException).getResponse() as { code: string }).code).toBe('TOO_MANY_TRIES');
      expect(h.prisma.$transaction).not.toHaveBeenCalled();

      // The same counter the till's void/refund PIN uses: it is locked too.
      expect(() => supervisorPinAttempts.startTry(TENANT)).toThrow(HttpException);
    });

    it('a right PIN clears the count', async () => {
      const h = makeHarness();
      for (let i = 0; i < 4; i++) {
        await h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '1111' })).catch(() => undefined);
      }
      await h.svc.adjust(TENANT, REQUESTER, writeOff());           // right PIN
      for (let i = 0; i < 4; i++) {
        await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '1111' })))
          .rejects.toThrow(ForbiddenException);                    // still not locked
      }
    });

    it('does not accept a PIN held by a role that may not approve (a cashier)', async () => {
      const h = makeHarness();
      await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '5862' })))
        .rejects.toThrow('Supervisor PIN not recognised.');
    });
  });

  describe('no self-approval', () => {
    it('refuses the requester\'s own PIN, says why, and writes nothing', async () => {
      const h = makeHarness();
      await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '7351' })))
        .rejects.toThrow('You cannot approve your own write-off');
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
      expect(h.audit.log).not.toHaveBeenCalled();
    });

    it('excludes the requester from the approvers it asks the database for', async () => {
      const h = makeHarness();
      await h.svc.adjust(TENANT, REQUESTER, writeOff());
      const where = h.prisma.user.findMany.mock.calls[0][0].where;
      expect(where.NOT).toEqual({ id: REQUESTER });
      expect(where.role.in).toEqual(['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD']);
    });

    it('never approves as the requester even if the database returned them', async () => {
      const h = makeHarness();
      // A query that ignored the NOT filter would hand the requester back.
      h.prisma.user.findMany.mockResolvedValue(USERS.filter((u) => u.role !== 'CASHIER') as any);
      await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '7351' })))
        .rejects.toThrow(ForbiddenException);
      expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    it('typing your own PIN is not counted as a wrong guess', async () => {
      const h = makeHarness();
      for (let i = 0; i < 6; i++) {
        await expect(h.svc.adjust(TENANT, REQUESTER, writeOff({ supervisorPin: '7351' })))
          .rejects.toThrow('You cannot approve your own write-off');
      }
      // Six own-PIN tries later, another supervisor's PIN still goes through.
      await expect(h.svc.adjust(TENANT, REQUESTER, writeOff())).resolves.toBeDefined();
    });
  });
});
