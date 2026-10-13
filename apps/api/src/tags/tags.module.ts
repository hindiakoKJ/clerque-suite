import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AuditModule } from '../audit/audit.module';
import { TagsController } from './tags.controller';
import { TagsService } from './tags.service';

/** Clerque Inventory, Phase 1: printed label numbers on one-of-a-kind parts. */
@Module({
  imports:     [DocumentsModule, AuditModule],
  controllers: [TagsController],
  providers:   [TagsService],
  exports:     [TagsService],
})
export class TagsModule {}
