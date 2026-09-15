import {
  Controller, Get, Post, Delete, Body, Param, Query, UseGuards, HttpCode, HttpStatus, Headers, Res, BadRequestException,
  UseInterceptors, UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BuyListsExcelService } from './buy-lists-excel.service';
import { IMPORT_UPLOAD } from '../import/import-upload.options';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PurchaseRequestStatus } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { RequireIdempotency } from '../common/decorators/require-idempotency.decorator';
import { ProcureService, AddLineDto } from './procure.service';
import { ReceiveRequestDto, RecordBoughtDto, AttachPhotoDto, RecordCountDto } from './dto/receive-request.dto';
import { SANITY_HEADER, sanityContext } from '../common/sanity/sanity.types';
import { effectiveBranchId } from '../common/branch-scope';

/**
 * Clerque Procure.
 *
 * The roles split along who can actually know the thing being recorded.
 * A cashier, cook or barista sees the shortage and adds to the list; only an
 * owner or manager closes the request, records what was paid, and posts it to
 * stock — those three move money and inventory.
 *
 * GENERAL_EMPLOYEE is the kitchen account. It builds the list, and -- when
 * the shop shows purchase costs to its staff -- records what came back and
 * files the photo of the paper. Sending, posting to stock and cancelling
 * stay with the owner or manager: recording is writing down, posting is
 * spending, and the separation is between those two.
 */
