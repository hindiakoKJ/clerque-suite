import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BusinessType, AccountingMethod } from '@prisma/client';
import { TaxCalculatorService } from '../tax/tax.service';
import { AuditService } from '../audit/audit.service';
import { taxStatusFlags } from '@repo/shared-types';
import type { TaxStatus } from '@repo/shared-types';

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
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');

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
}
