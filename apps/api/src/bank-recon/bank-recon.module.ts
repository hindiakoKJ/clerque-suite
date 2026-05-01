import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BankReconciliationController } from './bank-recon.controller';
import { BankReconciliationService } from './bank-recon.service';

@Module({
  imports:     [PrismaModule],
  controllers: [BankReconciliationController],
  providers:   [BankReconciliationService],
})
export class BankReconciliationModule {}
