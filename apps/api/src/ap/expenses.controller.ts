import {
  Controller,
  Get,
  Post,
  Patch,
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
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto, UpdateExpenseDto, RecordPaymentDto } from './dto/expense.dto';
import { ExpenseStatus } from '@prisma/client';

const AP_READ_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT',
  'FINANCE_LEAD', 'BOOKKEEPER', 'EXTERNAL_AUDITOR',
] as const;

const AP_WRITE_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT', 'AP_ACCOUNTANT',
] as const;

const AP_POST_VOID_ROLES = [
  'BUSINESS_OWNER', 'SUPER_ADMIN', 'ACCOUNTANT',
] as const;

@ApiTags('AP — Expenses')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ap/expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @Roles(...AP_READ_ROLES)
  findAll(
    @CurrentUser() user: JwtPayload,
    @Query('vendorId') vendorId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const parsedStatus = status as ExpenseStatus | undefined;
    return this.expensesService.findAll(user.tenantId!, {
      vendorId,
      status: parsedStatus,
      from,
      to,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  @Roles(...AP_READ_ROLES)
  findOne(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.findOne(id, user.tenantId!);
  }

  @Post()
  @Roles(...AP_WRITE_ROLES)
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: JwtPayload) {
    return this.expensesService.create(user.tenantId!, user.sub, dto);
  }

  @Patch(':id')
  @Roles(...AP_WRITE_ROLES)
  update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.expensesService.update(id, user.tenantId!, user.sub, dto);
  }

  @Post(':id/post')
  @Roles(...AP_POST_VOID_ROLES)
  @HttpCode(HttpStatus.OK)
  postExpense(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.post(id, user.tenantId!, user.sub);
  }

  @Post(':id/void')
  @Roles(...AP_POST_VOID_ROLES)
  @HttpCode(HttpStatus.OK)
  voidExpense(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.expensesService.void(id, user.tenantId!, user.sub);
  }

  @Post(':id/pay')
  @Roles(...AP_WRITE_ROLES)
  @HttpCode(HttpStatus.OK)
  recordPayment(
    @Param('id') id: string,
    @Body() dto: RecordPaymentDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.expensesService.recordPayment(id, user.tenantId!, user.sub, dto);
  }
}
