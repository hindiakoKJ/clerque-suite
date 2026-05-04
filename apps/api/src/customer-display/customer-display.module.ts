import { Module } from '@nestjs/common';
import { CustomerDisplayController } from './customer-display.controller';
import { CustomerDisplayService } from './customer-display.service';

@Module({
  controllers: [CustomerDisplayController],
  providers:   [CustomerDisplayService],
})
export class CustomerDisplayModule {}
