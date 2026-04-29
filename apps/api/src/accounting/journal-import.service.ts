/**
 * JournalImportService — Excel JE import for batch posting.
 *
 * Two surfaces:
 *   1. Template download — generates a tenant-specific .xlsx with the actual
 *      COA pre-populated as a reference sheet, plus header row, sample rows,
 *      and Excel data validation (drop-downs, date format, etc.).
 *   2. Upload + parse — atomic per-entry, per-row error reporting. Either the
 *      whole batch posts or nothing posts.
 *
 * Excel layout (strict — must match the template):
 *   Sheet "Journal Entries":
 *     Row 1: header (frozen)
 *     Row 2+: data rows
 *   Columns (in order):
 *     A: Group Key            — string; same value groups lines into one JE
 *     B: Document Date        — date (YYYY-MM-DD)
 *     C: Posting Date         — date; blank = use Document Date
 *     D: Memo                 — short description (becomes JE.description)
 *     E: Reference            — optional external ref (invoice #, OR #)
 *     F: Account Code         — looked up against tenant COA
 *     G: Line Description     — optional per-line memo
 *     H: Debit                — peso amount (decimal, 2dp); blank for credit lines
 *     I: Credit               — peso amount (decimal, 2dp); blank for debit lines
 *
 *   Sheet "COA Reference" (read-only, auto-populated):
 *     Account Code | Account Name | Type | Normal Balance
 *
 *   Sheet "Instructions" (auto-populated):
 *     How to fill the template, common gotchas, validation rules.
 *
 * One Excel file can contain MANY JEs — they're grouped by the "Group Key"
 * column. e.g. groupKey "JE-A" rows form one entry, "JE-B" rows form another.
 *
 * Atomic semantics:
 *   - If ANY row fails validation, NONE of the JEs post. Errors are returned
 *     per-row so the user can fix Excel and retry. This matches the user
 *     expectation of "either I posted everything or I posted nothing".
 *   - Each individual JE goes through journal.service.ts → create() so
 *     period-lock + balance + permission checks all apply per-entry.
 */

import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';
import { JournalService } from './journal.service';

interface ImportRow {
  rowNumber:       number;
  groupKey:        string;
  documentDate:    string | null;
  postingDate:     string | null;
  memo:            string | null;
  reference:       string | null;
  accountCode:     string | null;
  lineDescription: string | null;
  debit:           number | null;
  credit:          number | null;
}

export interface ImportRowError {
  row:      number;
  column:   string;
  message:  string;
}

export interface ImportResult {
  successful:    number;          // JEs posted
  failed:        number;          // JEs that didn't post
  errors:        ImportRowError[];
  postedEntries: { entryNumber: string; description: string; lineCount: number }[];
}

@Injectable()
export class JournalImportService {
  private readonly logger = new Logger(JournalImportService.name);

  constructor(
    private prisma:  PrismaService,
    private journal: JournalService,
  ) {}

  // ─── Template generation ───────────────────────────────────────────────────

  /**
   * Build a tenant-specific .xlsx template the user downloads, fills in,
   * and uploads. The template carries:
   *   - Header row + sample rows on the data sheet
   *   - The tenant's actual COA as a reference sheet (so users can copy
   *     codes they actually have, not generic textbook codes)
   *   - Instructions sheet
   */
  async generateTemplate(tenantId: string): Promise<Buffer> {
    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, postingControl: 'OPEN' },
      orderBy: { code: 'asc' },
      select: { code: true, name: true, type: true, normalBalance: true },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    wb.created = new Date();

