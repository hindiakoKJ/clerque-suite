import { Module } from '@nestjs/common';
import { UomService } from './uom.service';
import { UomController } from './uom.controller';

@Module({
  providers:   [UomService],
  controllers: [UomController],
  exports:     [UomService],
})
export class UomModule {}
