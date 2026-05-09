import {
  Controller, Get, Post, Patch, Body, Param,
  UseGuards, HttpCode, HttpStatus, Request,
  BadRequestException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import * as bcrypt from 'bcryptjs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AccountsService } from '../accounting/accounts.service';
import { PlatformService, type UpdatePlatformConfigDto } from './platform.service';
import { SubscriptionBillingService } from './subscription-billing.service';
import { DemoBootstrapService } from './demo-bootstrap.service';
import type { ScenarioKey } from '../admin/demo-scenarios';
import { DEFAULT_APP_ACCESS } from '@repo/shared-types';

/**
 * Sprint 15 — Console-only platform endpoints. SUPER_ADMIN exclusively.
 *
 * All endpoints here either:
 *   - read/write the singleton PlatformConfig (HNS Corp's master data)
 *   - bootstrap the HNS Corp PH tenant
 *   - issue subscriptions cross-tenant
 *   - provision demo tenants
 *
 * None of these endpoints read other tenants' financial data — privacy
 * invariant preserved. Writes into other tenants' books are limited to
 * the auto-billing flow (mirrors HNS's outgoing receipt) and demo
 * provisioning (creating fresh tenants).
 */
@ApiTags('Platform (Console)')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN')
@Controller('admin/platform')
export class PlatformController {
  constructor(
    private readonly platform:     PlatformService,
    private readonly billing:      SubscriptionBillingService,
    private readonly bootstrap:    DemoBootstrapService,
    private readonly prisma:       PrismaService,
    private readonly accounts:     AccountsService,
  ) {}

  // ─── Config ───────────────────────────────────────────────────────────────

  @ApiOperation({ summary: 'Read platform configuration (HNS Corp master data + cron toggles)' })
  @Get('config')
  getConfig() {
    return this.platform.get();
  }

  @ApiOperation({ summary: 'Update platform configuration' })
  @Patch('config')
  @HttpCode(HttpStatus.OK)
  updateConfig(@Body() dto: UpdatePlatformConfigDto) {
    return this.platform.update(dto);
  }

  // ─── HNS Corp PH tenant bootstrap ─────────────────────────────────────────

  @ApiOperation({
    summary: 'Bootstrap HNS Corp PH as a Clerque tenant',
    description: 'Idempotent. Creates the HNS tenant if absent, then sets PlatformConfig.hnsTenantId. Required before subscription billing can run.',
  })
  @Post('bootstrap-hns-corp')
  @HttpCode(HttpStatus.OK)
  async bootstrapHnsCorp(@Request() req: { user: JwtPayload }) {
    const slug      = 'hnscorp';
    const ownerEmail = 'ops@hnscorp.test';
    const tenantName = 'HNS Corp PH';

    let tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    let generatedPassword: string | null = null;

    if (!tenant) {
      generatedPassword = this.generatePassword();
      const passwordHash = await bcrypt.hash(generatedPassword, 12);

      tenant = await this.prisma.$transaction(async (tx) => {
        const t = await tx.tenant.create({
          data: {
            name:            tenantName,
            slug,
            businessType:    'SERVICE' as Prisma.TenantCreateInput['businessType'],
            tier:            'TIER_3' as Prisma.TenantCreateInput['tier'],
            planCode:        'ENTERPRISE',
            modulePos:       true,
            moduleLedger:    true,
            modulePayroll:   true,
            staffSeatQuota:  15,
            staffSeatAddons: 0,
            branchQuota:     1,
            taxStatus:       'UNREGISTERED' as Prisma.TenantCreateInput['taxStatus'],
            isDemoTenant:    false,
            contactEmail:    ownerEmail,
            status:          'ACTIVE',
          },
        });
        const branch = await tx.branch.create({
          data: { tenantId: t.id, name: 'Head Office', isActive: true },
        });

        // Ops user — owner of HNS tenant. Only used for system actions;
        // the HNS staff log into Console, not this tenant directly.
        const ownerAccess = DEFAULT_APP_ACCESS['BUSINESS_OWNER'] ?? [];
        await tx.user.create({
          data: {
            tenantId: t.id, branchId: branch.id, name: 'HNS Operations',
            email:    ownerEmail.toLowerCase(),
            passwordHash,
            role:     'BUSINESS_OWNER',
            isActive: true,
            appAccess: { create: ownerAccess.map((a) => ({
              appCode: a.app as Prisma.UserAppAccessCreateWithoutUserInput['appCode'],
              level:   a.level as Prisma.UserAppAccessCreateWithoutUserInput['level'],
            })) },
          },
        });

        return t;
      });
    }

    await this.accounts.seedDefaultAccounts(tenant.id);

    // Wire the HNS tenant ID into PlatformConfig (idempotent).
    const platform = await this.platform.get();
    if (platform.hnsTenantId !== tenant.id) {
      await this.platform.setHnsTenantId(tenant.id);
    }

    // Sync HNS Corp master data from PlatformConfig → HNS tenant fields
    // (TIN, address, contactEmail) so receipts reflect what's in Settings.
    await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        tin:          platform.tin ?? null,
        tinNumber:    platform.tin ?? null,
        address:      platform.address ?? null,
        contactPhone: platform.contactPhone ?? null,
        contactEmail: platform.contactEmail ?? ownerEmail,
        taxStatus:    platform.taxStatus,
        isBirRegistered: platform.isBirRegistered,
      },
    });

    return {
      tenantId: tenant.id,
      slug,
      tenantName,
      ownerEmail,
      ownerPassword: generatedPassword,
      created:       generatedPassword !== null,
    };
  }

  // ─── Subscription billing ─────────────────────────────────────────────────

  @ApiOperation({ summary: 'Manually issue a subscription bill for a tenant (dual-write: HNS Order + customer APBill)' })
  @Post('billing/issue/:tenantId')
  @HttpCode(HttpStatus.CREATED)
  issueSubscription(
    @Param('tenantId') tenantId: string,
    @Request() req: { user: JwtPayload },
    @Body() body: { periodStart?: string; periodEnd?: string },
  ) {
    const now = new Date();
    const periodStart = body.periodStart ? new Date(body.periodStart)
                                         : new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd   = body.periodEnd   ? new Date(body.periodEnd)
                                         : new Date(now.getFullYear(), now.getMonth() + 1, 1);
    if (periodEnd <= periodStart) {
      throw new BadRequestException('periodEnd must be after periodStart.');
    }
    return this.billing.issueSubscription(tenantId, periodStart, periodEnd, req.user.sub);
  }

  @ApiOperation({ summary: 'List subscription bills issued (read from HNS tenant\'s Orders)' })
  @Get('billing/orders')
  async listHnsOrders() {
    const platform = await this.platform.get();
    if (!platform.hnsTenantId) return { error: 'HNS Corp PH not bootstrapped.', orders: [] };

    const orders = await this.prisma.order.findMany({
      where:   { tenantId: platform.hnsTenantId, invoiceType: 'CHARGE' },
      orderBy: { createdAt: 'desc' },
      take:    200,
      include: {
        customer: { select: { id: true, name: true } },
        items:    { select: { productName: true, lineTotal: true } },
      },
    });
    return { orders };
  }

  // ─── Demo provisioning ────────────────────────────────────────────────────

  @ApiOperation({ summary: 'List available demo scenarios' })
  @Get('demo/scenarios')
  listScenarios() {
    return this.bootstrap.listScenarios();
  }

  @ApiOperation({ summary: 'Provision a demo tenant for a scenario' })
  @Post('demo/provision/:scenario')
  @HttpCode(HttpStatus.OK)
  provision(@Param('scenario') scenario: ScenarioKey) {
    return this.bootstrap.provision(scenario);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private generatePassword(): string {
    const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789abcdefghjkmnpqrstuvwxyz';
    return Array.from({ length: 16 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');
  }
}
