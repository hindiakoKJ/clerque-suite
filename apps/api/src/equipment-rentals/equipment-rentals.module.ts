import { Module } from '@nestjs/common';
import { EquipmentRentalsController } from './equipment-rentals.controller';
import { EquipmentRentalsService } from './equipment-rentals.service';
import { AccountingModule } from '../accounting/accounting.module';
import { TaxModule } from '../tax/tax.module';

/**
 * Courts-vertical equipment rentals (paddles / shoes / balls). Separate from
 * the DME `rentals` module. Posts via JournalService with source SYSTEM.
 */
@Module({
  imports:     [AccountingModule, TaxModule],
  controllers: [EquipmentRentalsController],
  providers:   [EquipmentRentalsService],
  exports:     [EquipmentRentalsService],
})
export class EquipmentRentalsModule {}
