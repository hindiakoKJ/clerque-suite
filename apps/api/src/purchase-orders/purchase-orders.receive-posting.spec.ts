import { PurchaseOrdersService } from './purchase-orders.service';

/**
 * Receiving against a PO has to reach the books — as CASH by default.
 *
 * Two things were wrong. The receive wrote a lot and bumped the quantity
 * directly, so it produced no accounting event, no weighted-average blend, no
 * recipe re-cost and no period check: stock landed on the shelf for free.
 *
 * And the first fix for that assumed a named vendor meant credit terms. It
 * does not. Cafe Carolina buys everything for cash or on Shopee, and Shopee is
 * prepaid — the money leaves when the order is placed, days before the parcel
 * arrives. Defaulting to CREDIT would invent an Accounts Payable balance the
 * shop does not owe, and an AP bill nobody will ever pay off, which then sits
 * on the balance sheet forever because no payment exists to clear it.
 *
 * Ordering still posts nothing at all. A purchase order is a commitment, not a
 * transaction.
 */
describe('PurchaseOrdersService.receive — reaching the books', () => {
  const TENANT = 't1';
  const PO = 'po1';
  const ITEM = 'item1';
  const RM = 'rm-beans';
  const BRANCH = 'b1';
  const VENDOR = 'v1';

  function build() {
    const received: any[] = [];
    const tx: any = {
      purchaseOrder: {
        findFirst: jest.fn().mockResolvedValue({
          id: PO, tenantId: TENANT, branchId: BRANCH, vendorId: VENDOR,
          poNumber: 'PO-2026-000001', status: 'ORDERED',
          items: [{ id: ITEM, rawMaterialId: RM, qtyOrdered: 1000, qtyReceived: 0, unitCost: 2.24 }],
        }),
        update: jest.fn().mockResolvedValue({ id: PO, status: 'RECEIVED', items: [] }),
      },
      purchaseOrderItem: {
        update:   jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([{ qtyOrdered: 1000, qtyReceived: 1000 }]),
      },
      // Deliberately absent: rawMaterialLot / rawMaterialInventory. If this
      // method still wrote stock itself, these would throw.
    };
    const prisma: any = { $transaction: jest.fn((fn: any) => fn(tx)) };
    const inventory: any = {
      receiveRawMaterial: jest.fn((_t: string, rmId: string, dto: any) => {
        received.push({ rawMaterialId: rmId, ...dto });
        return Promise.resolve({ quantity: dto.quantity });
      }),
    };
    const svc = new PurchaseOrdersService(prisma, inventory) as any;
    return { svc, tx, received };
  }

  const line = [{ itemId: ITEM, qtyReceived: 1000 }];

  it('routes the receipt through the real stock path', async () => {
    const { svc, received } = build();
    await svc.receive(TENANT, PO, line);
    expect(received).toHaveLength(1);
    expect(received[0].rawMaterialId).toBe(RM);
    expect(received[0].quantity).toBe(1000);
  });

  it('carries the delivery cost, so the weighted average can blend', async () => {
    const { svc, received } = build();
    await svc.receive(TENANT, PO, line);
    expect(received[0].costPrice).toBe(2.24);
  });

  it('treats the delivery as CASH unless told otherwise', async () => {
    // The shop buys for cash or on Shopee. Both are money already gone by the
    // time the goods land.
    const { svc, received } = build();
    await svc.receive(TENANT, PO, line);
    expect(received[0].paymentMethod).toBe('CASH');
  });

  it('raises no payable for a cash delivery, even with a vendor named', async () => {
    // A vendor is who you bought from, not who you owe. Passing the vendor on
    // a cash receipt is what would create the AP bill.
    const { svc, received } = build();
    await svc.receive(TENANT, PO, line);
    expect(received[0].vendorId).toBeUndefined();
  });

  it('still supports real terms when someone says so', async () => {
    const { svc, received } = build();
    await svc.receive(TENANT, PO, line, 'CREDIT');
    expect(received[0].paymentMethod).toBe('CREDIT');
    expect(received[0].vendorId).toBe(VENDOR);
  });

  it('keys each receipt STEP, so a part delivery is not read as a repeat', async () => {
    // A PO line is often received in instalments; keying on the line alone
    // would make the second parcel look like a duplicate of the first.
    const { svc, received } = build();
    await svc.receive(TENANT, PO, line);
    expect(received[0].referenceNumber).toContain('PO-2026-000001');
    expect(received[0].referenceNumber).toContain('1000');
  });

  it('reports a line that could not be posted instead of losing the whole receipt', async () => {
    // The PO quantities are already committed; throwing would discard the
    // deliveries that were fine.
    const { svc } = build();
    const svcAny = svc as any;
    svcAny.inventory.receiveRawMaterial = jest.fn().mockRejectedValue(new Error('period is closed'));
    const res = await svc.receive(TENANT, PO, line);
    expect(res.failed).toHaveLength(1);
    expect(res.failed[0].reason).toMatch(/period is closed/);
  });

  it('refuses to receive against a PO that was never ordered', async () => {
    const { svc, tx } = build();
    tx.purchaseOrder.findFirst.mockResolvedValue({
      id: PO, tenantId: TENANT, branchId: BRANCH, status: 'DRAFT', poNumber: 'PO-1', items: [],
    });
    await expect(svc.receive(TENANT, PO, line)).rejects.toThrow(/Cannot receive/);
  });

  it('refuses to receive more than was ordered', async () => {
    const { svc } = build();
    await expect(svc.receive(TENANT, PO, [{ itemId: ITEM, qtyReceived: 5000 }]))
      .rejects.toThrow(/exceed ordered qty/);
  });
});
