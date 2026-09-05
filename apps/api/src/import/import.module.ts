import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AccountingPeriodsModule } from '../accounting-periods/accounting-periods.module';
import { SubRecipesModule } from '../sub-recipes/sub-recipes.module';

@Module({
  imports: [
    PrismaModule,
    AccountingPeriodsModule,
    // "Made in batches": the importer defines preps through the same
    // setRecipe the app uses, so one set of rules decides what a prep may be.
    SubRecipesModule,
    MulterModule.register({ storage: memoryStorage() }),
  ],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
