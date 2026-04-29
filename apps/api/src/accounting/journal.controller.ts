import {
  Controller, Get, Post, Patch, Param, Body, Query, UseGuards, HttpCode, HttpStatus,
  UploadedFile, UseInterceptors, Res,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JournalService, CreateJournalDto } from './journal.service';
import { JournalImportService } from './journal-import.service';

@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting/journal')
export class JournalController {
  constructor(
    private readonly svc:    JournalService,
    private readonly import_: JournalImportService,
  ) {}

  /** Read journal entries — Bookkeeper and above; External Auditor read-only. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get()
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('page')   page?:   string,
    @Query('from')   from?:   string,
    @Query('to')     to?:     string,
    @Query('status') status?: string,
  ) {
    return this.svc.findAll(user.tenantId!, {
      page: page ? Number(page) : 1, from, to, status,
    });
  }

  /** Get single journal entry — same read-access set. */
  @Roles('BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'EXTERNAL_AUDITOR')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  /** Create — can save as DRAFT or post immediately */
  @Post()
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateJournalDto) {
    return this.svc.create(user.tenantId!, dto, user.sub);
  }

  /** Approve & post a DRAFT entry */
  @Patch(':id/post')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @HttpCode(HttpStatus.OK)
  post(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.post(user.tenantId!, id, user.sub);
  }

  /**
   * GET /accounting/journal/import/template
   * Generates a tenant-specific .xlsx template (with the actual COA seeded
   * as a reference sheet) for the user to download, fill, and re-upload.
   */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT', 'BOOKKEEPER', 'SUPER_ADMIN')
  @Get('import/template')
  async downloadImportTemplate(
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const buffer = await this.import_.generateTemplate(user.tenantId!);
    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="je-import-template-${new Date().toISOString().slice(0, 10)}.xlsx"`,
    });
    res.send(buffer);
  }

  /**
   * POST /accounting/journal/import
   * Upload a filled-in .xlsx. Atomic — either all JEs in the file post or
   * none do. Per-row errors are returned for the user to fix and re-upload.
   *
   * Multipart form-data: field name "file"
   */
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap
  }))
  importXlsx(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file) throw new BadRequestException('No file uploaded.');
    return this.import_.importFromXlsx(user.tenantId!, user.sub, file.buffer);
  }

  /** Reverse a POSTED entry — creates a mirror JE with flipped debits/credits */
  @Post(':id/reverse')
  @Roles('BUSINESS_OWNER', 'ACCOUNTANT')
  reverse(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: { reverseDate?: string },
  ) {
    return this.svc.reverse(user.tenantId!, id, user.sub, body.reverseDate);
  }
}
