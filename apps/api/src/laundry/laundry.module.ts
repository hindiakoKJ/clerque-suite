import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LaundryService } from './laundry.service';
import { LaundryController } from './laundry.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [LaundryController],
  providers:   [LaundryService],
  exports:     [LaundryService],
})
export class LaundryModule {}
