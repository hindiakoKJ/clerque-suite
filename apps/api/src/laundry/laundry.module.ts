import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NumberingModule } from '../numbering/numbering.module';
import { LaundryService } from './laundry.service';
import { LaundryController } from './laundry.controller';
import { PublicStubController } from './public-stub.controller';

@Module({
  imports:     [PrismaModule, NumberingModule],
  controllers: [LaundryController, PublicStubController],
  providers:   [LaundryService],
  exports:     [LaundryService],
})
export class LaundryModule {}
