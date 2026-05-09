import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NumberingModule } from '../numbering/numbering.module';
import { JobOrdersService } from './job-orders.service';
import { JobOrdersController } from './job-orders.controller';

@Module({
  imports:     [PrismaModule, NumberingModule],
  controllers: [JobOrdersController],
  providers:   [JobOrdersService],
  exports:     [JobOrdersService],
})
export class JobOrdersModule {}
