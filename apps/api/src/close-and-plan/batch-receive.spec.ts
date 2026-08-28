import { CloseAndPlanService } from './close-and-plan.service';

/**
 * A batch receive has to actually receive.
 *
 * It used to create RawMaterialLot rows and stop, under a comment claiming
 * "WAC recompute and stocked-in event go through the existing InventoryService
 * pathway (not duplicated here)" — which was the opposite of what the code
 * did. It called nothing. So an evening's deliveries produced lot rows while
 * stock never rose, WAC never moved, recipes kept their old costs, the
 * purchase never reached the books, and none of it checked the period lock.
 *
 * Nothing errored. That is what made it worth a test rather than a fix alone.
 */
describe('CloseAndPlanService — batchReceive delegates to the real receive path', () => {
  const TENANT = 't1';
  const BRANCH = 'b1';
  const USER   = 'u1';

  function build(opts: { receiveThrows?: Record<string, string> } = {}) {
    const received: Array<{ rawMaterialId: string; dto: any }> = [];
    const prisma: any = {
      rawMaterial: {
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve((where.id.in as string[]).map((id) => ({ id, name: id })))),
      },
      branch: { findFirst: jest.fn().mockResolvedValue({ id: BRANCH }) },
      rawMaterialLot: {
        findFirst: jest.fn().mockResolvedValue(null),   // duplicate detection
        findMany:  jest.fn(() => Promise.resolve(
          received.map((r, i) => ({
            id: 'lot-' + i, rawMaterialId: r.rawMaterialId, stickerTier: 'NORMAL',
            qtyRemaining: 1, expirationDate: null, receivedAt: new Date(),
          })))),
        // sticker-tier recompute writes here after a receive
        update: jest.fn(() => Promise.resolve({})),
      },
      $transaction: jest.fn((fn: any) => fn(prisma)),
    };
    const inventory: any = {
      receiveRawMaterial: jest.fn((tenantId: string, rawMaterialId: string, dto: any) => {
        const boom = opts.receiveThrows?.[rawMaterialId];
        if (boom) return Promise.reject(new Error(boom));
        received.push({ rawMaterialId, dto });
        return Promise.resolve({ ok: true });
      }),
    };
    const svc = new CloseAndPlanService(prisma, inventory) as any;
    return { svc, inventory, received, prisma };
  }

  const line = (id: string, over: Record<string, unknown> = {}) => ({
    rawMaterialId: id, qtyReceived: 5, unitCost: 100, dupeOverride: true, ...over,
  });

  it('routes every line through receiveRawMaterial', async () => {
    const { svc, inventory } = build();
    await svc.batchReceive(TENANT, BRANCH, USER, [line('rm1'), line('rm2')]);

    // the only path that moves stock, blends WAC, re-costs recipes, queues the
    // journal entry and checks the period lock
    expect(inventory.receiveRawMaterial).toHaveBeenCalledTimes(2);
  });

  it('never writes a lot row by hand any more', async () => {
    // creating the lot itself is exactly what skipped everything else, so the
    // mock deliberately offers no create(): if the service still called it,
    // this would throw rather than quietly pass.
    const { svc, prisma } = build();
    await svc.batchReceive(TENANT, BRANCH, USER, [line('rm1')]);

    expect(prisma.rawMaterialLot.create).toBeUndefined();
  });

  it('passes the invoice date through, so the period lock sees the real date', async () => {
    // A delivery keyed the next morning belongs to the day it arrived. The old
    // code hardcoded new Date() on the lot.
    const { svc, received } = build();
    await svc.batchReceive(TENANT, BRANCH, USER,
      [line('rm1', { receivedAt: '2026-08-20' })]);

    expect(received[0].dto.receivedAt).toBe('2026-08-20');
  });

  it('carries the cost and quantity to the receive, not just to a lot', async () => {
    const { svc, received } = build();
    await svc.batchReceive(TENANT, BRANCH, USER,
      [line('rm1', { qtyReceived: 12, unitCost: 88.5 })]);

    expect(received[0].dto.quantity).toBe(12);
    expect(received[0].dto.costPrice).toBe(88.5);
  });

  it('fails one line without losing the rest of the delivery', async () => {
    // A locked period on the last row must not send someone back to re-key
    // the other nine by hand.
    const { svc, inventory } = build({
      receiveThrows: { rm2: 'Accounting period for 2026-07 is closed.' },
    });
    const res = await svc.batchReceive(TENANT, BRANCH, USER,
      [line('rm1'), line('rm2'), line('rm3')]);

    expect(inventory.receiveRawMaterial).toHaveBeenCalledTimes(3);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].rawMaterialId).toBe('rm2');
    expect(res.failed[0].reason).toMatch(/closed/i);
  });

  it('still refuses lines from another tenant', async () => {
    const { svc, prisma } = build();
    prisma.rawMaterial.findMany.mockResolvedValueOnce([{ id: 'rm1', name: 'x' }]);
    await expect(
      svc.batchReceive(TENANT, BRANCH, USER, [line('rm1'), line('stolen')]),
    ).rejects.toThrow(/do not belong/i);
  });
});
