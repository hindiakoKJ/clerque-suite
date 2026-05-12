import { Module } from '@nestjs/common';
import { BirService } from './bir.service';
import { Bir2307Service } from './bir-2307.service';
import { BirController } from './bir.controller';

@Module({
  providers:   [BirService, Bir2307Service],
  controllers: [BirController],
  exports:     [BirService, Bir2307Service],
})
export class BirModule {}
