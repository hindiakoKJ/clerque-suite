import { Module } from '@nestjs/common';
import { LayoutsController } from './layouts.controller';
import { LayoutsService } from './layouts.service';

@Module({
  controllers: [LayoutsController],
  providers:   [LayoutsService],
  exports:     [LayoutsService],
})
export class LayoutsModule {}
