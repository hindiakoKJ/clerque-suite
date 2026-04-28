import { Controller, Get, Patch, Body, Req, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
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

  @Roles('BUSINESS_OWNER')
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(@CurrentUser() user: JwtPayload, @Body() body: UpdateTenantProfileDto) {
    return this.tenantService.updateProfile(user.tenantId!, body);
  }

  /**
   * PATCH /tenant/tax-settings
   *
   * Updates BIR tax classification, TIN, business name, and accounting method.
   * Restricted to BUSINESS_OWNER and SUPER_ADMIN — these are compliance-critical fields.
   *
   * ⚠️  After calling this endpoint, the user must re-login to receive an updated JWT.
   *     The old JWT still carries the previous tax flags until it expires or is refreshed.
   */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN')
  @Patch('tax-settings')
  @HttpCode(HttpStatus.OK)
  updateTaxSettings(
    @CurrentUser() user: JwtPayload,
    @Body() body: UpdateTaxSettingsDto,
    @Req() req: Request,
  ) {
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
                    ?? req.socket?.remoteAddress;
    return this.tenantService.updateTaxSettings(
      user.tenantId!,
      body,
      user.sub,
      ipAddress,
    );
  }
}
