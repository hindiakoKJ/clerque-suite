import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UomService, CreateUomDto, UpdateUomDto } from './uom.service';

@ApiTags('Units of Measure')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('uom')
export class UomController {
  constructor(private readonly uom: UomService) {}

  /** List all UoMs for the tenant (auto-seeds standard set on first call). */
  @Get()
  findAll(@CurrentUser() user: JwtPayload) {
    return this.uom.findAll(user.tenantId!);
  }

  /** Create a custom unit. MDM and OWNER only. */
  @Roles('BUSINESS_OWNER', 'MDM')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUomDto) {
    return this.uom.create(user.tenantId!, dto);
  }

  /** Update an existing unit. MDM and OWNER only. */
  @Roles('BUSINESS_OWNER', 'MDM')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUomDto,
  ) {
    return this.uom.update(user.tenantId!, id, dto);
  }

  /** Soft-deactivate a unit. OWNER only (cannot hard-delete — products may reference it). */
  @Roles('BUSINESS_OWNER')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  deactivate(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.uom.deactivate(user.tenantId!, id);
  }
}
