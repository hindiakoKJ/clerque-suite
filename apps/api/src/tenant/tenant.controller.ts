import { Controller, Get, Patch, Post, Body, Param, Req, UseGuards, HttpCode, HttpStatus, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantProfileDto } from './dto/update-tenant-profile.dto';
import { UpdateTaxSettingsDto } from './dto/update-tax-settings.dto';

@ApiTags('Tenant')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenant')
export class TenantController {
  constructor(private tenantService: TenantService) {}

  /** Returns all active branches for the authenticated user's tenant.
   *  Used by product inventory prompt, shift open, and any branch-picker UI. */
  @Roles(
    'CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT',
    'BOOKKEEPER', 'FINANCE_LEAD', 'MDM', 'PAYROLL_MASTER',
    'WAREHOUSE_STAFF', 'SALES_LEAD', 'AR_ACCOUNTANT', 'AP_ACCOUNTANT',
    'GENERAL_EMPLOYEE',
  )
  @Get('branches')
  getBranches(@CurrentUser() user: JwtPayload) {
    return this.tenantService.getBranches(user.tenantId!);
  }

  @Roles('CASHIER', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'ACCOUNTANT')
  @Get('profile')
  getProfile(@CurrentUser() user: JwtPayload) {
    return this.tenantService.getProfile(user.tenantId!);
  }

  /**
   * GET /tenant/subscription
   * Drives the Settings → Subscription page: current tier, staff usage vs cap,
   * branches vs quota, and feature flags. BUSINESS_OWNER only — staff don't
   * need to see the upgrade CTA on a shared terminal.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('subscription')
  getSubscription(@CurrentUser() user: JwtPayload) {
    return this.tenantService.getSubscription(user.tenantId!);
  }

  /**
   * POST /tenant/seed-test-users
   * Idempotent — creates one user per role plus sample customers/vendors.
   * BUSINESS_OWNER scope only. Returns full credentials list.
   *
   * Use case: spin up a test demo on prod with realistic role coverage so
   * you can sign in as each role and see what they see. Predictable
   * password "Test1234!" + PIN "1234" — never use on a tenant with real
   * customer data.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('seed-test-users')
  @HttpCode(HttpStatus.OK)
  seedTestUsers(@CurrentUser() user: JwtPayload) {
    return this.tenantService.seedTestUsers(user.tenantId!, user.sub);
  }

  /**
   * PATCH /tenant/ai-addon
   * SUPER_ADMIN-only — assign / extend / cancel AI add-on, or set a custom
   * quota override.
   *
   * Body shape:
   *   {
   *     tenantId?:      string         // target tenant; defaults to caller's
   *     addonType?:     'STARTER_50' | 'STANDARD_200' | 'PRO_500' | null
   *     expiresAt?:     ISO8601 string | null
   *     quotaOverride?: number | null  // 0 = kill switch, >0 = custom, null = remove
   *   }
   *
   * Tenant user must re-login to pick up the new aiQuotaMonthly in their JWT.
   */
  @Roles('SUPER_ADMIN')
  @Patch('ai-addon')
  @HttpCode(HttpStatus.OK)
  setAiAddon(
    @CurrentUser() user: JwtPayload,
    @Body() body: {
      tenantId?:      string;
      addonType?:     'STARTER_50' | 'STANDARD_200' | 'PRO_500' | null;
      expiresAt?:     string | null;
      quotaOverride?: number | null;
    },
  ) {
    const targetTenantId = body.tenantId ?? user.tenantId;
    if (!targetTenantId) {
      throw new BadRequestException('tenantId is required when called outside a tenant context.');
    }
    return this.tenantService.setAiAddon(
      targetTenantId,
      {
        addonType:     body.addonType,
        expiresAt:     body.expiresAt === undefined
                          ? undefined
                          : body.expiresAt === null
                            ? null
                            : new Date(body.expiresAt),
        quotaOverride: body.quotaOverride,
      },
      user.sub,
    );
  }

  @Roles('BUSINESS_OWNER')
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(@CurrentUser() user: JwtPayload, @Body() body: UpdateTenantProfileDto) {
    return this.tenantService.updateProfile(user.tenantId!, body);
  }

