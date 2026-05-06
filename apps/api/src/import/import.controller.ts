import {
  Controller,
  Post,
  Get,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  Res,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ImportService } from './import.service';
import type { JwtPayload } from '@repo/shared-types';

interface AuthRequest extends Express.Request {
  user: JwtPayload;
}

@Controller('import')
@UseGuards(JwtAuthGuard)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  // ── Products ───────────────────────────────────────────────────────────────
  @Post('products')
  @UseInterceptors(FileInterceptor('file'))
  importProducts(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importProducts(file, req.user.tenantId!);
  }

  @Get('template/products')
  async productsTemplate(@Res() res: Response) {
    const buf = await this.importService.productsTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-products-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  @Post('inventory')
  @UseInterceptors(FileInterceptor('file'))
  importInventory(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
    @Query('branchId') branchId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    if (!branchId)
      throw new BadRequestException('branchId query param is required.');
    return this.importService.importInventory(
      file,
      req.user.tenantId!,
      branchId,
    );
  }

  @Get('template/inventory')
  async inventoryTemplate(@Res() res: Response) {
    const buf = await this.importService.inventoryTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-inventory-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Chart of Accounts ─────────────────────────────────────────────────────
  @Post('chart-of-accounts')
  @UseInterceptors(FileInterceptor('file'))
  importChartOfAccounts(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importChartOfAccounts(file, req.user.tenantId!);
  }

  @Get('template/chart-of-accounts')
  async coaTemplate(@Res() res: Response) {
    const buf = await this.importService.coaTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-coa-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Journal Entries ────────────────────────────────────────────────────────
  @Post('journal-entries')
  @UseInterceptors(FileInterceptor('file'))
  importJournal(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importJournalEntries(
      file,
      req.user.tenantId!,
      req.user.sub,
    );
  }

  @Get('template/journal-entries')
  async journalTemplate(@Res() res: Response) {
    const buf = await this.importService.journalTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-journal-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Setup Pack: one upload to seed Products + Inventory ────────────────
  @Post('setup-pack')
  @UseInterceptors(FileInterceptor('file'))
  importSetupPack(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
    @Query('branchId') branchId: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    if (!branchId)
      throw new BadRequestException('branchId query param is required.');
    return this.importService.importSetupPack(
      file,
      req.user.tenantId!,
      branchId,
    );
  }

  @Get('template/setup-pack')
  async setupPackTemplate(@Res() res: Response) {
    const buf = await this.importService.setupPackTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-setup-pack.xlsx"',
    });
    res.send(buf);
  }

  // ── Customers (AR master) ──────────────────────────────────────────────
  @Post('customers')
  @UseInterceptors(FileInterceptor('file'))
  importCustomers(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importCustomers(file, req.user.tenantId!);
  }
  @Get('template/customers')
  async customersTemplate(@Res() res: Response) {
    const buf = await this.importService.customersTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="clerque-customers-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Stock Receipts (raw-material purchases / WAC) ──────────────────────
  @Post('stock-receipts')
  @UseInterceptors(FileInterceptor('file'))
  importStockReceipts(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importStockReceipts(file, req.user.tenantId!, req.user.sub);
  }
  @Get('template/stock-receipts')
  async stockReceiptsTemplate(@Res() res: Response) {
    const buf = await this.importService.stockReceiptsTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="clerque-stock-receipts-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Vendors (AP master) ────────────────────────────────────────────────
  @Post('vendors')
  @UseInterceptors(FileInterceptor('file'))
  importVendors(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importVendors(file, req.user.tenantId!);
  }
  @Get('template/vendors')
  async vendorsTemplate(@Res() res: Response) {
    const buf = await this.importService.vendorsTemplate();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="clerque-vendors-template.xlsx"',
    });
    res.send(buf);
  }
}
