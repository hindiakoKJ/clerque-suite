import {
  Controller, Get, Patch, Post, Param, Body, Query,
  UseGuards, HttpCode, HttpStatus, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from './admin.guard';
import { AdminService, CreateTenantDto, AddUserDto, UpdateTenantProfileDto } from './admin.service';
import { LayoutsService } from '../layouts/layouts.service';
import type { ScenarioKey } from './demo-scenarios';
import type { JwtPayload, CoffeeShopTier } from '@repo/shared-types';

/** Extract the super-admin actor from the JWT for ConsoleLog. */
function actor(req: { user: JwtPayload }) {
  return { email: req.user.name ?? req.user.sub };
}

@ApiTags('Admin (Console)')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private svc: AdminService,
    private layouts: LayoutsService,
  ) {}

  // ─── Platform metrics ─────────────────────────────────────────────────────

  @Get('metrics')
  metrics() {
    return this.svc.getPlatformMetrics();
  }

  // ─── Tenant list + create ─────────────────────────────────────────────────

  @Get('tenants')
  listTenants(
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('tier')   tier?:   string,
  ) {
    return this.svc.listTenants({ search, status, tier });
  }

  @Post('tenants')
  @HttpCode(HttpStatus.CREATED)
  createTenant(@Request() req: { user: JwtPayload }, @Body() dto: CreateTenantDto) {
    return this.svc.createTenant(dto, actor(req));
  }

  // ─── Tenant detail + actions ──────────────────────────────────────────────

  @Get('tenants/:id')
  tenantDetail(@Param('id') id: string) {
    return this.svc.getTenantDetail(id);
  }

  @Patch('tenants/:id/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'GRACE' | 'SUSPENDED' },
  ) {
    return this.svc.setTenantStatus(id, body.status, actor(req));
  }

  @Patch('tenants/:id/tier')
  @HttpCode(HttpStatus.OK)
  setTier(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { tier: string },
  ) {
    return this.svc.setTenantTier(id, body.tier, actor(req));
  }

  @Patch('tenants/:id/ai-override')
  @HttpCode(HttpStatus.OK)
  setAiOverride(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { quotaOverride: number | null; addonType: string | null },
  ) {
    return this.svc.setAiOverride(id, body.quotaOverride, body.addonType, actor(req));
  }

  @Patch('tenants/:id/profile')
  @HttpCode(HttpStatus.OK)
  updateProfile(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: UpdateTenantProfileDto,
  ) {
    return this.svc.updateTenantProfile(id, dto, actor(req));
  }

  /**
   * Sales-controlled coffee-shop tier upgrade. Provisions stations,
   * printers, and terminals for the chosen CS tier on the target tenant.
   * Idempotent — preserves owner-renamed stations.
   */
  @Patch('tenants/:id/coffee-shop-tier')
  @HttpCode(HttpStatus.OK)
  applyCoffeeShopTier(
    @Param('id') id: string,
    @Body() body: { tier: CoffeeShopTier; customerDisplayOverride?: boolean },
  ) {
    return this.layouts.applyCoffeeShopTier(id, body.tier, {
      customerDisplayOverride: body.customerDisplayOverride,
    });
  }

  /**
   * Clear ALL data for a tenant — wipes products, categories, ingredients,
   * orders, journal entries, accounting events. Preserves the tenant
   * record, users, branches, and floor layout. Used for onboarding when
   * a tenant wants to clear sample data and build their own catalog.
   *
   * This is more aggressive than reset-demo (which re-seeds scenario data).
   */
  @Post('tenants/:id/clear-data')
  @HttpCode(HttpStatus.OK)
  clearTenantData(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.svc.clearAllTenantData(id, actor(req));
  }

  /**
   * Seed the master coffee-shop ingredient catalogue (~110 items) onto a
   * tenant — espresso beans, syrups, milks, cups, etc. — with realistic PH
   * cost prices, opening quantities, and low-stock alert thresholds.
   *
   * Idempotent: existing ingredients (by name) are skipped, so re-running
   * tops up missing items without duplicating.
   */
  @Post('tenants/:id/seed-coffee-shop-ingredients')
  @HttpCode(HttpStatus.OK)
  seedCoffeeShopIngredients(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.svc.seedCoffeeShopIngredients(id, actor(req));
  }

  /**
   * Seed the master coffee-shop CATEGORY catalogue + auto-route to stations.
   *
   * Creates 15 standard menu categories (Hot Coffee, Cold Coffee, Pastries,
   * Sandwiches, Mains, etc.) and links each to the right station based on
   * the tenant's existing floor layout — Bar gets drinks, Kitchen gets hot
   * food, Pastry Pass gets pre-made bakery, Counter handles retail.
   * Idempotent: re-runs only fix unrouted categories.
   */
  @Post('tenants/:id/seed-coffee-shop-categories')
  @HttpCode(HttpStatus.OK)
  seedCoffeeShopCategories(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
  ) {
    return this.svc.seedCoffeeShopCategories(id, actor(req));
  }

  @Post('tenants/:id/reset-demo')
  @HttpCode(HttpStatus.OK)
  resetDemo(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() body: { scenario: ScenarioKey },
  ) {
    return this.svc.resetDemoData(id, body.scenario, actor(req));
  }

  // ─── Tenant users ─────────────────────────────────────────────────────────

  @Get('tenants/:id/users')
  listTenantUsers(@Param('id') id: string) {
    return this.svc.listTenantUsers(id);
  }

  @Post('tenants/:id/users')
  @HttpCode(HttpStatus.CREATED)
  addUserToTenant(
    @Request() req: { user: JwtPayload },
    @Param('id') id: string,
    @Body() dto: AddUserDto,
  ) {
    return this.svc.addUserToTenant(id, dto, actor(req));
  }

  // ─── User actions ─────────────────────────────────────────────────────────

  @Post('users/:id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(@Request() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.resetUserPassword(id, actor(req));
  }

  @Post('users/:id/clear-lockout')
  @HttpCode(HttpStatus.OK)
  clearLockout(@Request() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.clearLockout(id, actor(req));
  }

  @Post('users/:id/force-logout')
  @HttpCode(HttpStatus.OK)
  forceLogout(@Request() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.forceLogout(id, actor(req));
  }

  @Patch('users/:id/toggle-active')
  @HttpCode(HttpStatus.OK)
  toggleActive(@Request() req: { user: JwtPayload }, @Param('id') id: string) {
    return this.svc.toggleUserActive(id, actor(req));
  }

  // ─── Failed events ────────────────────────────────────────────────────────

  @Get('failed-events')
  failedEvents(@Query('limit') limit?: string) {
    return this.svc.listFailedEvents({ limit: limit ? Number(limit) : undefined });
  }

  // ─── Console audit log ────────────────────────────────────────────────────

  @Get('console-log')
  consoleLog(
    @Query('tenantId') tenantId?: string,
    @Query('limit')    limit?:    string,
    @Query('offset')   offset?:   string,
  ) {
    return this.svc.listConsoleLogs({
      tenantId,
      limit:  limit  ? Number(limit)  : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }
}
