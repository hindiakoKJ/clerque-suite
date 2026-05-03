import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { LayoutsModule } from '../layouts/layouts.module';

@Module({
  imports:     [PrismaModule, LayoutsModule],
  controllers: [AdminController],
  providers:   [AdminService],
})
export class AdminModule {}
