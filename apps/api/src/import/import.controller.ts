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
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp } from '../auth/decorators/require-app.decorator';
import { PlanFeatureGuard } from '../auth/guards/plan-feature.guard';
import { RequirePlanFeature } from '../auth/decorators/require-plan-feature.decorator';
import { ImportService } from './import.service';
import { IMPORT_UPLOAD } from './import-upload.options';
import type { JwtPayload } from '@repo/shared-types';

interface AuthRequest extends Express.Request {
  user: JwtPayload;
}

@Controller('import')
// Bulk import overwrites master data (catalog, stock, ledger), so it is
// restricted to owners/managers and master-data roles. Previously this
// controller carried ONLY JwtAuthGuard, which let any signed-in user —
// including a CASHIER — overwrite the entire product catalog and inventory.
// AppAccessGuard/PlanFeatureGuard are inert unless a method adds their
// decorator; the full-accounting imports below opt in.
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard, PlanFeatureGuard)
@Roles(
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'MDM', 'BRANCH_MANAGER',
  'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD',
)
export class ImportController {
  constructor(private readonly importService: ImportService) {}

  // ── Products ───────────────────────────────────────────────────────────────
  @Post('products')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
  importProducts(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importProducts(file, req.user.tenantId!);
  }

  @Get('template/products')
  async productsTemplate(@Req() req: AuthRequest, @Res() res: Response) {
    // Sprint 19 — Vertical-aware template: pharmacy tenants get pharmacy
    // sample rows + pharmacy columns. Other verticals get the lean F&B
    // template without the medicine-specific columns.
    const buf = await this.importService.productsTemplate(req.user.tenantId ?? undefined);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-products-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Migration: Loyverse ────────────────────────────────────────────────────
  /**
   * Accepts a Loyverse "Item list" export as-is and migrates the catalog.
   * Column names are matched dynamically (per-store price/stock columns are
   * discovered at run time), then the rows are handed to the same importers
   * the Clerque templates use.
   *
   * `branchId` is optional: supply it to also seed opening stock from the
   * export's per-store stock columns.
   */
  @Post('loyverse')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
  importLoyverse(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthRequest,
    @Query('branchId') branchId?: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importLoyverse(
      file,
      req.user.tenantId!,
      branchId ?? req.user.branchId ?? undefined,
    );
  }

  @Get('template/loyverse')
  async loyverseTemplate(@Res() res: Response) {
    const buf = await this.importService.loyverseTemplate();
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':
        'attachment; filename="clerque-loyverse-sample.xlsx"',
    });
    res.send(buf);
  }

  // ── Inventory ──────────────────────────────────────────────────────────────
  @Post('inventory')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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
  // Full-accounting only — the chart of accounts is a FULL-tier surface.
  // Posting double-entry directly (POST /journal) is restricted to
  // BUSINESS_OWNER + ACCOUNTANT. Importing is the same act in bulk, so it
  // must not be the wider door: the class-level list would otherwise let a
  // BRANCH_MANAGER/MDM/FINANCE_LEAD post entries they cannot post by hand.
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @Post('chart-of-accounts')
  @RequireApp('LEDGER', 'READ_ONLY')
  @RequirePlanFeature('advancedAccounting')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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
  // Full-accounting only: importing journal entries would otherwise let a
  // SIMPLE-tier (Solo Books) tenant post arbitrary double-entry and bypass the
  // advancedAccounting lock that guards the Journal screens/API.
  // Posting double-entry directly (POST /journal) is restricted to
  // BUSINESS_OWNER + ACCOUNTANT. Importing is the same act in bulk, so it
  // must not be the wider door: the class-level list would otherwise let a
  // BRANCH_MANAGER/MDM/FINANCE_LEAD post entries they cannot post by hand.
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT')
  @Post('journal-entries')
  @RequireApp('LEDGER', 'READ_ONLY')
  @RequirePlanFeature('advancedAccounting')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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
  async setupPackTemplate(@Req() req: AuthRequest, @Res() res: Response) {
    const buf = await this.importService.setupPackTemplate(req.user.tenantId ?? undefined);
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
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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
  // Full-accounting only — vendors belong to the AP module.
  @Post('vendors')
  @RequireApp('LEDGER', 'READ_ONLY')
  @RequirePlanFeature('advancedAccounting')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
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

  // ── Ingredients / Raw Materials (Sprint 19) ────────────────────────────
  @Post('ingredients')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
  importIngredients(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importIngredients(file, req.user.tenantId!);
  }
  @Get('template/ingredients')
  async ingredientsTemplate(@Req() req: AuthRequest, @Res() res: Response) {
    const buf = await this.importService.ingredientsTemplate(req.user.tenantId ?? undefined);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="clerque-ingredients-template.xlsx"',
    });
    res.send(buf);
  }

  // ── Recipes / BOM (Sprint 19) ──────────────────────────────────────────
  @Post('recipes')
  @UseInterceptors(FileInterceptor('file', IMPORT_UPLOAD))
  importRecipes(@UploadedFile() file: Express.Multer.File, @Req() req: AuthRequest) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.importService.importRecipes(file, req.user.tenantId!);
  }
  @Get('template/recipes')
  async recipesTemplate(@Req() req: AuthRequest, @Res() res: Response) {
    const buf = await this.importService.recipesTemplate(req.user.tenantId ?? undefined);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="clerque-recipes-template.xlsx"',
    });
    res.send(buf);
  }
}
