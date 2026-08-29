import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PurchaseRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ProcureService, AddLineDto, BoughtLineDto } from './procure.service';

/**
 * Clerque Procure.
 *
 * The roles split along who can actually know the thing being recorded.
 * A cashier sees the shortage and adds to the list; only an owner or manager
 * closes the request, records what was paid, and posts it to stock — those
 * three move money and inventory.
 */
@ApiTags('Procure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('procure/requests')
export class ProcureController {
  constructor(private readonly procure: ProcureService) {}

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Get()
  @ApiOperation({ summary: 'List purchase requests' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status') status?: PurchaseRequestStatus,
  ) {
    return this.procure.list(user.tenantId!, branchId ?? user.branchId ?? undefined, status);
  }

  /** The list being added to right now. Creates one if there is none. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post('open')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Today's open request for this branch" })
  open(@CurrentUser() user: JwtPayload, @Body() body: { branchId?: string }) {
    return this.procure.openRequest(user.tenantId!, body.branchId ?? user.branchId!, user.sub);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.procure.get(user.tenantId!, id);
  }

  /**
   * The list assembles itself from what the shop already knows, rather than
   * from whoever happens to notice.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post('pull-low-stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add everything below its reorder level to the open request' })
  pull(@CurrentUser() user: JwtPayload, @Body() body: { branchId?: string }) {
    return this.procure.pullLowStock(user.tenantId!, body.branchId ?? user.branchId!, user.sub);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Post(':id/lines')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an ingredient to the request' })
  addLine(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: AddLineDto) {
    return this.procure.addLine(user.tenantId!, id, body);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF')
  @Delete(':id/lines/:lineId')
  @HttpCode(HttpStatus.OK)
  removeLine(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
  ) {
    return this.procure.removeLine(user.tenantId!, id, lineId);
  }

  /** Cutoff. Sends even when empty — an explicit all-clear is the point. */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Post(':id/send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close the request and send it to the owners' })
  send(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.procure.sendRequest(user.tenantId!, id, user.sub);
  }

  /** What was actually bought, in containers and what each cost. */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Post(':id/bought')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the shopping: packs, pack size, price paid' })
  bought(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { lines: BoughtLineDto[] },
  ) {
    return this.procure.recordBought(user.tenantId!, id, body.lines ?? []);
  }

  /**
   * Posting to stock moves inventory and posts to the ledger, so it stays with
   * the owner or manager.
   */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post the bought lines to stock' })
  receive(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { paymentMethod?: 'CASH' | 'OWNER_FUNDED' },
  ) {
    return this.procure.receiveRequest(user.tenantId!, id, user.sub, body.paymentMethod ?? 'CASH');
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.procure.cancel(user.tenantId!, id);
  }
}
