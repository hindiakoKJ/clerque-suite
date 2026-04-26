import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CustomersController } from './customers.controller';
import { ArController } from './ar.controller';
import { CustomersService } from './customers.service';
import { ArService } from './ar.service';

@Module({
  imports: [PrismaModule],
  controllers: [CustomersController, ArController],
  providers: [CustomersService, ArService],
  exports: [CustomersService, ArService],
})
export class ArModule {}
