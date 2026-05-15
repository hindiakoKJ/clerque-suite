import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { VoidApprovalsService } from './void-approvals.service';
import { VoidApprovalsController } from './void-approvals.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [VoidApprovalsController],
  providers:   [VoidApprovalsService],
  exports:     [VoidApprovalsService],
})
export class VoidApprovalsModule {}
