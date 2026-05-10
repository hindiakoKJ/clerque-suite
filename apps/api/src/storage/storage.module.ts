import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Sprint 19 — Storage module. Global so DocumentsService, ProductsController,
 * BackupScheduler, and any future upload path can inject StorageService
 * without each module re-importing it.
 */
@Global()
@Module({
  providers: [StorageService],
  exports:   [StorageService],
})
export class StorageModule {}
