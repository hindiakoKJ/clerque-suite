import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NumberingModule } from '../numbering/numbering.module';
import { ConstructionService } from './construction.service';
import { ConstructionController } from './construction.controller';

@Module({
  imports:     [PrismaModule, NumberingModule],
  controllers: [ConstructionController],
  providers:   [ConstructionService],
  exports:     [ConstructionService],
})
export class ConstructionModule {}
