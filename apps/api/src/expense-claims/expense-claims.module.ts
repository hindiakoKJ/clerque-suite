import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ExpenseClaimsService } from './expense-claims.service';
import { ExpenseClaimsController } from './expense-claims.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [ExpenseClaimsController],
  providers:   [ExpenseClaimsService],
  exports:     [ExpenseClaimsService],
})
export class ExpenseClaimsModule {}
