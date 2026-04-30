import {
  Controller, Get, Post,
  Param, Body, Query, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ArService } from './ar.service';
import { RecordCollectionDto } from './dto/record-collection.dto';

const READ_ROLES       = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT', 'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR'] as const;
const COLLECTION_ROLES = ['BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AR_ACCOUNTANT'] as const;

/**
 * Legacy AR controller — POS-only "Outstanding Sales" feature for charge-tab
 * orders (T2+ tier). Treats POS Orders as the AR document.
 *
 * Mounted under /ar/pos/* to keep the path namespace clear of the formal
 * back-office ARInvoicesController which lives at /ar/invoices.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ar/pos')
export class ArController {
  constructor(private readonly svc: ArService) {}

  @Roles(...READ_ROLES)
  @Get('summary')
  getSummary(@CurrentUser() user: JwtPayload) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.getSummary(user.tenantId);
  }

  @Roles(...READ_ROLES)
  @Get('aging')
  getAging(@CurrentUser() user: JwtPayload) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.getAging(user.tenantId);
  }

  @Roles(...READ_ROLES)
  @Get('invoices')
  findInvoices(
    @CurrentUser() user: JwtPayload,
    @Query('customerId') customerId?: string,
    @Query('collected')  collected?: string,
    @Query('from')       from?: string,
    @Query('to')         to?: string,
    @Query('page')       page?: string,
    @Query('limit')      limit?: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    const collectedBool =
      collected === 'true'  ? true  :
      collected === 'false' ? false :
      undefined;
    return this.svc.findInvoices(user.tenantId, {
      customerId,
      collected: collectedBool,
      from,
      to,
      page:  page  ? Number(page)  : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Roles(...READ_ROLES)
  @Get('invoices/:orderId')
  getInvoice(@CurrentUser() user: JwtPayload, @Param('orderId') orderId: string) {
    if (!user.tenantId) throw new ForbiddenException('Tenant context required');
    return this.svc.getInvoice(orderId, user.tenantId);
  }

  @Roles(...COLLECTION_ROLES)
  @Post('invoices/:orderId/collect')
  recordCollection(
    @CurrentUser() user: JwtPayload,
    @Param('orderId') orderId: string,
    @Body() dto: RecordCollectionDto,
  ) {
    if (!user.tenantId || !user.sub) throw new ForbiddenException('Tenant context required');
    return this.svc.recordCollection(orderId, user.tenantId, user.sub, dto);
  }
}
