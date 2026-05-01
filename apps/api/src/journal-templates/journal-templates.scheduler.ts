/**
 * JournalTemplatesScheduler — daily auto-run of recurring JE templates.
 *
 * Runs at 4am Manila (20:00 UTC the previous day) — after midnight closes
 * but before users start their day. For each tenant with due templates,
 * instantiates them as POSTED entries (or PENDING_APPROVAL if they exceed
 * the approval threshold).
 *
 * Failures in one template don't block the others — each is wrapped in
 * try/catch.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { JournalTemplatesService } from './journal-templates.service';

@Injectable()
export class JournalTemplatesScheduler {
  private readonly logger = new Logger(JournalTemplatesScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly svc:    JournalTemplatesService,
  ) {}

  @Cron('0 20 * * *', { timeZone: 'Asia/Manila' })
  async runDailyTemplates() {
    this.logger.log('Running due journal-template auto-instantiations…');
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true },
    });
    for (const t of tenants) {
      try {
        const due = await this.svc.findDueTemplates(t.id);
        for (const tpl of due) {
          try {
            await this.svc.runNow(t.id, tpl.id, tpl.createdById);
            this.logger.log(`Tenant ${t.id}: ran template ${tpl.name} (${tpl.id})`);
          } catch (err) {
            this.logger.error(`Tenant ${t.id} template ${tpl.id} failed: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        this.logger.error(`Tenant ${t.id} due-template scan failed: ${(err as Error).message}`);
      }
    }
  }
}
