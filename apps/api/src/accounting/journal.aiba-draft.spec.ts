import { JournalService } from './journal.service';

/**
 * A journal entry an API key drafted (source AIBA) is posted by a person,
 * and Clerque's approval threshold still applies to it then: at or over the
 * threshold it waits for an approver instead of reaching the books.
 */
describe('JournalService.post — an AIBA draft and the approval threshold', () => {
  const T = 't1';
  function build(source: string, amount: number, threshold = 50000) {
    const entry = {
      id: 'je1', tenantId: T, entryNumber: 'JE-0001', status: 'DRAFT', source, date: new Date('2026-11-30'), postingDate: null,
      lines: [
        { accountId: 'a1', debit: amount, credit: 0 },
        { accountId: 'a2', debit: 0, credit: amount },
      ],
    };
    const prisma: any = {
      journalEntry: {
        findFirst: jest.fn().mockResolvedValueOnce(entry).mockResolvedValue({ ...entry, status: 'X' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      account: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          { id: 'a1', code: '6100', name: 'Salaries', postingControl: 'OPEN' },
          { id: 'a2', code: '1010', name: 'Cash', postingControl: 'OPEN' },
        ]),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ jeApprovalThreshold: threshold }) },
    };
    const periods: any = { assertDateIsOpen: jest.fn().mockResolvedValue(undefined) };
    const svc = new JournalService(prisma, {} as any, periods, {} as any);
    return { svc, prisma };
  }

  it('at or over the threshold, an AIBA draft goes to PENDING_APPROVAL, not POSTED', async () => {
    const { svc, prisma } = build('AIBA', 52310);
    await svc.post(T, 'je1', 'u_bookkeeper');
    expect(prisma.journalEntry.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.journalEntry.updateMany.mock.calls[0][0]).toEqual({
      where: { id: 'je1', tenantId: T, status: 'DRAFT' },
      data:  { status: 'PENDING_APPROVAL' },
    });
  });

  it('under the threshold it posts as any draft does', async () => {
    const { svc, prisma } = build('AIBA', 1200);
    await svc.post(T, 'je1', 'u_bookkeeper');
    expect(prisma.journalEntry.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'POSTED', postedBy: 'u_bookkeeper' });
  });

  it("a person's own manual draft is unchanged by this rule", async () => {
    const { svc, prisma } = build('MANUAL', 52310);
    await svc.post(T, 'je1', 'u_bookkeeper');
    expect(prisma.tenant.findUnique).not.toHaveBeenCalled();
    expect(prisma.journalEntry.updateMany.mock.calls[0][0].data.status).toBe('POSTED');
  });
});
