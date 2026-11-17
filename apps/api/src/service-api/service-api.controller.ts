import {
  Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Query, Req, SetMetadata, UseGuards, UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
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
import { ReceiptsCaller, ServiceReceiptsService } from './service-receipts.service';
import { ServiceReceiptPostDto, ServiceReceiptReadDto } from './service-receipts.dto';
import { ReceiptReadLimitGuard, ReceiptReads, ReleaseReceiptReadInterceptor } from '../procure/receipt-read-limit.guard';

/**
 * /api/v1/service -- what a machine (AIBA) may ask of one tenant with a
 * scoped API key: read the inventory and chosen ledger balances, and open
 * drafts a person finishes. Nothing under here approves, voids or deletes;
 * those routes live elsewhere and refuse every API key (RolesGuard fails
 * closed for role SERVICE where it is not named).
 *
 * One route posts, and only one (KJ 2026-11-17): procure/receipts/post,
 * scope procure:receipts, for PAID receipts sent through AIBA's Telegram
 * and read by Clerque's own receipt reader. It posts as the owner who
 * issued the key, on its own only when Clerque's own checks hold
 * (service-receipts.service.ts). Every other route here reads or drafts.
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
    private readonly receipts:  ServiceReceiptsService,
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
   * Read a paid receipt with Clerque's own reader, plus Clerque's verdict on
   * whether it may post on its own. Writes nothing. Held to the shop's daily
   * read cap like the app's own Read button (and its monthly AI allowance,
   * in the service).
   */
  @RequireApiKeyScope('procure:receipts')
  @RequireApiKeyLevel('readwrite')
  @UseGuards(ReceiptReadLimitGuard)
  @UseInterceptors(ReleaseReceiptReadInterceptor)
  @Post('procure/receipts/read')
  @HttpCode(HttpStatus.OK)
  readReceipt(
    @CurrentUser() user: JwtPayload,
    @Body() dto: ServiceReceiptReadDto,
    @Req() req?: Request & { receiptReads?: ReceiptReads },
  ) {
    const caller = this.receiptsCaller(user);
    // Today's reads after this one, as the app's own Read answers them.
    const reads = req?.receiptReads
      ? { usedToday: req.receiptReads.usedToday + 1, limit: req.receiptReads.limit, resetsAt: req.receiptReads.resetsAt }
      : undefined;
    return this.receipts.read(caller, dto).then((result) => ({ ...result, reads }));
  }

  /** Post a paid receipt: the one posting route under /service. */
  @RequireApiKeyScope('procure:receipts')
  @RequireApiKeyLevel('readwrite')
  @Post('procure/receipts/post')
  @HttpCode(HttpStatus.CREATED)
  postReceipt(@CurrentUser() user: JwtPayload, @Body() dto: ServiceReceiptPostDto) {
    return this.receipts.post(this.receiptsCaller(user), dto);
  }

  /** The caller for the receipt routes: Procure is a POS module, and a receipt may land on the key's default branch. */
  private receiptsCaller(user: JwtPayload): ReceiptsCaller {
    const caller = this.caller(user, 'POS');
    return { ...caller, defaultBranchId: user.branchId ?? null };
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
