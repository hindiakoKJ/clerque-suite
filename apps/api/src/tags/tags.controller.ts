import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { TagsService, type PaidFrom } from './tags.service';

/** Who prints labels and sees the full list. */
const LABEL_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM'] as const;
/**
 * Who tags parts. In a small shop the seller is also the receiver, and a
 * person holds one role, so cashiers tag too -- only with printed labels, and
 * nothing sells until the owner has costed it from the photos.
 */
const TAG_ROLES = ['BUSINESS_OWNER', 'BRANCH_MANAGER', 'MDM', 'CASHIER', 'WAREHOUSE_STAFF', 'SALES_LEAD'] as const;

class ReserveLabelsDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(500)
  count!: number;
}

class CreateTagDto {
  @IsString() @Matches(/^\d{6}$/, { message: 'The tag number is the 6 digits on the label.' })
  number!: string;

  @IsString() @MaxLength(64)
  productId!: string;

  @IsString() @MaxLength(64)
  branchId!: string;

  @IsOptional() @IsString() @MaxLength(64)
  engineNumber?: string;

  @IsOptional() @IsString() @MaxLength(64)
  chassisNumber?: string;

  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;
}

class CostTagDto {
  @Type(() => Number) @IsNumber() @Min(0) @Max(100_000_000)
  cost!: number;

  @IsIn(['OWNER_FUNDED', 'BANK', 'CASH'])
  paidFrom!: PaidFrom;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Roles(...LABEL_ROLES)
  @Post('labels/reserve')
  reserve(@CurrentUser() user: JwtPayload, @Body() body: ReserveLabelsDto) {
    return this.tags.reserveLabels(user.tenantId!, user.sub, body.count);
  }

  @Roles(...LABEL_ROLES)
  @Get('labels/runs')
  runs(@CurrentUser() user: JwtPayload) {
    return this.tags.listRuns(user.tenantId!);
  }

  @Roles(...TAG_ROLES)
  @Get('lookup')
  lookup(@CurrentUser() user: JwtPayload, @Query('code') code: string, @Query('branchId') branchId?: string) {
    return this.tags.lookup(user.tenantId!, user.role, code ?? '', branchId);
  }

  @Roles(...TAG_ROLES)
  @Get('photos/:documentId')
  async photo(@Param('documentId') documentId: string, @Req() req: Request, @Res() res: Response) {
    const user = req.user as JwtPayload;
    await this.tags.servePhoto(user.tenantId!, documentId, res, user.role);
  }

  @Roles(...LABEL_ROLES)
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('q') q?: string,
  ) {
    return this.tags.list(user.tenantId!, user.role, { status, branchId, q });
  }

  @Roles(...TAG_ROLES)
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreateTagDto) {
    return this.tags.createTag(user.tenantId!, user.sub, body);
  }

  @Roles(...TAG_ROLES)
  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } }))
  addPhoto(@CurrentUser() user: JwtPayload, @Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    return this.tags.addPhoto(user.tenantId!, user.sub, user.role, id, file);
  }

  /** The owner alone puts a part in stock, after seeing its photos. */
  @Roles('BUSINESS_OWNER')
  @Post(':id/cost')
  @HttpCode(HttpStatus.OK)
  cost(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() body: CostTagDto) {
    return this.tags.costTag(user.tenantId!, user.sub, id, body.cost, body.paidFrom);
  }
}
