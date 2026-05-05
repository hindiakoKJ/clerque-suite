import { Module } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { OperationsService } from './operations.service';
import { ReportsController } from './reports.controller';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, OperationsService],
  exports: [ReportsService, OperationsService],
})
export class ReportsModule {}
