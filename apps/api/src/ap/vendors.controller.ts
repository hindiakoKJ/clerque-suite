import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { VendorsService } from './vendors.service';
import { ExpensesService } from './expenses.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/vendor.dto';

const AP_READ_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT',
  'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR',
] as const;

const AP_WRITE_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT',
] as const;

@ApiTags('AP — Vendors')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ap/vendors')
export class VendorsController {
  constructor(
    private readonly vendorsService: VendorsService,
    private readonly expensesService: ExpensesService,
  ) {}

  @Get()
  @Roles(...AP_READ_ROLES)
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('isActive') isActive?: string,
  ) {
    const activeFilter =
      isActive === 'true' ? true : isActive === 'false' ? false : undefined;
    return this.vendorsService.findAll(user.tenantId!, { search, isActive: activeFilter });
  }

  @Get('aging')
  @Roles(...AP_READ_ROLES)
  getAging(@CurrentUser() user: JwtPayload) {
    return this.expensesService.getAging(user.tenantId!);
  }

  /** FBL1N — Vendor Ledger Explorer drill-down. */
  @Get(':id/ledger')
  @Roles(...AP_READ_ROLES)
  getLedger(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to')   to?:   string,
  ) {
    return this.vendorsService.getLedger(user.tenantId!, id, { from, to });
  }

  @Get(':id')
  @Roles(...AP_READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vendorsService.findOne(id, user.tenantId!);
  }

  @Post()
  @Roles(...AP_WRITE_ROLES)
  create(@Body() dto: CreateVendorDto, @CurrentUser() user: JwtPayload) {
    return this.vendorsService.create(user.tenantId!, dto);
  }

  @Patch(':id')
  @Roles(...AP_WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateVendorDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.vendorsService.update(id, user.tenantId!, dto);
  }

  @Delete(':id')
  @Roles(...AP_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  deactivate(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.vendorsService.deactivate(id, user.tenantId!);
  }
}