@ApiTags('Procure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('procure/requests')
export class ProcureController {
  constructor(
    private readonly procure: ProcureService,
    private readonly excel: BuyListsExcelService,
  ) {}

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Get()
  @ApiOperation({ summary: 'List purchase requests' })
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('status') status?: PurchaseRequestStatus,
  ) {
    return this.procure.list(user.tenantId!, branchId ?? user.branchId ?? undefined, status, user.role);
  }

  /** The list being added to right now. Creates one if there is none. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Post('open')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Today's open request for this branch" })
  async open(@CurrentUser() user: JwtPayload, @Body() body: { branchId?: string }) {
    const branchId = await this.procure.resolveBranch(user.tenantId!, body.branchId ?? user.branchId);
    return this.procure.openRequest(user.tenantId!, branchId, user.sub, user.role);
  }

  /**
   * What is capping the menu, by ingredient.
   *
   * The till shows "16 left" on a latte. Whoever buys stock needs the other
   * half of that sentence — which ingredient, and how much of the menu it is
   * holding back. Open to the same roles as the buy list, because the cook who
   * notices is the one who should be able to look it up.
   *
   * Declared BEFORE :id so "menu-ceiling" is not read as a request id.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Get('menu-ceiling')
  @ApiOperation({ summary: 'Ingredients ranked by how much of the menu they are limiting' })
  async menuCeiling(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    return this.procure.menuCeiling(user.tenantId!, await this.procure.resolveBranch(user.tenantId!, branchId ?? user.branchId));
  }

  /**
   * What each ingredient held last time, for every ingredient: the picker
   * needs it before a line exists, so "2 bottles" is typed as 2 bottles.
   * Declared BEFORE :id so "pack-memory" is not read as a request id.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Get('pack-memory')
  @ApiOperation({ summary: 'Pack size and last price per ingredient, from the last delivery' })
  packMemory(@CurrentUser() user: JwtPayload) {
    return this.procure.packMemory(user.tenantId!, user.role);
  }

  /**
   * Where each item was bought, and what it cost there, for a date range
   * (the last 90 days when none is given). Store names for everyone who can
   * open Procure; prices only for people who may see purchase costs.
   * Declared BEFORE :id.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Get('where-bought')
  @ApiOperation({ summary: 'Where each item is usually bought, per item and per store' })
  whereBought(
    @CurrentUser() user: JwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('branchId') branchId?: string,
  ) {
    // A branch's staff see their own branch; an owner sees the branch asked for, or the whole shop.
    return this.procure.whereBought(user.tenantId!, { from, to, branchId: effectiveBranchId(user, branchId) }, user.role);
  }

  /**
   * The buy lists as an Excel file, for a date range: the backup the owner can
   * read, edit and upload back. Declared BEFORE :id.
   */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM')
  @Get('excel')
  @ApiOperation({ summary: 'Download the buy lists as an Excel file' })
  async excelExport(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('branchId') branchId?: string,
  ) {
    const out = await this.excel.exportWorkbook(user.tenantId!, { from, to, branchId });
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${out.filename}"`,
      'Content-Length':      out.buffer.length.toString(),
    });
    res.send(out.buffer);
  }

  /**
   * The same file uploaded back. Shows what would change unless preview=false:
   * nothing is written by a preview, and nothing goes into stock either way.
   */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM')
  @Post('excel')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
  @ApiOperation({ summary: 'Upload the buy-lists Excel file: preview, then record' })
  excelImport(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Query('preview') preview?: string,
  ) {
    return this.excel.importWorkbook(user.tenantId!, file, { userId: user.sub, role: user.role }, preview !== 'false');
  }

  /**
   * The buy list as a PDF, for the group chat. `copy=sent` (default) is the
   * list as it went out, with no prices, so the kitchen may share it;
   * `copy=booked` is what was bought and put in stock, with prices only for
   * those the shop shows purchase costs to.
   *
   * Declared BEFORE :id, the same as the routes above.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Get(':id/pdf')
  @ApiOperation({ summary: 'The buy list as a PDF: as sent, or as booked into stock' })
  async pdf(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Res() res: Response,
    @Query('copy') copy?: string,
  ) {
    if (copy != null && copy !== 'sent' && copy !== 'booked') {
      throw new BadRequestException('copy is "sent" or "booked".');
    }
    const out = await this.procure.requestPdf(user.tenantId!, id, copy === 'booked' ? 'booked' : 'sent', user.role);
    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `inline; filename="${out.filename}"`,
      'Content-Length':      out.buffer.length.toString(),
      'Cache-Control':       'no-store',
    });
    res.send(out.buffer);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Get(':id')
  get(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.procure.get(user.tenantId!, id, user.role);
  }

  /**
   * The list assembles itself from what the shop already knows, rather than
   * from whoever happens to notice.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Post('pull-low-stock')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add everything below its reorder level to the open request' })
  async pull(@CurrentUser() user: JwtPayload, @Body() body: { branchId?: string }) {
    const branchId = await this.procure.resolveBranch(user.tenantId!, body.branchId ?? user.branchId);
    return this.procure.pullLowStock(user.tenantId!, branchId, user.sub);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Post(':id/lines')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add an ingredient to the request' })
  addLine(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: AddLineDto) {
    return this.procure.addLine(user.tenantId!, id, body);
  }

  /**
   * "Remaining: 1 bottle". What is left on the shelf, said while building the
   * list; it lands on a cycle count the owner posts later. Counting is not
   * posting, so the kitchen may say it.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Post(':id/lines/:lineId/count')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record what is left on the shelf for a line, onto a cycle count' })
  count(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Param('lineId') lineId: string,
    @Body() body: RecordCountDto,
  ) {
    return this.procure.recordCount(user.tenantId!, id, lineId, user.sub, body.countedQty);
  }

  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
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

  /**
   * What was actually bought, in containers and what each cost. Open to
   * whoever is holding the bag; the service refuses staff on a shop that
   * hides purchase costs from them, and refuses staff a second go at a line.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @RequireIdempotency()   // paid-ahead money and fees post from here; a double-tap must not post twice
  @Post(':id/bought')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record the shopping: packs, pack size, price paid' })
  bought(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: RecordBoughtDto,
    @Headers(SANITY_HEADER) sanity?: string,
  ) {
    return this.procure.recordBought(
      user.tenantId!, id, body.lines ?? [],
      { userId: user.sub, role: user.role },
      {
        note: body.note, boughtAt: body.boughtAt, onTheWay: body.onTheWay, paidFrom: body.paidFrom, charges: body.charges,
        sanity: sanityContext(sanity, body.sanityConfirmations, user.sub, user.role),
      },
    );
  }

  /** The paper, filed by whoever is holding it. Filing is not posting. */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM', 'WAREHOUSE_STAFF', 'GENERAL_EMPLOYEE')
  @Post(':id/photo')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Attach a photo of the receipt, order screen or delivery slip' })
  photo(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: AttachPhotoDto) {
    return this.procure.attachPhoto(user.tenantId!, id, user.sub, body);
  }

  /**
   * Posting to stock moves inventory and posts to the ledger, so it stays with
   * the owner or manager.
   */
  /*
    Idempotent: the goods are protected by each line's control number, but
    the charges that ride along (shipping, a platform fee, a lost pack) have
    no such key, and a double-tap on a slow connection would post them twice.
  */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @RequireIdempotency()
  @Post(':id/receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Post what arrived to stock' })
  receive(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ReceiveRequestDto,
  ) {
    /*
      "The price really did change" from this screen too. A line refused by the
      order-of-magnitude guard left the request at BOUGHT with no way past the
      guard except the receipts screen, and a hand-typed request never had one.
    */
    return this.procure.receiveRequest(user.tenantId!, id, user.sub, body.paymentMethod ?? 'CASH', {
      ...(body.acceptCostChange === true ? { acceptCostChangeAll: true } : {}),
      receivedAt: body.receivedAt,
      note:       body.note,
      lines:      body.lines,
      closeShort: body.closeShort,
      closeRest:  body.closeRest,
      charges:    body.charges,
    });
  }

  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'MDM')
  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.procure.cancel(user.tenantId!, id);
  }
}
