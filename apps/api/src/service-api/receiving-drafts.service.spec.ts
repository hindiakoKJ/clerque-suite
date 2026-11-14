import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReceivingDraftsService } from './receiving-drafts.service';
import { chargedUnitCost } from './receiving-rules';

/**
 * Confirming a receiving draft is one tap that receives the delivery
 * through Clerque's own receiving (InventoryService.receiveRawMaterial):
 * stock, lot, cost, the journal event and the AP bill on credit. These pin
 * what that tap hands the existing logic, and what it refuses.
 */
describe('ReceivingDraftsService', () => {
  const T = 't1';
  const draftRow = (over: Record<string, unknown> = {}) => ({
    id: 'rd1', tenantId: T, branchId: 'b1', reference: 'AIBA-AP-1042', status: 'DRAFT',
    supplierName: 'Dairy Co', supplierTin: '123-456-789-000', vendorId: 'v1',
    invoiceNumber: 'SI-1042', invoiceDate: new Date('2026-11-19T16:00:00Z'), dueDate: new Date('2026-12-19T16:00:00Z'),
    vatable: true, subtotal: new Prisma.Decimal('2133.57'), vat: new Prisma.Decimal('256.03'), total: new Prisma.Decimal('2389.60'),
    purchaseOrderId: null,
    lines: [
      { itemId: 'rm_1', kind: 'raw', qty: '24.0000', unitCost: '85.5655', lineTotal: '2053.57', uom: 'L', printed: null },
      { itemId: 'rm_2', kind: 'raw', qty: '1000.0000', unitCost: '0.0800', lineTotal: '80.00', uom: 'g', printed: null },
    ],
    result: null,
    ...over,
  });

  function build(opts: { draft?: any; bills?: any[]; vendor?: any; receive?: jest.Mock; taxStatus?: string } = {}) {
    const row = opts.draft === undefined ? draftRow() : opts.draft;
    // The claim: status DRAFT, or (OR) a POSTING row last touched before the stale line.
    const claimable = (where: any) => row && (where.status
      ? where.status === row.status
      : where.OR.some((c: any) => c.status === row.status && (!c.updatedAt || (row.updatedAt ?? new Date()) < c.updatedAt.lt)));
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ taxStatus: opts.taxStatus ?? 'VAT' }) },
      receivingDraft: {
        findFirst: jest.fn(({ where }: any) => Promise.resolve(
          row && where.tenantId === row.tenantId && where.id === row.id && (!where.branchId || where.branchId === row.branchId) ? { ...row } : null)),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(({ where, data }: any) => {
          if (claimable(where)) { row.status = data.status; return Promise.resolve({ count: 1 }); }
          return Promise.resolve({ count: 0 });
        }),
        update: jest.fn(({ data }: any) => { Object.assign(row, data); return Promise.resolve({ ...row }); }),
      },
      vendor: {
        findFirst: jest.fn().mockResolvedValue(opts.vendor === undefined ? { id: 'v1' } : opts.vendor),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'v_new' }),
      },
      aPBill: { findFirst: jest.fn(({ where }: any) => Promise.resolve((opts.bills ?? []).find((b) => b.vendorBillRef === where.vendorBillRef) ?? null)) },
      rawMaterialLot: { findFirst: jest.fn().mockResolvedValue(null) },
      purchaseOrderItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const receive = opts.receive ?? jest.fn().mockResolvedValue({ quantityAfter: 30 });
    const inventory: any = { receiveRawMaterial: receive };
    return { svc: new ReceivingDraftsService(prisma, inventory), prisma, receive, row };
  }

  it('receives every line through the existing receiving: on credit, to the supplier, under the invoice number', async () => {
    const { svc, receive, row } = build();
    const r = await svc.confirm(T, 'rd1', 'u_owner');
    expect(receive).toHaveBeenCalledTimes(2);
    const [tenant, item, dto] = receive.mock.calls[0];
    expect(tenant).toBe(T);
    expect(item).toBe('rm_1');
    expect(dto).toMatchObject({
      branchId: 'b1', quantity: 24, paymentMethod: 'CREDIT', vendorId: 'v1', termsDays: 30,
      referenceNumber: 'SI-1042', receivedAt: '2026-11-20T04:00:00.000Z',
      // The draft's cost is net of VAT; receiving wants what was charged and takes the VAT back out itself.
      costPrice: 95.8334,
    });
    expect(dto).not.toHaveProperty('acceptCostChange');
    expect(r.status).toBe('CONFIRMED');
    expect(row).toMatchObject({ status: 'CONFIRMED', confirmedById: 'u_owner' });
    expect(r.lines.map((l: any) => l.outcome)).toEqual(['POSTED', 'POSTED']);
  });

  it('a non-VAT invoice goes in at its own unit cost', () => {
    expect(chargedUnitCost({ unitCost: '85.5655' }, false)).toBe(85.5655);
    expect(chargedUnitCost({ unitCost: '85.5655' }, true)).toBe(95.8334);
  });

  it('nothing moves until a person confirms: making the service does not receive', () => {
    const { receive } = build();
    expect(receive).not.toHaveBeenCalled();
  });

  it('refuses an invoice received since it was drafted, and puts the draft back', async () => {
    const { svc, receive, row } = build({ bills: [{ vendorBillRef: 'SI-1042', billNumber: 'BILL-000031' }] });
    await expect(svc.confirm(T, 'rd1', 'u_owner')).rejects.toThrow(ConflictException);
    expect(receive).not.toHaveBeenCalled();
    expect(row.status).toBe('DRAFT');
  });

  it('a line refused (closed period, cost ten times off) keeps the draft a DRAFT with the reason; confirming again only adds what is missing', async () => {
    const receive = jest.fn()
      .mockResolvedValueOnce({ quantityAfter: 30 })
      .mockRejectedValueOnce(new BadRequestException('"Beans" is on file at P1.85 per g ... ten times'))
      .mockResolvedValueOnce({ duplicate: true })
      .mockResolvedValueOnce({ quantityAfter: 2000 });
    const { svc, row } = build({ receive });
    const first = await svc.confirm(T, 'rd1', 'u_owner');
    expect(first.status).toBe('DRAFT');
    expect(first.lines[1]).toMatchObject({ outcome: 'FAILED', reason: expect.stringContaining('ten times') });

    // The person ticks "the price really changed" and confirms again.
    const second = await svc.confirm(T, 'rd1', 'u_owner', { acceptCostChange: true });
    expect(second.status).toBe('CONFIRMED');
    expect(second.lines.map((l: any) => l.outcome)).toEqual(['ALREADY_POSTED', 'POSTED']);
    expect(receive.mock.calls[3][2]).toMatchObject({ acceptCostChange: true });
    expect(row.status).toBe('CONFIRMED');
  });

  it('a supplier new to the shop is added from the invoice so the bill is owed to someone', async () => {
    const { svc, prisma, receive } = build({ draft: draftRow({ vendorId: null }), vendor: null });
    await svc.confirm(T, 'rd1', 'u_owner');
    expect(prisma.vendor.create).toHaveBeenCalledWith(expect.objectContaining({ data: { tenantId: T, name: 'Dairy Co', tin: '123-456-789-000' } }));
    expect(receive.mock.calls[0][2].vendorId).toBe('v_new');
    // kept on the draft: a confirm again uses this supplier, never a second new one
    expect(prisma.receivingDraft.update).toHaveBeenCalledWith({ where: { id: 'rd1' }, data: { vendorId: 'v_new' } });
  });

  it("a VAT-registered shop does not take in a non-VAT supplier's invoice here (it would book input VAT that does not exist); a non-VAT shop does", async () => {
    const plain = () => draftRow({ vatable: false, vat: new Prisma.Decimal('0'), total: new Prisma.Decimal('2133.57') });
    const vatShop = build({ draft: plain() });
    await expect(vatShop.svc.confirm(T, 'rd1', 'u_owner')).rejects.toThrow(/VAT-registered/);
    expect(vatShop.receive).not.toHaveBeenCalled();
    expect(vatShop.row.status).toBe('DRAFT');
    const plainShop = build({ draft: plain(), taxStatus: 'NON_VAT' });
    await expect(plainShop.svc.confirm(T, 'rd1', 'u_owner')).resolves.toMatchObject({ status: 'CONFIRMED' });
    expect(plainShop.receive.mock.calls[0][2].costPrice).toBe(85.5655);
  });

  it("a branch manager sees and acts on their own branch's deliveries only", async () => {
    const { svc, receive, prisma } = build();
    await expect(svc.confirm(T, 'rd1', 'u_mgr_b2', { branchId: 'b2' })).rejects.toThrow(NotFoundException);
    await expect(svc.cancel(T, 'rd1', 'b2')).rejects.toThrow(NotFoundException);
    await expect(svc.getNamed(T, 'rd1', 'b2')).rejects.toThrow(NotFoundException);
    expect(receive).not.toHaveBeenCalled();
    await svc.list(T, 'DRAFT', 'b2');
    expect(prisma.receivingDraft.findMany.mock.calls[0][0].where).toMatchObject({ tenantId: T, branchId: 'b2' });
    await expect(svc.confirm(T, 'rd1', 'u_mgr_b1', { branchId: 'b1' })).resolves.toMatchObject({ status: 'CONFIRMED' });
  });

  it('a confirm that died long ago (POSTING for over ten minutes) is taken over; lines already in are not received twice', async () => {
    const receive = jest.fn().mockResolvedValueOnce({ duplicate: true }).mockResolvedValueOnce({ quantityAfter: 2000 });
    const { svc, row } = build({
      draft: draftRow({ status: 'POSTING', updatedAt: new Date(Date.now() - 11 * 60 * 1000) }),
      // its first line is in already: the duplicate check would refuse a first try
      bills: [{ vendorBillRef: 'SI-1042', billNumber: 'BILL-000031' }], receive,
    });
    const r = await svc.confirm(T, 'rd1', 'u_owner');
    expect(r.status).toBe('CONFIRMED');
    expect(r.lines.map((l: any) => l.outcome)).toEqual(['ALREADY_POSTED', 'POSTED']);
    expect(row.status).toBe('CONFIRMED');
    const fresh = build({ draft: draftRow({ status: 'POSTING', updatedAt: new Date() }) });
    await expect(fresh.svc.confirm(T, 'rd1', 'u_owner')).rejects.toThrow(ConflictException);
  });

  it('a machine never confirms', async () => {
    const { svc, receive } = build();
    await expect(svc.confirm(T, 'rd1', 'apikey:key1')).rejects.toThrow(ForbiddenException);
    await expect(svc.confirm(T, 'rd1', '')).rejects.toThrow(ForbiddenException);
    expect(receive).not.toHaveBeenCalled();
  });

  it("another tenant's draft is not found", async () => {
    const { svc } = build();
    await expect(svc.confirm('t2', 'rd1', 'u_other')).rejects.toThrow(NotFoundException);
  });

  it('two taps at once: the second is refused, nothing received twice', async () => {
    const { svc, row } = build();
    row.status = 'POSTING';
    await expect(svc.confirm(T, 'rd1', 'u_owner')).rejects.toThrow(ConflictException);
  });

  it('a received or discarded draft cannot be confirmed; a part-received one cannot be discarded', async () => {
    await expect(build({ draft: draftRow({ status: 'CONFIRMED' }) }).svc.confirm(T, 'rd1', 'u')).rejects.toThrow(/already received/);
    await expect(build({ draft: draftRow({ status: 'CANCELLED' }) }).svc.confirm(T, 'rd1', 'u')).rejects.toThrow(/discarded/);
    await expect(build({ draft: draftRow({ result: [{ itemId: 'rm_1', outcome: 'POSTED' }] }) }).svc.cancel(T, 'rd1')).rejects.toThrow(BadRequestException);
    await expect(build().svc.cancel(T, 'rd1')).resolves.toEqual({ id: 'rd1', status: 'CANCELLED' });
  });

  it('the Deliveries screen gets the branch and the matched item names, read inside the tenant only', async () => {
    const { svc, prisma } = build();
    prisma.receivingDraft.findMany.mockResolvedValue([draftRow()]);
    prisma.rawMaterial = { findMany: jest.fn().mockResolvedValue([{ id: 'rm_1', name: 'Fresh milk', unit: 'L' }]) };
    prisma.branch = { findMany: jest.fn().mockResolvedValue([{ id: 'b1', name: 'Main' }]) };
    const [d] = await svc.list(T, 'DRAFT');
    // "To confirm" includes a draft caught mid-confirm, so a stuck one stays in sight
    expect(prisma.receivingDraft.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: T, status: { in: ['DRAFT', 'POSTING'] } } }));
    expect(prisma.rawMaterial.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, id: { in: ['rm_1', 'rm_2'] } });
    expect(prisma.branch.findMany.mock.calls[0][0].where).toEqual({ tenantId: T, id: { in: ['b1'] } });
    expect(d.branchName).toBe('Main');
    expect(d.lines.map((l: any) => l.itemName)).toEqual(['Fresh milk', null]);
    expect(await build().svc.list(T)).toEqual([]);
  });
});
