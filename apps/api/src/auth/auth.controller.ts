import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Delete,
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
    // Decode to get userId without full validation — refresh strategy handles trust
    const payload = this.authService['jwt'].decode(dto.refreshToken) as { sub: string };
    return this.authService.refresh(payload.sub, dto.refreshToken);
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
}
