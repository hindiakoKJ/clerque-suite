import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { TierQuotaGuard } from '../auth/guards/tier-quota.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@ApiTags('Users')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  // Branches listing — needed by frontend dropdowns
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER', 'CASHIER')
  @Get('branches')
  getBranches(@CurrentUser() user: JwtPayload) {
    return this.usersService.getBranches(user.tenantId!);
  }

  // List staff — owner/payroll_master see salary fields; others see masked response
  @Roles('BUSINESS_OWNER', 'MDM', 'BRANCH_MANAGER', 'SALES_LEAD', 'PAYROLL_MASTER')
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    const filterBranchId =
      user.role === 'BRANCH_MANAGER' || user.role === 'MDM' || user.role === 'SALES_LEAD'
        ? (user.branchId ?? undefined)
        : branchId;
    return this.usersService.findAll(user.tenantId!, filterBranchId, user.role);
  }

  @Roles('BUSINESS_OWNER', 'MDM', 'BRANCH_MANAGER', 'SALES_LEAD', 'PAYROLL_MASTER')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.usersService.findOne(user.tenantId!, id, user.role);
  }

  // Create staff — BUSINESS_OWNER and MDM can add employees.
  // TierQuotaGuard rejects with TIER_QUOTA_EXCEEDED if tier.maxStaff reached.
  @Roles('BUSINESS_OWNER', 'MDM')
  @UseGuards(TierQuotaGuard)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.tenantId!, dto);
  }

  // Update user — BUSINESS_OWNER and MDM can edit employee details
  @Roles('BUSINESS_OWNER', 'MDM')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user.tenantId!, id, dto, user.role, user.sub);
  }

  // Reset password — only owner
  @Roles('BUSINESS_OWNER')
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ResetPasswordDto,
  ) {
    return this.usersService.resetPassword(user.tenantId!, id, body.newPassword);
  }

  /**
   * Toggle MDM role — BUSINESS_OWNER only.
   *
   * Promotes a staff member to MDM (Master Data Manager) or demotes them back
   * to GENERAL_EMPLOYEE. Sessions are invalidated immediately on change.
   * All actions are recorded in the immutable AuditLog.
   */
  @Roles('BUSINESS_OWNER')
  @Patch(':id/toggle-mdm')
  @HttpCode(HttpStatus.OK)
  toggleMdm(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
             ?? req.socket?.remoteAddress;
    return this.usersService.assignMdmRole(user.tenantId!, id, user.sub, ip);
  }
}
