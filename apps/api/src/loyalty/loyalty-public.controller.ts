/**
 * Sprint 19 — Public stamp-card stub.
 *
 * GET /stamps/:token  — UNAUTHENTICATED
 *   Customer scans the QR on their printed card (or follows the SMS link)
 *   and sees their digital card from any phone — no login required.
 *   The token is unguessable (cuid-style 16 hex), so leaking the URL only
 *   exposes that single customer's stamp count for that tenant — no other
 *   customer data, no PII, no payment history.
 */
import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { LoyaltyService } from './loyalty.service';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Loyalty (Public)')
@Controller('stamps')
export class LoyaltyPublicController {
  constructor(
    private readonly svc:    LoyaltyService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':token')
  async getCard(@Param('token') token: string) {
    if (!/^[a-f0-9]{8}-[a-f0-9]{8}$/.test(token)) {
      throw new NotFoundException('Card not found.');
    }
    const data = await this.svc.getByPublicToken(token);
    // Fill in tenant business name (privacy-safe: just the storefront name).
    const tenant = await this.prisma.tenant.findUnique({
      where:  { id: data.tenantId },
      select: { name: true, businessName: true, receiptLogoUrl: true },
    });
    return {
      ...data,
      tenantBusinessName: tenant?.businessName ?? tenant?.name ?? null,
      tenantLogoUrl:      tenant?.receiptLogoUrl ?? null,
    };
  }
}
