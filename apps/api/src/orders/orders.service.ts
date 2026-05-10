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
import { NumberingService } from '../numbering/numbering.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { Prisma, InventoryLogType } from '@prisma/client';
import { OfflineOrder } from '@repo/shared-types';

@Injectable()
export class OrdersService {
  constructor(
    private prisma:    PrismaService,
    private periods:   AccountingPeriodsService,
    private taxCalc:   TaxCalculatorService,
    private audit:     AuditService,
    private numbering: NumberingService,
    private loyalty:   LoyaltyService,
  ) {}

  // ─── Create order (online or from offline sync) ─────────────────────────

  async create(tenantId: string, cashierId: string, payload: OfflineOrder) {
    // Idempotency: if clientUuid already exists FOR THIS TENANT, return it.
    // Tenant scope is critical — clientUuid is globally unique on the Order
    // model, so a malicious payload could otherwise echo back another
    // tenant's order body. findFirst with both filters short-circuits only
    // on a real match within the caller's tenant.
    if (payload.clientUuid) {
      const existing = await this.prisma.order.findFirst({
        where: { clientUuid: payload.clientUuid, tenantId },
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

    // Sprint 19 — Pharmacy PIN-attest validation. Replaces the earlier
    // RX_REQUIRED_NO_PRESCRIPTION guard (commit 2d30c97 → revised plan).
    // Real Filipino pharmacy workflow: the assistant has already verified
    // the paper Rx; the till just needs the pharmacist's PIN to attest.
    //
    //   1. For every line whose product is Rx-required, item.attestPin must
    //      belong to a tenant user with prcLicense set + isActive.
    //   2. For every line whose product.drugClass = DDB_S2, also require
    //      a Yellow Rx serial number (RA 9165 §61).
    //   3. We stamp OrderItem.dispensedByPrc + dispensedById from the
    //      attesting pharmacist on success — that's the legal audit trail.
    //
    // The optional prescriptionId field is preserved for back-compat (older
    // clients still send it) but is no longer required at the till; owners
    // backfill it later from /pos/pharmacy/rx if they want to formally tie
    // the sale to a paper Rx record.
    let attestedByLine = new Map<number, { prc: string; userId: string }>();
    {
      const productIds = Array.from(new Set(payload.items.map((i) => i.productId)));
      if (productIds.length > 0) {
        const rxProducts = await this.prisma.product.findMany({
          where:  { id: { in: productIds }, tenantId, isRxRequired: true },
          select: { id: true, name: true, drugClass: true },
        });
        const rxProductIds = new Set(rxProducts.map((p) => p.id));
        const s2ProductIds = new Set(
          rxProducts.filter((p) => (p as any).drugClass === 'DDB_S2').map((p) => p.id),
        );

        // Collect distinct PINs across all Rx-required lines, look them up
        // once, then reuse the resolved user info per line.
        const pinsToResolve = Array.from(new Set(
          payload.items
            .filter((i) => rxProductIds.has(i.productId))
            .map((i) => (i as any).attestPin)
            .filter((p): p is string => !!p),
        ));
        const usersByPin = new Map<string, { id: string; prcLicense: string | null; name: string }>();
        if (pinsToResolve.length > 0) {
          const users = await this.prisma.user.findMany({
            where:  { tenantId, isActive: true, kioskPin: { in: pinsToResolve } },
            select: { id: true, kioskPin: true, prcLicense: true, name: true },
          });
          for (const u of users) {
            if (u.kioskPin) usersByPin.set(u.kioskPin, { id: u.id, prcLicense: u.prcLicense, name: u.name });
          }
        }

        const missingAttest: string[] = [];
        const notPharmacist: string[] = [];
        const missingS2:     string[] = [];

        payload.items.forEach((i, idx) => {
          if (!rxProductIds.has(i.productId)) return;
          const pin = (i as any).attestPin as string | undefined;
          if (!pin) { missingAttest.push(i.productName); return; }
          const user = usersByPin.get(pin);
          if (!user) { missingAttest.push(i.productName); return; }
          if (!user.prcLicense) { notPharmacist.push(i.productName); return; }
          attestedByLine.set(idx, { prc: user.prcLicense, userId: user.id });
          if (s2ProductIds.has(i.productId)) {
            const serial = (i as any).yellowRxSerial as string | undefined;
            if (!serial || !/^[A-Z0-9-]{4,32}$/i.test(serial.trim())) {
              missingS2.push(i.productName);
            }
          }
        });

        if (missingAttest.length > 0) {
          throw new BadRequestException({
            code:    'RX_ATTEST_PIN_INVALID',
            message: `Pharmacist PIN required (or wrong PIN) for: ${missingAttest.join(', ')}.`,
          });
        }
        if (notPharmacist.length > 0) {
          throw new BadRequestException({
            code:    'RX_ATTEST_NOT_PHARMACIST',
            message: `That PIN belongs to a non-pharmacist staff member; cannot dispense: ${notPharmacist.join(', ')}.`,
          });
        }
        if (missingS2.length > 0) {
          throw new BadRequestException({
            code:    'S2_YELLOW_RX_REQUIRED',
            message: `Yellow Rx serial required for DDB Schedule II: ${missingS2.join(', ')}.`,
          });
        }

        // Tolerate clients that still send prescriptionId — validate it
        // belongs to this tenant if supplied.
        const suppliedIds = Array.from(new Set(
          payload.items.map((i) => i.prescriptionId).filter((id): id is string => !!id),
        ));
        if (suppliedIds.length > 0) {
          const ownedRx = await this.prisma.prescription.findMany({
            where:  { id: { in: suppliedIds }, tenantId },
            select: { id: true },
          });
          if (ownedRx.length !== suppliedIds.length) {
            throw new BadRequestException({
              code:    'RX_NOT_FOUND',
              message: 'One or more prescriptions could not be found in your tenant.',
            });
          }
        }
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // Generate order number inside the transaction so the count is stable.
      // Relies on @@unique([tenantId, orderNumber]) as the final race guard.
      const orderNumber = await this.generateOrderNumberInTx(tx, tenantId);

      // ── Sprint 7: PAID → COMPLETED status flow ────────────────────────────
      // Determine whether ANY of the order's items will need station prep.
      // Items go to a station via Product.category.stationId. If no item
      // routes to any station, there's nothing to wait on — the order skips
      // the PAID stage entirely and goes straight to COMPLETED at sale time.
      const productIds = payload.items.map((i) => i.productId);
      // CRITICAL: scope by tenantId so a crafted productId from another tenant
      // cannot be smuggled into this tenant's order. If any productId is not
      // owned by this tenant, reject the entire order — it's malformed input,
      // not a routing edge case.
      const productsForRouting = productIds.length
        ? await tx.product.findMany({
            where:  { id: { in: productIds }, tenantId },
            select: { id: true, category: { select: { stationId: true } } },
          })
        : [];
      if (productsForRouting.length !== new Set(productIds).size) {
        throw new BadRequestException(
          'One or more products in this order do not belong to your tenant.',
        );
      }
      const hasAnyRoutedItem = productsForRouting.some(
        (p) => p.category?.stationId != null,
      );
      const paidAtTs = new Date(payload.createdAt);
      const initialStatus: 'PAID' | 'COMPLETED' = hasAnyRoutedItem ? 'PAID' : 'COMPLETED';
      const initialReadyAt = hasAnyRoutedItem ? null : paidAtTs;
      const initialCompletedAt = hasAnyRoutedItem ? null : paidAtTs;

      const order = await tx.order.create({
        data: {
          tenantId,
          branchId: payload.branchId,
          shiftId: payload.shiftId,
          orderNumber,
          status: initialStatus,
          subtotal: new Prisma.Decimal(payload.subtotal),
          discountAmount: new Prisma.Decimal(payload.discountAmount),
          vatAmount: new Prisma.Decimal(payload.vatAmount),
          totalAmount: new Prisma.Decimal(payload.totalAmount),
          isPwdScDiscount: payload.isPwdScDiscount,
          pwdScIdRef: payload.pwdScIdRef,
          pwdScIdOwnerName: payload.pwdScIdOwnerName,
          clientUuid: payload.clientUuid,
          createdById: cashierId,
          paidAt: paidAtTs,
          readyAt: initialReadyAt,
          completedAt: initialCompletedAt,
          // ── BIR CAS: Invoice classification & B2B customer fields ──────────
          invoiceType:     (payload.invoiceType ?? 'CASH_SALE') as any,
          taxType:         (payload.taxType      ?? 'VAT_12')    as any,
          customerName:    payload.customerName,
          customerTin:     payload.customerTin,
          customerAddress: payload.customerAddress,
          // Sprint 19 — Loyalty: link to Customer master when present (also
          // drives AR aging for CHARGE invoices via the existing dueDate
          // computation downstream).
          customerId:      payload.customerId,
          items: {
            create: payload.items.map((item, idx) => ({
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
              // Sprint 19 — Pharmacy: prescriptionId is optional + back-compat.
              prescriptionId: item.prescriptionId,
              // Sprint 19 — PIN-attest stamps the dispensing pharmacist on the
              // line. Computed above in `attestedByLine` from the validated
              // attestPin → User.kioskPin lookup.
              dispensedByPrc: attestedByLine.get(idx)?.prc,
              dispensedById:  attestedByLine.get(idx)?.userId,
              yellowRxSerial: (item as any).yellowRxSerial,
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
      // Sprint 4A — when the tenant is on FIFO, drain ingredient lots in
      // receivedAt order so COGS reflects the actual cost of the ingredients
      // that were consumed. WAC tenants use the running average on
      // RawMaterial.costPrice.
      //
      // Sprint 8 — for RECIPE_BASED products, the COGS posted to the ledger
      // MUST equal the sum of (bom.qty × ingredient cost) — NOT the manual
      // Product.costPrice field. Otherwise an owner who hasn't kept their
      // product cost-price in sync with their suppliers' price changes will
      // see wildly inaccurate gross margin. We accumulate a per-product
      // "true unit cost" from the BOM walk and pass it to the COGS event
      // builder below, overriding the snapshot fallback for recipe products.
      const tenantValuation = await tx.tenant.findUnique({
        where:  { id: tenantId },
        select: { valuationMethod: true },
      });
      const useFifo = tenantValuation?.valuationMethod === 'FIFO';

      // productId -> per-unit recipe cost (₱ per single finished unit).
      // Populated only for products that have a BOM (i.e., RECIPE_BASED).
      const recipeUnitCostByProduct = new Map<string, number>();

      for (const item of payload.items) {
        const soldQty = Number(item.quantity);
        // BOM walk: defense-in-depth tenant scope on the JOIN side too.
        // The productId guard above already rejects cross-tenant productIds,
        // but scoping the bomItem query by product.tenantId makes this
        // resilient to any future code path that bypasses the upstream guard.
        const bomItems = await tx.bomItem.findMany({
          where:  { productId: item.productId, product: { tenantId } },
          select: {
            rawMaterialId: true,
            quantity:      true,
            rawMaterial:   { select: { costPrice: true } },
          },
        });

        if (bomItems.length === 0) continue; // not a recipe product — skip

        // Per-unit cost accumulator for this product (₱ per single unit).
        let perUnitCost = 0;

        for (const bom of bomItems) {
          const perUnitQty = Number(bom.quantity);    // ingredient qty per 1 finished unit
          const consumeQty = perUnitQty * soldQty;     // total qty drained for this order line

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

          if (useFifo) {
            // FIFO: drain oldest lots first AND accumulate the actual lot
            // unit-costs into the recipe cost. Each lot's unitCost was frozen
            // at the receipt moment, so this gives the genuine historical
            // cost of the ingredients in this specific drink.
            let remaining = consumeQty;
            let drainedCost = 0;        // total ₱ drained from lots for this BOM line
            let drainedQty  = 0;        // total qty actually drained (may be < consumeQty if under-stocked)
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
              drainedCost += drain * Number(lot.unitCost);
              drainedQty  += drain;
              remaining   -= drain;
            }
            // Per-unit cost contribution from this ingredient. If we couldn't
            // fully drain (under-stocked), fall back to RawMaterial.costPrice
            // for the remaining portion so COGS is never zero.
            const bomLineUnitCost = soldQty > 0 ? drainedCost / soldQty : 0;
            const shortfallQty    = consumeQty - drainedQty;
            const fallbackUnitCost = shortfallQty > 0 && bom.rawMaterial?.costPrice != null
              ? (shortfallQty * Number(bom.rawMaterial.costPrice)) / soldQty
              : 0;
            perUnitCost += bomLineUnitCost + fallbackUnitCost;
          } else {
            // WAC: use RawMaterial.costPrice (running average updated on receipts).
            // Per-unit cost = bom.qty × ingredient WAC.
            const wacCost = bom.rawMaterial?.costPrice != null ? Number(bom.rawMaterial.costPrice) : 0;
            perUnitCost += perUnitQty * wacCost;
          }
        }

        recipeUnitCostByProduct.set(item.productId, perUnitCost);
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

      // Sprint 6 — Manufacturing overhead allocation. Only applied when
      // businessType is MANUFACTURING and overheadRatePerUnit is set.
      // Per PFRS for SMEs: F&B / retail tenants record utilities + rent
      // as OpEx, NOT COGS — so they should leave overheadRatePerUnit null
      // (the default). Manufacturing tenants under full absorption costing
      // pull a portion of factory utilities into COGS via this rate.
      const tenantCostingProfile = await tx.tenant.findUnique({
        where:  { id: tenantId },
        select: { businessType: true, overheadRatePerUnit: true },
      });
      const overheadRate =
        tenantCostingProfile?.businessType === 'MANUFACTURING' &&
        tenantCostingProfile.overheadRatePerUnit != null
          ? Number(tenantCostingProfile.overheadRatePerUnit)
          : 0;

      await tx.accountingEvent.create({
        data: {
          tenantId,
          orderId: order.id,
          type: 'COGS',
          status: 'PENDING',
          payload: {
            orderId: order.id,
            branchId: payload.branchId,
            overheadRate,                      // 0 for non-manufacturing tenants
            lines: payload.items
              .map((i) => {
                // Cost resolution precedence (most → least authoritative):
                //   1. RECIPE  — sum of actual ingredient costs for this order
                //                (FIFO lot drains or WAC running averages).
                //                This is the TRUE cost of the drink/food made.
                //   2. WAC     — Moving-Average Cost from finished-goods
                //                inventory (UNIT_BASED products on costed receipts).
                //   3. SNAPSHOT — the till's snapshot of Product.costPrice
                //                (UNIT_BASED legacy fallback only).
                const recipe = recipeUnitCostByProduct.get(i.productId);
                const wac    = avgCostByProduct.get(i.productId);
                const unitCost =
                  recipe != null ? recipe :
                  wac    != null ? wac    :
                  i.costPrice != null ? Number(i.costPrice) : null;
                if (unitCost == null) return null;
                const qty = Number(i.quantity);
                // Overhead is added per unit produced. For MANUFACTURING, this
                // shifts a slice of factory utilities into COGS (full absorption).
                const overhead = overheadRate * qty;
                const costMethod =
                  recipe != null ? (useFifo ? 'RECIPE_FIFO' : 'RECIPE_WAC') :
                  wac    != null ? 'WAC' :
                                   'SNAPSHOT';
                return {
                  productId:    i.productId,
                  quantity:     i.quantity,
                  unitCost,
                  totalCost:    qty * unitCost + overhead,
                  directCost:   qty * unitCost,
                  overhead,
                  costMethod,
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

    // Sprint 19 — Loyalty stamp accrual. Runs AFTER the transaction commits
    // so stamp-card writes never roll back the order itself. Errors are
    // logged but never propagated — a loyalty hiccup must not fail a sale.
    if (payload.customerId) {
      try {
        await this.loyalty.accrueStampsForOrder(
          tenantId,
          order.id,
          payload.customerId,
          Number(payload.totalAmount),
        );
      } catch (err: any) {
        // eslint-disable-next-line no-console
        console.warn(
          `[orders] Loyalty accrual failed for order ${order.id} customer ${payload.customerId}: ${err?.message}`,
        );
      }
    }

    return order;
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
      // Sprint 7: voids allowed on PAID (still in production) and COMPLETED orders.
      // OPEN orders aren't yet finalized — there's nothing to void. VOIDED / RETURNED
      // orders can't be voided again.
      if (order.status !== 'PAID' && order.status !== 'COMPLETED') {
        throw new BadRequestException('Only paid or completed orders can be voided');
      }

      const today = new Date();
      // Voids are scoped to the same calendar day as the SALE (paidAt), not
      // the production-complete moment. A drink ordered at 11:55 PM that
      // didn't get bumped READY until 12:05 AM still belongs to yesterday's
      // shift for void purposes.
      const saleDate = order.paidAt ?? order.completedAt ?? order.createdAt;
      if (
        saleDate.getFullYear() !== today.getFullYear() ||
        saleDate.getMonth() !== today.getMonth() ||
        saleDate.getDate() !== today.getDate()
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

      // ── Reverse inventory + capture restocked cost for COGS reversal ──
      // Sprint 9 accounting fix: when an order is voided, only items that
      // were physically restocked (UNIT_BASED finished goods that returned
      // to the shelf) generate a COGS reversal. RECIPE_BASED items had
      // their ingredients consumed — the cost stays in COGS as wastage,
      // matching reality.
      //
      // The journal processor needs to know the total cost of restocked
      // items to post the correct reversal. We accumulate it here and
      // pass it in the VOID event payload.
      // tenantId added to orderItem query for defense-in-depth (HIGH-3 fix)
      const items = await tx.orderItem.findMany({
        where:   { orderId, order: { tenantId } },
        include: { product: { select: { inventoryMode: true } } },
      });
      let restockedCogsTotal = 0;
      for (const item of items) {
        // RECIPE_BASED items skip restock entirely — ingredients are waste.
        // Their cost stays in COGS. (Defense in depth: even if an
        // InventoryItem somehow exists for a recipe product, don't restock.)
        if (item.product?.inventoryMode === 'RECIPE_BASED') continue;

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
          // Accumulate the cost of restocked items for the COGS reversal.
          // Use the per-item costPrice (snapshot at sale time) × restocked qty.
          // Falls back to product's current costPrice when item snapshot is null.
          const itemCost = item.costPrice != null
            ? Number(item.costPrice)
            : (await tx.product.findUnique({
                where:  { id: item.productId },
                select: { costPrice: true },
              }))?.costPrice ?? null;
          if (itemCost != null) {
            restockedCogsTotal += Number(itemCost) * Number(item.quantity);
          }
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
            // Sprint 9: total cost of items physically restocked. Drives the
            // partial COGS reversal in the journal processor. Zero for café
            // (recipe ingredients consumed = waste). Equal to the original
            // COGS for retail (everything goes back on the shelf).
            restockedCogsTotal,
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

  /**
   * List orders for a tenant. ALWAYS paginated to prevent OOM at scale —
   * a busy branch can do 500+ orders/day; without a cap a year-old tenant
   * would try to deserialize tens of thousands of rows.
   *
   * Default take = 100, max = 500. Returns { data, total, take, skip }.
   * Soft-deleted orders are excluded.
   */
  async findAll(
    tenantId: string,
    branchId?: string,
    shiftId?: string,
    take = 100,
    skip = 0,
  ) {
    const safeTake = Math.min(Math.max(take, 1), 500);
    const safeSkip = Math.max(skip, 0);
    const where = {
      tenantId,
      deletedAt: null,
      ...(branchId ? { branchId } : {}),
      ...(shiftId ? { shiftId } : {}),
    };
    const [total, data] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          items: { include: { modifiers: true } },
          payments: true,
          discounts: true,
          createdBy: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take:    safeTake,
        skip:    safeSkip,
      }),
    ]);
    return { data, total, take: safeTake, skip: safeSkip };
  }

  async findOne(tenantId: string, id: string) {
    // Note: findOne intentionally INCLUDES soft-deleted records — the receipt
    // detail page needs to render voided orders for audit. Lists use findAll
    // which filters them out.
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
      // Sprint 7: PAID orders (still in production) can also be refunded —
      // customer changes mind before the drink is ready. Only OPEN, VOIDED,
      // or RETURNED block refunds.
      if (item.order.status !== 'PAID' && item.order.status !== 'COMPLETED') {
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

      // Compute the COGS portion attributable to the refunded units, but
      // only when the items were physically restocked. Recipe items that
      // can't be restocked (refund only — drink consumed) leave the COGS
      // intact as wastage. UNIT_BASED items that go back on the shelf
      // generate a proportional COGS reversal.
      const itemUnitCost = item.costPrice != null
        ? Number(item.costPrice)
        : (item.product?.costPrice != null ? Number(item.product.costPrice) : 0);
      const restockedCogsAmount = restock ? itemUnitCost * quantity : 0;

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
            orderNumber:    item.order.orderNumber,
            refundQty:      quantity,
            originalQty:    Number(item.quantity),
            refundAmount,
            refundMethod,
            restocked:      restock,
            // Sprint 9: pre-computed proportional COGS reversal. Zero for
            // non-restocked refunds (waste); cost × qty for restocked items.
            restockedCogsTotal: restockedCogsAmount,
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

  /**
   * Sprint 17 — improved error surfacing.
   *
   * Each result now includes `errorCode` (Prisma P-code or HTTP status string)
   * and `firstFailureIndex` summarises where to resume. The caller (offline
   * sync queue on the device) can:
   *   - find the first failed clientUuid and pause that order's retry
   *   - log subsequent failures without retrying them in a loop
   *
   * The sweep is best-effort sequential — same-shift offline orders get
   * processed in submission order so JE numbering / EOD aggregation isn't
   * scrambled.
   */
  async bulkSync(tenantId: string, cashierId: string, orders: OfflineOrder[]) {
    const results: Array<{
      clientUuid: string;
      orderId?:   string;
      error?:     string;
      errorCode?: string;
      ok:         boolean;
    }> = [];
    let firstFailureIndex: number | null = null;

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      try {
        const created = await this.create(tenantId, cashierId, order);
        results.push({ clientUuid: order.clientUuid!, orderId: created.id, ok: true });
      } catch (err: any) {
        if (firstFailureIndex === null) firstFailureIndex = i;
        const code = err?.code ?? err?.status ?? err?.name ?? 'UNKNOWN';
        results.push({
          clientUuid: order.clientUuid!,
          error:      err?.message ?? String(err),
          errorCode:  String(code),
          ok:         false,
        });
      }
    }
    return {
      results,
      firstFailureIndex,
      successCount: results.filter((r) => r.ok).length,
      failureCount: results.filter((r) => !r.ok).length,
    };
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
    // Sprint 16 — race-safe via NumberingService (per-tenant counter row,
    // atomic UPDATE … RETURNING). Replaces the prior count()+1 approach,
    // which suffered double-issuance under concurrent checkouts on busy
    // shifts and was only safety-netted by the DB unique constraint
    // (P2002 → 409 retry storm).
    //
    // Sprint 19 — additional self-heal for the "counter behind data" failure
    // mode: if a demo seed, manual SQL, or a tenant data-reset that preserves
    // the sequence row leaves orphaned `ORD-{YYYY}-NNNNNN` rows above the
    // current counter, the next `next()` call returns a colliding number and
    // the parent $transaction rolls back the increment too — so the retry
    // hits the same collision indefinitely. We pre-sync the counter to
    // MAX(existing suffix) + 1 here, INSIDE the same tx, to break the loop.
    await this.syncCounterToMax(tx, tenantId);
    return this.numbering.next(tenantId, 'POS_ORDER', null, tx);
  }

  /**
   * If `documentNumberSequence` for POS_ORDER on this tenant is behind the
   * highest existing `Order.orderNumber` suffix for the current year, fast-
   * forward the counter so the next `next()` call cannot collide.
   *
   * Cheap (one indexed lookup + one update at most) — and a no-op when the
   * counter is already ahead, which is the steady-state case.
   */
  private async syncCounterToMax(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    tenantId: string,
  ): Promise<void> {
    const year = new Date().getFullYear();
    const prefix = `ORD-${year}-`;

    // Highest existing order number for this tenant in the current year.
    // Lexical sort works because the suffix is zero-padded (6 digits).
    const last = await tx.order.findFirst({
      where:   { tenantId, orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
      select:  { orderNumber: true },
    });
    if (!last) return;

    const m = last.orderNumber.match(/^ORD-\d{4}-(\d+)$/);
    if (!m) return;
    const maxSuffix = parseInt(m[1], 10);
    if (!Number.isFinite(maxSuffix)) return;

    const seq = await tx.documentNumberSequence.findFirst({
      where: { tenantId, type: 'POS_ORDER', branchId: null },
      select: { id: true, counter: true },
    });

    if (!seq) {
      // No sequence row yet but orphan ORD-{YYYY}-NNNNNN rows exist (e.g. from
      // a hand-seeded demo or migration). Pre-create the row with the right
      // counter so numbering.next() picks up at maxSuffix+1.
      await tx.documentNumberSequence.create({
        data: {
          tenantId,
          type:        'POS_ORDER',
          branchId:    null,
          prefix:      'ORD',
          format:      'ORD-{YYYY}-{######}',
          padding:     6,
          counter:     maxSuffix,
          resetPolicy: 'YEARLY',
          lastResetAt: new Date(),
        },
      });
      return;
    }

    if (seq.counter >= maxSuffix) return; // already ahead — nothing to do
    await tx.documentNumberSequence.update({
      where: { id: seq.id },
      data:  { counter: maxSuffix },     // .next() will increment to maxSuffix+1
    });
  }
}
