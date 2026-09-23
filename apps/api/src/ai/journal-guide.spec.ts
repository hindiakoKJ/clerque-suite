/**
 * What the entry checker does with an answer that is not in the shape the
 * prompt asked for.
 *
 * The verdict is not decoration: the journal screen colours the panel with it
 * and disables "Post Entry" on BLOCKING. So a verdict the screen cannot read
 * is not a cosmetic problem — it is an entry the checker objected to that the
 * person can still post, under a heading that says otherwise.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { JournalGuideService } from './journal-guide.service';
import { AiService } from './ai.service';
import { PrismaService } from '../prisma/prisma.service';

const UTILITIES = 'acc-utilities';
const CASH      = 'acc-cash';

function makePrismaMock() {
  return {
    account: {
      findMany: jest.fn().mockResolvedValue([
        { id: UTILITIES, code: '6060', name: 'Utilities Expense', type: 'EXPENSE', normalBalance: 'DEBIT',  isSystem: false, postingControl: 'OPEN' },
        { id: CASH,      code: '1010', name: 'Cash on Hand',      type: 'ASSET',   normalBalance: 'DEBIT',  isSystem: false, postingControl: 'OPEN' },
      ]),
    },
    tenant: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ taxStatus: 'NON_VAT', businessName: 'Cafe Carolina', businessType: 'CAFE' }),
    },
    // No history needed: the prompt simply leaves that section out.
    journalEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

/** A balanced, ordinary entry — the cases are about the ANSWER, not the entry. */
const ENTRY = {
  date: '2026-09-16',
  memo: 'Meralco September',
  reference: null,
  lines: [
    { accountId: UTILITIES, side: 'DEBIT'  as const, amount: 8500, description: 'Electricity' },
    { accountId: CASH,      side: 'CREDIT' as const, amount: 8500, description: 'Paid in cash' },
  ],
};

