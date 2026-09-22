import 'reflect-metadata';
import { PH_TIMEZONE } from '@repo/shared-types';
import { BackupScheduler } from '../backup/backup.scheduler';
import { AuditArchiveScheduler } from '../audit/audit-archive.scheduler';
import { AutoBackupService } from '../auto-backup/auto-backup.service';
import { CleanupScheduler } from './cleanup.scheduler';

/**
 * The jobs meant for the middle of the night must run in the middle of the
 * MANILA night. Railway containers run in UTC, so a bare '0 2 * * *' fired at
 * 10:00 in the morning -- the full-database backup in the middle of service.
 */
/** The metadata key @Cron writes its options under (@nestjs/schedule's SCHEDULE_CRON_OPTIONS, not exported). */
const SCHEDULE_CRON_OPTIONS = 'SCHEDULE_CRON_OPTIONS';

describe('night-time jobs run on Manila time', () => {
  const cron = (method: unknown) => Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, method as object) as { cronTime: string; timeZone?: string };

  it.each([
    ['daily backup, 02:00',           BackupScheduler.prototype.runDailyBackup,               '0 2 * * *'],
    ['audit archive, 02:30',          AuditArchiveScheduler.prototype.runDailyArchive,        '30 2 * * *'],
    ['plan auto-backup, 02:00',       AutoBackupService.prototype.runDailyBackups,            '0 02 * * *'],
    ['idempotency-key purge, 03:15',  CleanupScheduler.prototype.purgeExpiredIdempotencyKeys, '15 3 * * *'],
  ])('%s', (_name, method, cronTime) => {
    expect(cron(method)).toMatchObject({ cronTime, timeZone: PH_TIMEZONE });
  });
});
