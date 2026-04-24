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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';
import { UsersService, CreateUserDto, UpdateUserDto } from './users.service';

interface ResetPasswordBody { newPassword: string; }

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

  // List staff (owner sees all, manager sees their branch only)
  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Get()
  findAll(@CurrentUser() user: JwtPayload, @Query('branchId') branchId?: string) {
    const filterBranchId =
      user.role === 'BRANCH_MANAGER' ? (user.branchId ?? undefined) : branchId;
    return this.usersService.findAll(user.tenantId!, filterBranchId);
  }

  @Roles('BUSINESS_OWNER', 'BRANCH_MANAGER')
  @Get(':id')
  findOne(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.usersService.findOne(user.tenantId!, id);
  }

  // Create staff — only owner
  @Roles('BUSINESS_OWNER')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateUserDto) {
    return this.usersService.create(user.tenantId!, dto);
  }

  // Update user — only owner
  @Roles('BUSINESS_OWNER')
  @Patch(':id')
  update(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.usersService.update(user.tenantId!, id, dto);
  }

  // Reset password — only owner
  @Roles('BUSINESS_OWNER')
  @Post(':id/reset-password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() body: ResetPasswordBody,
  ) {
    return this.usersService.resetPassword(user.tenantId!, id, body.newPassword);
  }
}
