import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NumberingModule } from '../numbering/numbering.module';
import { TruckingService } from './trucking.service';
import { TruckingController } from './trucking.controller';

@Module({
  imports:     [PrismaModule, NumberingModule],
  controllers: [TruckingController],
  providers:   [TruckingService],
  exports:     [TruckingService],
})
export class TruckingModule {}
