import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { BusinessType, AccountingMethod } from '@prisma/client';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';
import * as bcrypt from 'bcryptjs';
import { taxStatusFlags, getAiQuotaForTenant, TIER_PRICING, AI_ADDONS, DEFAULT_APP_ACCESS } from '@repo/shared-types';
import type { TaxStatus, TierId, AiAddonType, UserRole } from '@repo/shared-types';

export interface UpdateTenantProfileDto {
  businessType?: BusinessType;
  name?: string;
  tin?: string;
  address?: string;
  contactEmail?: string;
  contactPhone?: string;
}

export interface UpdateTaxSettingsDto {
  taxStatus?:        TaxStatus;
  tinNumber?:        string;
  businessName?:     string;
  registeredAddress?: string;
  accountingMethod?: AccountingMethod;
  /** BIR Permit to Use status */
  isPtuHolder?:      boolean;
  ptuNumber?:        string;
  minNumber?:        string;
}

@Injectable()
export class TenantService {
  constructor(
    private prisma:   PrismaService,
    private taxCalc:  TaxCalculatorService,
    private audit:    AuditService,
  ) {}

  /** Returns all active branches for branch-picker dropdowns across the app. */
  async getBranches(tenantId: string) {
    return this.prisma.branch.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, name: true, address: true },
      orderBy: { name: 'asc' },
    });
  }

  /**
   * GET /tenant/subscription — current tier + staff usage + expiry.
   * Used by Settings → Subscription page to render the upgrade CTA.
   */
  async getSubscription(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        tier: true,
        expiresAt: true,
        branchQuota: true,
        cashierSeatQuota: true,
        hasTimeMonitoring: true,
        hasBirForms: true,
        isDemoTenant: true,
        signupSource: true,
        setupFeePaidAt: true,
        aiAddonType: true,
        aiAddonExpiresAt: true,
        aiQuotaOverride: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

    // Resolve AI quota — tier-included + active addon + override.
    const tierId = tenant.tier as TierId;
    const aiResolution = getAiQuotaForTenant(
      tierId,
      tenant.aiAddonType as AiAddonType | null,
      tenant.aiAddonExpiresAt,
      tenant.aiQuotaOverride,
    );

    // Count this month's actual usage.
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    const aiUsedThisMonth = await this.prisma.aiUsage.count({
      where: {
        tenantId,
        createdAt: { gte: startOfMonth },
        action:    { in: ['journal_drafter', 'journal_guide', 'receipt_ocr'] },
      },
    });

    // Tier pricing — looked up from the canonical pricing table.
    const tierPricing = TIER_PRICING[tierId];
    const aiAddonPackage = tenant.aiAddonType
      ? AI_ADDONS[tenant.aiAddonType as AiAddonType]
      : null;

    // Active non-owner staff count — what the tier cap limits.
    const staffCount = await this.prisma.user.count({
      where: {
        tenantId,
        isActive: true,
        role: { notIn: ['BUSINESS_OWNER', 'SUPER_ADMIN'] },
      },
    });

    // Active branch count for branch quota display.
    const branchCount = await this.prisma.branch.count({
      where: { tenantId, isActive: true },
    });

    return {
      tier:              tenant.tier,
      expiresAt:         tenant.expiresAt,
      staffCount,
      branchCount,
      branchQuota:       tenant.branchQuota,
      cashierSeatQuota:  tenant.cashierSeatQuota,
      hasTimeMonitoring: tenant.hasTimeMonitoring,
      hasBirForms:       tenant.hasBirForms,
      isDemoTenant:      tenant.isDemoTenant,
      signupSource:      tenant.signupSource,

      // Pricing — what they pay
      pricing: {
        setupFeePhp:    tierPricing.setupFeePhp,
        monthlyPhp:     tierPricing.monthlyPhp,
        annualPhp:      tierPricing.annualPhp,
        setupFeePaidAt: tenant.setupFeePaidAt,
      },

      // AI quota — usage vs budget
      ai: {
        monthlyQuota:    aiResolution.monthlyQuota,
        usedThisMonth:   aiUsedThisMonth,
        remaining:       Math.max(0, aiResolution.monthlyQuota - aiUsedThisMonth),
        source:          aiResolution.source,
        enabled:         aiResolution.enabled,
        addonType:       tenant.aiAddonType,
        addonExpiresAt:  tenant.aiAddonExpiresAt,
        addonPackage:    aiAddonPackage,
      },
    };
  }

  /**
   * SUPER_ADMIN-only: assign / extend / cancel an AI add-on subscription.
   * Plus an optional quota override (kill switch or custom quota) that beats
   * everything else. Tenant must re-login to pick up the new JWT quota.
   *
   * Examples:
   *   { addonType: 'STANDARD_200', expiresAt: '2026-05-31T23:59:59Z' }
   *     → activate Standard 200 addon until end of May
   *   { addonType: null }
   *     → cancel addon (returns tenant to tier-included quota only)
   *   { quotaOverride: 1000 }
   *     → SUPER_ADMIN custom quota (sales perk, beta)
   *   { quotaOverride: 0 }
   *     → kill switch (force AI off)
   *   { quotaOverride: null }
   *     → remove override (use tier + addon resolution)
   */
  async setAiAddon(
    tenantId:       string,
    params: {
      addonType?:     AiAddonType | null;
      expiresAt?:     Date | null;
      quotaOverride?: number | null;
    },
    performedBy:    string,
  ) {
    const before = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: {
        aiAddonType:       true,
        aiAddonExpiresAt:  true,
        aiQuotaOverride:   true,
      },
    });
    if (!before) throw new NotFoundException('Tenant not found');

    const data: Record<string, unknown> = {};
    if (params.addonType     !== undefined) data.aiAddonType      = params.addonType;
    if (params.expiresAt     !== undefined) data.aiAddonExpiresAt = params.expiresAt;
    if (params.quotaOverride !== undefined) data.aiQuotaOverride  = params.quotaOverride;

    await this.prisma.tenant.update({ where: { id: tenantId }, data });

    await this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'Tenant',
      entityId:    tenantId,
      before:      {
        aiAddonType:      before.aiAddonType,
        aiAddonExpiresAt: before.aiAddonExpiresAt,
        aiQuotaOverride:  before.aiQuotaOverride,
      },
      after:       data,
      description: 'AI add-on subscription / quota override updated',
      performedBy,
    });

    return data;
  }

  /**
   * Seed test data for the caller's own tenant — one user per major role,
   * plus a handful of sample customers / vendors / products. Idempotent:
   * users that already exist by email are left alone, and the credentials
   * are returned every time so the caller can re-fetch them.
   *
   * BUSINESS_OWNER scope only. SUPER_ADMIN can call it for any tenant via
   * a thin wrapper at the controller. NOT for use on a tenant with real
   * customer data — the predictable passwords here are weak by design.
   */
  async seedTestUsers(tenantId: string, callerId: string) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { id: true, slug: true, name: true },
    });

    // Pick or create a default branch — many roles need one assigned
    let branch = await this.prisma.branch.findFirst({
      where:   { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!branch) {
      branch = await this.prisma.branch.create({
        data: { tenantId, name: 'Main Branch', isActive: true },
      });
    }

    // ── Test user fixtures ─────────────────────────────────────────────────
    // One per major role. Email pattern: <role-key>@<slug>.test
    // Single shared password (for testing only; real production should never
    // see this seeder — it's BUSINESS_OWNER-gated and intended for the demo
    // account on prod).
    const TEST_PASSWORD = 'Test1234!';
    const TEST_PIN      = '1234';

    interface RoleSeed {
      role:       UserRole;
      name:       string;
      shortDesc:  string;     // user-facing role description
      keyAccess:  string[];   // bullet points of what they can do (for the response)
    }

    const ROLES: RoleSeed[] = [
      { role: 'BUSINESS_OWNER',   name: 'Test Owner',          shortDesc: 'Tenant admin — full access', keyAccess: ['Everything across POS, Ledger, Payroll', 'Manage staff + roles', 'Settings, BIR, audit log'] },
      { role: 'BRANCH_MANAGER',   name: 'Test Branch Manager', shortDesc: 'Branch oversight',           keyAccess: ['Approve voids + manager-override discounts', 'Settlement batches', 'Read-only Ledger', 'Cannot operate the till'] },
      { role: 'SALES_LEAD',       name: 'Test Sales Lead',     shortDesc: 'Senior cashier',             keyAccess: ['Operate POS terminal', 'Void orders without supervisor', 'Approve cashier discounts'] },
      { role: 'CASHIER',          name: 'Test Cashier',        shortDesc: 'Operates the till',          keyAccess: ['Sell, open/close shift', 'Void with supervisor co-auth', 'No price edits'] },
      { role: 'MDM',              name: 'Test MDM',            shortDesc: 'Master Data Manager',        keyAccess: ['Products, prices, categories, modifiers', 'Inventory adjust', 'No till operation'] },
      { role: 'WAREHOUSE_STAFF',  name: 'Test Warehouse',      shortDesc: 'Stock movement only',        keyAccess: ['Inventory adjust + receive stock', 'No sales, no prices'] },
      { role: 'FINANCE_LEAD',     name: 'Test Finance Lead',   shortDesc: 'Senior finance',             keyAccess: ['Bank reconciliation', 'Cash-flow reports', 'No payroll, no price edits'] },
      { role: 'BOOKKEEPER',       name: 'Test Bookkeeper',     shortDesc: 'Junior accounting',          keyAccess: ['Journal entries', 'GL posting', 'No payroll, no period close'] },
      { role: 'ACCOUNTANT',       name: 'Test Accountant',     shortDesc: 'Senior accounting',          keyAccess: ['Full Ledger read', 'Journal entries', 'Period close (with OWNER co-auth)'] },
      { role: 'AR_ACCOUNTANT',    name: 'Test AR Accountant',  shortDesc: 'Customer billing',           keyAccess: ['Customer invoices + collections', 'Read POS sales'] },
      { role: 'AP_ACCOUNTANT',    name: 'Test AP Accountant',  shortDesc: 'Vendor billing',             keyAccess: ['Supplier bills + payments', 'Vendor master data'] },
      { role: 'PAYROLL_MASTER',   name: 'Test Payroll Master', shortDesc: 'Payroll runs',               keyAccess: ['Salary view + edits', 'Run payroll', 'Government contributions (SSS/PhilHealth/Pag-IBIG)'] },
      { role: 'GENERAL_EMPLOYEE', name: 'Test Employee',       shortDesc: 'Generic employee',           keyAccess: ['Clock in / out', 'Submit expense claims', 'View own payslips'] },
      { role: 'EXTERNAL_AUDITOR', name: 'Test Auditor',        shortDesc: 'Read-only compliance',       keyAccess: ['Read-only Ledger + audit log', 'BIR reports', 'Zero write access'] },
    ];

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    const pinHash      = await bcrypt.hash(TEST_PIN, 8);

    const created: { role: UserRole; email: string; alreadyExisted: boolean }[] = [];
    for (const seed of ROLES) {
      const slug  = seed.role.toLowerCase().replace(/_/g, '');
      const email = `${slug}@${tenant.slug}.test`;

      const existing = await this.prisma.user.findFirst({
        where:  { tenantId, email },
        select: { id: true },
      });
      if (existing) {
        created.push({ role: seed.role, email, alreadyExisted: true });
        continue;
      }

      const access = DEFAULT_APP_ACCESS[seed.role] ?? [];
      await this.prisma.user.create({
        data: {
          tenantId,
          // Owners + cashiers + sales-lead + general employees get a branch.
          // Pure back-office roles stay null so they aren't bound to one branch.
          branchId: ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'SALES_LEAD', 'CASHIER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE'].includes(seed.role)
            ? branch.id
            : null,
          email,
          passwordHash,
          kioskPin:    pinHash,
          name:        seed.name,
          role:        seed.role,
          isActive:    true,
          appAccess: {
            create: access.map((a) => ({ appCode: a.app, level: a.level })),
          },
        },
      });
      created.push({ role: seed.role, email, alreadyExisted: false });
    }

    // ── Sample masters: customers + vendors ────────────────────────────────
    // Skipped if any already exist for this tenant — keeps the seeder safe.
    const existingCustomers = await this.prisma.customer.count({ where: { tenantId } });
    let customersCreated = 0;
    if (existingCustomers === 0) {
      await this.prisma.customer.createMany({
        data: [
          { tenantId, name: 'Andoks Manila Branch',     contactEmail: 'orders@andoks.test',  contactPhone: '+639171234001', creditTermDays: 30, isActive: true },
          { tenantId, name: 'Manila Office Tower',      contactEmail: 'admin@mot.test',      contactPhone: '+639171234002', creditTermDays: 30, isActive: true },
          { tenantId, name: 'BGC Coworking Hub',        contactEmail: 'orders@bgcwork.test', contactPhone: '+639171234003', creditTermDays: 15, isActive: true },
          { tenantId, name: 'Sample Walk-in Customer',  contactEmail: null,                  contactPhone: null,            creditTermDays: 0,  isActive: true },
        ],
      });
      customersCreated = 4;
    }

    const existingVendors = await this.prisma.vendor.count({ where: { tenantId } });
    let vendorsCreated = 0;
    if (existingVendors === 0) {
      await this.prisma.vendor.createMany({
        data: [
          { tenantId, name: 'Meralco',                  tin: '000-100-200-300', contactEmail: 'billing@meralco.test',  contactPhone: '+639171234101', isActive: true },
          { tenantId, name: 'PLDT Business',            tin: '000-100-200-301', contactEmail: 'biz@pldt.test',         contactPhone: '+639171234102', isActive: true },
          { tenantId, name: 'Coffee Bean Supplier Co.', tin: '000-100-200-302', contactEmail: 'sales@coffeesupp.test', contactPhone: '+639171234103', isActive: true },
        ],
      });
      vendorsCreated = 3;
    }

    // ── Sample products + inventory + sales history ─────────────────────────
    // Demo data for the POS + Ledger walkthrough. All idempotent — skipped
    // if anything already exists in the relevant table.
    const demoData = await this.seedDemoTransactions(tenantId, branch.id, callerId);

    // Audit log
    await this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'Tenant',
      entityId:    tenantId,
      after:       {
        seedTestUsers:    created.length,
        customersCreated, vendorsCreated,
        ...demoData,
      },
      description: 'Test users + sample masters + demo transactions seeded',
      performedBy: callerId,
    });

    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      branch: { id: branch.id, name: branch.name },
      credentials: ROLES.map((seed) => {
        const slug  = seed.role.toLowerCase().replace(/_/g, '');
        const c = created.find((x) => x.role === seed.role);
        return {
          role:           seed.role,
          name:           seed.name,
          shortDesc:      seed.shortDesc,
          email:          `${slug}@${tenant.slug}.test`,
          password:       TEST_PASSWORD,
          pin:            TEST_PIN,
          alreadyExisted: c?.alreadyExisted ?? false,
          keyAccess:      seed.keyAccess,
        };
      }),
      samples: {
        customersCreated,
        vendorsCreated,
        customersAlreadyExisted: existingCustomers,
        vendorsAlreadyExisted:   existingVendors,
      },
      loginInstructions: [
        `Tenant ID:  ${tenant.slug}`,
        `Password:   ${TEST_PASSWORD}  (same for every test user)`,
        `PIN:        ${TEST_PIN}        (same for every test user)`,
        `Email:      <role>@${tenant.slug}.test  (e.g. cashier@${tenant.slug}.test)`,
      ],
    };
  }

  async getProfile(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        tin: true,
        tinNumber: true,
        businessName: true,
        address: true,
        registeredAddress: true,
        contactEmail: true,
        contactPhone: true,
        status: true,
        tier: true,
        taxStatus: true,
        isVatRegistered: true,
        isBirRegistered: true,
        accountingMethod: true,
        isPtuHolder: true,
        ptuNumber: true,
        minNumber: true,
        inventoryMode: true,
        valuationMethod: true,
        firstTransactionAt: true,         // Sprint 4A — locks valuationMethod once set
        overheadRatePerUnit: true,        // Sprint 6 — manufacturing overhead
        hasTimeMonitoring: true,
        hasBirForms: true,
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateProfile(tenantId: string, dto: UpdateTenantProfileDto) {
    await this.getProfile(tenantId);
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: dto,
      select: {
        id: true,
        name: true,
        businessType: true,
        tin: true,
        address: true,
        contactEmail: true,
        contactPhone: true,
      },
    });
  }

  /**
   * Sprint 6 — Set the manufacturing overhead rate (₱ per unit produced).
   *
   * Only meaningful for MANUFACTURING tenants. F&B and retail keep this
   * null because PFRS for SMEs treats utilities/rent as OpEx (not COGS)
   * for service-and-merchandising businesses. Setting a non-zero rate on
   * a non-manufacturing tenant is rejected with a clear message — better
   * to fail loud than silently mis-state COGS.
   */
  async setOverheadRate(tenantId: string, ratePerUnit: number | null) {
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { businessType: true },
    });
    if (!tenant) throw new NotFoundException('Tenant not found.');

    if (ratePerUnit != null && tenant.businessType !== 'MANUFACTURING') {
      throw new BadRequestException(
        'Overhead allocation only applies to MANUFACTURING tenants. ' +
        'For F&B and retail, utilities and rent should be recorded as ' +
        'Operating Expenses, not COGS (per PFRS for SMEs).',
      );
    }
    if (ratePerUnit != null && (Number.isNaN(ratePerUnit) || ratePerUnit < 0)) {
      throw new BadRequestException('Overhead rate must be a non-negative number.');
    }

    return this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { overheadRatePerUnit: ratePerUnit != null ? new Prisma.Decimal(ratePerUnit) : null },
      select: { overheadRatePerUnit: true },
    });
  }

  /**
   * Update inventory valuation method (WAC ↔ FIFO).
   *
   * Locked once a transaction has been posted: changing the method mid-stream
   * produces nonsensical COGS because old transactions were costed under the
   * previous method. The lock is enforced via Tenant.firstTransactionAt —
   * which is set the first time an order completes successfully.
   *
   * To change the method after lock:
   *   1. Close out the current fiscal year
   *   2. Have a CPA review the proposed switch
   *   3. SUPER_ADMIN clears firstTransactionAt manually via Console
   * (We don't expose this self-serve — the accounting implications are real.)
   */
  async setValuationMethod(
    tenantId:    string,
    method:      'WAC' | 'FIFO',
    performedBy: string,
  ) {
    const current = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { valuationMethod: true, firstTransactionAt: true },
    });
    if (!current) throw new NotFoundException('Tenant not found.');

    if (current.firstTransactionAt) {
      throw new BadRequestException(
        'Valuation method is locked because transactions have already been posted. ' +
        'Changing it now would produce inconsistent COGS. Contact support to discuss ' +
        'a clean cutover at fiscal year-end.',
      );
    }
    if (current.valuationMethod === method) {
      return { valuationMethod: method, unchanged: true };
    }

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data:  { valuationMethod: method },
      select: { valuationMethod: true },
    });
    // Audit (best-effort)
    await this.audit.log({
      tenantId,
      action:      'SETTING_CHANGED',
      entityType:  'Tenant',
      entityId:    tenantId,
      before:      { valuationMethod: current.valuationMethod },
      after:       { valuationMethod: method },
      description: `Inventory valuation method changed to ${method}`,
      performedBy,
    }).catch(() => undefined);

    return updated;
  }

  /**
   * Update BIR tax classification, TIN, and accounting method.
   *
   * Rules:
   *  - taxStatus drives isVatRegistered + isBirRegistered (derived via taxStatusFlags).
   *    All three are updated atomically to prevent drift.
   *  - tinNumber is validated against the BIR format 000-000-000-00000 before saving.
   *  - Changes are written to the immutable AuditLog for BIR compliance.
   *  - Clients must re-authenticate after this call; the JWT still holds the old flags.
   */
  async updateTaxSettings(
    tenantId:    string,
    dto:         UpdateTaxSettingsDto,
    performedBy: string,
    ipAddress?:  string,
  ) {
    const current = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { taxStatus: true, tinNumber: true, businessName: true, registeredAddress: true,
                accountingMethod: true, isVatRegistered: true, isBirRegistered: true,
                isPtuHolder: true, ptuNumber: true, minNumber: true },
    });

    // Validate TIN format before any write
    if (dto.tinNumber != null) {
      this.taxCalc.validateTin(dto.tinNumber); // throws BadRequestException on invalid format
    }

    // Derive boolean flags from the incoming taxStatus (or keep current if unchanged)
    const nextStatus = dto.taxStatus ?? (current.taxStatus as TaxStatus);
    const { isVatRegistered, isBirRegistered } = taxStatusFlags(nextStatus);

    const updated = await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(dto.taxStatus          != null ? { taxStatus: dto.taxStatus, isVatRegistered, isBirRegistered } : {}),
        ...(dto.tinNumber          != null ? { tinNumber: dto.tinNumber }               : {}),
        ...(dto.businessName       != null ? { businessName: dto.businessName }         : {}),
        ...(dto.registeredAddress  != null ? { registeredAddress: dto.registeredAddress } : {}),
        ...(dto.accountingMethod   != null ? { accountingMethod: dto.accountingMethod } : {}),
        ...(dto.isPtuHolder        != null ? { isPtuHolder: dto.isPtuHolder }           : {}),
        ...(dto.ptuNumber          != null ? { ptuNumber: dto.ptuNumber }               : {}),
        ...(dto.minNumber          != null ? { minNumber: dto.minNumber }               : {}),
      },
      select: {
        id: true, taxStatus: true, tinNumber: true, businessName: true, registeredAddress: true,
        accountingMethod: true, isVatRegistered: true, isBirRegistered: true,
        isPtuHolder: true, ptuNumber: true, minNumber: true,
      },
    });

    // MEDIUM-3 fix: Revoke all active sessions for this tenant's users so the new
    // tax flags (isVatRegistered, isBirRegistered, taxStatus) take effect immediately.
    // Without this, existing JWTs carry the old flags for up to 15 minutes, allowing
    // a downgraded NON_VAT tenant to continue submitting VAT orders during that window.
    if (dto.taxStatus != null && dto.taxStatus !== current.taxStatus) {
      await this.prisma.userSession.updateMany({
        where: { user: { tenantId } },
        data:  { status: 'REVOKED' },
      });
    }

    // Audit logging — fire-and-forget (do not await; write failure is non-fatal)
    const beforeSnap = { taxStatus: current.taxStatus, tinNumber: current.tinNumber,
                         businessName: current.businessName, accountingMethod: current.accountingMethod,
                         isPtuHolder: current.isPtuHolder, ptuNumber: current.ptuNumber, minNumber: current.minNumber };
    const afterSnap  = { taxStatus: updated.taxStatus, tinNumber: updated.tinNumber,
                         businessName: updated.businessName, accountingMethod: updated.accountingMethod,
                         isPtuHolder: updated.isPtuHolder, ptuNumber: updated.ptuNumber, minNumber: updated.minNumber };

    if (dto.taxStatus != null && dto.taxStatus !== current.taxStatus) {
      void this.audit.logTaxStatusChange(tenantId, beforeSnap, afterSnap, performedBy, ipAddress);
    }
    if (dto.tinNumber != null && dto.tinNumber !== current.tinNumber) {
      void this.audit.logTinUpdate(tenantId, current.tinNumber, dto.tinNumber, performedBy, ipAddress);
    }
    if ((dto.businessName != null && dto.businessName !== current.businessName) ||
        (dto.accountingMethod != null && dto.accountingMethod !== current.accountingMethod)) {
      void this.audit.log({
        tenantId, action: 'SETTING_CHANGED', entityType: 'Tenant', entityId: tenantId,
        before: beforeSnap, after: afterSnap,
        description: 'Tenant settings updated',
        performedBy, ipAddress,
      });
    }

    return updated;
  }

  async getAndValidate(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.status === 'SUSPENDED') {
      throw new ForbiddenException('Subscription suspended. Contact support.');
    }
    return tenant;
  }

  async assertBranchBelongsToTenant(branchId: string, tenantId: string) {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId },
    });
    if (!branch) throw new ForbiddenException('Branch not found in this tenant');
    return branch;
  }

  // ── Ledger thresholds (JE approval + dashboard severity) ─────────────────

  async getLedgerThresholds(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({
      where:  { id: tenantId },
      select: { jeApprovalThreshold: true, metricsThresholds: true },
    });
    return {
      jeApprovalThreshold: Number(t.jeApprovalThreshold),
      metricsThresholds:   (t.metricsThresholds ?? null) as Record<string, number> | null,
    };
  }

  async updateLedgerThresholds(
    tenantId: string,
    body: { jeApprovalThreshold?: number; metricsThresholds?: Record<string, number> },
  ) {
    if (body.jeApprovalThreshold != null && body.jeApprovalThreshold < 0) {
      throw new ForbiddenException('JE approval threshold must be 0 or more (0 = no approval gate).');
    }
    return this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(body.jeApprovalThreshold != null
          ? { jeApprovalThreshold: new Prisma.Decimal(body.jeApprovalThreshold) }
          : {}),
        ...(body.metricsThresholds !== undefined
          ? { metricsThresholds: (body.metricsThresholds as Prisma.InputJsonValue) }
          : {}),
      },
      select: { jeApprovalThreshold: true, metricsThresholds: true },
    });
  }

  // ─── Demo transaction seeder ──────────────────────────────────────────────
  /**
   * Seeds a realistic dataset for presentation/demo purposes:
   *   • 3 categories
   *   • 8 products with cost prices + inventory at the main branch
   *   • 12 POS orders spread across the last 14 days
   *   • 1 formal AR invoice (OPEN) + 1 partial-paid
   *   • 1 formal AP bill (OPEN with WHT) + 1 paid
   *   • Current month accounting period (auto-created by other flows; we ensure)
   *
   * Every step is idempotent — checks the relevant table for existing rows
   * and skips if anything's already there. Safe to call repeatedly.
   *
   * Returns counts for audit-log output.
   */
  private async seedDemoTransactions(tenantId: string, branchId: string, callerId: string) {
    const out = {
      categoriesCreated: 0,
      productsCreated:   0,
      inventorySeeded:   0,
      ordersCreated:     0,
      arInvoicesCreated: 0,
      apBillsCreated:    0,
    };

    // ── Categories ─────────────────────────────────────────────────────────
    const existingCats = await this.prisma.category.count({ where: { tenantId } });
    let beverageCat: { id: string } | null = null;
    let foodCat:     { id: string } | null = null;
    let bakeryCat:   { id: string } | null = null;
    if (existingCats === 0) {
      [beverageCat, foodCat, bakeryCat] = await Promise.all([
        this.prisma.category.create({ data: { tenantId, name: 'Beverages', sortOrder: 1 }, select: { id: true } }),
        this.prisma.category.create({ data: { tenantId, name: 'Food',      sortOrder: 2 }, select: { id: true } }),
        this.prisma.category.create({ data: { tenantId, name: 'Bakery',    sortOrder: 3 }, select: { id: true } }),
      ]);
      out.categoriesCreated = 3;
    } else {
      // Pick whatever exists — best-effort fallback for repeat calls
      const existing = await this.prisma.category.findMany({
        where: { tenantId }, select: { id: true, name: true },
      });
      beverageCat = existing.find((c) => /beverage|drink/i.test(c.name)) ?? existing[0] ?? null;
      foodCat     = existing.find((c) => /food/i.test(c.name))           ?? existing[0] ?? null;
      bakeryCat   = existing.find((c) => /bakery|bread/i.test(c.name))   ?? existing[0] ?? null;
    }

    // ── Products ───────────────────────────────────────────────────────────
    const existingProducts = await this.prisma.product.count({ where: { tenantId } });
    interface DemoProduct {
      name: string; categoryId: string | null;
      price: number; cost: number; isVatable: boolean;
      stockQty: number; stockAvgCost: number;
    }
    const products: DemoProduct[] = existingProducts === 0 ? [
      { name: 'Iced Coffee 16oz',  categoryId: beverageCat?.id ?? null, price: 110, cost: 35, isVatable: true,  stockQty: 80,  stockAvgCost: 35 },
      { name: 'Iced Latte 16oz',   categoryId: beverageCat?.id ?? null, price: 130, cost: 45, isVatable: true,  stockQty: 70,  stockAvgCost: 45 },
      { name: 'Hot Americano',     categoryId: beverageCat?.id ?? null, price: 95,  cost: 28, isVatable: true,  stockQty: 60,  stockAvgCost: 28 },
      { name: 'Bottled Water',     categoryId: beverageCat?.id ?? null, price: 25,  cost: 12, isVatable: false, stockQty: 200, stockAvgCost: 12 },
      { name: 'Tuna Sandwich',     categoryId: foodCat?.id     ?? null, price: 95,  cost: 40, isVatable: true,  stockQty: 25,  stockAvgCost: 40 },
      { name: 'Pasta Aglio Olio',  categoryId: foodCat?.id     ?? null, price: 165, cost: 70, isVatable: true,  stockQty: 18,  stockAvgCost: 70 },
      { name: 'Plain Donut',       categoryId: bakeryCat?.id   ?? null, price: 35,  cost: 12, isVatable: false, stockQty: 50,  stockAvgCost: 12 },
      { name: 'Chocolate Croissant', categoryId: bakeryCat?.id ?? null, price: 75,  cost: 28, isVatable: false, stockQty: 30,  stockAvgCost: 28 },
    ] : [];

    const productRows: { id: string; name: string; price: number; cost: number; isVatable: boolean; categoryId: string | null }[] = [];
    for (const p of products) {
      const created = await this.prisma.product.create({
        data: {
          tenantId,
          name:      p.name,
          price:     new Prisma.Decimal(p.price),
          costPrice: new Prisma.Decimal(p.cost),
          isVatable: p.isVatable,
          isActive:  true,
          inventoryMode: 'UNIT_BASED',
          ...(p.categoryId ? { categoryId: p.categoryId } : {}),
        },
        select: { id: true, name: true, price: true, costPrice: true, isVatable: true, categoryId: true },
      });
      productRows.push({
        id: created.id, name: created.name,
        price: Number(created.price),
        cost:  Number(created.costPrice ?? p.cost),
        isVatable: created.isVatable,
        categoryId: created.categoryId,
      });
      // Seed inventory + avgCost
      await this.prisma.inventoryItem.create({
        data: {
          tenantId, branchId, productId: created.id,
          quantity: new Prisma.Decimal(p.stockQty),
          avgCost:  new Prisma.Decimal(p.stockAvgCost),
          lowStockAlert: 10,
        },
      });
      out.productsCreated++;
      out.inventorySeeded++;
    }

    // ── POS orders (last 14 days) ──────────────────────────────────────────
    // Skip if any order exists for this tenant already
    const existingOrders = await this.prisma.order.count({ where: { tenantId } });
    if (existingOrders === 0 && productRows.length > 0) {
      // Pick a random cashier user to attribute orders to
      const cashier = await this.prisma.user.findFirst({
        where: { tenantId, role: 'CASHIER' }, select: { id: true },
      });
      if (cashier) {
        const today = new Date();
        for (let i = 0; i < 12; i++) {
          // Spread across last 14 days, random hour 8-18
          const daysBack = Math.floor(i / 12 * 14);
          const completedAt = new Date(today);
          completedAt.setDate(completedAt.getDate() - daysBack);
          completedAt.setHours(8 + (i % 10), (i * 7) % 60, 0, 0);

          // 1-3 random products per order
          const lineCount = 1 + (i % 3);
          const orderItems: Array<{ product: typeof productRows[0]; qty: number }> = [];
          for (let j = 0; j < lineCount; j++) {
            const p = productRows[(i * 3 + j) % productRows.length];
            const qty = 1 + (j % 2);
            orderItems.push({ product: p, qty });
          }

          // Compute totals
          let subtotal = 0;
          let vatAmount = 0;
          for (const oi of orderItems) {
            const lineNet = oi.product.price * oi.qty;
            subtotal += lineNet;
            if (oi.product.isVatable) {
              // Tenant is VAT-registered (demo seed sets this); VAT-inclusive pricing
              // → vatAmount = lineNet * 12/112
              vatAmount += (lineNet * 12) / 112;
            }
          }
          const totalAmount = subtotal;
          const orderNumber = `ORD-DEMO-${String(i + 1).padStart(4, '0')}`;

          await this.prisma.order.create({
            data: {
              tenantId, branchId,
              orderNumber,
              status: 'COMPLETED',
              subtotal:        new Prisma.Decimal(subtotal),
              totalAmount:     new Prisma.Decimal(totalAmount),
              vatAmount:       new Prisma.Decimal(vatAmount.toFixed(2)),
              discountAmount:  new Prisma.Decimal(0),
              isPwdScDiscount: false,
              invoiceType:     'CASH_SALE',
              taxType:         'VAT_12',
              completedAt,
              createdAt:       completedAt,
              createdById:     cashier.id,
              items: {
                create: orderItems.map((oi) => ({
                  productId:   oi.product.id,
                  productName: oi.product.name,
                  unitPrice:   new Prisma.Decimal(oi.product.price),
                  quantity:    new Prisma.Decimal(oi.qty),
                  lineTotal:   new Prisma.Decimal(oi.product.price * oi.qty),
                  costPrice:   new Prisma.Decimal(oi.product.cost),
                  isVatable:   oi.product.isVatable,
                  taxType:     oi.product.isVatable ? 'VAT_12' : 'VAT_EXEMPT',
                  vatAmount:   new Prisma.Decimal(
                    oi.product.isVatable ? ((oi.product.price * oi.qty * 12) / 112).toFixed(2) : 0,
                  ),
                  discountAmount: new Prisma.Decimal(0),
                })),
              },
              payments: {
                create: [{
                  method:    'CASH',
                  amount:    new Prisma.Decimal(totalAmount),
                  reference: `DEMO-${orderNumber}`,
                }],
              },
            },
          });
          out.ordersCreated++;
        }
      }
    }

    // ── Formal AR invoices ────────────────────────────────────────────────
    const existingArInvoices = await this.prisma.aRInvoice.count({ where: { tenantId } }).catch(() => 0);
    if (existingArInvoices === 0) {
      const customer = await this.prisma.customer.findFirst({
        where:   { tenantId, name: { contains: 'Manila Office Tower' } },
        select:  { id: true },
      });
      const revenueAccount = await this.prisma.account.findFirst({
        where:   { tenantId, code: { startsWith: '4' }, isActive: true },
        select:  { id: true },
      });
      if (customer && revenueAccount) {
        const today  = new Date();
        const issued = new Date(today); issued.setDate(issued.getDate() - 15);
        const due    = new Date(today); due.setDate(due.getDate() + 15);

        // OPEN invoice
        try {
          await this.prisma.aRInvoice.create({
            data: {
              tenantId, branchId, customerId: customer.id,
              invoiceNumber: 'INV-DEMO-0001',
              status:        'OPEN',
              invoiceDate:   issued,
              postingDate:   issued,
              dueDate:       due,
              termsDays:     30,
              reference:     'PO-DEMO-001',
              description:   'Sample monthly retainer',
              subtotal:      new Prisma.Decimal(50000),
              vatAmount:     new Prisma.Decimal(6000),
              totalAmount:   new Prisma.Decimal(56000),
              paidAmount:    new Prisma.Decimal(0),
              balanceAmount: new Prisma.Decimal(56000),
              createdById:   callerId,
              lines: {
                create: [{
                  accountId:   revenueAccount.id,
                  description: 'Monthly retainer service',
                  quantity:    new Prisma.Decimal(1),
                  unitPrice:   new Prisma.Decimal(50000),
                  taxAmount:   new Prisma.Decimal(6000),
                  lineTotal:   new Prisma.Decimal(56000),
                }],
              },
            },
          });
          out.arInvoicesCreated++;
        } catch { /* schema variant — skip */ }
      }
    }

    // ── Formal AP bills with WHT ───────────────────────────────────────────
    const existingApBills = await this.prisma.aPBill.count({ where: { tenantId } }).catch(() => 0);
    if (existingApBills === 0) {
      const vendor = await this.prisma.vendor.findFirst({
        where:   { tenantId, name: { contains: 'Meralco' } },
        select:  { id: true },
      });
      const expenseAccount = await this.prisma.account.findFirst({
        where:   { tenantId, code: { startsWith: '6' }, isActive: true },
        select:  { id: true },
      });
      if (vendor && expenseAccount) {
        const today  = new Date();
        const issued = new Date(today); issued.setDate(issued.getDate() - 10);
        const due    = new Date(today); due.setDate(due.getDate() + 20);

        try {
          await this.prisma.aPBill.create({
            data: {
              tenantId, branchId, vendorId: vendor.id,
              billNumber:    'BILL-DEMO-0001',
              vendorBillRef: 'MERALCO-2026-04',
              status:        'OPEN',
              billDate:      issued,
              postingDate:   issued,
              dueDate:       due,
              termsDays:     30,
              description:   'Monthly electricity bill',
              subtotal:      new Prisma.Decimal(15000),
              vatAmount:     new Prisma.Decimal(1800),
              totalAmount:   new Prisma.Decimal(16800),
              whtAmount:     new Prisma.Decimal(750),  // 5% on rentals/utilities-like (simplified)
              whtAtcCode:    'WC100',
              paidAmount:    new Prisma.Decimal(0),
              balanceAmount: new Prisma.Decimal(16050), // 16800 − 750 WHT
              createdById:   callerId,
              lines: {
                create: [{
                  accountId:   expenseAccount.id,
                  description: 'Utilities — Electricity',
                  quantity:    new Prisma.Decimal(1),
                  unitPrice:   new Prisma.Decimal(15000),
                  taxAmount:   new Prisma.Decimal(1800),
                  lineTotal:   new Prisma.Decimal(16800),
                }],
              },
            },
          });
          out.apBillsCreated++;
        } catch { /* schema variant — skip */ }
      }
    }

    return out;
  }
}
