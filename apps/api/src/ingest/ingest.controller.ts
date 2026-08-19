import {
  Controller, Post, Body, UseGuards, HttpCode, HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { RolesGuard } from '../auth/guards/roles.guard';
import { JwtOrApiKeyGuard } from '../auth/guards/jwt-or-api-key.guard';
import { RequireApiKeyLevel } from '../auth/decorators/use-api-key.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { isServicePrincipal } from '../auth/strategies/api-key.strategy';
import type { JwtPayload } from '@repo/shared-types';
import { IngestService } from './ingest.service';
import type { CourtSideEvent } from './courtside.types';
import type { MagnetEvent } from './magnetmoments.types';

/**
 * Ecosystem event ingest. Today: CourtSide (court booking + online payment)
 * posts each paid sale and each refund here.
 *
 * Auth is the SAME machine-principal path every ecosystem write uses: a club's
 * API key resolves to role 'SERVICE', and RolesGuard fails closed for it
 * everywhere 'SERVICE' is not named — so this route is reachable ONLY by a
 * readwrite key on the club's own tenant. The sale lands in that club's books.
 */
@ApiTags('Ingest')
@ApiBearerAuth('access-token')
@UseGuards(JwtOrApiKeyGuard, RolesGuard)
@Controller('ingest')
export class IngestController {
  constructor(private readonly ingest: IngestService) {}

  @Roles('SERVICE', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @RequireApiKeyLevel('readwrite')
  @Post('courtside')
  @HttpCode(HttpStatus.OK)
  async courtside(@CurrentUser() user: JwtPayload, @Body() body: CourtSideEvent) {
    if (!body || (body.event_type !== 'sale' && body.event_type !== 'refund')) {
      throw new BadRequestException('event_type must be "sale" or "refund".');
    }
    const service = isServicePrincipal(user);
    return this.ingest.ingest(
      user.tenantId!,
      service ? user.apiKeyId : null,
      user.branchId ?? null,
      body,
    );
  }

  /**
   * magnetmoments.cc (Magnet Books): a shop's "mark paid" posts its magnet
   * sale — and any refund — into that shop's own tenant. Same machine-principal
   * auth as CourtSide: only a readwrite key on the shop's tenant gets here.
   */
  @Roles('SERVICE', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @RequireApiKeyLevel('readwrite')
  @Post('magnetmoments')
  @HttpCode(HttpStatus.OK)
  async magnetmoments(@CurrentUser() user: JwtPayload, @Body() body: MagnetEvent) {
    if (!body || (body.event_type !== 'sale' && body.event_type !== 'refund')) {
      throw new BadRequestException('event_type must be "sale" or "refund".');
    }
    const service = isServicePrincipal(user);
    return this.ingest.ingestMagnet(
      user.tenantId!,
      service ? user.apiKeyId : null,
      user.branchId ?? null,
      body,
    );
  }

  /**
   * Seed the placeholder magnet catalog — one product per magnetmoments size
   * with its own placeholder cost + price — so a shop can review and edit
   * prices in Products BEFORE its first sale lands. Idempotent: existing
   * products (by sku) are left untouched, so re-running never clobbers the
   * seller's edits. Owner or the shop's readwrite key.
   */
  @Roles('SERVICE', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @RequireApiKeyLevel('readwrite')
  @Post('magnetmoments/seed-catalog')
  @HttpCode(HttpStatus.OK)
  async seedMagnetCatalog(@CurrentUser() user: JwtPayload) {
    const { bySku, created } = await this.ingest.ensureMagnetCatalog(user.tenantId!);
    return {
      created,
      total: bySku.size,
      products: [...bySku.entries()].map(([sku, p]) => ({ sku, id: p.id, name: p.name, costPrice: p.costPrice })),
    };
  }
}
