import {
  Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Logger, Patch, Post, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsBoolean, IsOptional } from 'class-validator';
import type { JwtPayload } from '@repo/shared-types';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { TelegramClient } from './telegram.client';
import { TelegramLinksService, TgUpdate } from './telegram-links.service';
import { secretsMatch } from './link-token';

class UpdateTelegramAlertsDto {
  @IsOptional() @IsBoolean() alertSales?: boolean;
  @IsOptional() @IsBoolean() alertBuying?: boolean;
}

@ApiTags('Telegram')
@Controller('telegram')
export class TelegramController {
  private readonly logger = new Logger('TelegramWebhook');

  constructor(
    private readonly links: TelegramLinksService,
    private readonly client: TelegramClient,
  ) {}

  @Get('me')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: JwtPayload) {
    return this.links.status(user);
  }

  /** A one-time link, good for 10 minutes, that ties the opener's Telegram chat to this signed-in person. */
  @Post('link')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  link(@CurrentUser() user: JwtPayload) {
    return this.links.createLink(user);
  }

  @Patch('me')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  update(@CurrentUser() user: JwtPayload, @Body() dto: UpdateTelegramAlertsDto) {
    return this.links.updateMine(user, dto);
  }

  @Delete('me')
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  unlink(@CurrentUser() user: JwtPayload) {
    return this.links.unlinkMine(user);
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAuthGuard)
  test(@CurrentUser() user: JwtPayload) {
    return this.links.sendTest(user);
  }

  /**
   * Telegram's calls to us. No login: it proves itself with the secret it was
   * given when the webhook was registered, compared in constant time. Answers
   * 200 even when handling fails, so Telegram does not keep re-sending an
   * update our own bug cannot handle.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  // Named: a bare @SkipThrottle() only skips a throttler called 'default', and this app's are short/medium/long.
  @SkipThrottle({ short: true, medium: true, long: true })
  @ApiExcludeEndpoint()
  async webhook(
    @Headers('x-telegram-bot-api-secret-token') secret: string | undefined,
    @Body() update: TgUpdate,
  ) {
    const expected = this.client.webhookSecret;
    if (!expected || !secretsMatch(expected, secret)) throw new UnauthorizedException();
    try {
      await this.links.handleUpdate(update ?? {});
    } catch (err) {
      this.logger.error(`Could not handle a Telegram update: ${err instanceof Error ? err.message : err}`);
    }
    return { ok: true };
  }
}
