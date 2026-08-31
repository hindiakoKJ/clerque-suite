import {
  BadRequestException, ForbiddenException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryService } from '../inventory/inventory.service';

export interface PurchaseOrderLineInput {
  rawMaterialId?: string | null;
  productId?:     string | null;
  description:    string;
  qtyOrdered:     number;
  unitCost:       number;
}

export interface CreatePurchaseOrderDto {
  branchId?:   string | null;
  vendorId?:   string | null;
  orderDate:   string;
  expectedAt?: string | null;
  notes?:      string;
  taxCents?:   number;
  items:       PurchaseOrderLineInput[];
}

export interface UpdatePurchaseOrderDto {
  branchId?:   string | null;
  vendorId?:   string | null;
  orderDate?:  string;
  expectedAt?: string | null;
  notes?:      string;
  taxCents?:   number;
  items?:      PurchaseOrderLineInput[]; // full replace when provided
}

export interface ReceiveLine {
  itemId:      string;
  qtyReceived: number;
  /** Optional expiration date for the lot when raw material is perishable. */
  expirationDate?: string | null;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    /*
      Receiving stock is one behaviour and it lives in one place.

      This module reimplemented it -- create a lot, bump the quantity -- and
      so skipped everything the real path does: the accounting event, the
      weighted-average blend, the recipe re-cost, the AP bill, the period
      lock and the idempotency check. Stock arrived and the books never
      heard about it.
    */
    private readonly inventory: InventoryService,
  ) {}

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private toDate(s: string | undefined | null, label: string): Date | null {
    if (s == null) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`${label} is not a valid date.`);
    }
    return d;
  }

  /** Compute subtotal/total in cents from a set of input lines. */
  private money(items: PurchaseOrderLineInput[], taxCents: number) {
    let subtotalCents = 0;
    const lineTotals: number[] = [];
    for (const it of items) {
      if (!(it.qtyOrdered > 0)) {
        throw new BadRequestException('Each PO line must have qtyOrdered > 0.');
      }
      if (it.unitCost < 0) {
        throw new BadRequestException('Unit cost cannot be negative.');
      }
      if (!it.rawMaterialId && !it.productId) {
        throw new BadRequestException('Each PO line must reference a rawMaterialId or productId.');
      }
      if (it.rawMaterialId && it.productId) {
        throw new BadRequestException('A PO line cannot reference both a raw material and a product.');
      }
      // PO line totals are stored as integer cents — round to nearest cent.
      const line = Math.round(it.qtyOrdered * it.unitCost * 100);
      lineTotals.push(line);
      subtotalCents += line;
    }
    return {
      subtotalCents,
      taxCents:   Math.max(0, Math.round(taxCents || 0)),
      totalCents: subtotalCents + Math.max(0, Math.round(taxCents || 0)),
      lineTotals,
    };
  }

  /** Tenant-scoped auto-number: PO-{YYYY}-{seq} where seq resets per year. */
  private async nextPoNumber(tenantId: string, year: number, tx: Prisma.TransactionClient): Promise<string> {
    // Find the highest existing seq for this tenant + year by scanning the
    // numeric tail of `poNumber`. We intentionally avoid a NumberingCounter
    // dependency to keep this module self-contained — the (tenantId, poNumber)
    // unique index guarantees collision detection inside the transaction.
    const prefix = `PO-${year}-`;
    const last = await tx.purchaseOrder.findFirst({
      where:   { tenantId, poNumber: { startsWith: prefix } },
      orderBy: { poNumber: 'desc' },
      select:  { poNumber: true },
    });
    let next = 1;
    if (last?.poNumber) {
      const seqStr = last.poNumber.slice(prefix.length);
      const n      = parseInt(seqStr, 10);
      if (!Number.isNaN(n)) next = n + 1;
    }
    return `${prefix}${String(next).padStart(6, '0')}`;
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────

  async create(tenantId: string, createdById: string, dto: CreatePurchaseOrderDto) {
    if (!dto.items?.length) throw new BadRequestException('PO must have at least one line.');

    const orderDate  = this.toDate(dto.orderDate, 'orderDate')!;
    const expectedAt = this.toDate(dto.expectedAt ?? null, 'expectedAt');
    const m          = this.money(dto.items, dto.taxCents ?? 0);

    return this.prisma.$transaction(async (tx) => {
      // Branch / vendor ownership checks
      if (dto.branchId) {
        const b = await tx.branch.findFirst({ where: { id: dto.branchId, tenantId }, select: { id: true } });
        if (!b) throw new BadRequestException('Branch does not belong to your tenant.');
      }
      if (dto.vendorId) {
        const v = await tx.vendor.findFirst({ where: { id: dto.vendorId, tenantId }, select: { id: true } });
        if (!v) throw new BadRequestException('Vendor does not belong to your tenant.');
      }

      const poNumber = await this.nextPoNumber(tenantId, orderDate.getFullYear(), tx);

      return tx.purchaseOrder.create({
        data: {
          tenantId,
          branchId:      dto.branchId ?? null,
          vendorId:      dto.vendorId ?? null,
          poNumber,
          orderDate,
          expectedAt:    expectedAt,
          status:        PurchaseOrderStatus.DRAFT,
          subtotalCents: m.subtotalCents,
          taxCents:      m.taxCents,
          totalCents:    m.totalCents,
          notes:         dto.notes ?? null,
          createdById,
          items: {
            create: dto.items.map((it, idx) => ({
              rawMaterialId:  it.rawMaterialId ?? null,
              productId:      it.productId ?? null,
              description:    it.description,
              qtyOrdered:     new Prisma.Decimal(it.qtyOrdered),
              unitCost:       new Prisma.Decimal(it.unitCost),
              lineTotalCents: m.lineTotals[idx]!,
            })),
          },
        },
        include: { items: true, vendor: true, branch: true },
      });
    });
  }

  async list(tenantId: string, status?: PurchaseOrderStatus) {
    return this.prisma.purchaseOrder.findMany({
      where:   { tenantId, ...(status ? { status } : {}) },
      orderBy: { orderDate: 'desc' },
      include: { vendor: { select: { id: true, name: true } }, branch: { select: { id: true, name: true } } },
      take:    500,
    });
  }

  async get(tenantId: string, id: string) {
    const po = await this.prisma.purchaseOrder.findFirst({
      where:   { id, tenantId },
      include: { items: true, vendor: true, branch: true },
    });
    if (!po) throw new NotFoundException('Purchase order not found.');

    // PurchaseOrderItem has no FK relation to RawMaterial / Product — resolve
    // display names in a separate batched query so the detail page can render
    // human-readable rows without an extra round trip per line.
    const rawIds = Array.from(new Set(po.items.map((i) => i.rawMaterialId).filter((x): x is string => !!x)));
    const prodIds = Array.from(new Set(po.items.map((i) => i.productId).filter((x): x is string => !!x)));
    const [rawMats, products] = await Promise.all([
      rawIds.length
        ? this.prisma.rawMaterial.findMany({ where: { id: { in: rawIds } }, select: { id: true, name: true, unit: true } })
        : Promise.resolve([] as { id: string; name: string; unit: string }[]),
      prodIds.length
        ? this.prisma.product.findMany({ where: { id: { in: prodIds } }, select: { id: true, name: true, sku: true } })
        : Promise.resolve([] as { id: string; name: string; sku: string | null }[]),
    ]);
    const rawById  = new Map(rawMats.map((r) => [r.id, r]));
    const prodById = new Map(products.map((p) => [p.id, p]));

    return {
      ...po,
      items: po.items.map((it) => ({
        ...it,
        rawMaterial: it.rawMaterialId ? rawById.get(it.rawMaterialId) ?? null : null,
        product:     it.productId     ? prodById.get(it.productId)     ?? null : null,
      })),
    };
  }

  async update(tenantId: string, id: string, dto: UpdatePurchaseOrderDto) {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where:  { id, tenantId },
      select: { id: true, status: true, taxCents: true },
    });
    if (!existing) throw new NotFoundException('Purchase order not found.');
    if (existing.status !== PurchaseOrderStatus.DRAFT) {
      throw new ForbiddenException('Only DRAFT purchase orders can be edited.');
    }

    const orderDate  = dto.orderDate  ? this.toDate(dto.orderDate, 'orderDate')! : undefined;
    const expectedAt = dto.expectedAt !== undefined ? this.toDate(dto.expectedAt, 'expectedAt') : undefined;

    return this.prisma.$transaction(async (tx) => {
      if (dto.branchId) {
        const b = await tx.branch.findFirst({ where: { id: dto.branchId, tenantId }, select: { id: true } });
        if (!b) throw new BadRequestException('Branch does not belong to your tenant.');
      }
      if (dto.vendorId) {
        const v = await tx.vendor.findFirst({ where: { id: dto.vendorId, tenantId }, select: { id: true } });
        if (!v) throw new BadRequestException('Vendor does not belong to your tenant.');
      }

      let money: ReturnType<typeof this.money> | null = null;
      if (dto.items) {
        if (!dto.items.length) throw new BadRequestException('PO must have at least one line.');
        money = this.money(dto.items, dto.taxCents ?? existing.taxCents);
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.branchId !== undefined ? { branchId: dto.branchId } : {}),
          ...(dto.vendorId !== undefined ? { vendorId: dto.vendorId } : {}),
          ...(orderDate ? { orderDate } : {}),
          ...(expectedAt !== undefined ? { expectedAt } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(money ? {
            subtotalCents: money.subtotalCents,
            taxCents:      money.taxCents,
            totalCents:    money.totalCents,
            items: {
              create: dto.items!.map((it, idx) => ({
                rawMaterialId:  it.rawMaterialId ?? null,
                productId:      it.productId ?? null,
                description:    it.description,
                qtyOrdered:     new Prisma.Decimal(it.qtyOrdered),
                unitCost:       new Prisma.Decimal(it.unitCost),
                lineTotalCents: money!.lineTotals[idx]!,
              })),
            },
          } : {}),
        },
        include: { items: true },
      });
    });
  }

  /** DRAFT → ORDERED. No financial side-effects yet; receive creates the lots. */
  async submit(tenantId: string, id: string) {
    const existing = await this.prisma.purchaseOrder.findFirst({
      where:  { id, tenantId },
      select: { id: true, status: true, items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundException('Purchase order not found.');
    if (existing.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException(`Cannot submit a PO in status ${existing.status}.`);
    }
    if (!existing.items.length) {
      throw new BadRequestException('Cannot submit an empty PO.');
    }
    return this.prisma.purchaseOrder.update({
      where: { id },
      data:  { status: PurchaseOrderStatus.ORDERED },
    });
  }

  /**
   * Record receipts against PO lines.
   *
   * ORDERING posts nothing, deliberately: a purchase order is a commitment,
   * not a transaction. Nothing has changed hands, so there is no entry to
   * make. RECEIVING is the moment the books care about, and it is the same
   * moment whether the goods came the same day or three days later.
   *
   * The stock movement itself is delegated to InventoryService rather than
   * reimplemented here. This method used to create a lot and bump the
   * quantity directly, which meant a PO receipt produced NO accounting event,
   * NO weighted-average blend, NO recipe re-cost, NO AP bill and NO period
   * check. Stock landed on the shelf for free: COGS was understated when it
   * sold, and the money owed to the supplier was never recorded.
   *
   * The PO's own bookkeeping (qtyReceived, status) stays in a transaction;
   * the stock receives run after it commits, because receiveRawMaterial opens
   * its own. Same shape as the Procure buy-list receive.
   */
  async receive(tenantId: string, id: string, lines: ReceiveLine[]) {
    if (!lines?.length) throw new BadRequestException('No lines provided to receive.');

    const toStock: Array<{
      rawMaterialId: string;
      quantity:      number;
      unitCost:      number;
      expirationDate: string | null;
      reference:     string;
      itemId:        string;
    }> = [];
    let branchId = '';
    let vendorId: string | null = null;

    const po0 = await this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findFirst({
        where:   { id, tenantId },
        include: { items: true },
      });
      if (!po) throw new NotFoundException('Purchase order not found.');
      if (po.status !== PurchaseOrderStatus.ORDERED && po.status !== PurchaseOrderStatus.PARTIAL) {
        throw new BadRequestException(`Cannot receive against a PO in status ${po.status}.`);
      }
      if (!po.branchId) {
        throw new BadRequestException('PO must have a destination branch before receiving.');
      }

      const byId = new Map(po.items.map((it) => [it.id, it]));

      for (const line of lines) {
        if (!(line.qtyReceived > 0)) {
          throw new BadRequestException(`qtyReceived must be > 0 for item ${line.itemId}.`);
        }
        const item = byId.get(line.itemId);
        if (!item) throw new BadRequestException(`PO line ${line.itemId} not found on this PO.`);

        const newQtyReceived = Number(item.qtyReceived) + line.qtyReceived;
        if (newQtyReceived > Number(item.qtyOrdered) + 1e-6) {
          throw new BadRequestException(
            `Receiving ${line.qtyReceived} would exceed ordered qty ${item.qtyOrdered} for item ${line.itemId}.`,
          );
        }

        await tx.purchaseOrderItem.update({
          where: { id: item.id },
          data:  { qtyReceived: new Prisma.Decimal(newQtyReceived) },
        });

        /*
          Collected, not written. The actual stock movement goes through
          InventoryService once this transaction commits, so it gets the
          accounting event, the WAC blend, the recipe re-cost, the AP bill and
          the period lock -- none of which happened when this module wrote the
          rows itself.
        */
        if (item.rawMaterialId) {
          const expirationDate = line.expirationDate ? new Date(line.expirationDate) : null;
          if (expirationDate && Number.isNaN(expirationDate.getTime())) {
            throw new BadRequestException('expirationDate is not a valid date.');
          }
          toStock.push({
            rawMaterialId:  item.rawMaterialId,
            quantity:       line.qtyReceived,
            unitCost:       Number(item.unitCost),
            expirationDate: line.expirationDate ?? null,
            /*
              Unique per receipt STEP, not per line: a PO line is often
              received in instalments, and keying on the line alone would make
              the second delivery look like a repeat of the first. The
              cumulative quantity moves with each step and repeats only when
              the same step is submitted twice, which is exactly what should
              be caught.
            */
            reference: `${po.poNumber}-${item.id.slice(-6)}-${newQtyReceived}`,
            itemId:    item.id,
          });
        }
        // Product-typed PO lines: deferred — wire to InventoryLot/InventoryItem
        // when finished-goods receipts go through the PO flow.
      }

      // Recompute aggregate fulfillment after the writes.
      const refreshed = await tx.purchaseOrderItem.findMany({
        where:  { purchaseOrderId: id },
        select: { qtyOrdered: true, qtyReceived: true },
      });
      const fullyReceived = refreshed.every((r) => Number(r.qtyReceived) >= Number(r.qtyOrdered) - 1e-6);
      const anyReceived   = refreshed.some((r)  => Number(r.qtyReceived) > 0);
      const nextStatus    = fullyReceived
        ? PurchaseOrderStatus.RECEIVED
        : anyReceived
          ? PurchaseOrderStatus.PARTIAL
          : po.status;

      branchId = po.branchId;
      vendorId = po.vendorId ?? null;

      return tx.purchaseOrder.update({
        where:   { id },
        data:    { status: nextStatus },
        include: { items: true },
      });
    });

    /*
      Now move the stock properly, one line at a time.

      CREDIT when the PO names a vendor, because that is what a purchase order
      to a supplier IS -- goods now, money later -- and it is what raises the
      AP bill so the debt is visible and payable. Without a vendor there is
      nobody to owe, so it is treated as owner-funded, exactly as the receive
      form does.

      A line that fails is reported rather than thrown: the PO's quantities are
      already committed, and rolling the whole receipt back over one bad line
      would lose the deliveries that were fine. The caller sees which lines
      reached the books and which did not.
    */
    const posted: Array<{ rawMaterialId: string; quantity: number }> = [];
    const failed: Array<{ rawMaterialId: string; reason: string }> = [];
    for (const s of toStock) {
      try {
        await this.inventory.receiveRawMaterial(tenantId, s.rawMaterialId, {
          branchId,
          quantity:        s.quantity,
          costPrice:       s.unitCost,
          paymentMethod:   vendorId ? 'CREDIT' : 'OWNER_FUNDED',
          ...(vendorId ? { vendorId } : {}),
          referenceNumber: s.reference,
          ...(s.expirationDate ? { expirationDate: s.expirationDate } : {}),
          purchaseOrderItemId: s.itemId,
        } as never);
        posted.push({ rawMaterialId: s.rawMaterialId, quantity: s.quantity });
      } catch (err) {
        failed.push({
          rawMaterialId: s.rawMaterialId,
          reason: err instanceof Error ? err.message : 'Could not post this line to stock.',
        });
      }
    }

    return { ...po0, posted, failed };
  }
}
