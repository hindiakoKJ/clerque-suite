import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NumberingModule } from '../numbering/numbering.module';
import { PharmacyService } from './pharmacy.service';
import { PharmacyController } from './pharmacy.controller';
import { DeliveryService } from './delivery.service';
import { DeliveryController } from './delivery.controller';

@Module({
  imports:     [PrismaModule, NumberingModule],
  controllers: [PharmacyController, DeliveryController],
  providers:   [PharmacyService, DeliveryService],
  exports:     [PharmacyService, DeliveryService],
})
export class PharmacyModule {}
