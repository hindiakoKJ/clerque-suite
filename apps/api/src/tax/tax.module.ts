import { Module } from '@nestjs/common';
import { TaxCalculatorService } from './tax.service';

@Module({
  providers: [TaxCalculatorService],
  exports:   [TaxCalculatorService],
})
export class TaxModule {}
