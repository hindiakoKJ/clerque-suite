import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LoyaltyProService } from './loyalty-pro.service';
import { LoyaltyProController } from './loyalty-pro.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [LoyaltyProController],
  providers:   [LoyaltyProService],
  exports:     [LoyaltyProService],
})
export class LoyaltyProModule {}