describe('JournalGuideService — the verdict the screen acts on', () => {
  let svc:    JournalGuideService;
  let prisma: ReturnType<typeof makePrismaMock>;
  let ai:     { call: jest.Mock };

  beforeEach(async () => {
    prisma = makePrismaMock();
    ai     = { call: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JournalGuideService,
        { provide: PrismaService, useValue: prisma },
        { provide: AiService,     useValue: ai },
      ],
    }).compile();

    svc = module.get(JournalGuideService);
  });

  /** Put a whole model answer on the wire. */
  const answers = (obj: unknown) => ai.call.mockResolvedValue(JSON.stringify(obj));

  const blockIssue = {
    severity: 'BLOCK', lineIndex: 0,
    message: 'Utilities Expense is credited on a bill you paid.',
    rationale: 'Paying a bill increases the expense.',
  };
  const warnIssue = {
    severity: 'WARN', lineIndex: 1,
    message: 'No reference number on the entry.',
    rationale: 'Harder to trace at audit.',
  };

  it('keeps a good answer exactly as the model wrote it', async () => {
    answers({ verdict: 'WARNINGS', summary: 'Check line 2.', issues: [warnIssue] });

    const out = await svc.validate('t1', 'u1', ENTRY);

    expect(out.verdict).toBe('WARNINGS');
    expect(out.summary).toBe('Check line 2.');
    expect(out.issues).toHaveLength(1);
    expect(out.meta).toEqual({ promptVersion: 'v1.0.0', aiAssisted: true });
  });

  it('blocks when the answer lists a BLOCK issue but has no verdict', async () => {
    answers({ summary: 'That is backwards.', issues: [blockIssue] });

    const out = await svc.validate('t1', 'u1', ENTRY);

    // Without this the screen fell through to its all-clear branch and left
    // "Post Entry" live under a BLOCK issue.
    expect(out.verdict).toBe('BLOCKING');
    expect(out.summary).toBe('That is backwards.');
  });

  it('blocks when the answer lists a BLOCK issue but claims everything is OK', async () => {
    answers({ verdict: 'OK', summary: 'Looks fine.', issues: [blockIssue] });

    expect((await svc.validate('t1', 'u1', ENTRY)).verdict).toBe('BLOCKING');
  });

  it('reads a misspelled verdict as "worth a look" when issues were listed', async () => {
    // "WARNING" is the spelling a model reaches for; the screen knows only
    // "WARNINGS".
    answers({ verdict: 'WARNING', summary: 'Check line 2.', issues: [warnIssue] });

    expect((await svc.validate('t1', 'u1', ENTRY)).verdict).toBe('WARNINGS');
  });

  it('keeps a near-miss verdict even when the answer listed nothing', async () => {
    // The model plainly meant "look at this". Deriving from an empty issues
    // list instead would turn that into a green all-clear.
    answers({ verdict: 'WARNING', summary: 'Check line 1.', issues: [] });

    expect((await svc.validate('t1', 'u1', ENTRY)).verdict).toBe('WARNINGS');
  });

  it('reads "BLOCKED" as blocking', async () => {
    answers({ verdict: 'BLOCKED', summary: 'Do not post this.', issues: [] });

    expect((await svc.validate('t1', 'u1', ENTRY)).verdict).toBe('BLOCKING');
  });

  it('says WARNINGS for an INFO-only answer with no verdict', async () => {
    answers({ summary: 'Just a note.', issues: [{ severity: 'INFO', lineIndex: null, message: 'Paid from cash.', rationale: 'Usually the bank.' }] });

    expect((await svc.validate('t1', 'u1', ENTRY)).verdict).toBe('WARNINGS');
  });

  it('says OK when there is no verdict and nothing was flagged', async () => {
    answers({ summary: 'Clean.', issues: [] });

    expect((await svc.validate('t1', 'u1', ENTRY)).verdict).toBe('OK');
  });

  it('fills in a sentence when the model forgot the summary', async () => {
    answers({ verdict: 'WARNINGS', issues: [warnIssue] });

    const out = await svc.validate('t1', 'u1', ENTRY);

    expect(out.summary).toBe('Worth a second look before you post this.');
  });

  it('fills in a sentence when the summary is blank', async () => {
    answers({ verdict: 'OK', summary: '   ', issues: [] });

    expect((await svc.validate('t1', 'u1', ENTRY)).summary).toBe(
      'Nothing to flag — the accounts and the sides look like the usual pattern.',
    );
  });

  it('survives an answer whose "issues" is an object, not a list', async () => {
    // This used to throw inside .map and leave the route answering 500
    // "an unexpected error occurred".
    answers({ verdict: 'WARNINGS', summary: 'x', issues: { first: 'Utilities credited' } });

    const out = await svc.validate('t1', 'u1', ENTRY);

    expect(out.issues).toEqual([]);
    // The verdict the model did give is usable, so it stands: the panel says
    // "Review before posting" with nothing listed, which is the honest read
    // of an answer we could only half understand.
    expect(out.verdict).toBe('WARNINGS');
  });

  it('still refuses an answer that is not JSON at all', async () => {
    ai.call.mockResolvedValue('I had a look and it seems fine to me.');

    await expect(svc.validate('t1', 'u1', ENTRY)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('still clamps a line number the model invented', async () => {
    answers({ verdict: 'WARNINGS', summary: 'x', issues: [{ ...warnIssue, lineIndex: 9 }] });

    expect((await svc.validate('t1', 'u1', ENTRY)).issues[0].lineIndex).toBeNull();
  });

  it('still drops a suggested account that does not exist', async () => {
    answers({
      verdict: 'WARNINGS', summary: 'x',
      issues: [{ ...warnIssue, suggestion: { type: 'swap_account', description: 'Use the bank', accountId: 'not-a-real-id' } }],
    });

    expect((await svc.validate('t1', 'u1', ENTRY)).issues[0].suggestion?.accountId).toBeUndefined();
  });
});
