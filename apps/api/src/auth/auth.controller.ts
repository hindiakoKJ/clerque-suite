import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Delete,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { RefreshDto, LogoutDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtPayload } from '@repo/shared-types';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @UseGuards(AuthGuard('local'))
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Request() req: any) {
    const { id, tenantId, branchId, role, name } = req.user;
    const deviceInfo = req.headers['user-agent'];
    const ipAddress = req.ip;
    return this.authService.login(id, tenantId, branchId, role, name ?? '', deviceInfo, ipAddress);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    const sub = this.authService.extractRefreshSub(dto.refreshToken);
    return this.authService.refresh(sub, dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@CurrentUser() user: JwtPayload, @Body() dto: LogoutDto) {
    await this.authService.logout(user.sub, dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('sessions')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(@CurrentUser() user: JwtPayload) {
    await this.authService.logoutAllDevices(user.sub);
  }

  /**
   * POST /auth/change-password
   * Authenticated users can change their own password.
   * Requires current password for verification.
   * All sessions are revoked after a successful change.
   */
  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() user: JwtPayload,
    @Body() body: { currentPassword?: string; newPassword?: string },
  ) {
    if (!body.currentPassword || !body.newPassword) {
      throw new BadRequestException('currentPassword and newPassword are required.');
    }
    await this.authService.changePassword(user.sub, body.currentPassword, body.newPassword);
  }

  /**
   * POST /auth/forgot-password
   * Accepts email + tenantSlug. Always responds 204 (no email enumeration).
   * If the user exists and is active, a password-reset email is sent.
   */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() body: { email?: string; tenantSlug?: string }) {
    if (!body.email || !body.tenantSlug) return; // silent — avoid enumeration
    await this.authService.forgotPassword(body.email, body.tenantSlug);
  }

  /**
   * POST /auth/reset-password
   * Validates the one-time reset token and sets the new password.
   * All sessions are revoked after a successful reset.
   */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() body: { token?: string; newPassword?: string }) {
    if (!body.token || !body.newPassword) {
      throw new BadRequestException('token and newPassword are required.');
    }
    await this.authService.resetPassword(body.token, body.newPassword);
  }
}
