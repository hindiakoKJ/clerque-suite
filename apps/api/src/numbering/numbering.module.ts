import { Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/**
 * NumberingModule — global service for AR / AP document numbers.
 * Exported so AR + AP modules can inject NumberingService.next() and call
 * it inside their own posting transactions.
 */
@Module({
  providers: [NumberingService],
  exports:   [NumberingService],
})
export class NumberingModule {}
