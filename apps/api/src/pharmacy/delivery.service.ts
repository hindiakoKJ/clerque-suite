/**
 * Sprint 19 — Supplier delivery receiving.
 *
 * Pharmacies receive stock from distributors (Mercury, Watsons-DSI, Zuellig,
 * Pharma) and need an atomic flow that:
 *   1. Records the DR (DeliveryReceipt + items)
 *   2. Creates ProductLot rows per line (FDA Circular 13-2014 trail)
 *   3. Updates InventoryItem at the branch
 *
 * The optional apBillId link lets the owner manually post the AP bill from
 * /ledger/ap/bills and tie it back; future sprint auto-posts. WAC (avgCost)
 * is updated using the standard moving-average formula on every receipt.
 */
import {
  Injectable, BadRequestException, NotFoundException, ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { Prisma } from '@prisma/client';

export interface CreateDeliveryDto {
  vendorId:    string;
  branchId:    string;
  drNumber:    string;
  notes?:      string;
  items: Array<{
    productId: string;
    lotNumber: string;
    expiresAt: string; // ISO date
    quantity:  number;
    costPrice: number;
  }>;
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma:    PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  /**
   * Best-effort lookup of an Inventory asset account for auto-posting the AP
   * bill in DRAFT. Tries PFRS-for-SMEs standard code 1310 first; falls back
   * to any ASSET account whose name contains "inventory" / "merchandise".
   * Returns null if nothing reasonable exists — caller skips the auto-bill
   * in that case (delivery still posts to inventory + WAC; the owner can
   * create the bill manually).
   */
  private async findInventoryAccount(
    tx:       Prisma.TransactionClient,
    tenantId: string,
  ): Promise<string | null> {
    const byCode = await tx.account.findFirst({
      where:  { tenantId, code: '1310', isActive: true, type: 'ASSET' },
      select: { id: true },
    });
    if (byCode) return byCode.id;
    const byName = await tx.account.findFirst({
      where: {
        tenantId, isActive: true, type: 'ASSET',
        OR: [
          { name: { contains: 'inventory',   mode: 'insensitive' } },
          { name: { contains: 'merchandise', mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return byName?.id ?? null;
  }

  private addDays(date: Date, days: number): Date {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  list(tenantId: string, q?: { branchId?: string; take?: number; skip?: number }) {
    return this.prisma.deliveryReceipt.findMany({
      where: {
        tenantId,
        ...(q?.branchId ? { branchId: q.branchId } : {}),
      },
      orderBy: { receivedAt: 'desc' },
      take:    Math.min(q?.take ?? 50, 200),
      skip:    q?.skip ?? 0,
      include: {
        vendor: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        items:  {
          select: {
            id: true, productId: true, lotNumber: true, expiresAt: true,
            quantity: true, costPrice: true,
            product: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  async getOne(tenantId: string, id: string) {
    const receipt = await this.prisma.deliveryReceipt.findFirst({
      where:  { id, tenantId },
      include: {
        vendor: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } },
        items: {
          include: {
            product:    { select: { id: true, name: true, genericName: true, brandName: true } },
            productLot: { select: { id: true, lotNumber: true, expiresAt: true } },
          },
        },
      },
    });
    if (!receipt) throw new NotFoundException('Delivery receipt not found.');
    return receipt;
  }

  async create(tenantId: string, receivedById: string, dto: CreateDeliveryDto) {
    if (!dto.vendorId)  throw new BadRequestException('vendorId is required.');
    if (!dto.branchId)  throw new BadRequestException('branchId is required.');
    if (!dto.drNumber?.trim()) throw new BadRequestException('drNumber is required.');
    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('At least one line item is required.');
    }

    // Validate vendor + branch belong to this tenant.
    const [vendor, branch] = await Promise.all([
      this.prisma.vendor.findFirst({
        where:  { id: dto.vendorId, tenantId },
        select: { id: true, name: true },
      }),
      this.prisma.branch.findFirst({ where: { id: dto.branchId, tenantId }, select: { id: true } }),
    ]);
    if (!vendor) throw new BadRequestException('Vendor does not belong to this tenant.');
    if (!branch) throw new BadRequestException('Branch does not belong to this tenant.');

    // Validate all products belong to this tenant + dedupe (productId, lotNumber)
    const productIds = Array.from(new Set(dto.items.map((i) => i.productId)));
    const products = await this.prisma.product.findMany({
      where:  { id: { in: productIds }, tenantId },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      throw new BadRequestException('One or more products do not belong to your tenant.');
    }

    // Validate lot expiry is in the future
    const now = Date.now();
    for (const item of dto.items) {
      if (!item.lotNumber?.trim()) throw new BadRequestException('lotNumber is required on every line.');
      const exp = new Date(item.expiresAt);
      if (isNaN(exp.getTime())) throw new BadRequestException(`Invalid expiry date: ${item.expiresAt}`);
      if (exp.getTime() <= now) {
        throw new BadRequestException(`Lot ${item.lotNumber} expires on/before today — cannot receive expired stock.`);
      }
      if (item.quantity == null || item.quantity <= 0) {
        throw new BadRequestException(`Quantity must be > 0 for lot ${item.lotNumber}.`);
      }
      if (item.costPrice == null || item.costPrice < 0) {
        throw new BadRequestException(`Cost price must be ≥ 0 for lot ${item.lotNumber}.`);
      }
    }
    // No duplicate (productId, lotNumber) within this single receipt
    const seen = new Set<string>();
    for (const item of dto.items) {
      const k = `${item.productId}|${item.lotNumber.trim()}`;
      if (seen.has(k)) {
        throw new ConflictException(`Duplicate line: same product + lot "${item.lotNumber}" appears more than once.`);
      }
      seen.add(k);
    }

    // Atomic: create receipt + items, upsert lots, update inventory + WAC.
    return this.prisma.$transaction(async (tx) => {
      const drNumberTrim = dto.drNumber.trim();

      // Reject duplicate (vendorId, drNumber) — prevents the same DR being
      // posted twice (which would double-count inventory).
      const existingDr = await tx.deliveryReceipt.findFirst({
        where:  { tenantId, vendorId: dto.vendorId, drNumber: drNumberTrim },
        select: { id: true },
      });
      if (existingDr) {
        throw new ConflictException({
          code:    'DELIVERY_RECEIPT_DUPLICATE',
          message: `DR# ${drNumberTrim} from this vendor was already posted (receipt ${existingDr.id}).`,
        });
      }

      const receipt = await tx.deliveryReceipt.create({
        data: {
          tenantId,
          branchId:     dto.branchId,
          vendorId:     dto.vendorId,
          drNumber:     drNumberTrim,
          notes:        dto.notes ?? null,
          receivedById,
        },
        select: { id: true },
      });

      for (const item of dto.items) {
        const lotTrim = item.lotNumber.trim();
        const qty     = new Prisma.Decimal(item.quantity);
        const cost    = new Prisma.Decimal(item.costPrice);

        // Upsert ProductLot — if (tenantId, productId, lotNumber) already
        // exists (same lot received earlier), increment its quantity.
        const lot = await tx.productLot.upsert({
          where: {
            tenantId_productId_lotNumber: {
              tenantId, productId: item.productId, lotNumber: lotTrim,
            },
          },
          update: {
            quantity:  { increment: qty },
            expiresAt: new Date(item.expiresAt),
            costPrice: cost, // last-cost; WAC lives on InventoryItem
          },
          create: {
            tenantId,
            productId: item.productId,
            branchId:  dto.branchId,
            lotNumber: lotTrim,
            expiresAt: new Date(item.expiresAt),
            quantity:  qty,
            costPrice: cost,
          },
          select: { id: true },
        });

        // Create the receipt item linked to the lot
        await tx.deliveryReceiptItem.create({
          data: {
            receiptId:    receipt.id,
            productId:    item.productId,
            lotNumber:    lotTrim,
            expiresAt:    new Date(item.expiresAt),
            quantity:     qty,
            costPrice:    cost,
            productLotId: lot.id,
          },
        });

        // Update InventoryItem + WAC. WAC formula:
        //   newAvg = (oldQty * oldAvg + receivedQty * receivedCost) / (oldQty + receivedQty)
        const existingInv = await tx.inventoryItem.findUnique({
          where:  { branchId_productId: { branchId: dto.branchId, productId: item.productId } },
          select: { id: true, quantity: true, avgCost: true },
        });
        if (existingInv) {
          const oldQty  = Number(existingInv.quantity);
          const oldAvg  = existingInv.avgCost != null ? Number(existingInv.avgCost) : Number(item.costPrice);
          const newQty  = oldQty + Number(item.quantity);
          const newAvg  = newQty > 0
            ? (oldQty * oldAvg + Number(item.quantity) * Number(item.costPrice)) / newQty
            : Number(item.costPrice);
          await tx.inventoryItem.update({
            where: { id: existingInv.id },
            data:  {
              quantity: { increment: qty },
              avgCost:  new Prisma.Decimal(newAvg.toFixed(4)),
            },
          });
        } else {
          await tx.inventoryItem.create({
            data: {
              tenantId,
              branchId:  dto.branchId,
              productId: item.productId,
              quantity:  qty,
              avgCost:   cost,
            },
          });
        }
      }

      // Auto-create a DRAFT AP bill so the owner doesn't have to re-key the
      // same totals in /ledger/ap/bills. Net 30 default; vendor's stored TIN /
      // WHT rate carry through. The bill stays DRAFT — owner reviews, splits
      // VAT/WHT if needed, then posts (which does the actual GL hit).
      const totalCost = dto.items.reduce(
        (s, it) => s + Number(it.quantity) * Number(it.costPrice),
        0,
      );
      let createdApBillId: string | null = null;
      if (totalCost > 0) {
        const inventoryAccountId = await this.findInventoryAccount(tx, tenantId);
        if (inventoryAccountId) {
          const billNumber = await this.numbering.next(tenantId, 'AP_BILL', null, tx);
          const today      = new Date();
          const termsDays  = 30;
          const dueDate    = this.addDays(today, termsDays);
          const bill = await tx.aPBill.create({
            data: {
              tenantId,
              branchId:        dto.branchId,
              billNumber,
              vendorBillRef:   drNumberTrim,            // distributor's DR#
              reference:       `DR ${drNumberTrim}`,
              vendorId:        dto.vendorId,
              billDate:        today,
              postingDate:     today,
              dueDate,
              termsDays,
              subtotal:        new Prisma.Decimal(totalCost.toFixed(2)),
              vatAmount:       new Prisma.Decimal(0),
              whtAmount:       new Prisma.Decimal(0),
              totalAmount:     new Prisma.Decimal(totalCost.toFixed(2)),
              paidAmount:      new Prisma.Decimal(0),
              balanceAmount:   new Prisma.Decimal(totalCost.toFixed(2)),
              status:          'DRAFT',
              description:     `Auto-posted from delivery receipt DR ${drNumberTrim}`,
              createdById:     receivedById,
              lines: {
                create: dto.items.map((it) => ({
                  accountId:   inventoryAccountId,
                  description: `Lot ${it.lotNumber.trim()} exp ${it.expiresAt}`,
                  quantity:    new Prisma.Decimal(it.quantity),
                  unitPrice:   new Prisma.Decimal(it.costPrice),
                  taxAmount:   new Prisma.Decimal(0),
                  lineTotal:   new Prisma.Decimal((Number(it.quantity) * Number(it.costPrice)).toFixed(2)),
                })),
              },
            },
            select: { id: true },
          });
          createdApBillId = bill.id;
          await tx.deliveryReceipt.update({
            where: { id: receipt.id },
            data:  { apBillId: createdApBillId },
          });
        }
      }

      return this.getOne(tenantId, receipt.id);
    });
  }
}
