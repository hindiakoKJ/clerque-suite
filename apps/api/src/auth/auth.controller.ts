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
import { RefreshDto, LogoutDto, PinLoginDto } from './dto/login.dto';
import { UnauthorizedException } from '@nestjs/common';
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

  /**
   * POST /auth/pin-login
   * Cashier fast-login. tenantSlug + email + 4-8 digit PIN.
   * Returns the same JWT shape as /auth/login.
   */
  @Post('pin-login')
  @HttpCode(HttpStatus.OK)
  async pinLogin(@Request() req: any, @Body() dto: PinLoginDto) {
    const user = await this.authService.validateUserByPin(dto.email, dto.pin, dto.companyCode);
    if (!user) throw new UnauthorizedException('Invalid PIN, email, or company code.');
    const deviceInfo = req.headers['user-agent'];
    const ipAddress = req.ip;
    return this.authService.login(
      user.id,
      user.tenantId,
      user.branchId,
      user.role,
      user.name ?? '',
      deviceInfo,
      ipAddress,
    );
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

  /**
   * POST /auth/verify-supervisor-pin
   * Used at the cashier till to authorise a void. The cashier is logged in;
   * the supervisor enters their PIN on the cashier's screen. The endpoint
   * looks up which supervisor (in the SAME tenant, with VOID_DIRECT role)
   * owns this PIN and returns their identity for the void to record.
   *
   * Request:  { pin: "1234" }
   * Returns:  { userId, name, role }  (200)
   * Errors:   401 if no matching supervisor found
   *
   * The endpoint requires JWT auth so we know which tenant to scope the PIN
   * lookup to — prevents cross-tenant PIN reuse.
   */
  @UseGuards(JwtAuthGuard)
  @Post('verify-supervisor-pin')
  @HttpCode(HttpStatus.OK)
  async verifySupervisorPin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { pin?: string },
  ) {
    if (!body.pin) throw new BadRequestException('pin is required.');
    return this.authService.verifySupervisorPin(user.tenantId!, body.pin);
  }

  /**
   * POST /auth/set-supervisor-pin
   * Set or change the current user's supervisor PIN. Self-service only —
   * supervisors set their own PIN, never delegated to admin (they could
   * then impersonate). Requires the user's current login password to
   * confirm identity (defence against stolen-session PIN takeover).
   *
   * Request:  { currentPassword: "...", newPin: "1234" }
   * Returns:  204
   */
  @UseGuards(JwtAuthGuard)
  @Post('set-supervisor-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setSupervisorPin(
    @CurrentUser() user: JwtPayload,
    @Body() body: { currentPassword?: string; newPin?: string },
  ) {
    if (!body.currentPassword || !body.newPin) {
      throw new BadRequestException('currentPassword and newPin are required.');
    }
    await this.authService.setSupervisorPin(user.sub, body.currentPassword, body.newPin);
  }
}
