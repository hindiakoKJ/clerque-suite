import {
  Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Query, SetMetadata, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiKeyGuard, API_KEY_MIN_LEVEL } from '../auth/guards/api-key.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequireApiKeyLevel, RequireApiKeyScope } from '../auth/decorators/use-api-key.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '@repo/shared-types';
import { isServicePrincipal } from '../auth/strategies/api-key.strategy';
import { InventorySnapshotService } from './inventory-snapshot.service';
import { LedgerBalancesService } from './ledger-balances.service';
import { ServiceCaller, ServiceDraftsService } from './service-drafts.service';

/**
 * /api/v1/service -- what a machine (AIBA) may ask of one tenant with a
 * scoped API key: read the inventory and chosen ledger balances, and open
 * drafts a person finishes. Nothing under here posts, approves, voids or
 * deletes; those routes live elsewhere and refuse every API key (RolesGuard
 * fails closed for role SERVICE where it is not named).
 *
 * Key only: ApiKeyGuard authenticates, a JWT is never accepted here. Each
 * route names its scope (api-keys/scopes.ts), and a key of the original
 * kind, with no scopes, is refused on all of them.
 */
@ApiTags('Service API')
@ApiBearerAuth('access-token')
@SetMetadata(API_KEY_MIN_LEVEL, 'read')
@UseGuards(ApiKeyGuard, RolesGuard)
@Roles('SERVICE')
@Controller('service')
export class ServiceApiController {
  constructor(
    private readonly snapshots: InventorySnapshotService,
    private readonly ledger:    LedgerBalancesService,
    private readonly drafts:    ServiceDraftsService,
  ) {}

  @RequireApiKeyScope('inventory:read')
  @Get('inventory/snapshot')
  snapshot(@CurrentUser() user: JwtPayload, @Query() q: Record<string, unknown>) {
    const caller = this.caller(user, 'POS');
    return this.snapshots.snapshot(caller.tenantId, q);
  }

  @RequireApiKeyScope('ledger:read')
  @Get('ledger/balances')
  balances(@CurrentUser() user: JwtPayload, @Query() q: Record<string, unknown>) {
    const caller = this.caller(user, 'LEDGER');
    return this.ledger.balances(caller.tenantId, q);
  }

  @RequireApiKeyScope('inventory:draft')
  @RequireApiKeyLevel('readwrite')
  @Post('inventory/drafts/count')
  @HttpCode(HttpStatus.CREATED)
  draftCount(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.drafts.draftCount(this.caller(user, 'POS'), body);
  }

  @RequireApiKeyScope('inventory:draft')
  @RequireApiKeyLevel('readwrite')
  @Post('inventory/drafts/purchase-request')
  @HttpCode(HttpStatus.CREATED)
  draftPurchaseRequest(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.drafts.draftPurchaseRequest(this.caller(user, 'POS'), body);
  }

  @RequireApiKeyScope('inventory:draft')
  @RequireApiKeyLevel('readwrite')
  @Post('inventory/drafts/receiving')
  @HttpCode(HttpStatus.CREATED)
  draftReceiving(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.drafts.draftReceiving(this.caller(user, 'POS'), body);
  }

  @RequireApiKeyScope('journal:draft')
  @RequireApiKeyLevel('readwrite')
  @Post('ledger/drafts/journal')
  @HttpCode(HttpStatus.CREATED)
  draftJournal(@CurrentUser() user: JwtPayload, @Body() body: Record<string, unknown>) {
    return this.drafts.draftJournal(this.caller(user, 'LEDGER'), body);
  }

  /**
   * The key behind the request, and its tenant's module switch for the part
   * of Clerque the route reads or drafts into. The tenant always comes from
   * the key, never from the request.
   */
  private caller(user: JwtPayload, module: 'POS' | 'LEDGER'): ServiceCaller {
    if (!isServicePrincipal(user) || !user.tenantId) {
      throw new ForbiddenException('This endpoint is for API keys.');
    }
    const on = module === 'POS' ? user.modulePos : user.moduleLedger;
    if (on === false) throw new ForbiddenException(`The ${module} module is switched off for this business.`);
    return { tenantId: user.tenantId, keyId: user.apiKeyId, label: user.apiKeyLabel };
  }
}
