import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, MaxLength, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard }   from '../auth/guards/jwt-auth.guard';
import { RolesGuard }     from '../auth/guards/roles.guard';
import { AppAccessGuard } from '../auth/guards/app-access.guard';
import { RequireApp }     from '../auth/decorators/require-app.decorator';
import { Roles }          from '../auth/decorators/roles.decorator';
import { CurrentUser }    from '../auth/decorators/current-user.decorator';
import { JwtPayload }     from '@repo/shared-types';
import { CashAdvanceService } from './cash-advance.service';
import { CA_PAID_FROM } from './cash-advance';

const PAID_FROM = Object.keys(CA_PAID_FROM);
const STATUSES  = ['REQUESTED', 'OPEN', 'PAID', 'REJECTED', 'CANCELLED'];

class RequestAdvanceDto {
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) amount: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) perPayday: number;
  @IsString() @MaxLength(300) reason: string;
}

class GiveAdvanceDto {
  @IsString() userId: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) amount: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) perPayday: number;
  @IsIn(PAID_FROM) paidFrom: string;
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
  @IsOptional() @IsDateString() givenOn?: string;
}

class ApproveAdvanceDto {
  @IsIn(PAID_FROM) paidFrom: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) amount?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) perPayday?: number;
  @IsOptional() @IsDateString() givenOn?: string;
}

class RejectAdvanceDto {
  @IsString() @MaxLength(300) reason: string;
}

/**
 * Staff cash advances. Handing over money is payroll-finance work, so only
 * the owner and the payroll master decide; every staff member can ask for
 * one and see their own balance.
 */
@ApiTags('Payroll')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard, AppAccessGuard)
@RequireApp('PAYROLL', 'CLOCK_ONLY')
@Controller('payroll')
export class CashAdvanceController {
  constructor(private readonly svc: CashAdvanceService) {}

  // ── Owner / payroll master ─────────────────────────────────────────────

  @ApiOperation({ summary: 'All cash advances (optionally by status)' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Get('cash-advances')
  list(@CurrentUser() user: JwtPayload, @Query('status') status?: string) {
    return this.svc.list(user.tenantId!, status && STATUSES.includes(status) ? status : undefined);
  }

  @ApiOperation({ summary: 'Record a cash advance already handed over' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('cash-advances')
  give(@CurrentUser() user: JwtPayload, @Body() dto: GiveAdvanceDto) {
    return this.svc.give(user.tenantId!, { sub: user.sub, role: user.role }, dto);
  }

  @ApiOperation({ summary: 'Hand over the money for a staff request' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('cash-advances/:id/approve')
  approve(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: ApproveAdvanceDto) {
    return this.svc.approve(user.tenantId!, { sub: user.sub, role: user.role }, id, dto);
  }

  @ApiOperation({ summary: 'Turn down a staff request' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('cash-advances/:id/reject')
  reject(@CurrentUser() user: JwtPayload, @Param('id') id: string, @Body() dto: RejectAdvanceDto) {
    return this.svc.reject(user.tenantId!, { sub: user.sub, role: user.role }, id, dto.reason);
  }

  @ApiOperation({ summary: 'Undo an advance recorded by mistake (nothing taken back yet)' })
  @Roles('BUSINESS_OWNER', 'PAYROLL_MASTER', 'SUPER_ADMIN')
  @Post('cash-advances/:id/cancel')
  cancel(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.cancel(user.tenantId!, { sub: user.sub, role: user.role }, id);
  }

  // ── Staff self-service ─────────────────────────────────────────────────

  @ApiOperation({ summary: 'My cash advances and what is left to pay back' })
  @Get('me/cash-advances')
  mine(@CurrentUser() user: JwtPayload) {
    return this.svc.listMine(user.tenantId!, user.sub);
  }

  @ApiOperation({ summary: 'Ask for a cash advance' })
  @Post('me/cash-advances')
  request(@CurrentUser() user: JwtPayload, @Body() dto: RequestAdvanceDto) {
    return this.svc.request(user.tenantId!, user.sub, dto);
  }

  @ApiOperation({ summary: 'Withdraw my request while it is still waiting' })
  @Post('me/cash-advances/:id/withdraw')
  withdraw(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.svc.withdraw(user.tenantId!, user.sub, id);
  }
}
