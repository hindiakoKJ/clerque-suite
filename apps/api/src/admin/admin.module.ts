import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { LayoutsModule } from '../layouts/layouts.module';
import { AccountingModule } from '../accounting/accounting.module';

@Module({
  imports:     [PrismaModule, LayoutsModule, AccountingModule],
  controllers: [AdminController],
  providers:   [AdminService],
})
export class AdminModule {}
