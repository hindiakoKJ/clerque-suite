import { Controller, Get, HttpException, HttpStatus, Logger, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger('Health');

  constructor(private prisma: PrismaService) {}

  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (err) {
      /*
        This route is public. Prisma's connection error names the database
        host, port and sometimes the user, so it goes to the log and nowhere
        else; the caller gets a plain 503 that load balancers and uptime
        monitors understand.
      */
      this.logger.error(`Database check failed: ${(err as Error)?.message ?? err}`);
      throw new HttpException(
        { code: 'DB_UNREACHABLE', message: 'The database is not reachable right now.', status: 'degraded', db: 'error' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return { status: 'ok', db: 'ok', timestamp: new Date().toISOString() };
  }

  /**
   * The address the API believes the caller has. It tells the caller nothing
   * they do not already know, and it is the one-step check that the
   * Cloudflare -> Railway proxy chain is read correctly: open it on the shop's
   * wifi and it must show the shop's public address, not Cloudflare's. The
   * rate limiter and the bad-login lockout are keyed on this value.
   */
  @Get('ip')
  ip(@Req() req: Request) {
    // The forwarding headers as they really arrive, in the log only. This is how client-ip.ts was
    // corrected (Railway appends its own edge); if Railway or Cloudflare change, it shows here first.
    this.logger.log(`ip-chain ${JSON.stringify({
      xff: req.headers?.['x-forwarded-for'] ?? null,
      xRealIp: req.headers?.['x-real-ip'] ?? null,
      cf: req.headers?.['cf-connecting-ip'] ?? null,
      envoy: req.headers?.['x-envoy-external-address'] ?? null,
      forwarded: req.headers?.['forwarded'] ?? null,
      socket: req.socket?.remoteAddress ?? null,
      resolved: req.ip ?? null,
    })}`);
    return { ip: req.ip ?? null };
  }
}
