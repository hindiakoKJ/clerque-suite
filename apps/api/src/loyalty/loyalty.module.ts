import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoyaltyService } from './loyalty.service';
import { LoyaltyController } from './loyalty.controller';
import { LoyaltyPublicController } from './loyalty-public.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [LoyaltyController, LoyaltyPublicController],
  providers:   [LoyaltyService],
  exports:     [LoyaltyService],
})
export class LoyaltyModule {}
