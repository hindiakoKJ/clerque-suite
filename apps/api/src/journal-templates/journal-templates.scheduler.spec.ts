/**
 * JournalTemplatesScheduler — a due template holding another shop's account
 * (saved before the save-time check existed) is skipped and logged by the
 * nightly job; the shop's other due templates still post (S4-7 / KNOWN-2).
 */
import { JournalTemplatesScheduler } from './journal-templates.scheduler';
import { JournalTemplatesService } from './journal-templates.service';

const SHOP_A = 'tenant-a';
const SHOP_B = 'tenant-b';

const ACCOUNTS = [
  { id: 'a-rent', tenantId: SHOP_A },
  { id: 'a-cash', tenantId: SHOP_A },
  { id: 'b-cash', tenantId: SHOP_B },
];

const BAD_TPL = {
  id: 'tpl-bad', tenantId: SHOP_A, name: 'Planted', isActive: true, frequency: 'MONTHLY',
  createdById: 'user-a', lastRunAt: null,
  lines: [{ accountId: 'a-rent', debit: 100 }, { accountId: 'b-cash', credit: 100 }],
};
const GOOD_TPL = {
  id: 'tpl-good', tenantId: SHOP_A, name: 'Monthly rent', isActive: true, frequency: 'MONTHLY',
  createdById: 'user-a', lastRunAt: null,
  lines: [{ accountId: 'a-rent', debit: 100 }, { accountId: 'a-cash', credit: 100 }],
};

describe('JournalTemplatesScheduler.runDailyTemplates — foreign accounts', () => {
  it("skips and logs a template with another shop's account, and still runs the good one", async () => {
    const templates = [BAD_TPL, GOOD_TPL];
    const prisma = {
      tenant: { findMany: jest.fn().mockResolvedValue([{ id: SHOP_A }]) },
      journalTemplate: {
        findMany:  jest.fn().mockResolvedValue(templates),
        findFirst: jest.fn(async ({ where }: any) =>
          templates.find((t) => t.id === where.id && t.tenantId === where.tenantId) ?? null),
        update:    jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
      account: {
        count: jest.fn(async ({ where }: any) =>
          ACCOUNTS.filter((a) => where.id.in.includes(a.id) && a.tenantId === where.tenantId).length),
      },
    };
    const journal = { create: jest.fn(async () => ({ id: 'je-1', status: 'POSTED' })) };
    const svc = new JournalTemplatesService(prisma as any, journal as any);
    const scheduler = new JournalTemplatesScheduler(prisma as any, svc);

    const logger = (scheduler as any).logger;
    const errorSpy = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);

    await scheduler.runDailyTemplates();

    // Only the good template reached the journal.
    expect(journal.create).toHaveBeenCalledTimes(1);
    expect((journal.create.mock.calls[0] as any[])[1].description).toContain('tpl-good');

    // The bad one was logged with its id and the reason.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('tpl-bad');
    expect(errorSpy.mock.calls[0][0]).toContain('not in your shop');

    // The bad template was not marked as run; the good one was.
    expect(prisma.journalTemplate.update).toHaveBeenCalledTimes(1);
    expect(prisma.journalTemplate.update.mock.calls[0][0].where).toEqual({ id: 'tpl-good' });
  });
});
