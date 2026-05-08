import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { LayoutsModule } from '../layouts/layouts.module';
import { AccountingModule } from '../accounting/accounting.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports:     [PrismaModule, LayoutsModule, AccountingModule, MailModule],
  controllers: [AdminController],
  providers:   [AdminService],
})
export class AdminModule {}