  /**
   * POST /tenant/branches — create a new branch.
   *
   * Plan-aware: rejects when the tenant has already provisioned `maxBranches`
   * for their plan code (PLAN_LIMITS). Owners can buy a higher plan from
   * Settings → Subscription to lift the cap.
   *
   * BUSINESS_OWNER + SUPER_ADMIN only — adding a branch is a structural,
   * billing-relevant change that staff shouldn't make.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Post('branches')
  @HttpCode(HttpStatus.CREATED)
  createBranch(
    @CurrentUser() user: JwtPayload,
    @Body() body: { name?: string; address?: string },
  ) {
    if (!body.name || body.name.trim().length < 2) {
      throw new BadRequestException('Branch name must be at least 2 characters.');
    }
    return this.tenantService.createBranch(user.tenantId!, {
      name:    body.name.trim(),
      address: body.address?.trim() || null,
    });
  }

  /**
   * PATCH /tenant/branches/:id — rename / change address / toggle active.
   * BUSINESS_OWNER + SUPER_ADMIN.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('branches/:id')
  @HttpCode(HttpStatus.OK)
  updateBranch(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { name?: string; address?: string | null; isActive?: boolean },
  ) {
    return this.tenantService.updateBranch(user.tenantId!, id, body);
  }

  /**
   * PATCH /tenant/tax-settings
   *
   * Updates operational fields (TIN, business name, registered address, PTU/MIN).
   * Sprint 12 — three policy fields (taxStatus, accountingMethod, isBirRegistered)
   * are now CONSOLE-only. If an owner posts any of those, returns 403
   * CONSOLE_ONLY_POLICY. SUPER_ADMIN can still write all fields when
   * authenticating into the tenant (ops/support workflow).
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('tax-settings')
  @HttpCode(HttpStatus.OK)
  updateTaxSettings(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdateTaxSettingsDto,
    @Req() req: Request,
  ) {
    // Owner attempting to change a policy field — 403 with the same code the
    // valuation/overhead endpoints use. Surfaces a friendly message to the UI
    // and is consistent across all four locked policy knobs.
    if (!user.isSuperAdmin) {
      const policyField =
        body.taxStatus        != null ? 'taxStatus'        :
        body.accountingMethod != null ? 'accountingMethod' :
        null;
      if (policyField) {
        throw new ForbiddenException({
          code:    'CONSOLE_ONLY_POLICY',
          field:   policyField,
          message: `${policyField} is now controlled by HNS support. Contact us to change.`,
        });
      }
    }

    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                    ?? req.socket?.remoteAddress;
    return this.tenantService.updateTaxSettings(
      user.tenantId!,
      body,
      user.sub,
      ipAddress,
      Boolean(user.isSuperAdmin),
    );
  }

  /**
   * Sprint 12 — valuation method is now console-only.
   *
   * Why: switching valuation mid-year produces inconsistent COGS. Even with
   * the existing first-transaction auto-lock, owners were able to switch
   * before issuing their first OR (the most common scenario where a coffee
   * shop signs up Friday, plays with WAC/FIFO over the weekend, then opens
   * Monday with whatever they last clicked). HNS support owns this knob now;
   * the tenant sees the value read-only in Settings.
   *
   * SUPER_ADMIN can still hit this endpoint — for support workflows that
   * authenticate AS the tenant — but the friendlier console path is
   * PATCH /admin/tenants/:id/profile { valuationMethod: 'FIFO' }.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('valuation-method')
  @HttpCode(HttpStatus.OK)
  setValuationMethod(
    @CurrentUser() user: JwtPayload,
    @Body() _body: { method: 'WAC' | 'FIFO' },
  ) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException({
        code:    'CONSOLE_ONLY_POLICY',
        field:   'valuationMethod',
        message: 'Inventory valuation method is now controlled by HNS support. Contact us to change.',
      });
    }
    return this.tenantService.setValuationMethod(user.tenantId!, _body.method, user.sub);
  }

  /**
   * Sprint 12 — overhead rate is now console-only (same reason as valuation
   * method: changing the COGS base mid-year corrupts gross margin reporting).
   * Tenants see the value read-only in Settings → Costing.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('overhead-rate')
  @HttpCode(HttpStatus.OK)
  setOverheadRate(
    @CurrentUser() user: JwtPayload,
    @Body() body: { ratePerUnit: number | null },
  ) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException({
        code:    'CONSOLE_ONLY_POLICY',
        field:   'overheadRatePerUnit',
        message: 'Manufacturing overhead rate is now controlled by HNS support. Contact us to change.',
      });
    }
    return this.tenantService.setOverheadRate(user.tenantId!, body.ratePerUnit);
  }

  /** Update Ledger ops + JE approval thresholds (Owner only). */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('ledger-thresholds')
  @HttpCode(HttpStatus.OK)
  updateLedgerThresholds(
    @CurrentUser() user: JwtPayload,
    @Body() body: { jeApprovalThreshold?: number; metricsThresholds?: Record<string, number> },
  ) {
    return this.tenantService.updateLedgerThresholds(user.tenantId!, body);
  }

  /** Read-only fetch — used by Settings page + Dashboard. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER')
  @Get('ledger-thresholds')
  getLedgerThresholds(@CurrentUser() user: JwtPayload) {
    return this.tenantService.getLedgerThresholds(user.tenantId!);
  }
}
