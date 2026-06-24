import { SimpleEntriesService } from './simple-entries.service';
import { CreateSimpleEntryDto } from './dto/simple-entry.dto';

/**
 * Verifies the financial core: each plain-language entry type maps to the
 * correct, balanced debit/credit account codes. Account ids are mocked as
 * `acct-<code>` so we can assert the code that was posted.
 */
describe('SimpleEntriesService', () => {
  let svc: SimpleEntriesService;
  let captured: { lines: Array<{ accountId: string; debit?: number; credit?: number }>; reference?: string } | null;

  const accounts = {
    findByCode: jest.fn((_t: string, code: string) => Promise.resolve({ id: `acct-${code}`, code })),
  };
  const journal = {
    create: jest.fn((_t: string, dto: any) => {
      captured = dto;
      return Promise.resolve({ id: 'je1', entryNumber: 'JE-1', date: new Date(dto.date), description: dto.description, status: 'POSTED' });
    }),
  };
  const prisma = { journalEntry: { findMany: jest.fn() } };

  const TID = 'tenant-1';
  const UID = 'user-1';

  beforeEach(() => {
    jest.clearAllMocks();
    captured = null;
    svc = new SimpleEntriesService(prisma as any, accounts as any, journal as any);
  });

  const dr = () => captured!.lines.find((l) => l.debit != null)!.accountId;
  const cr = () => captured!.lines.find((l) => l.credit != null)!.accountId;
  const balanced = () => {
    const d = captured!.lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const c = captured!.lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    return Math.abs(d - c) < 0.001;
  };
  const run = (dto: Partial<CreateSimpleEntryDto>) =>
    svc.create(TID, UID, { amount: 1000, date: '2026-06-24', ...dto } as CreateSimpleEntryDto);

  it('EXPENSE (rent, from bank) → DR 6050 / CR 1020, balanced', async () => {
    await run({ type: 'EXPENSE', source: 'BANK', category: 'RENT', amount: 15000 });
    expect(dr()).toBe('acct-6050');
    expect(cr()).toBe('acct-1020');
    expect(balanced()).toBe(true);
  });

  it('EXPENSE with no category → misc 6140; default funding is CASH', async () => {
    await run({ type: 'EXPENSE' });
    expect(dr()).toBe('acct-6140');
    expect(cr()).toBe('acct-1010');
  });

  it('EXPENSE categories map to the right account', async () => {
    const map: Record<string, string> = {
      UTILITIES: '6060', SUPPLIES: '6070', REPAIRS: '6090', TRANSPORT: '6100', OTHER: '6140',
    };
    for (const [cat, code] of Object.entries(map)) {
      await run({ type: 'EXPENSE', category: cat as any, source: 'CASH' });
      expect(dr()).toBe(`acct-${code}`);
    }
  });

  it('OTHER_INCOME (cash) → DR 1010 / CR 4050', async () => {
    await run({ type: 'OTHER_INCOME', source: 'CASH' });
    expect(dr()).toBe('acct-1010');
    expect(cr()).toBe('acct-4050');
    expect(balanced()).toBe(true);
  });

  it('OWNER_CONTRIBUTION (bank) → DR 1020 / CR 3010', async () => {
    await run({ type: 'OWNER_CONTRIBUTION', source: 'BANK' });
    expect(dr()).toBe('acct-1020');
    expect(cr()).toBe('acct-3010');
  });

  it('OWNER_DRAWING (cash) → DR 3020 / CR 1010', async () => {
    await run({ type: 'OWNER_DRAWING', source: 'CASH' });
    expect(dr()).toBe('acct-3020');
    expect(cr()).toBe('acct-1010');
  });

  it('DEPOSIT_TO_BANK → DR 1020 / CR 1010', async () => {
    await run({ type: 'DEPOSIT_TO_BANK' });
    expect(dr()).toBe('acct-1020');
    expect(cr()).toBe('acct-1010');
    expect(balanced()).toBe(true);
  });

  it('WITHDRAW_TO_CASH → DR 1010 / CR 1020', async () => {
    await run({ type: 'WITHDRAW_TO_CASH' });
    expect(dr()).toBe('acct-1010');
    expect(cr()).toBe('acct-1020');
  });

  it('amount is posted on both legs and reference is stamped SE', async () => {
    await run({ type: 'EXPENSE', source: 'CASH', amount: 250.5 });
    const debit = captured!.lines.find((l) => l.debit != null)!.debit;
    const credit = captured!.lines.find((l) => l.credit != null)!.credit;
    expect(debit).toBe(250.5);
    expect(credit).toBe(250.5);
    expect(captured!.reference).toBe('SE');
  });

  it('posts with MANUAL source and the acting user', async () => {
    await run({ type: 'EXPENSE', source: 'CASH' });
    expect(journal.create).toHaveBeenCalledWith(TID, expect.anything(), UID, 'MANUAL');
  });

  it('throws a friendly error if an account is missing', async () => {
    accounts.findByCode.mockResolvedValueOnce(null as any);
    await expect(run({ type: 'EXPENSE', source: 'CASH' })).rejects.toThrow(/not fully set up/i);
  });
});
