import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';
import { Prisma, InventoryLogType } from '@prisma/client';
import { OfflineOrder } from '@repo/shared-types';

@Injectable()
export class OrdersService {
  constructor(
    private prisma:   PrismaService,
    private periods:  AccountingPeriodsService,
    private taxCalc:  TaxCalculatorService,
    private audit:    AuditService,
  ) {}

  // ─── Create order (online or from offline sync) ─────────────────────────

  async create(tenantId: string, cashierId: string, payload: OfflineOrder) {
    // Idempotency: if clientUuid already exists, return existing order
    if (payload.clientUuid) {
      const existing = await this.prisma.order.findUnique({
        where: { clientUuid: payload.clientUuid },
      });
      if (existing) return existing;
    }

    // ── Tenant compliance guards (outside transaction for clarity) ────────────

    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { taxStatus: true, isVatRegistered: true },
    });

    // Guard: tax status consistency — non-VAT tenants must submit zero VAT.
    // Uses the unified TaxCalculatorService rule so both POS and sync share the same logic.
    this.taxCalc.assertVatConsistency(
      Number(payload.vatAmount),
      (tenant.taxStatus ?? 'UNREGISTERED') as 'VAT' | 'NON_VAT' | 'UNREGISTERED',
    );

    // Guard: period lock — offline orders cannot land in a closed accounting period
    await this.periods.assertDateIsOpen(tenantId, new Date(payload.createdAt));

    // Guard: MEDIUM-4 — authorizedById in discount lines must belong to this tenant.
    // Without this, a cashier could forge the authorizer UUID with any UUID (e.g.,
    // a known SUPER_ADMIN or another tenant's manager) to bypass discount audit trails.
    const authorizerIds = payload.discounts
      .map((d) => d.authorizedById)
      .filter((id): id is string => id != null && id.length > 0);

    if (authorizerIds.length > 0) {
      const validCount = await this.prisma.user.count({
        where: { id: { in: authorizerIds }, tenantId },
      });
      if (validCount !== authorizerIds.length) {
        throw new BadRequestException(
          'One or more discount authorizers do not belong to your organization.',
        );
      }
    }

    // Guard: branch ownership — the branchId in the payload must belong to this tenant.
    // Without this check, a malicious client could submit a cross-tenant branchId and
    // cause inventory deductions and order records to be created at another tenant's branch.
    await this.assertBranchBelongsToTenant(tenantId, payload.branchId);

    return this.prisma.$transaction(async (tx) => {
      // Generate order number inside the transaction so the count is stable.
      // Relies on @@unique([tenantId, orderNumber]) as the final race guard.
      const orderNumber = await this.generateOrderNumberInTx(tx, tenantId);

      const order = await tx.order.create({
        data: {
          tenantId,
          branchId: payload.branchId,
          shiftId: payload.shiftId,
          orderNumber,
          status: 'COMPLETED',
          subtotal: new Prisma.Decimal(payload.subtotal),
          discountAmount: new Prisma.Decimal(payload.discountAmount),
          vatAmount: new Prisma.Decimal(payload.vatAmount),
          totalAmount: new Prisma.Decimal(payload.totalAmount),
          isPwdScDiscount: payload.isPwdScDiscount,
          pwdScIdRef: payload.pwdScIdRef,
          pwdScIdOwnerName: payload.pwdScIdOwnerName,
          clientUuid: payload.clientUuid,
          createdById: cashierId,
          completedAt: new Date(payload.createdAt),
          // ── BIR CAS: Invoice classification & B2B customer fields ──────────
          invoiceType:     (payload.invoiceType ?? 'CASH_SALE') as any,
          taxType:         (payload.taxType      ?? 'VAT_12')    as any,
          customerName:    payload.customerName,
          customerTin:     payload.customerTin,
          customerAddress: payload.customerAddress,
          items: {
            create: payload.items.map((item) => ({
              productId: item.productId,
              variantId: item.variantId,
              productName: item.productName,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              quantity: new Prisma.Decimal(item.quantity),
              discountAmount: new Prisma.Decimal(item.discountAmount),
              vatAmount: new Prisma.Decimal(item.vatAmount),
              lineTotal: new Prisma.Decimal(item.lineTotal),
              costPrice: item.costPrice != null ? new Prisma.Decimal(item.costPrice) : undefined,
              isVatable: item.isVatable,
              taxType: (item.taxType ?? (item.isVatable ? 'VAT_12' : 'VAT_EXEMPT')) as any,
              modifiers: item.modifiers?.length
                ? {
                    create: item.modifiers.map((m) => ({
                      modifierGroupId: m.modifierGroupId,
                      modifierOptionId: m.modifierOptionId,
                      groupName: m.groupName,
                      optionName: m.optionName,
                      priceAdjustment: new Prisma.Decimal(m.priceAdjustment),
                    })),
                  }
                : undefined,
            })),
          },
          payments: {
            create: payload.payments.map((p) => ({
              method: p.method,
              amount: new Prisma.Decimal(p.amount),
              reference: p.reference,
            })),
          },
          discounts: {
            create: payload.discounts.map((d) => ({
              discountType:     d.discountType,
              discountConfigId: d.discountConfigId,
              discountPercent:  d.discountPercent != null ? new Prisma.Decimal(d.discountPercent) : undefined,
              discountFixed:    d.discountFixed   != null ? new Prisma.Decimal(d.discountFixed)   : undefined,
              discountAmount:   new Prisma.Decimal(d.discountAmount),
              reason:           d.reason,
              authorizedById:   d.authorizedById,
              // Per-PWD/SC ID (allows multiple senior/PWD customers to share one order).
              pwdScIdRef:       d.pwdScIdRef       ?? undefined,
              pwdScIdOwnerName: d.pwdScIdOwnerName ?? undefined,
            })),
          },
        },
        include: { items: { include: { modifiers: true } }, payments: true, discounts: true },
      });

      // Update inventory per item using Prisma ORM (no raw SQL).
      // Read current stock → compute new quantity → write back inside the
      // same interactive transaction so Postgres serialises concurrent writes
      // to the same row at the DB level.
      // Captures the per-product avgCost (Moving-Average Cost / WAC) for the
      // COGS event built after this loop. Falls back to item.costPrice (the
      // snapshot from the till) when avgCost isn't set.
      const avgCostByProduct = new Map<string, number>();
      for (const item of payload.items) {
        const soldQty = Number(item.quantity);

        const invItem = await tx.inventoryItem.findFirst({
          where: { tenantId, branchId: payload.branchId, productId: item.productId },
          select: { id: true, quantity: true, avgCost: true },
        });

        // No inventory record, or already at zero — skip deduction and log
        if (!invItem || Number(invItem.quantity) <= 0) continue;

        // Capture WAC for the COGS event (built after this loop). Falls back
        // to the product-snapshot cost if no avgCost is set.
        if (invItem.avgCost != null) {
          avgCostByProduct.set(item.productId, Number(invItem.avgCost));
        }

        const qtyBefore = Number(invItem.quantity);
        const qtyAfter  = Math.max(qtyBefore - soldQty, 0);

        await tx.inventoryItem.update({
          where: { id: invItem.id },
          data:  { quantity: new Prisma.Decimal(qtyAfter) },
        });

        await tx.inventoryLog.create({
          data: {
            tenantId,
            branchId: payload.branchId,
            productId: item.productId,
            type: InventoryLogType.SALE_DEDUCTION,
            quantity:       new Prisma.Decimal(-soldQty),
            quantityBefore: new Prisma.Decimal(qtyBefore),
            quantityAfter:  new Prisma.Decimal(qtyAfter),
            reason:      `Sale — Order ${orderNumber}`,
            referenceId: order.id,
            createdById: cashierId,
          },
        });
      }

      // ── Raw material ingredient deduction via BOM ────────────────────────
      // For every sold item, look up its bill-of-materials and deduct the
      // corresponding raw material inventory at the branch level.
      //
      // Sprint 4A — when the tenant is on FIFO, also drain ingredient lots in
      // receivedAt order so COGS reflects the actual cost of the ingredients
      // that were consumed. WAC tenants skip the lot drain (their COGS uses
      // the running average on RawMaterial.costPrice).
      const tenantValuation = await tx.tenant.findUnique({
        where:  { id: tenantId },
        select: { valuationMethod: true },
      });
      const useFifo = tenantValuation?.valuationMethod === 'FIFO';

      for (const item of payload.items) {
        const soldQty = Number(item.quantity);
        const bomItems = await tx.bomItem.findMany({
          where:  { productId: item.productId },
          select: { rawMaterialId: true, quantity: true },
        });

        for (const bom of bomItems) {
          const consumeQty = Number(bom.quantity) * soldQty;

          // Always update the aggregate inventory pool (used by max-producible
          // computation and low-stock alerts).
          const rmInv = await tx.rawMaterialInventory.findUnique({
            where: { branchId_rawMaterialId: { branchId: payload.branchId, rawMaterialId: bom.rawMaterialId } },
          });
          if (!rmInv) continue;
          const before = Number(rmInv.quantity);
          const after  = Math.max(before - consumeQty, 0);
          await tx.rawMaterialInventory.update({
            where: { branchId_rawMaterialId: { branchId: payload.branchId, rawMaterialId: bom.rawMaterialId } },
            data:  { quantity: new Prisma.Decimal(after) },
          });

          // FIFO: drain oldest lots first.
          if (useFifo) {
            let remaining = consumeQty;
            const lots = await tx.rawMaterialLot.findMany({
              where: {
                branchId:      payload.branchId,
                rawMaterialId: bom.rawMaterialId,
                qtyRemaining:  { gt: 0 },
              },
              orderBy: { receivedAt: 'asc' },
            });
            for (const lot of lots) {
              if (remaining <= 0) break;
              const lotRem = Number(lot.qtyRemaining);
              const drain  = Math.min(lotRem, remaining);
              await tx.rawMaterialLot.update({
                where: { id: lot.id },
                data:  { qtyRemaining: new Prisma.Decimal(lotRem - drain) },
              });
              remaining -= drain;
            }
            // If we couldn't fully drain (under-stocked), the order still
            // succeeds — but a future audit query can detect the gap because
            // the inventory pool went negative-floored to 0 above.
          }
        }
      }

      // Queue AccountingEvents
      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          type: 'SALE',
          status: 'PENDING',
          payload: {
            orderId: order.id,
            orderNumber,
            branchId: payload.branchId,
            completedAt: payload.createdAt,
            lines: payload.items,
            payments: payload.payments,
            vatAmount: payload.vatAmount,
            totalAmount: payload.totalAmount,
            discountAmount: payload.discountAmount,
            isPwdScDiscount: payload.isPwdScDiscount,
            // BIR CAS: include invoice classification and customer for journal narrative
            invoiceType:     payload.invoiceType ?? 'CASH_SALE',
            taxType:         payload.taxType      ?? 'VAT_12',
            customerName:    payload.customerName,
            customerTin:     payload.customerTin,
          } as unknown as Prisma.JsonObject,
        },
      });

      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          type: 'COGS',
          status: 'PENDING',
          payload: {
            orderId: order.id,
            branchId: payload.branchId,
            lines: payload.items
              .map((i) => {
                // Prefer Moving-Average Cost from inventory (set on costed
                // receipts). Fall back to the till's snapshot of costPrice.
                const wac = avgCostByProduct.get(i.productId);
                const unitCost = wac ?? (i.costPrice != null ? Number(i.costPrice) : null);
                if (unitCost == null) return null;
                return {
                  productId:    i.productId,
                  quantity:     i.quantity,
                  unitCost,
                  totalCost:    Number(i.quantity) * unitCost,
                  costMethod:   wac != null ? 'WAC' : 'SNAPSHOT',
                };
              })
              .filter((line): line is NonNullable<typeof line> => line !== null),
          } as unknown as Prisma.JsonObject,
        },
      });

      // Sprint 4A — Lock the valuation method choice once the first
      // transaction posts. Subsequent attempts to change WAC ↔ FIFO will
      // be rejected by tenantService.setValuationMethod. Idempotent:
      // updateMany with a null guard so re-saves are no-ops.
      await tx.tenant.updateMany({
        where: { id: tenantId, firstTransactionAt: null },
        data:  { firstTransactionAt: new Date() },
      });

      return order;
    }, {
      // BOM deduction iterates N items × M ingredients with individual DB round-trips
      // to Railway Postgres. Default 5s timeout is too short — raise to 30s.
      maxWait: 10_000,
      timeout: 30_000,
    });
  }

  // ─── Void order (same-day; CASHIER requires supervisor co-auth) ─────────

  /**
   * Void a completed order.
   *
   * SOD dual-authorization rule:
   *   - SALES_LEAD, BRANCH_MANAGER, BUSINESS_OWNER → void directly (callerRole checked).
   *   - CASHIER → must supply `supervisorId`.  Backend looks up the supervisor, validates
   *     they exist in the same tenant, and confirms their role is SALES_LEAD or above.
   *     The order is then recorded with voidedById = supervisor and voidInitiatedById = cashier.
   */
  async void(
    tenantId:     string,
    orderId:      string,
    callerId:     string,
    callerRole:   string,
    reason:       string,
    supervisorId?: string,
  ) {
    // ── SOD: Dual-authorization for CASHIER voids ─────────────────────────────
    const VOID_DIRECT_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD'];
    let resolvedManagerId: string;
    let initiatorId: string | null = null;

    if (VOID_DIRECT_ROLES.includes(callerRole)) {
      // Supervisor is voiding directly — no co-auth needed
      resolvedManagerId = callerId;
    } else {
      // CASHIER (or any other sales role) — supervisorId is mandatory
      if (!supervisorId) {
        throw new BadRequestException(
          'Cashiers must provide a supervisorId (SALES_LEAD or BUSINESS_OWNER) to authorize a void.',
        );
      }
      // Validate the supervisor exists in this tenant and has the right role
      const supervisor = await this.prisma.user.findFirst({
        where: { id: supervisorId, tenantId },
        select: { id: true, role: true, name: true },
      });
      if (!supervisor) {
        throw new BadRequestException('Supervisor not found in this business.');
      }
      if (!VOID_DIRECT_ROLES.includes(supervisor.role)) {
        throw new ForbiddenException(
          `'${supervisor.name}' (${supervisor.role}) does not have void authority. ` +
          'A SALES_LEAD, BRANCH_MANAGER, or BUSINESS_OWNER must authorize.',
        );
      }
      resolvedManagerId = supervisorId;   // supervisor is the authorizer
      initiatorId       = callerId;       // cashier is recorded as initiator
    }

    // ── TOCTOU-safe: move all checks INSIDE the transaction so the read and write
    //    are atomic. The outer findFirst was removed to prevent a race where the
    //    order could change tenants between the check and the update (defense-in-depth).
    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({
        where: { id: orderId, tenantId },   // tenant-scoped check inside transaction
      });
      if (!order) throw new NotFoundException('Order not found');
      if (order.status !== 'COMPLETED') {
        throw new BadRequestException('Only completed orders can be voided');
      }

      const today = new Date();
      const completedAt = order.completedAt ?? order.createdAt;
      if (
        completedAt.getFullYear() !== today.getFullYear() ||
        completedAt.getMonth() !== today.getMonth() ||
        completedAt.getDate() !== today.getDate()
      ) {
        throw new ForbiddenException('Voids are only allowed on the same day as the sale');
      }

      const updated = await tx.order.update({
        where: { id: orderId },
        data: {
          status:           'VOIDED',
          voidedById:       resolvedManagerId,
          voidInitiatedById: initiatorId,
          voidedAt:         new Date(),
          voidReason:       reason,
        },
      });

      // Reverse inventory and log the reversal
      // tenantId added to orderItem query for defense-in-depth (HIGH-3 fix)
      const items = await tx.orderItem.findMany({ where: { orderId, order: { tenantId } } });
      for (const item of items) {
        const invItem = await tx.inventoryItem.findUnique({
          where: { branchId_productId: { branchId: order.branchId!, productId: item.productId } },
        });
        if (invItem) {
          const qtyBefore = Number(invItem.quantity);
          const qtyAfter = qtyBefore + Number(item.quantity);
          await tx.inventoryItem.update({
            where: { branchId_productId: { branchId: order.branchId!, productId: item.productId } },
            data: { quantity: new Prisma.Decimal(qtyAfter) },
          });
          await tx.inventoryLog.create({
            data: {
              tenantId,
              branchId: order.branchId!,
              productId: item.productId,
              type: InventoryLogType.VOID_REVERSAL,
              quantity: new Prisma.Decimal(Number(item.quantity)),
              quantityBefore: new Prisma.Decimal(qtyBefore),
              quantityAfter: new Prisma.Decimal(qtyAfter),
              reason: `Void — Order ${order.orderNumber}: ${reason}`,
              referenceId: orderId,
              createdById: resolvedManagerId,
            },
          });
        }
      }

      // Queue reversal accounting event — include full financial data so the
      // journal processor can generate a correct reversal even if the original
      // SALE event hasn't been synced yet (out-of-order processing fallback).
      const payments = await tx.orderPayment.findMany({ where: { orderId } });
      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId,
          type: 'VOID',
          status: 'PENDING',
          payload: {
            orderId,
            orderNumber: order.orderNumber,
            reason,
            totalAmount:    Number(order.totalAmount),
            vatAmount:      Number(order.vatAmount),
            discountAmount: Number(order.discountAmount),
            payments: payments.map((p) => ({ method: p.method, amount: Number(p.amount) })),
          } as unknown as Prisma.JsonObject,
        },
      });

      return { updated, orderNumber: order.orderNumber };
    });

    // Write immutable audit record after the transaction commits — fire-and-forget.
    // Doing this outside the transaction ensures a DB failure in the audit write
    // never rolls back a successfully voided order.
    void this.audit.logVoid(tenantId, orderId, result.orderNumber, reason, resolvedManagerId);

    return result.updated;
  }

  // ─── List orders ─────────────────────────────────────────────────────────

  findAll(tenantId: string, branchId?: string, shiftId?: string) {
    return this.prisma.order.findMany({
      where: {
        tenantId,
        ...(branchId ? { branchId } : {}),
        ...(shiftId ? { shiftId } : {}),
      },
      include: {
        items: { include: { modifiers: true } },
        payments: true,
        discounts: true,
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: {
        items: {
          include: {
            modifiers: true,
            refunds: { include: { refundedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
          },
        },
        payments: true,
        discounts: true,
        createdBy: { select: { id: true, name: true } },
        voidedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  // ─── Item-level refund (partial void) ────────────────────────────────────
  /**
   * Refund N units of a single OrderItem. Validates qty ≤ remaining,
   * increments OrderItem.refundedQty, optionally restocks inventory,
   * creates an OrderItemRefund audit row, and queues a proportional
   * REVERSAL accounting event so the GL reflects the give-back.
   *
   * Rules:
   *  - Order must be COMPLETED (can't refund a draft / voided order)
   *  - Quantity must be > 0 and ≤ (item.quantity - item.refundedQty)
   *  - CASHIER triggers; SOD supervisor PIN co-auth checked at controller level
   *    (matches the void flow)
   */
  async refundItem(args: {
    tenantId:      string;
    orderId:       string;
    orderItemId:   string;
    quantity:      number;
    reason:        string;
    refundMethod:  string;
    restock:       boolean;
    refundedById:  string;
  }) {
    const { tenantId, orderId, orderItemId, quantity, reason, refundMethod, restock, refundedById } = args;

    if (quantity <= 0) throw new BadRequestException('Refund quantity must be positive.');
    if (!reason?.trim()) throw new BadRequestException('Refund reason is required.');

    return this.prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findFirst({
        where: { id: orderItemId, orderId, order: { tenantId } },
        include: { order: true, product: { select: { id: true, costPrice: true, name: true } } },
      });
      if (!item) throw new NotFoundException('Order item not found.');
      if (item.order.status !== 'COMPLETED') {
        throw new BadRequestException(`Cannot refund — order is ${item.order.status}.`);
      }

      const alreadyRefunded = Number(item.refundedQty);
      const remaining = Number(item.quantity) - alreadyRefunded;
      if (quantity > remaining + 0.0001) {
        throw new BadRequestException(`Only ${remaining} unit(s) remaining to refund on this line.`);
      }

      // Pro-rated refund amount: refunded qty / total qty × lineTotal (incl VAT)
      const refundAmount = (quantity / Number(item.quantity)) * Number(item.lineTotal);

      // Increment refundedQty + create audit row
      await tx.orderItem.update({
        where: { id: orderItemId },
        data:  { refundedQty: new Prisma.Decimal(alreadyRefunded + quantity) },
      });

      const refundRow = await tx.orderItemRefund.create({
        data: {
          orderItemId,
          quantity:     new Prisma.Decimal(quantity),
          refundAmount: new Prisma.Decimal(refundAmount.toFixed(2)),
          reason:       reason.trim(),
          refundMethod: refundMethod as Prisma.OrderItemRefundCreateInput['refundMethod'],
          restocked:    restock,
          refundedById,
        },
      });

      // Inventory restock — only if requested and the order had a branchId
      if (restock && item.order.branchId) {
        const inv = await tx.inventoryItem.findFirst({
          where: { tenantId, branchId: item.order.branchId, productId: item.productId },
          select: { id: true, quantity: true },
        });
        if (inv) {
          const before = Number(inv.quantity);
          const after  = before + quantity;
          await tx.inventoryItem.update({
            where: { id: inv.id },
            data:  { quantity: new Prisma.Decimal(after) },
          });
          await tx.inventoryLog.create({
            data: {
              tenantId,
              branchId:       item.order.branchId,
              productId:      item.productId,
              type:           InventoryLogType.STOCK_IN,
              quantity:       new Prisma.Decimal(quantity),
              quantityBefore: new Prisma.Decimal(before),
              quantityAfter:  new Prisma.Decimal(after),
              reason:         `Refund — Order ${item.order.orderNumber}`,
              referenceId:    refundRow.id,
              createdById:    refundedById,
            },
          });
        }
      }

      // Queue a partial reversal accounting event. The journal processor
      // posts: DR Sales (proportional) / DR Output VAT / CR Cash (or AR)
      // and, if restock=true, DR Inventory / CR COGS proportionally.
      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId,
          type:    'VOID', // reuses the existing reversal handler
          status:  'PENDING',
          payload: {
            mode:           'ITEM_REFUND',
            orderId,
            orderItemId,
            refundQty:      quantity,
            originalQty:    Number(item.quantity),
            refundAmount,
            refundMethod,
            restocked:      restock,
            reason:         reason.trim(),
          } as unknown as Prisma.JsonObject,
        },
      });

      return {
        refundId:        refundRow.id,
        orderItemId,
        refundAmount,
        quantityRefunded: quantity,
        totalRefundedQty: alreadyRefunded + quantity,
        remainingQty:    Number(item.quantity) - (alreadyRefunded + quantity),
      };
    });
  }

  // ─── Bulk sync from offline queue ────────────────────────────────────────

  async bulkSync(tenantId: string, cashierId: string, orders: OfflineOrder[]) {
    const results: { clientUuid: string; orderId?: string; error?: string }[] = [];
    for (const order of orders) {
      try {
        const created = await this.create(tenantId, cashierId, order);
        results.push({ clientUuid: order.clientUuid!, orderId: created.id });
      } catch (err: any) {
        results.push({ clientUuid: order.clientUuid!, error: err.message });
      }
    }
    return results;
  }

  /**
   * Guard: verify that `branchId` is owned by `tenantId`.
   * Prevents cross-tenant branch injection in OfflineOrder payloads.
   * Called before any write that accepts branchId from the client.
   */
  private async assertBranchBelongsToTenant(tenantId: string, branchId: string): Promise<void> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
      select: { id: true },
    });
    if (!branch) {
      throw new ForbiddenException(
        'The provided branchId does not belong to your organization.',
      );
    }
  }

  /**
   * Generate the next sequential order number for the tenant.
   *
   * MUST be called inside a Prisma interactive transaction (`tx`) so that
   * the count is stable for the duration of the write.  The @@unique
   * constraint on (tenantId, orderNumber) is the final safety net for
   * the extremely rare concurrent-order race — it surfaces as P2002
   * (already handled → 409) rather than a silent duplicate.
   *
   * Intentionally avoids raw SQL / pg_advisory_xact_lock so that Railway's
   * Postgres and any connection-pool mode work without P2010 raw-query errors.
   */
  private async generateOrderNumberInTx(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    tenantId: string,
  ): Promise<string> {
    const year  = new Date().getFullYear();
    const count = await tx.order.count({ where: { tenantId } });
    const seq   = String(count + 1).padStart(6, '0');
    return `ORD-${year}-${seq}`;
  }
}
