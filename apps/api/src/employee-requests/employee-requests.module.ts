import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmployeeRequestsController } from './employee-requests.controller';
import { EmployeeRequestsService } from './employee-requests.service';

@Module({
  imports:     [PrismaModule],
  controllers: [EmployeeRequestsController],
  providers:   [EmployeeRequestsService],
  exports:     [EmployeeRequestsService],
})
export class EmployeeRequestsModule {}
