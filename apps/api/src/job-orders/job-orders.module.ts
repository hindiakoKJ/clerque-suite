import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { JobOrdersService } from './job-orders.service';
import { JobOrdersController } from './job-orders.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [JobOrdersController],
  providers:   [JobOrdersService],
  exports:     [JobOrdersService],
})
export class JobOrdersModule {}