    // ── Sheet 1: Journal Entries (the data sheet) ───────────────────────────
    const dataSheet = wb.addWorksheet('Journal Entries', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    dataSheet.columns = [
      { header: 'Group Key',        key: 'groupKey',     width: 12 },
      { header: 'Document Date',    key: 'docDate',      width: 14, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Posting Date',     key: 'postDate',     width: 14, style: { numFmt: 'yyyy-mm-dd' } },
      { header: 'Memo',             key: 'memo',         width: 40 },
      { header: 'Reference',        key: 'reference',    width: 20 },
      { header: 'Account Code',     key: 'accountCode',  width: 14 },
      { header: 'Line Description', key: 'lineDesc',     width: 30 },
      { header: 'Debit',            key: 'debit',        width: 14, style: { numFmt: '#,##0.00' } },
      { header: 'Credit',           key: 'credit',       width: 14, style: { numFmt: '#,##0.00' } },
    ];
    // Header styling
    const headerRow = dataSheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
    headerRow.height = 22;

    // Add 3 sample rows showing two complete JEs
    const today = new Date().toISOString().slice(0, 10);
    const sampleAccounts = accounts.length >= 2
      ? [accounts[0].code, accounts[1].code]
      : ['1010', '6020']; // fallback so the template is usable even on a fresh tenant
    dataSheet.addRow(['JE-001', today, today, 'Sample: Paid utilities',  'Meralco-202604', sampleAccounts[1], 'Electric bill April', 7589.29, null]);
    dataSheet.addRow(['JE-001', today, today, 'Sample: Paid utilities',  'Meralco-202604', sampleAccounts[0], 'BPI checking',        null,    7589.29]);
    dataSheet.addRow(['JE-002', today, today, 'Sample: Bank fee',         null,             sampleAccounts[1], 'BPI service charge',  100.00,  null]);
    dataSheet.addRow(['JE-002', today, today, 'Sample: Bank fee',         null,             sampleAccounts[0], 'BPI checking',        null,    100.00]);
    // Leave a few blank rows for the user to type into
    for (let i = 0; i < 10; i++) dataSheet.addRow([]);

    // ── Sheet 2: COA Reference ──────────────────────────────────────────────
    const coaSheet = wb.addWorksheet('COA Reference', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    coaSheet.columns = [
      { header: 'Account Code',    key: 'code',    width: 14 },
      { header: 'Account Name',    key: 'name',    width: 40 },
      { header: 'Type',            key: 'type',    width: 14 },
      { header: 'Normal Balance',  key: 'normal',  width: 16 },
    ];
    const coaHeader = coaSheet.getRow(1);
    coaHeader.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    coaHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF555555' } };
    accounts.forEach((a) => coaSheet.addRow([a.code, a.name, a.type, a.normalBalance]));

    // ── Sheet 3: Instructions ───────────────────────────────────────────────
    const helpSheet = wb.addWorksheet('Instructions');
    helpSheet.columns = [{ width: 80 }];
    const lines = [
      ['Clerque Journal Entry Import — Instructions'],
      [''],
      ['HOW TO USE:'],
      ['1. Fill in the "Journal Entries" sheet, one row per debit/credit line.'],
      ['2. Use the "Group Key" column to bundle lines into one JE.'],
      ['   Same Group Key = same JE. Different Group Keys = different JEs.'],
      ['3. Each JE must be balanced: total debits MUST equal total credits.'],
      ['4. Account Code must exist in the "COA Reference" sheet.'],
      ['5. Save as .xlsx and upload via Settings → Journal → Import.'],
      [''],
      ['COLUMN GUIDE:'],
      ['  Group Key       — Required. Same value groups multiple lines into one JE.'],
      ['  Document Date   — Required. Format YYYY-MM-DD. When the event occurred.'],
      ['  Posting Date    — Optional. Format YYYY-MM-DD. Determines accounting period.'],
      ['                    Blank = use Document Date. Must fall in an OPEN period.'],
      ['  Memo            — Required. Short description for the JE (one per group).'],
      ['  Reference       — Optional. External reference (invoice #, OR #, voucher #).'],
      ['  Account Code    — Required. Must exist in "COA Reference" sheet.'],
      ['  Line Description— Optional. Per-line description.'],
      ['  Debit / Credit  — Each row must have one or the other (not both, not zero).'],
      ['                    Decimal places: 2.'],
      [''],
      ['VALIDATION:'],
      ['  - Either ALL JEs in the file post, or NONE do (atomic).'],
      ['  - Errors are reported per-row so you can fix Excel and re-upload.'],
      ['  - Period-lock check: rows landing in a CLOSED period will reject.'],
      [''],
      ['LIMITS:'],
      ['  - Max 10,000 rows per file.'],
      ['  - Max 1,000 JEs per file.'],
      ['  - Date range: any open period.'],
    ];
    lines.forEach(([t]) => helpSheet.addRow([t]));
    helpSheet.getRow(1).font = { bold: true, size: 14 };

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ─── Upload + parse ────────────────────────────────────────────────────────

  /**
   * Parse an uploaded .xlsx and post the JEs atomically.
   * @param tenantId   Caller's tenant.
   * @param userId     Caller's user id (for audit / postedBy).
   * @param fileBuffer Raw uploaded file bytes.
   */
  async importFromXlsx(
    tenantId: string,
    userId:   string,
    fileBuffer: Buffer,
  ): Promise<ImportResult> {
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(fileBuffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('Not a valid Excel file. Save as .xlsx and try again.');
    }

    const dataSheet = wb.getWorksheet('Journal Entries');
    if (!dataSheet) {
      throw new BadRequestException('Could not find a "Journal Entries" sheet. Use the downloaded template.');
    }

    // Parse rows. Skip blank rows. Skip the header row.
    const rows: ImportRow[] = [];
    dataSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return; // header
      const groupKey = stringValue(row.getCell(1).value);
      // Treat a row with no group key + no data as fully blank → skip silently
      if (!groupKey && allCellsBlank(row)) return;

      rows.push({
        rowNumber,
        groupKey:        groupKey ?? '',
        documentDate:    dateValue(row.getCell(2).value),
        postingDate:     dateValue(row.getCell(3).value),
        memo:            stringValue(row.getCell(4).value),
        reference:       stringValue(row.getCell(5).value),
        accountCode:     stringValue(row.getCell(6).value),
        lineDescription: stringValue(row.getCell(7).value),
        debit:           numberValue(row.getCell(8).value),
        credit:          numberValue(row.getCell(9).value),
      });
    });

    if (rows.length === 0) {
      throw new BadRequestException('The "Journal Entries" sheet is empty. Add at least one entry.');
    }
    if (rows.length > 10_000) {
      throw new BadRequestException('Too many rows. Split the file into batches of 10,000 or fewer.');
    }

    // Look up COA — needed for code → id mapping + validation
    const accounts = await this.prisma.account.findMany({
      where: { tenantId, isActive: true, postingControl: 'OPEN' },
      select: { id: true, code: true },
    });
    const codeToId = new Map(accounts.map((a) => [a.code, a.id]));

    // Group rows by Group Key
    const groups = new Map<string, ImportRow[]>();
    for (const r of rows) {
      if (!groups.has(r.groupKey)) groups.set(r.groupKey, []);
      groups.get(r.groupKey)!.push(r);
    }

    // Validate each group + collect errors. Build the JE payloads only if no errors.
    const errors: ImportRowError[] = [];
    const payloads: Array<{ groupKey: string; dto: import('./journal.service').CreateJournalDto }> = [];

    for (const [groupKey, groupRows] of groups.entries()) {
      const groupErrors = this.validateGroup(groupKey, groupRows, codeToId);
      if (groupErrors.length > 0) {
        errors.push(...groupErrors);
        continue;
      }
      payloads.push({
        groupKey,
        dto: this.buildDto(groupRows, codeToId),
      });
    }

    if (errors.length > 0) {
      // Atomic: nothing posts if there's a single error.
      return {
        successful:    0,
        failed:        groups.size,
        errors,
        postedEntries: [],
      };
    }

    // All-or-nothing: post everything inside one Prisma interactive transaction.
    // Each create() call hits its own validation + period-lock + assertPermission,
    // but they share the transaction context so any throw rolls back the whole batch.
    const posted: ImportResult['postedEntries'] = [];
    try {
      await this.prisma.$transaction(async () => {
        for (const { dto } of payloads) {
          const result = await this.journal.create(tenantId, dto, userId);
          posted.push({
            entryNumber: result.entryNumber,
            description: result.description,
            lineCount:   dto.lines.length,
          });
        }
      }, { timeout: 60_000 }); // long-ish timeout for big batches
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error during batch post';
      this.logger.error(`Batch import failed: ${msg}`);
      throw new BadRequestException(`Batch failed at posting: ${msg}. No JEs were saved.`);
    }

    return {
      successful:    posted.length,
      failed:        0,
      errors:        [],
      postedEntries: posted,
    };
  }

  // ─── Validation per group ──────────────────────────────────────────────────

  private validateGroup(
    groupKey:  string,
    rows:      ImportRow[],
    codeToId:  Map<string, string>,
  ): ImportRowError[] {
    const errors: ImportRowError[] = [];

    // Group key required
    if (!groupKey) {
      for (const r of rows) {
        errors.push({ row: r.rowNumber, column: 'Group Key', message: 'Group Key is required.' });
      }
      return errors;
    }

    // Memo, Document Date must be consistent within the group
    const memos = new Set(rows.map((r) => (r.memo ?? '').trim()).filter(Boolean));
    const docDates = new Set(rows.map((r) => r.documentDate).filter(Boolean) as string[]);
    if (memos.size > 1) {
      errors.push({ row: rows[0].rowNumber, column: 'Memo', message: `Group "${groupKey}" has conflicting memos: ${[...memos].join(' vs ')}. Use the same memo on every row of a group.` });
    }
    if (docDates.size > 1) {
      errors.push({ row: rows[0].rowNumber, column: 'Document Date', message: `Group "${groupKey}" has conflicting document dates. Use the same date on every row.` });
    }

    // Per-row validation
    let totalDebit = 0;
    let totalCredit = 0;
    for (const r of rows) {
      if (!r.documentDate) {
        errors.push({ row: r.rowNumber, column: 'Document Date', message: 'Document Date is required.' });
      }
      if (!r.memo || r.memo.trim().length === 0) {
        errors.push({ row: r.rowNumber, column: 'Memo', message: 'Memo is required.' });
      }
      if (!r.accountCode) {
        errors.push({ row: r.rowNumber, column: 'Account Code', message: 'Account Code is required.' });
      } else if (!codeToId.has(r.accountCode)) {
        errors.push({ row: r.rowNumber, column: 'Account Code', message: `Account "${r.accountCode}" not found in your Chart of Accounts (or not OPEN for posting).` });
      }
      const d = r.debit ?? 0;
      const c = r.credit ?? 0;
      if (d > 0 && c > 0) {
        errors.push({ row: r.rowNumber, column: 'Debit/Credit', message: 'A single line cannot have both Debit AND Credit. Pick one.' });
      }
      if (d === 0 && c === 0) {
        errors.push({ row: r.rowNumber, column: 'Debit/Credit', message: 'Each line must have either a Debit or a Credit amount > 0.' });
      }
      totalDebit  += d;
      totalCredit += c;
    }

    // Group must balance
    if (rows.length >= 2 && Math.abs(totalDebit - totalCredit) > 0.01) {
      errors.push({
        row:     rows[0].rowNumber,
        column:  'Debit/Credit',
        message: `Group "${groupKey}" is unbalanced: Debits ₱${totalDebit.toFixed(2)} vs Credits ₱${totalCredit.toFixed(2)}. Difference ₱${Math.abs(totalDebit - totalCredit).toFixed(2)}.`,
      });
    }

    if (rows.length < 2) {
      errors.push({ row: rows[0].rowNumber, column: 'Group Key', message: `Group "${groupKey}" needs at least 2 lines (one debit + one credit).` });
    }

    return errors;
  }

  private buildDto(
    rows:     ImportRow[],
    codeToId: Map<string, string>,
  ): import('./journal.service').CreateJournalDto {
    const first = rows[0];
    return {
      date:        first.documentDate!,
      postingDate: first.postingDate ?? undefined,
      description: first.memo!,
      reference:   first.reference ?? undefined,
      saveDraft:   false, // import goes straight to POSTED — fix Excel and re-upload if wrong
      lines: rows.map((r) => ({
        accountId:   codeToId.get(r.accountCode!)!,
        debit:       r.debit  ?? undefined,
        credit:      r.credit ?? undefined,
        description: r.lineDescription ?? undefined,
      })),
    };
  }
}

// ─── Cell value helpers ────────────────────────────────────────────────────

function stringValue(v: ExcelJS.CellValue): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (v instanceof Date)     return v.toISOString().slice(0, 10);
  if (typeof v === 'object' && 'text' in v && typeof v.text === 'string') return v.text.trim() || null;
  if (typeof v === 'object' && 'result' in v) return stringValue((v as { result: ExcelJS.CellValue }).result);
  return null;
}

function numberValue(v: ExcelJS.CellValue): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,\s₱]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof v === 'object' && 'result' in v) return numberValue((v as { result: ExcelJS.CellValue }).result);
  return null;
}

function dateValue(v: ExcelJS.CellValue): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'string') {
    // Accept YYYY-MM-DD or any parseable variant
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
    return null;
  }
  if (typeof v === 'number') {
    // Excel date serial — not recommended but support it: 1900-based, days since epoch
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + v * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function allCellsBlank(row: ExcelJS.Row): boolean {
  let blank = true;
  row.eachCell({ includeEmpty: true }, (cell) => {
    if (cell.value != null && cell.value !== '') blank = false;
  });
  return blank;
}
