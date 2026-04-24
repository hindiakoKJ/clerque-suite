import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    // Log masked DB URL so we can verify env vars are received on Render
    const url = process.env.DATABASE_URL ?? '(not set)';
    const masked = url.length > 20
      ? url.replace(/:([^:@]+)@/, ':***@').substring(0, 80) + '...'
      : url;
    this.logger.log(`Connecting to: ${masked}`);

    try {
      await this.$connect();
      this.logger.log('Database connected successfully');
    } catch (err) {
      this.logger.error(`Database connection failed: ${(err as Error).message}`);
      // Don't crash on startup — let health checks surface the issue
      // The app will still start; DB errors will surface per-request
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
