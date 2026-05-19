import { Module } from '@nestjs/common';
import { PreOrdersController } from './pre-orders.controller';
import { PreOrdersService } from './pre-orders.service';

@Module({
  controllers: [PreOrdersController],
  providers: [PreOrdersService],
  exports: [PreOrdersService],
})
export class PreOrdersModule {}
