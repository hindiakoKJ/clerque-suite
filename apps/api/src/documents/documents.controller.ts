import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Query,
  Body,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { DocumentsService } from './documents.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { JwtPayload } from '@repo/shared-types';

@ApiTags('Documents')
@ApiBearerAuth('access-token')
// Attachments here are BIR supporting records (receipts behind journal
// entries, AP bills, AR invoices). RolesGuard was absent, so any
// authenticated principal — including kiosk/display accounts — could
// upload, list and download them. Delete is additionally SOD-gated in
// the service.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  /** POST /documents/upload — upload a file and link it to an entity. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD', 'CASHIER',
         'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'AR_ACCOUNTANT',
         'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR')
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    return this.documentsService.upload(
      user.tenantId!,
      dto.entityType,
      dto.entityId,
      file,
      dto.label,
      user.sub,
    );
  }

  /** GET /documents?entityType=X&entityId=Y — list docs for an entity. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD', 'CASHIER',
         'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'AR_ACCOUNTANT',
         'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR')
  @Get()
  list(
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Req() req: Request,
  ) {
    const user = req.user as JwtPayload;
    return this.documentsService.list(user.tenantId!, entityType, entityId, user.role);
  }

  /** GET /documents/:id/download — stream the file. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD', 'CASHIER',
         'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'AR_ACCOUNTANT',
         'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR')
  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = req.user as JwtPayload;
    await this.documentsService.serve(user.tenantId!, id, res, user.role);
  }

  /** DELETE /documents/:id — delete document + file from disk. */
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'SALES_LEAD', 'CASHIER',
         'ACCOUNTANT', 'BOOKKEEPER', 'FINANCE_LEAD', 'AR_ACCOUNTANT',
         'AP_ACCOUNTANT', 'EXTERNAL_AUDITOR')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as JwtPayload;
    return this.documentsService.delete(
      user.tenantId!, id, user.sub, user.role, user.customPermissions,
    );
  }
}
