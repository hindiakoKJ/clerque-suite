import {
  Injectable, Logger, BadRequestException, NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NumberingService } from '../numbering/numbering.service';
import { APBillsService } from '../ap/ap-bills.service';
import { PlatformService } from './platform.service';
import { PLAN_MONTHLY_PRICE_PHP_CENTS, type PlanCode } from '@repo/shared-types';

/**
 * Sprint 15 — Cross-tenant subscription billing.
 *
 * Each month, HNS Corp PH bills its tenants for SaaS usage. Two atomic
 * sides per invoice:
 *
 *   1. **Revenue side** (HNS Corp PH tenant)
 *      - APBill-style line items: plan + AI add-ons
 *      - VAT split when HNS is VAT-registered AND tenant is VAT-registered
 *      - Records as a CHARGE-type Order (AR pending), eventually paid by
 *        the tenant's AP payment.
 *
 *   2. **Expense side** (customer tenant)
 *      - APBill posted to vendor "HNS Corp PH" (auto-created if missing)
 *      - Same VAT split, mirrored — Input VAT (1040) creditable when both
 *        sides are VAT-registered.
 *      - Expense lines hit account 6280 Software Subscriptions & SaaS.
 *
 * Both sides share the same period/issue date so accruals match. The
 * service is the only legitimate writer of these specific records;
 * manual JEs would diverge HNS's books from each tenant's books.
 *
 * **Privacy invariant — preserved.** This service writes INTO each
 * tenant's books (mirroring HNS's outgoing receipt). It never READS the
 * tenant's other financial data. Console operators see HNS's billing
 * dashboard, which queries HNS tenant only.
 */
@Injectable()
export class SubscriptionBillingService {
  private readonly logger = new Logger(SubscriptionBillingService.name);

  constructor(
    private readonly prisma:    PrismaService,
    private readonly platform:  PlatformService,
    private readonly numbering: NumberingService,
    private readonly apBills:   APBillsService,
  ) {}

