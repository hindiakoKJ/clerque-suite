import { Module } from '@nestjs/common';
import { KdsController } from './kds.controller';
import { KdsService } from './kds.service';

@Module({
  controllers: [KdsController],
  providers:   [KdsService],
})
export class KdsModule {}
