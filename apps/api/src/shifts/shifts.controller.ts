import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ShiftsService } from './shifts.service';
import { OpenShiftDto } from './dto/open-shift.dto';
import { CloseShiftDto } from './dto/close-shift.dto';

@ApiTags('Shifts')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('shifts')
export class ShiftsController {
  constructor(private shiftsService: ShiftsService) {}

  /**
   * Open a new shift (or return the existing active one — idempotent).
   * Restricted to operational cashier roles only.
   * BUSINESS_OWNER and BRANCH_MANAGER are supervisors — they do not operate the register.
   */
  @Roles('CASHIER', 'SALES_LEAD')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  open(@CurrentUser() user: JwtPayload, @Body() body: OpenShiftDto) {
    return this.shiftsService.open(
      user.tenantId!,
      user.sub,
      body.branchId,
      body.openingCash,
      body.notes,
    );
  }

  /**
   * Get the active (open) shift for a branch.
   * Supervisors can see which shift is running without being the cashier.
   */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get('active')
  getActive(@CurrentUser() user: JwtPayload, @Query('branchId') branchId: string) {
    return this.shiftsService.getActive(user.tenantId!, user.sub, branchId);
  }

  /** List recent shifts — management / reporting view */
  @Roles('BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('branchId') branchId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.shiftsService.list(user.tenantId!, branchId, limit ? parseInt(limit) : 20);
  }

  /** Get a specific shift by ID with full summary */
  @Roles('CASHIER', 'SALES_LEAD', 'BRANCH_MANAGER', 'BUSINESS_OWNER', 'SUPER_ADMIN', 'FINANCE_LEAD')
  @Get(':id')
  getById(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.shiftsService.getById(user.tenantId!, id);
  }

  /**
   * Close the active shift — cashier/sales-lead only.
   * Supervisors cannot close a shift they never opened.
   */
  @Roles('CASHIER', 'SALES_LEAD')
  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: CloseShiftDto,
  ) {
    return this.shiftsService.close(
      user.tenantId!,
      id,
      user.sub,
      body.closingCashDeclared,
      body.notes,
    );
  }
}