  /**
   * Issue a single subscription bill for one customer-tenant for a period.
   * Atomic — rolls back both the HNS Order and the customer APBill on any
   * failure. Idempotent: rejects if a bill already exists for that period.
   *
   * @returns { hnsOrderId, customerBillId, totalAmount, vatAmount }
   */
  async issueSubscription(
    targetTenantId: string,
    periodStart: Date,
    periodEnd: Date,
    actorUserId: string,
  ): Promise<IssueSubscriptionResult> {
    const platform = await this.platform.get();
    if (!platform.hnsTenantId) {
      throw new BadRequestException(
        'HNS Corp PH tenant is not bootstrapped — run POST /admin/bootstrap-hns-corp first.',
      );
    }

    const target = await this.prisma.tenant.findUnique({
      where:  { id: targetTenantId },
      select: { id: true, name: true, slug: true, planCode: true, taxStatus: true, status: true, tin: true, contactEmail: true, contactPhone: true, address: true, isBirRegistered: true },
    });
    if (!target) throw new NotFoundException('Target tenant not found.');
    if (target.status === 'SUSPENDED') {
      throw new BadRequestException('Cannot bill a suspended tenant.');
    }
    if (!target.planCode) {
      throw new BadRequestException(`Tenant ${target.name} has no planCode set.`);
    }
    if (target.planCode === 'ENTERPRISE') {
      throw new BadRequestException('ENTERPRISE plan is billed manually outside this flow.');
    }

    const planPrice = (PLAN_MONTHLY_PRICE_PHP_CENTS[target.planCode as PlanCode] ?? 0) / 100;
    if (planPrice <= 0) {
      throw new BadRequestException(`No monthly price configured for plan ${target.planCode}.`);
    }

    // VAT split — only when BOTH sides are VAT-registered.
    const vatApplies = platform.taxStatus === 'VAT' && target.taxStatus === 'VAT';
    const grossAmount = +planPrice.toFixed(2);
    const vatAmount   = vatApplies ? +(grossAmount - grossAmount / 1.12).toFixed(2) : 0;
    const netAmount   = +(grossAmount - vatAmount).toFixed(2);

    // Reject duplicate billing for the same period (one bill per tenant per period).
    // The check is on the customer's side: an APBill from HNS-vendor with
    // a description matching the period.
    const periodTag = `${periodStart.toISOString().slice(0, 7)}`; // "YYYY-MM"
    const periodDescription = `Clerque ${target.planCode} — ${periodTag}`;

    const existingBill = await this.prisma.aPBill.findFirst({
      where: {
        tenantId: target.id,
        description: periodDescription,
        status: { not: 'CANCELLED' },
      },
      select: { id: true, billNumber: true },
    });
    if (existingBill) {
      throw new ConflictException(
        `Bill for ${target.name} period ${periodTag} already exists (${existingBill.billNumber}).`,
      );
    }

    const issueDate = new Date();
    const dueDate   = new Date(issueDate.getTime() + platform.subscriptionDueDays * 86_400_000);

    return this.prisma.$transaction(async (tx) => {
      // ─── Customer-side: APBill ────────────────────────────────────────────

      // 1. Get-or-create HNS Corp PH as a Vendor in target tenant.
      const hnsVendor = await this.upsertHnsVendorInTenant(tx, target.id, platform);

      // 2. Resolve the expense account 6280 Software Subscriptions on customer side.
      const expenseAccount = await tx.account.findFirst({
        where:  { tenantId: target.id, code: '6280', isActive: true },
        select: { id: true },
      });
      if (!expenseAccount) {
        throw new BadRequestException(
          'Customer tenant is missing chart-of-accounts row 6280 — re-seed default accounts.',
        );
      }
      // Optional Input VAT account (1040) — only used when VAT applies.
      const inputVatAccount = vatApplies
        ? await tx.account.findFirst({ where: { tenantId: target.id, code: '1040', isActive: true }, select: { id: true } })
        : null;

      // 3. Generate AP bill number.
      const billNumber = await this.nextAPBillNumber(tx, target.id);

      // 4. Build line items. Plan line carries the VAT-split tax amount;
      //    when VAT applies, line.taxAmount is the input VAT we'll credit.
      const lines = [{
        accountId:   expenseAccount.id,
        description: `Clerque subscription — plan ${target.planCode}`,
        quantity:    new Prisma.Decimal(1),
        unitPrice:   new Prisma.Decimal(grossAmount),
        taxAmount:   new Prisma.Decimal(vatAmount),
        lineTotal:   new Prisma.Decimal(grossAmount),
      }];

      const apBill = await tx.aPBill.create({
        data: {
          tenantId:      target.id,
          billNumber,
          vendorBillRef: '',  // will be set to HNS's order number after we create it
          vendorId:      hnsVendor.id,
          billDate:      issueDate,
          postingDate:   issueDate,
          dueDate,
          termsDays:     platform.subscriptionDueDays,
          subtotal:      new Prisma.Decimal(netAmount),
          vatAmount:     new Prisma.Decimal(vatAmount),
          whtAmount:     new Prisma.Decimal(0),
          totalAmount:   new Prisma.Decimal(grossAmount),
          paidAmount:    new Prisma.Decimal(0),
          balanceAmount: new Prisma.Decimal(grossAmount),
          status:        'DRAFT',
          description:   periodDescription,
          notes:         `Auto-issued by Clerque platform. Period: ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
          createdById:   actorUserId,
          lines:         { create: lines },
        },
        select: { id: true, billNumber: true },
      });

      // ─── HNS-side: Order (CHARGE invoiceType) ──────────────────────────────

      // 1. Get-or-create the customer-tenant as a Customer in HNS tenant.
      const hnsCustomer = await this.upsertCustomerInHnsTenant(tx, platform.hnsTenantId!, target);

      // 2. Find the default branch of HNS tenant for the order's branchId.
      const hnsBranch = await tx.branch.findFirst({
        where:  { tenantId: platform.hnsTenantId!, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (!hnsBranch) {
        throw new BadRequestException('HNS Corp PH tenant has no active branch.');
      }

      // 3. Generate order number for HNS tenant.
      const orderNumber = await this.nextOrderNumber(tx, platform.hnsTenantId!);

      // 4. Find a default product in HNS tenant for "Subscription" — or
      //    create one on first run. Service-style line; no inventory.
      const subscriptionProduct = await this.upsertSubscriptionProductInHnsTenant(
        tx, platform.hnsTenantId!, hnsBranch.id,
      );

      // 5. Create the Order with one OrderItem for the plan.
      const hnsOrder = await tx.order.create({
        data: {
          tenantId:    platform.hnsTenantId!,
          branchId:    hnsBranch.id,
          orderNumber,
          status:      'COMPLETED',          // service has been delivered (subscription period)
          subtotal:    new Prisma.Decimal(netAmount),
          discountAmount: new Prisma.Decimal(0),
          vatAmount:   new Prisma.Decimal(vatAmount),
          totalAmount: new Prisma.Decimal(grossAmount),
          customerId:  hnsCustomer.id,
          customerName: target.name,
          customerTin:  target.tin ?? null,
          invoiceType:  'CHARGE',
          taxType:      vatApplies ? 'VAT_12' : 'VAT_EXEMPT',
          dueDate,
          createdById:  actorUserId,
          completedAt:  issueDate,
          items: {
            create: [{
              productId:   subscriptionProduct.id,
              productName: `Clerque ${target.planCode} — ${periodTag}`,
              quantity:    new Prisma.Decimal(1),
              unitPrice:   new Prisma.Decimal(grossAmount),
              lineTotal:   new Prisma.Decimal(grossAmount),
              vatAmount:   new Prisma.Decimal(vatAmount),
              isVatable:   vatApplies,
              taxType:     vatApplies ? 'VAT_12' : 'VAT_EXEMPT',
            }],
          },
        },
        select: { id: true, orderNumber: true },
      });

      // 6. Update the customer's APBill to reference HNS's Order number as
      //    the vendor-bill-ref. Closes the loop for audit trail.
      await tx.aPBill.update({
        where: { id: apBill.id },
        data:  { vendorBillRef: hnsOrder.orderNumber },
      });

      // 7. Queue an AccountingEvent on the HNS side so the JE engine posts
      //    the revenue + Output VAT entries on HNS's books. Standard SALE
      //    event format (orderId on the event row).
      await tx.accountingEvent.create({
        data: {
          tenantId: platform.hnsTenantId!,
          orderId:  hnsOrder.id,
          type:     'SALE',
          status:   'PENDING',
          payload:  {
            orderId:     hnsOrder.id,
            orderNumber: hnsOrder.orderNumber,
            branchId:    hnsBranch.id,
            completedAt: issueDate.toISOString(),
            lines:       [{ productName: `Clerque ${target.planCode} — ${periodTag}`, quantity: 1, unitPrice: grossAmount, lineTotal: grossAmount, taxAmount: vatAmount, taxType: vatApplies ? 'VAT_12' : 'VAT_EXEMPT' }],
            payments:    [],   // CHARGE = no payment yet; collected via AR
            vatAmount,
            totalAmount: grossAmount,
            discountAmount: 0,
            invoiceType: 'CHARGE',
            taxType:     vatApplies ? 'VAT_12' : 'VAT_EXEMPT',
            customerName: target.name,
            customerTin:  target.tin ?? null,
          },
        },
      });

      this.logger.log(
        `[subscription-billing] Issued ${target.name}: HNS order ${hnsOrder.orderNumber} ↔ tenant bill ${apBill.billNumber} (₱${grossAmount}, VAT ${vatAmount})`,
      );

      // 8. Sprint 16 — auto-post the customer's APBill if PlatformConfig
      //    flag enabled. Posts the JE: DR 6280 + DR 1040 (when VAT) /
      //    CR 2010 AP. Otherwise the bill lands in DRAFT for tenant
      //    review (default behavior).
      let autoPosted = false;
      if (platform.subscriptionAutoPost) {
        try {
          await this.apBills.post(target.id, apBill.id, actorUserId);
          autoPosted = true;
        } catch (err) {
          this.logger.warn(
            `[subscription-billing] auto-post failed for bill ${apBill.billNumber} on tenant ${target.id}: ${err instanceof Error ? err.message : String(err)} — bill remains in DRAFT.`,
          );
          // Don't block the issuance — the customer can post the bill manually.
        }
      }

      return {
        hnsOrderId:         hnsOrder.id,
        hnsOrderNumber:     hnsOrder.orderNumber,
        customerBillId:     apBill.id,
        customerBillNumber: apBill.billNumber,
        totalAmount:        grossAmount,
        vatAmount,
        netAmount,
        targetTenantId:     target.id,
        autoPosted,
      };
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Upsert HNS Corp PH as a Vendor in the target tenant. */
  private async upsertHnsVendorInTenant(
    tx: Prisma.TransactionClient,
    targetTenantId: string,
    platform: { companyName: string; tin: string | null; address: string | null; contactEmail: string | null; contactPhone: string | null },
  ) {
    const existing = await tx.vendor.findFirst({
      where:  { tenantId: targetTenantId, name: platform.companyName },
      select: { id: true },
    });
    if (existing) return existing;

    return tx.vendor.create({
      data: {
        tenantId:     targetTenantId,
        name:         platform.companyName,
        tin:          platform.tin,
        address:      platform.address,
        contactEmail: platform.contactEmail,
        contactPhone: platform.contactPhone,
        isActive:     true,
        notes:        'Auto-created by Clerque platform — subscription billing vendor.',
      },
      select: { id: true },
    });
  }

  /** Upsert the customer-tenant as a Customer in HNS Corp PH's tenant. */
  private async upsertCustomerInHnsTenant(
    tx: Prisma.TransactionClient,
    hnsTenantId: string,
    target: { id: string; name: string; slug: string; tin: string | null; contactEmail: string | null; contactPhone: string | null; address: string | null },
  ) {
    // Use the customer-tenant's slug as a stable external key.
    const externalKey = `tenant:${target.slug}`;
    const existing = await tx.customer.findFirst({
      where:  { tenantId: hnsTenantId, name: target.name },
      select: { id: true },
    });
    if (existing) return existing;

    return tx.customer.create({
      data: {
        tenantId:     hnsTenantId,
        name:         target.name,
        contactPhone: target.contactPhone,
        contactEmail: target.contactEmail,
        defaultAddress: target.address,
        // notes:     `External key: ${externalKey}`,  // Customer model may not have notes
      },
      select: { id: true },
    });
  }

  /** Upsert a singleton "Clerque Subscription" product in HNS tenant. */
  private async upsertSubscriptionProductInHnsTenant(
    tx: Prisma.TransactionClient,
    hnsTenantId: string,
    branchId: string,
  ) {
    const existing = await tx.product.findFirst({
      where:  { tenantId: hnsTenantId, sku: 'CLERQUE-SUBSCRIPTION' },
      select: { id: true },
    });
    if (existing) return existing;

    // Create as service-style (UNIT_BASED but no inventory), VAT-able by default.
    return tx.product.create({
      data: {
        tenantId:    hnsTenantId,
        name:        'Clerque Monthly Subscription',
        sku:         'CLERQUE-SUBSCRIPTION',
        description: 'SaaS platform subscription. Variable price by plan.',
        price:       new Prisma.Decimal(0),  // overridden per line at order time
        isVatable:   true,
        isActive:    true,
        inventoryMode: 'UNIT_BASED',
      },
      select: { id: true },
    });
  }

  private async nextAPBillNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    return this.numbering.next(tenantId, 'AP_BILL', null, tx);
  }

  private async nextOrderNumber(tx: Prisma.TransactionClient, tenantId: string): Promise<string> {
    return this.numbering.next(tenantId, 'POS_ORDER', null, tx);
  }

  // ─── Cron: monthly auto-issue ────────────────────────────────────────────

  /**
   * Runs at 02:00 daily. On the first of the month, issues a subscription
   * bill for every ACTIVE tenant whose plan supports auto-billing (skip
   * ENTERPRISE — billed manually).
   *
   * Idempotent — issueSubscription rejects duplicates for the same period.
   * Failures on individual tenants are logged but don't block the rest.
   */
  @Cron('0 0 2 * * *')
  async dailySweep() {
    const platform = await this.platform.get();
    if (!platform.subscriptionAutoIssue) {
      this.logger.warn('[subscription-billing] auto-issue disabled in PlatformConfig.');
      return;
    }
    if (!platform.hnsTenantId) {
      this.logger.warn('[subscription-billing] HNS tenant not bootstrapped; skipping cron.');
      return;
    }

    const now = new Date();
    if (now.getDate() !== 1) {
      // Only run on day 1 of the month.
      return;
    }

    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const tenants = await this.prisma.tenant.findMany({
      where: {
        status:   'ACTIVE',
        planCode: { notIn: ['ENTERPRISE'] },
        // Don't bill HNS itself.
        id:       { not: platform.hnsTenantId },
      },
      select: { id: true, name: true },
    });

    let issued = 0;
    for (const t of tenants) {
      try {
        await this.issueSubscription(t.id, periodStart, periodEnd, 'SYSTEM');
        issued++;
      } catch (err: any) {
        if (err?.name === 'ConflictException') continue;
        this.logger.warn(`[subscription-billing] issue failed for ${t.name}: ${err?.message ?? err}`);
      }
    }
    this.logger.log(`[subscription-billing] cron issued ${issued}/${tenants.length} subscriptions for ${periodStart.toISOString().slice(0, 7)}`);
  }
}

export interface IssueSubscriptionResult {
  hnsOrderId:         string;
  hnsOrderNumber:     string;
  customerBillId:     string;
  customerBillNumber: string;
  totalAmount:        number;
  vatAmount:          number;
  netAmount:          number;
  targetTenantId:     string;
  autoPosted:         boolean;
}
