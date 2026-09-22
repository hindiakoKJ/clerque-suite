/**
 * Journal Entries .xlsx export.
 *
 * Before: the export called the screen's paged list with no page, so the
 * bookkeeper got the newest 50 entries — and the columns carried no debit or
 * credit. The page said "460 total entries"; the file had 50, no amounts.
 */
import ExcelJS from 'exceljs';
import { ExportService, journalExportRows, JOURNAL_EXPORT_COLUMNS, type JournalExportEntry } from './export.service';

const cashLine  = (n: number) => ({ description: null,   debit: n, credit: 0, account: { code: '1010', name: 'Cash on Hand' } });
const salesLine = (n: number) => ({ description: 'sale', debit: 0, credit: n, account: { code: '4010', name: 'Sales Revenue' } });

const entry = (i: number, status = 'POSTED', lines = [cashLine(100), salesLine(100)]): JournalExportEntry => ({
  entryNumber: `JE-${String(i).padStart(4, '0')}`,
  date:        new Date('2026-09-01T00:00:00+08:00'),
  postingDate: null,
  description: `Sale ORD-2026-${String(i).padStart(6, '0')}`,
  reference:   null,
  source:      'POS',
  status,
  lines,
});

describe('journalExportRows', () => {
  it('writes one row per LINE with the account and the amount, repeating the entry header', () => {
    const { rows } = journalExportRows([entry(1)]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      entryIndex: 0, entryNumber: 'JE-0001', description: 'Sale ORD-2026-000001', source: 'POS', status: 'POSTED',
      accountCode: '1010', accountName: 'Cash on Hand', lineNote: '', debit: 100, credit: null,
    });
    expect(rows[1]).toMatchObject({
      entryIndex: 0, entryNumber: 'JE-0001',
      accountCode: '4010', accountName: 'Sales Revenue', lineNote: 'sale', debit: null, credit: 100,
    });
  });

  it('leaves the untouched side BLANK (not 0.00) so the sheet reads like a journal', () => {
    const { rows } = journalExportRows([entry(1)]);
    expect(rows[0].credit).toBeNull();
    expect(rows[1].debit).toBeNull();
  });

  it('totals POSTED entries only in a mixed listing, so the figure agrees with the trial balance', () => {
    const { totalDebit, totalCredit, rows } = journalExportRows([
      entry(1, 'POSTED'), entry(2, 'DRAFT'), entry(3, 'VOIDED'),
    ]);
    expect(rows).toHaveLength(6);           // drafts and voids are still LISTED
    expect(totalDebit).toBe(100);
    expect(totalCredit).toBe(100);
  });

  it('totals everything it lists when the caller filtered to a single status', () => {
    const { totalDebit } = journalExportRows([entry(1, 'DRAFT'), entry(2, 'DRAFT')], true);
    expect(totalDebit).toBe(200);
  });

  it('adds in centavos, so 0.1 + 0.2 comes out as 0.30 and not 0.30000000000000004', () => {
    const { totalDebit } = journalExportRows([
      entry(1, 'POSTED', [cashLine(0.1), salesLine(0.1)]),
      entry(2, 'POSTED', [cashLine(0.2), salesLine(0.2)]),
    ]);
    expect(totalDebit).toBe(0.3);
  });

  it('posting date falls back to the document date on an older entry', () => {
    const { rows } = journalExportRows([entry(1)]);
    expect(rows[0].postingDate.getTime()).toBe(rows[0].docDate.getTime());
  });

  it('carries Debit and Credit columns', () => {
    const keys = JOURNAL_EXPORT_COLUMNS.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['accountCode', 'accountName', 'debit', 'credit']));
  });
});

describe('ExportService.exportJournal', () => {
  it('ships EVERY entry in the range with its lines — not the screen page of 50', async () => {
    const entries = Array.from({ length: 120 }, (_, i) => entry(i + 1));
    const journal = { findAllForExport: jest.fn().mockResolvedValue(entries), findAll: jest.fn() };
    const prisma  = { tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Carolina' }) } };
    const none = {} as never;
    const svc = new ExportService(
      prisma as never, none, journal as never, none, none, none, none, none, none, none, none, none, none, none,
    );

    const buf = await svc.exportJournal('t1', { from: '2026-09-01', to: '2026-09-30' });

    // The un-paged query, with the same filter the screen uses.
    expect(journal.findAll).not.toHaveBeenCalled();
    expect(journal.findAllForExport).toHaveBeenCalledWith('t1', { from: '2026-09-01', to: '2026-09-30', status: undefined });

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Journal Entries')!;

    const headers = (ws.getRow(4).values as unknown[]).map((v) => String(v ?? ''));
    expect(headers).toEqual(expect.arrayContaining(['Entry #', 'Account Code', 'Account Name', 'Debit', 'Credit']));
    const debitCol  = headers.indexOf('Debit');
    const creditCol = headers.indexOf('Credit');
    const descCol   = headers.indexOf('Description');

    const entryNumbers = new Set<string>();
    let lineRows = 0;
    let totalRowDebit: unknown = null;
    let totalRowCredit: unknown = null;
    ws.eachRow((row, n) => {
      if (n < 5) return;
      const first = row.getCell(1).value;
      if (typeof first === 'string' && first.startsWith('JE-')) { entryNumbers.add(first); lineRows++; }
      const desc = row.getCell(descCol).value;
      if (typeof desc === 'string' && desc.startsWith('TOTAL')) {
        totalRowDebit  = row.getCell(debitCol).value;
        totalRowCredit = row.getCell(creditCol).value;
      }
    });
    expect(entryNumbers.size).toBe(120);   // was capped at 50
    expect(lineRows).toBe(240);            // two lines per entry
    expect(totalRowDebit).toBe(12000);
    expect(totalRowCredit).toBe(12000);
  });
});
