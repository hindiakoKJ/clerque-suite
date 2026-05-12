import { Module } from '@nestjs/common';
import { BirService } from './bir.service';
import { BirController } from './bir.controller';

@Module({
  providers:   [BirService],
  controllers: [BirController],
  exports:     [BirService],
})
export class BirModule {}
