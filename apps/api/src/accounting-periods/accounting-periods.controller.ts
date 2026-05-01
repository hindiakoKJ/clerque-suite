import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AccountingPeriodsService } from './accounting-periods.service';
import { CreatePeriodDto } from './dto/create-period.dto';
import { ReopenPeriodDto } from './dto/reopen-period.dto';

@ApiTags('Accounting Periods')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('accounting-periods')
export class AccountingPeriodsController {
  constructor(private periodsService: AccountingPeriodsService) {}

  @Roles('ACCOUNTANT', 'BRANCH_MANAGER', 'BUSINESS_OWNER')
  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.periodsService.list(user.tenantId!);
  }

  /**
   * Period-Close Checklist (CLOCO) — auto-evaluated pre-close checks.
   * Returns each check's status (PASS/FAIL/MANUAL/N_A) so the UI can show
   * a guided close flow.
   */
  @Roles('ACCOUNTANT', 'FINANCE_LEAD', 'BUSINESS_OWNER', 'SUPER_ADMIN')
  @Get(':id/checklist')
  checklist(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.periodsService.getCloseChecklist(user.tenantId!, id);
  }

  @Roles('BUSINESS_OWNER')
  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() body: CreatePeriodDto) {
    return this.periodsService.create(user.tenantId!, body);
  }

  /** Close a period — only Business Owner can lock the books. Audit-logged. */
  @Roles('BUSINESS_OWNER')
  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
             ?? req.socket?.remoteAddress;
    return this.periodsService.closePeriod(user.tenantId!, id, user.sub, ip);
  }

  /**
   * Reopen a closed period — Business Owner only.
   *
   * Mirrors SAP OB52: a written reason is mandatory, close metadata is preserved,
   * and the action is recorded in the immutable AuditLog.
   *
   * Body: { reason: string }  ← required, min 10 chars
   */
  @Roles('BUSINESS_OWNER')
  @Patch(':id/reopen')
  @HttpCode(HttpStatus.OK)
  reopen(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ReopenPeriodDto,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
             ?? req.socket?.remoteAddress;
    return this.periodsService.reopenPeriod(
      user.tenantId!, id, user.sub, body.reason, ip,
    );
  }
}
