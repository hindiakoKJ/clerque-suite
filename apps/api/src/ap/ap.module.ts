import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VendorsController } from './vendors.controller';
import { ExpensesController } from './expenses.controller';
import { VendorsService } from './vendors.service';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [PrismaModule],
  controllers: [VendorsController, ExpensesController],
  providers: [VendorsService, ExpensesService],
  exports: [VendorsService, ExpensesService],
})
export class ApModule {}
