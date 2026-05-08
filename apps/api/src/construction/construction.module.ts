import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConstructionService } from './construction.service';
import { ConstructionController } from './construction.controller';

@Module({
  imports:     [PrismaModule],
  controllers: [ConstructionController],
  providers:   [ConstructionService],
  exports:     [ConstructionService],
})
export class ConstructionModule {}
