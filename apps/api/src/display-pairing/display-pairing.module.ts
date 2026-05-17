import { Module } from '@nestjs/common';
import { DisplayPairingController } from './display-pairing.controller';
import { DisplayPairingService } from './display-pairing.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports:   [PrismaModule],
  controllers: [DisplayPairingController],
  providers:   [DisplayPairingService],
  exports:     [DisplayPairingService],
})
export class DisplayPairingModule {}
