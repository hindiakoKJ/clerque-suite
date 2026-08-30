import { Injectable, BadRequestException, Optional } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  UNIT_FACTORS as SHARED_UNIT_FACTORS,
  normUnit as sharedNormUnit,
  unitFactor as sharedUnitFactor,
} from '../inventory/unit-conversion';
import { AccountingPeriodsService } from '../accounting-periods/accounting-periods.service';
import { mapLoyverseItems, looksLikeLoyverse } from './loyverse.mapper';
import { isRecipeBusinessType } from '@repo/shared-types';

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
  /**
   * Rows imported with no Cost Price. Not an error — a shop can open before
   * it has costed everything, and recipe-based items get their cost from the
   * recipe anyway — but those products report 100% margin until a cost or a
   * recipe exists, so the number is surfaced instead of passing silently.
   */
  missingCost?: number;
}

@Injectable()
export class ImportService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * Optional ONLY so the many unit tests that construct this service with a
     * bare prisma stub keep working. It is always provided in the module, and
     * importStockReceipts REFUSES to write without it (see below) rather than
     * quietly skipping the period lock — a bypass that is invisible is worse
     * than a missing feature.
     */
    @Optional() private readonly periods?: AccountingPeriodsService,
  ) {}

  // ── Helper: parse xlsx or csv buffer into row arrays (first sheet only) ──
  /**
   * Rows for a single-sheet importer.
   *
   * `preferred` names the tab this importer actually wants. Without it a
   * workbook that carries several tabs — say Ingredients + Recipes exported
   * together — silently handed EVERY importer its first sheet, so uploading
   * such a file to the Recipes importer parsed the Ingredients tab and failed
   * for reasons that made no sense to the person doing it. Falls back to the
   * first sheet, which is what a normal one-tab template is.
   */
  private async parseFile(
    file: Express.Multer.File,
    preferred: string[] = [],
  ): Promise<string[][]> {
    const all = await this.parseAllSheets(file);
    for (const want of preferred) {
      for (const [name, rows] of all) {
        if (name.trim().toLowerCase() === want.toLowerCase()) return rows;
      }
    }
    const first = all.values().next().value;
    return first ?? [];
  }

  /**
   * Parse all sheets of an xlsx (or the single CSV "sheet") into a Map of
   * sheetName → rows. Used by the Setup Pack importer which expects multiple
   * sheets in one file.
   */
  private async parseAllSheets(file: Express.Multer.File): Promise<Map<string, string[][]>> {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    const result = new Map<string, string[][]>();
    if (ext === 'csv') {
      result.set('Sheet1', this.parseCsv(file.buffer.toString('utf-8')));
      return result;
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as any);
    for (const ws of wb.worksheets) {
      const rows: string[][] = [];
      ws.eachRow((row) => {
        rows.push(
          (row.values as unknown[])
            .slice(1)
            .map((v) => this.cellToString(v)),
        );
      });
      result.set(ws.name, rows);
    }
    return result;
  }

  /**
   * Flatten one ExcelJS cell value to the plain string the importers expect.
   *
   * Bare String(v) turned every non-primitive cell into garbage: a rich-text
   * cell ({richText:[...]}), a formula cell ({formula,result}) and a hyperlink
   * cell ({text,hyperlink}) all became '[object Object]', and a real Excel
   * date became a 60-char locale string. The owner WILL type a date into the
   * Date column and Excel WILL store it as a Date, so these must round-trip.
   * ExcelJS reads Excel dates as UTC instants, hence the UTC getters.
   */
  private cellToString(v: unknown): string {
    if (v == null) return '';
    if (v instanceof Date) {
      if (isNaN(v.getTime())) return '';
      const mm = String(v.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(v.getUTCDate()).padStart(2, '0');
      return `${v.getUTCFullYear()}-${mm}-${dd}`;
    }
    if (typeof v !== 'object') return String(v);
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) {
      return (o.richText as { text?: unknown }[]).map((r) => (r?.text == null ? '' : String(r.text))).join('');
    }
    if ('formula' in o || 'sharedFormula' in o) return this.cellToString(o.result);
    if ('hyperlink' in o) return this.cellToString(o.text);
    if ('error' in o) return '';
    if ('text' in o) return this.cellToString(o.text);
    return String(v);
  }

  /**
   * RFC 4180 CSV parser.
   *
   * Replaces a naive `split(',')`, which corrupted any file where a quoted
   * field contained a comma — e.g. a product named `Pandesal, Large` or an
   * address `123 Main St, Manila` split into extra columns and shifted every
   * later value (price/cost landed in the wrong field). Also handles escaped
   * quotes (`""`), CRLF line endings, embedded newlines inside quoted fields,
   * and strips the UTF-8 BOM that Excel writes when you "Save as CSV" (the BOM
   * otherwise glues itself to the first header cell so the header row is never
   * matched).
   */
  private parseCsv(input: string): string[][] {
    const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
    const rows: string[][] = [];
    let row: string[] = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }  // escaped quote
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field); field = '';
      } else if (ch === '\n') {
        row.push(field); field = ''; rows.push(row); row = [];
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    // Trim cells and drop fully-blank rows (template spacer rows).
    return rows
      .map((r) => r.map((c) => c.trim()))
      .filter((r) => r.some((c) => c !== ''));
  }

  /**
   * Find the index of the header row in a parsed sheet by matching the
   * first column against a known value (case-insensitive, trimmed). Returns
   * -1 if not found. Used so templates can include title + instruction
   * rows above the headers without breaking the importer.
   */
  private findHeaderRow(rows: string[][], firstColMatchers: string[]): number {
    const norm = (s: string) => (s ?? '').trim().toLowerCase();
    const targets = firstColMatchers.map(norm);
    for (let i = 0; i < rows.length; i++) {
      if (targets.includes(norm(rows[i][0] ?? ''))) return i;
    }
    return -1;
  }

  /**
   * The optional column-hints row makeTemplate() writes directly under the
   * header (italic grey "Required. ..." / "Optional. ..." cells). It is NOT
   * data. Detect it literally rather than guessing from a value's shape, so a
   * genuine row with an odd value is never silently swallowed.
   */
  /**
   * Parse a number the way a Philippine owner actually types it into Excel:
   * "1,250.50", "PHP 1,200", "P1,200", "1 250", "(500)" for negative.
   *
   * Bare this.num() stops at the first comma, so "1,250.50" silently became
   * 1 -- a 1250x error with NO error message, on every price, cost, quantity
   * and journal amount. Returns NaN for anything that is not a clean number so
   * the existing isNaN() / `|| 0` guards at each call site keep their meaning.
   */
  private num(raw: unknown): number {
    if (raw == null) return NaN;
    if (typeof raw === 'number') return raw;
    let t = String(raw).trim();
    if (!t) return NaN;
    const negated = /^\(.*\)$/.test(t);
    if (negated) t = t.slice(1, -1).trim();
    t = t.replace(/^(PHP|Php|php)\s*/, '').replace(/^[P\u20B1$]\s*/, '');
    t = t.replace(/[\u00A0\s,]/g, '');
    if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return NaN;
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return NaN;
    return negated ? -n : n;
  }

  private isHintRow(r?: string[]): boolean {
    if (!r) return false;
    return r.filter((c) => /^\s*(Required|Optional)\.?\s/i.test(String(c ?? ''))).length >= 2;
  }

  /**
   * Sample rows. Every template ships realistic example rows, and a first-time
   * owner WILL forget to delete them -- which used to import 'Espresso Solo',
   * 'Globe Telecom' (with a made-up TIN) and two fake journal entries as REAL
   * data. makeTemplate() now stamps the first cell of every sample row with
   * SAMPLE_MARKER and every parser skips rows that carry it (counted in
   * result.skipped), so leaving the samples in place is harmless.
   *
   * Tolerates hand edits: 'SAMPLE - x', 'SAMPLE -x', 'SAMPLE — x', 'Sample: x'.
   */
  private static readonly SAMPLE_MARKER = 'SAMPLE - ';
  private static readonly SAMPLE_INSTRUCTION =
    'Rows starting with "SAMPLE - " are examples. They are IGNORED on import. Delete them or leave them — either is safe. Add your real rows below them.';


  /**
   * Strip null/undefined entries so a blank spreadsheet cell leaves the stored
   * value alone instead of nulling it.
   *
   * Customers and vendors were rebuilt wholesale on every re-import: a file
   * carrying only names wiped the TIN, address, email, phone, terms and credit
   * limit the owner had since filled in. `name` is always present (it is the
   * match key) so the record can never be left empty.
   */
  private onlySupplied<T extends Record<string, unknown>>(data: T): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== null && v !== undefined) out[k] = v;
    }
    return out as Partial<T>;
  }

  private isSampleRow(r?: string[]): boolean {
    if (!r) return false;
    const first = r.find((c) => String(c ?? '').trim() !== '');
    if (first == null) return false;
    return /^\s*sample\s*[-\u2013\u2014:]/i.test(String(first));
  }

  // ── Helper: generate Excel template buffer ──
  /**
   * Build a self-documenting Excel template.
   *
   * Layout:
   *   Row 1            — title (merged across all columns)
   *   Row 2-N          — instruction lines (gray, italic)
   *   Row N+1          — blank separator
   *   Row N+2          — column headers (dark fill, accent text)
   *   Row N+3          — column descriptions / format hints (italic, gray)
   *   Row N+4..        — sample data rows (first cell prefixed "SAMPLE - ",
   *                      light-grey italic; every parser ignores them)
   *
   * Required columns are marked with "*" in the header by convention.
   */
  private async makeTemplate(
    sheetName: string,
    headers: string[],
    sampleRows: string[][],
    opts: {
      title?:           string;
      instructions?:    string[];
      columnHints?:     string[];   // same length as headers
      /** Rows are the shop's own data, not examples — do not stamp or grey them. */
      realData?:        boolean;
    } = {},
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    const ws = wb.addWorksheet(sheetName);

    let cursor = 1;
    const colCount = headers.length;
    const lastColLetter = String.fromCharCode(64 + colCount); // A-Z only — fine for our widths

    // ── Title ───────────────────────────────────────────────────────────────
    if (opts.title) {
      ws.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
      const c = ws.getCell(`A${cursor}`);
      c.value = opts.title;
      c.font  = { bold: true, size: 14, color: { argb: 'FF8B5E3C' } };
      c.alignment = { vertical: 'middle' };
      ws.getRow(cursor).height = 22;
      cursor++;
    }

    // ── Instructions ───────────────────────────────────────────────────────
    // Every template that ships sample rows tells the owner they are ignored.
    // An export has rows but no samples, and telling someone their own data
    // will be ignored on import is exactly the wrong thing to say.
    const instructions = sampleRows.length && !opts.realData
      ? [ImportService.SAMPLE_INSTRUCTION, ...(opts.instructions ?? [])]
      : (opts.instructions ?? []);
    if (instructions.length) {
      for (const line of instructions) {
        ws.mergeCells(`A${cursor}:${lastColLetter}${cursor}`);
        const c = ws.getCell(`A${cursor}`);
        c.value = line;
        c.font  = { italic: true, color: { argb: 'FF666666' }, size: 10 };
        c.alignment = { wrapText: true, vertical: 'top' };
        cursor++;
      }
      // Blank separator row
      cursor++;
    }

    // ── Header row ──────────────────────────────────────────────────────────
    const headerRowIdx = cursor;
    ws.getRow(cursor).values = headers;
    ws.getRow(cursor).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(cursor).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' },
    };
    ws.getRow(cursor).alignment = { vertical: 'middle', horizontal: 'left' };
    ws.getRow(cursor).height = 20;
    cursor++;

    // ── Column hints ───────────────────────────────────────────────────────
    if (opts.columnHints?.length) {
      ws.getRow(cursor).values = opts.columnHints;
      ws.getRow(cursor).font = { italic: true, color: { argb: 'FF888888' }, size: 9 };
      ws.getRow(cursor).fill = {
        type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F1EC' },
      };
      cursor++;
    }

    // ── Sample data rows ───────────────────────────────────────────────────
    // Stamp the first cell with the SAMPLE marker (see isSampleRow) and style
    // the row light-grey italic so it is visibly "not yours".
    //
    // `realData` turns both off. An EXPORT reuses this same builder so the file
    // a shop downloads is laid out exactly like the blank template it already
    // knows — but its rows are the shop's own, and stamping them would make
    // re-importing the file a no-op, since isSampleRow skips them.
    for (const r of sampleRows) {
      const [first, ...rest] = r;
      const marked = opts.realData || this.isSampleRow(r)
        ? r
        : [`${ImportService.SAMPLE_MARKER}${first ?? ''}`, ...rest];
      ws.getRow(cursor).values = marked;
      if (!opts.realData) {
        ws.getRow(cursor).font = { italic: true, color: { argb: 'FF9E9E9E' } };
      }
      cursor++;
    }

    // ── Column widths ──────────────────────────────────────────────────────
    headers.forEach((_, i) => { ws.getColumn(i + 1).width = 22; });

    // Freeze panes below the header so the user can scroll data without
    // losing context.
    ws.views = [{ state: 'frozen', ySplit: opts.columnHints ? headerRowIdx + 1 : headerRowIdx }];

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Products Import ─────────────────────────────────────────────────────────
  // Expected columns: Name*, Category, Price*, Cost Price, VAT (Y/N), Barcode, Description
  async importProducts(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<ImportResult> {
    const rows = await this.parseFile(file, ['Products']);
    return this.importProductsFromRows(rows, tenantId);
  }

  private async importProductsFromRows(
    rows: string[][],
    tenantId: string,
  ): Promise<ImportResult> {
    // Skip the title + instructions block on our self-documenting templates
    // by locating the header row, then start data after the optional hint row.
    const headerIdx = this.findHeaderRow(rows, ['Name*', 'Name']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;

    if (rows.length <= dataStart)
      throw new BadRequestException(
        'File must have a header row and at least one data row.',
      );

    const result: ImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    let dataRows = rows.slice(dataStart);

    // Optional column-hints row (italic gray under the header). If row 1 of
    // dataRows looks like a hints row (no numeric Price), skip it.
    // Detect the hints row LITERALLY. The old test ("is the Price cell
    // numeric?") silently DELETED a genuine first product whenever its price
    // was blank, currency-prefixed or a formula -- not counted as skipped, not
    // reported as an error, so the owner saw "imported 42" for 43 rows.
    if (this.isHintRow(dataRows[0])) dataRows = dataRows.slice(1);

    // Sprint 19 — Pharmacy columns are appended to the template AFTER the
    // 7 standard columns. They're optional for every vertical; pharmacy
    // tenants get a tailored sheet with example rows that fill them in.
    //
    //   Column 8:  Generic Name
    //   Column 9:  Brand Name
    //   Column 10: Dosage Form
    //   Column 11: Strength
    //   Column 12: Drug Class (OTC / RX_ONLY / DDB_S2 / etc.)
    //   Column 13: Initial Lot # (optional — creates ProductLot if filled)
    //   Column 14: Initial Lot Expiry (ISO YYYY-MM-DD; required when col 13 is set)
    //   Column 15: Initial Stock (qty for the default branch when given)
    const VALID_DRUG_CLASSES = new Set([
      'OTC', 'OTC_BTC', 'RX_ONLY',
      'DDB_S2', 'DDB_S3', 'DDB_S4', 'DDB_S5',
      'VACCINE', 'DEVICE', 'SUPPLEMENT', 'COSMETIC', 'OTHER',
    ]);

    // Opening stock is resolved BY HEADER rather than by position. The lean
    // template carries it right after Description, while the pharmacy layout
    // keeps it in column 15 after the lot fields — a fixed index cannot serve
    // both, and matching the header also lets an owner move the column.
    const headerCells = headerIdx >= 0 ? (rows[headerIdx] ?? []) : [];
    const findCol = (re: RegExp): number =>
      headerCells.findIndex((h) => re.test(String(h ?? '').trim()));
    const stockCol = findCol(/^(opening|initial)\s*stock|stock\s*on\s*hand|qty\s*on\s*hand|quantity\s*on\s*hand$/i);
    const alertCol = findCol(/^low\s*stock\s*alert$/i);

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [
        name, categoryName, priceStr, costStr, vatStr, barcode, description,
        // Sprint 19 — pharmacy-specific (all optional)
        genericName, brandName, dosageForm, strength, drugClassRaw,
        lotNumber, lotExpiryStr,
      ] = dataRows[i];
      const initialStockStr = stockCol >= 0 ? dataRows[i][stockCol] : dataRows[i][14];
      const lowAlertStr     = alertCol >= 0 ? dataRows[i][alertCol] : undefined;

      // The pharmacy columns are ALSO resolved by header. Positional
      // destructuring above assumes the 15-column pharmacy layout, so on the
      // lean 9-column template columns 8 and 9 (Opening Stock, Low Stock
      // Alert) fell into genericName and brandName — a cafe ended up with
      // products whose "generic name" was the number 50. When the header has
      // no such column we pass undefined, and the conditional spread below
      // leaves the field untouched.
      const hasPharmacyCols = findCol(/^generic\s*name$/i) >= 0;
      const pharmCell = (re: RegExp, positional: string | undefined): string | undefined => {
        const c = findCol(re);
        if (c >= 0) return dataRows[i][c];
        return hasPharmacyCols ? positional : undefined;
      };
      const genericNameCell = pharmCell(/^generic\s*name$/i, genericName);
      const brandNameCell   = pharmCell(/^brand\s*name$/i,   brandName);
      const dosageFormCell  = pharmCell(/^dosage\s*form$/i,  dosageForm);
      const strengthCell    = pharmCell(/^strength$/i,        strength);

      if (!name?.trim()) {
        result.skipped++;
        continue;
      }
      const price = this.num(priceStr);
      if (isNaN(price) || price < 0) {
        result.errors.push({
          row: rowNum,
          message: `Invalid price: "${priceStr}"`,
        });
        continue;
      }
      // Cost Price drives COGS on every sale, but a blank one must not block
      // the import. A shop is usually still costing its menu when it needs to
      // start selling, and for anything that later gets a recipe the cost is
      // derived from ingredients and this column is never read. Blank imports
      // as 0 and is counted into result.missingCost so it stays visible;
      // a non-numeric value is still a real mistake and is rejected below.
      const costBlank = costStr == null || String(costStr).trim() === '';
      if (costBlank) result.missingCost = (result.missingCost ?? 0) + 1;
      const costPrice = costBlank ? 0 : this.num(costStr);
      if (isNaN(costPrice) || costPrice < 0) {
        result.errors.push({
          row: rowNum,
          message: `Invalid Cost Price: "${costStr}". Must be a number ≥ 0.`,
        });
        continue;
      }
      const isVatable = ['y', 'yes', '1', 'true'].includes(
        (vatStr || '').toLowerCase(),
      );

      // Sprint 19 — Validate optional pharmacy fields
      const drugClassRawTrim = (drugClassRaw ?? '').toUpperCase().trim();
      if (drugClassRawTrim && !VALID_DRUG_CLASSES.has(drugClassRawTrim)) {
        result.errors.push({
          row: rowNum,
          message: `Invalid Drug Class "${drugClassRaw}". Use one of: ${Array.from(VALID_DRUG_CLASSES).join(', ')}.`,
        });
        continue;
      }
      const drugClass = (drugClassRawTrim || 'OTC') as
        'OTC' | 'OTC_BTC' | 'RX_ONLY' | 'DDB_S2' | 'DDB_S3' | 'DDB_S4' | 'DDB_S5'
        | 'VACCINE' | 'DEVICE' | 'SUPPLEMENT' | 'COSMETIC' | 'OTHER';
      const isRxRequired = ['RX_ONLY', 'DDB_S2', 'DDB_S3', 'DDB_S4', 'DDB_S5'].includes(drugClass);
      const isControlledDrug = ['DDB_S2', 'DDB_S3', 'DDB_S4', 'DDB_S5'].includes(drugClass);

      // Initial lot validation
      let lotExpiryDate: Date | null = null;
      if (lotNumber?.trim()) {
        if (!lotExpiryStr?.trim()) {
          result.errors.push({
            row: rowNum,
            message: 'Initial Lot Expiry is required when Initial Lot # is set (use ISO date YYYY-MM-DD).',
          });
          continue;
        }
        const parsed = new Date(lotExpiryStr.trim());
        if (isNaN(parsed.getTime())) {
          result.errors.push({
            row: rowNum,
            message: `Invalid Initial Lot Expiry "${lotExpiryStr}". Use ISO date YYYY-MM-DD.`,
          });
          continue;
        }
        lotExpiryDate = parsed;
      }
      const initialStock = initialStockStr?.trim() ? this.num(initialStockStr) : 0;
      if (initialStockStr?.trim() && (isNaN(initialStock) || initialStock < 0)) {
        result.errors.push({
          row: rowNum,
          message: `Invalid Initial Stock "${initialStockStr}". Must be a number ≥ 0.`,
        });
        continue;
      }

      try {
        // Find or create category
        // Find-or-create the category. This used to upsert on a
        // `tenantId_name` compound unique that does NOT exist on Category, so
        // the upsert threw on EVERY row, the .catch fell back to findFirst,
        // and on a fresh tenant that returned null -- meaning every imported
        // product landed with no category at all. Category drives barista /
        // kitchen ticket routing (stationId) and the GL revenue split
        // (revenueAccountCode), so uncategorised products break both.
        // Matched case-insensitively so "Beans" and "beans" don't diverge.
        let categoryId: string | undefined;
        const catName = categoryName?.trim();
        if (catName) {
          const found = await this.prisma.category.findFirst({
            where:  { tenantId, name: { equals: catName, mode: 'insensitive' } },
            select: { id: true },
          });
          categoryId = found
            ? found.id
            : (await this.prisma.category.create({
                data:   { tenantId, name: catName },
                select: { id: true },
              })).id;
        }

        const existing = await this.prisma.product.findFirst({
          where: {
            tenantId,
            OR: [
              { name: name.trim() },
              ...(barcode?.trim() ? [{ barcode: barcode.trim() }] : []),
            ],
          },
        });

        // Sprint 19 — pharmacy field set, applied uniformly to create + update.
        const pharmacyFields = {
          ...(genericNameCell?.trim() && { genericName: genericNameCell.trim() }),
          ...(brandNameCell?.trim()   && { brandName:   brandNameCell.trim() }),
          ...(dosageFormCell?.trim()  && { dosageForm:  dosageFormCell.trim() }),
          ...(strengthCell?.trim()    && { strength:    strengthCell.trim() }),
          drugClass,
          isRxRequired,
          isControlledDrug,
        };

        // A blank cell means "I did not supply this", never "set it to zero".
        //
        // Re-importing a sheet with the Cost Price column left empty used to
        // write 0 over whatever the owner had since typed into the app, and a
        // sheet with no VAT column at all silently un-VATed the entire
        // catalogue — a BIR problem, not just a data one. On UPDATE both are
        // now only written when the sheet actually says something. On CREATE
        // they still fall through to their defaults.
        const vatColPresent = findCol(/^vat(\s*\(y\/n\))?$|^vatable$|^is\s*vatable$/i) >= 0;
        const vatSupplied   = vatColPresent && String(vatStr ?? '').trim() !== '';

        let productId: string;
        if (existing) {
          await this.prisma.product.update({
            where: { id: existing.id },
            data: {
              price,
              ...(costBlank ? {} : { costPrice }),
              ...(vatSupplied ? { isVatable } : {}),
              ...(categoryId && { categoryId }),
              ...(description?.trim() && { description: description.trim() }),
              ...(barcode?.trim() && { barcode: barcode.trim() }),
              ...pharmacyFields,
            },
          });
          productId = existing.id;
          result.updated++;
        } else {
          const created = await this.prisma.product.create({
            data: {
              tenantId,
              name: name.trim(),
              price,
              costPrice,
              isVatable,
              isActive: true,
              inventoryMode: 'UNIT_BASED',
              ...(categoryId && { categoryId }),
              ...(description?.trim() && { description: description.trim() }),
              ...(barcode?.trim() && { barcode: barcode.trim() }),
              ...pharmacyFields,
            },
            select: { id: true },
          });
          productId = created.id;
          result.imported++;
        }

        // Opening stock for ready-to-sell goods (bottled drinks, packaged
        // snacks) straight from the Products sheet, so a shop that buys
        // everything finished never has to touch a second file. Lot-tracked
        // rows are handled by the pharmacy block below, which seeds the same
        // InventoryItem — running both would double the count.
        //
        // The quantity is SET, not incremented: this is a declared opening
        // count, so re-importing a corrected sheet fixes the number instead
        // of stacking on top of it (matching the Inventory template).
        if (initialStockStr?.trim() && !lotNumber?.trim()) {
          const branch = await this.prisma.branch.findFirst({
            where:   { tenantId, isActive: true },
            select:  { id: true },
            orderBy: { createdAt: 'asc' },
          });
          if (!branch) {
            result.errors.push({
              row: rowNum,
              message: 'Opening Stock given but this business has no active branch yet.',
            });
          } else {
            // lowStockAlert is an Int column, not Decimal.
            const parsedAlert = lowAlertStr?.trim() ? this.num(lowAlertStr) : NaN;
            const lowAlert = Number.isFinite(parsedAlert) && parsedAlert >= 0
              ? Math.round(parsedAlert)
              : null;
            const qty = new Prisma.Decimal(Math.max(initialStock, 0));
            try {
              await this.prisma.inventoryItem.upsert({
                where:  { branchId_productId: { branchId: branch.id, productId } },
                update: {
                  quantity: qty,
                  ...(lowAlert != null ? { lowStockAlert: lowAlert } : {}),
                },
                create: {
                  tenantId,
                  branchId:  branch.id,
                  productId,
                  quantity:  qty,
                  ...(lowAlert != null ? { lowStockAlert: lowAlert } : {}),
                },
              });
            } catch (err: any) {
              result.errors.push({
                row: rowNum,
                message: `Opening stock failed: ${err?.message ?? 'unknown'}`,
              });
            }
          }
        }

        // Sprint 19 — If an initial lot is provided, create the ProductLot
        // row at the tenant's first branch. Pharmacy import shorthand —
        // for full lot management, owners use /pos/pharmacy/lots after.
        if (lotNumber?.trim() && lotExpiryDate) {
          const branch = await this.prisma.branch.findFirst({
            where:  { tenantId, isActive: true },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          if (branch) {
            const lotData = {
              tenantId,
              productId,
              branchId:  branch.id,
              lotNumber: lotNumber.trim(),
              expiresAt: lotExpiryDate,
              quantity:  new Prisma.Decimal(Math.max(initialStock, 0)),
              costPrice: new Prisma.Decimal(costPrice),
            };
            try {
              await this.prisma.productLot.upsert({
                where: {
                  // matches @@unique([tenantId, productId, lotNumber])
                  tenantId_productId_lotNumber: {
                    tenantId, productId, lotNumber: lotNumber.trim(),
                  },
                } as any,
                update: { quantity: lotData.quantity, expiresAt: lotData.expiresAt, costPrice: lotData.costPrice },
                create: lotData,
              });
              // Sync InventoryItem at the branch so the till sees the stock.
              if (initialStock > 0) {
                await this.prisma.inventoryItem.upsert({
                  where:  { productId_branchId: { productId, branchId: branch.id } } as any,
                  update: { quantity: { increment: new Prisma.Decimal(initialStock) } },
                  create: {
                    tenantId, productId, branchId: branch.id,
                    quantity: new Prisma.Decimal(initialStock),
                  },
                });
              }
            } catch (err: any) {
              result.errors.push({
                row: rowNum,
                message: `Initial lot create failed: ${err?.message ?? 'unknown'}`,
              });
            }
          }
        }
      } catch (err: any) {
        result.errors.push({
          row: rowNum,
          message: err.message ?? 'Unknown error',
        });
      }
    }
    return result;
  }

  /**
   * Sprint 19 — Vertical-aware product template. Pharmacy tenants get the
   * 15-column template with the medicine-specific fields + lot/expiry seed.
   * Other verticals get the lean 7-column template with sample rows tailored
   * to the vertical (coffee-shop / restaurant / laundry / retail / etc.).
   * The import parser still accepts both shapes, so a 7-column upload works
   * regardless of which template was downloaded.
   */
  async productsTemplate(tenantId?: string): Promise<Buffer> {
    let businessType: string = 'RETAIL';
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { businessType: true },
      });
      businessType = tenant?.businessType ?? 'RETAIL';
    }

    if (businessType === 'PHARMACY') {
      return this.makeTemplate(
        'Products',
        [
          'Name*',
          'Category',
          'Price*',
          'Cost Price*',
          'VAT (Y/N)',
          'Barcode',
          'Description',
          'Generic Name',
          'Brand Name',
          'Dosage Form',
          'Strength',
          'Drug Class',
          'Initial Lot #',
          'Initial Lot Expiry',
          'Initial Stock',
        ],
        [
          ['Paracetamol 500mg', 'Pain & Fever',   '2.50',  '1.20', 'Y', '', 'Tablet', 'Paracetamol',  'Biogesic', 'Tablet',  '500mg',  'OTC',     'PAR-2025-114', '2027-12-31', '500'],
          ['Amoxicillin 500mg', 'Antibiotics',    '12.00', '4.50', 'Y', '', 'Capsule','Amoxicillin',  'Amoxil',   'Capsule', '500mg',  'RX_ONLY', 'AMX-2025-042', '2026-09-30', '200'],
          ['Loratadine 10mg',   'Antihistamines', '8.00',  '3.50', 'Y', '', 'Tablet', 'Loratadine',   'Claritin', 'Tablet',  '10mg',   'RX_ONLY', 'LOR-2025-007', '2027-08-15', '300'],
          ['Diazepam 5mg',      'Anxiolytics',    '8.00',  '3.20', 'Y', '', 'Tablet', 'Diazepam',     'Valium',   'Tablet',  '5mg',    'DDB_S4',  'DIA-2025-018', '2027-03-15', '100'],
          ['Insulin (Humulin)', 'Vaccines & Bio', '850',   '420',  'Y', '', 'Cold-chain insulin',     'Insulin',  'Humulin','Vial',   '100IU/ml','VACCINE','INS-2025-022', '2026-11-30', '20'],
          ['BP Monitor',        'Devices',        '2500',  '1450', 'Y', '', '',       '',             '',         '',         '',       'DEVICE',  '',             '',             '5'],
          ['Vitamin C 500mg',   'Supplements',    '6.00',  '2.40', 'Y', '', 'Tablet', '',             'Cecon',    'Tablet',   '500mg',  'SUPPLEMENT','',           '',             '600'],
          ['Sunscreen SPF 50',  'Personal Care',  '380',   '180',  'Y', '', '',       '',             'Belo',     '',         '',       'COSMETIC','',             '',             '40'],
        ],
        {
          title: 'Clerque — Pharmacy Product Master Import Template',
          instructions: [
            'How to use:',
            '  1. Fill the rows below the headers. The grey SAMPLE rows are ignored — delete them or leave them.',
            '  2. Columns marked with * are required. Existing products are matched by Name (or Barcode if provided) and updated.',
            '  3. Cost Price is REQUIRED. It drives COGS posting on every sale. Enter 0 for complimentary items.',
            '  4. VAT column accepts Y / Yes / 1 / true (case-insensitive) for VAT-able items; anything else means no VAT.',
            '  5. Category — if it doesn\'t exist yet, Clerque creates it. Use consistent spelling across rows.',
            '  6. Save as .xlsx (or .csv). Upload via POS → Products → Import.',
            '',
            'Pharmacy columns:',
            '  - Drug Class: OTC, OTC_BTC, RX_ONLY, DDB_S2, DDB_S3, DDB_S4, DDB_S5, VACCINE, DEVICE, SUPPLEMENT, COSMETIC, OTHER. Defaults OTC.',
            '  - Drug Class drives the till workflow: RX_ONLY+ requires pharmacist PIN at sale; DDB_S2 also requires Yellow Rx serial.',
            '  - Initial Lot # + Expiry: optional shorthand to seed FDA lot tracking on import. If set, Initial Stock is dispensed against this lot. For full lot management, use /pos/pharmacy/lots after import.',
          ],
          columnHints: [
            'Required. Unique within tenant.',
            'Optional. Auto-creates if new.',
            'Required. Selling price (₱).',
            'REQUIRED. Unit cost (₱) for COGS.',
            'Y or N. Default N.',
            'Optional. EAN-13 / UPC etc.',
            'Optional. Free text.',
            'Optional. RA 6675 generic name.',
            'Optional. Brand name on label.',
            'Optional. Tablet/Capsule/Syrup.',
            'Optional. e.g. 500mg, 5mg/ml.',
            'Optional. Defaults OTC.',
            'Optional. Lot/batch number.',
            'Required if Initial Lot # set (YYYY-MM-DD).',
            'Optional. Initial qty at default branch.',
          ],
        },
      );
    }

    // Non-pharmacy template — lean 7 columns. Sample rows + title tailored
    // to the vertical so a coffee-shop owner sees beverages and a laundry
    // owner sees wash-and-fold services.
    const HEADERS = [
      'Name*',
      'Category',
      'Price*',
      'Cost Price*',
      'VAT (Y/N)',
      'Barcode',
      'Description',
      // Ready-to-sell goods can be stocked from this one sheet instead of a
      // second Inventory file — see the instructions block below.
      'Opening Stock',
      'Low Stock Alert',
    ];
    const HINTS = [
      'Required. Unique within tenant.',
      'Optional. Auto-creates if new.',
      'Required. Selling price (₱).',
      'REQUIRED. Unit cost (₱) for COGS.',
      'Y or N. Default N.',
      'Optional. EAN-13 / UPC etc.',
      'Optional. Free text.',
      'Optional. How many you have NOW. Leave blank for made-to-order items.',
      'Optional. Warn when stock falls below this.',
    ];

    let title = 'Clerque — Product Master Import Template';
    let sampleRows: string[][];
    let helperLine: string | null = null;

    switch (businessType) {
      case 'COFFEE_SHOP':
        title = 'Clerque — Coffee Shop Product Master Import Template';
        helperLine = 'Tip: For drinks made from beans + milk + cups (recipe-based COGS), use the Ingredients + Recipes templates after this — true cost is auto-derived from the recipe at sale time. The Cost Price below is a FALLBACK used only when no recipe exists.';
        sampleRows = [
          ['Espresso Solo',    'Beverages',   '85',  '22',  'Y', '',              'Single shot espresso'],
          ['Iced Latte 16oz',  'Beverages',   '150', '38',  'Y', '',              'Espresso + cold milk + ice'],
          ['Cappuccino 12oz',  'Beverages',   '130', '32',  'Y', '',              'Espresso + steamed milk + foam'],
          ['Matcha Latte 16oz','Beverages',   '170', '45',  'Y', '',              'Ceremonial matcha + steamed milk'],
          ['Croissant',        'Bakery',      '85',  '28',  'Y', '',              'Butter croissant, baked daily'],
          ['Banana Bread',     'Bakery',      '95',  '32',  'Y', '',              'Slice of banana loaf'],
          ['Bottled Water',    'Beverages',   '40',  '12',  'Y', '4806507000123', '500ml'],
          ['Espresso Beans',   'Retail',      '550', '320', 'Y', '',              '250g whole beans, single origin'],
        ];
        break;
      case 'RESTAURANT':
      case 'BAKERY':
      case 'FOOD_STALL':
      case 'BAR_LOUNGE':
      case 'CATERING':
        title = 'Clerque — Restaurant Product Master Import Template';
        helperLine = 'Tip: For dishes made from rice + meat + sauce (recipe-based COGS), use the Ingredients + Recipes templates after this — true cost is auto-derived from the recipe at sale time. The Cost Price below is a FALLBACK used only when no recipe exists.';
        sampleRows = [
          ['Garlic Rice',         'Mains',     '60',  '12',  'Y', '', 'Steamed rice with toasted garlic'],
          ['Tapsilog',            'Mains',     '180', '85',  'Y', '', 'Tapa + sinangag + itlog'],
          ['Adobong Manok',       'Mains',     '220', '110', 'Y', '', 'Chicken adobo with rice'],
          ['Sinigang na Baboy',   'Soups',     '280', '140', 'Y', '', 'Pork in sour tamarind broth'],
          ['Ice Cold Coke',       'Drinks',    '60',  '22',  'Y', '4801968501068', 'Coca-Cola in glass bottle'],
          ['San Mig Light',       'Drinks',    '110', '55',  'Y', '4806504020010', 'San Miguel Light beer 330ml'],
          ['Halo-Halo',           'Desserts',  '180', '70',  'Y', '', 'Mixed shaved ice dessert'],
        ];
        break;
      case 'LAUNDRY':
        title = 'Clerque — Laundry Service Master Import Template';
        helperLine = 'Tip: Wash / dry / iron / fold are services priced per kilo. Detergent + softener are retail add-ons.';
        sampleRows = [
          ['Wash & Dry per kilo',  'Services',     '60',   '18',   'Y', '', 'Self-service wash + dry, 8kg minimum'],
          ['Wash + Dry + Fold',    'Services',     '85',   '25',   'Y', '', 'Full-service per kilo'],
          ['Press / Iron per pc',  'Services',     '15',   '4',    'Y', '', 'Per garment, hand-pressed'],
          ['Dry Clean Suit',       'Services',     '350',  '180',  'Y', '', '2-piece suit, dry clean only'],
          ['Detergent Sachet',     'Retail',       '15',   '8',    'Y', '4806504050103', 'Tide single-use sachet'],
          ['Fabric Softener 1L',   'Retail',       '180',  '95',   'Y', '4806504051040', 'Downy 1L bottle'],
          ['Hanger 5-pack',        'Retail',       '60',   '30',   'Y', '', 'Plastic hangers, set of 5'],
        ];
        break;
      case 'MANUFACTURING':
        title = 'Clerque — Manufacturing Product Master Import Template';
        helperLine = 'Tip: For BOM-based products (track raw material COGS), set up the recipe from POS → Products after import.';
        sampleRows = [
          ['Wooden Chair',        'Furniture',     '3500', '1850', 'Y', '', 'Ash hardwood, 4 legs, no armrest'],
          ['Office Desk',         'Furniture',     '5500', '2400', 'Y', '', '120x60cm pine top, steel legs'],
          ['Bookshelf 5-tier',    'Furniture',     '4200', '1950', 'Y', '', 'Plywood, 180cm tall'],
          ['Custom Cabinet',      'Custom',       '12000', '4500', 'Y', '', 'Made-to-order — see job order'],
        ];
        break;
      case 'TRUCKING':
        title = 'Clerque — Trucking / Logistics Service Import Template';
        helperLine = 'Tip: Freight rates vary by distance + load. Set per-route pricing in Settings → Trucking after import.';
        sampleRows = [
          ['Manila → Cebu',       'Long Haul',     '12000', '8500', 'Y', '', '6-wheeler, 5-ton load, door-to-door'],
          ['Manila → Davao',      'Long Haul',     '18000', '12500', 'Y', '', '10-wheeler, 10-ton load'],
          ['Metro Manila Local',  'Local Delivery','2500',  '900',   'Y', '', 'Same-city, < 50km'],
          ['Diesel surcharge',    'Surcharge',     '500',   '0',     'Y', '', 'Per trip, indexed to fuel price'],
        ];
        break;
      case 'CONSTRUCTION':
        title = 'Clerque — Construction Service Import Template';
        helperLine = 'Tip: Track per-project labor + materials separately. Use Job Orders for project-based billing.';
        sampleRows = [
          ['Bag of Cement (40kg)',  'Materials', '320',  '180', 'Y', '', 'Holcim Excel'],
          ['Rebar #4 (12mm)',       'Materials', '450',  '280', 'Y', '', '7.5m length'],
          ['G.I. Sheet 8ft',        'Materials', '1200', '750', 'Y', '', 'Galvanized iron roofing'],
          ['Mason day rate',        'Labor',     '1200', '0',   'Y', '', 'Per worker per 8-hour day'],
          ['Helper day rate',       'Labor',     '700',  '0',   'Y', '', 'Per worker per 8-hour day'],
        ];
        break;
      case 'SERVICE':
      case 'RETAIL':
      default:
        title = 'Clerque — Product Master Import Template';
        sampleRows = [
          ['T-Shirt — Plain',      'Apparel',     '350',  '120', 'Y', '4806504070101', 'Cotton, white, S/M/L'],
          ['Jeans — Blue Denim',   'Apparel',     '950',  '420', 'Y', '4806504070118', 'Slim-cut, all sizes'],
          ['Sneakers',             'Footwear',    '1800', '850', 'Y', '4806504070125', 'Canvas, lace-up'],
          ['Backpack',             'Accessories', '850',  '380', 'Y', '4806504070132', '20L school/office bag'],
          ['Notebook',             'Stationery',  '85',   '32',  'Y', '4806504070149', '120-page A5 ruled'],
          ['Ballpen',              'Stationery',  '15',   '5',   'Y', '4806504070156', 'Pilot G2 black, fine tip'],
        ];
        break;
    }

    return this.makeTemplate(
      'Products',
      HEADERS,
      sampleRows,
      {
        title,
        instructions: [
          'How to use:',
          '  1. Fill the rows below the headers. The grey SAMPLE rows are ignored — delete them or leave them.',
          '  2. Columns marked with * are required. Existing products are matched by Name (or Barcode if provided) and updated.',
          '  3. Cost Price is REQUIRED. It drives COGS posting on every sale. Enter 0 for services or complimentary items.',
          '  4. VAT column accepts Y / Yes / 1 / true (case-insensitive) for VAT-able items; anything else means no VAT.',
          '  5. Category — if it doesn\'t exist yet, Clerque creates it. Use consistent spelling across rows.',
          '  6. Opening Stock — how many you have on hand RIGHT NOW. Fill this for ready-to-sell goods you buy finished (bottled water, chips, canned drinks) and you never need a second file.',
          '  7. Leave Opening Stock BLANK for anything you make to order (drinks, meals). Those are stocked by their ingredients instead — see the Ingredients and Recipes templates.',
          '  8. Save as .xlsx (or .csv). Upload via Settings → Import Templates → Import.',
          ...(helperLine ? [helperLine] : []),
          'Re-importing is safe: Opening Stock REPLACES the count (it is a stock take, not a delivery), so you can correct a number and upload again.',
          'To record a delivery that adds to stock instead, use the Stock Receipts template.',
        ],
        columnHints: HINTS,
      },
    );
  }

  // ── Inventory Import ────────────────────────────────────────────────────────
  // Expected columns: Product Name* OR Barcode*, Quantity*, Low Stock Alert
  /**
   * Migrate a Loyverse "Item list" export straight into Clerque.
   *
   * The export is translated into our own template row shapes and then run
   * through the SAME importers the templates use, so a migrated catalog gets
   * identical validation, category upsert and name/barcode matching. Nothing
   * about the Loyverse file is trusted beyond its column headers.
   *
   * Products are always imported. Opening stock is imported too when the
   * export carried per-store stock columns and the caller named a branch.
   */
  async importLoyverse(
    file: Express.Multer.File,
    tenantId: string,
    branchId?: string,
  ): Promise<
    ImportResult & {
      inventory?: ImportResult;
      storesDetected: string[];
      unmappedHeaders: string[];
      variantsExpanded: number;
    }
  > {
    const rows = await this.parseFile(file);

    let mapped;
    try {
      mapped = mapLoyverseItems(rows);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Could not read this Loyverse export.',
      );
    }

    if (mapped.productRows.length <= 1) {
      throw new BadRequestException(
        looksLikeLoyverse(rows)
          ? 'This looks like a Loyverse export but no item rows were found below the header.'
          : 'No items found. Export "Item list" from Loyverse (Back office > Items > Export) and upload that file unchanged.',
      );
    }

    const productResult = await this.importProductsFromRows(mapped.productRows, tenantId);

    let inventory: ImportResult | undefined;
    if (branchId && mapped.inventoryRows.length > 1) {
      inventory = await this.importInventoryFromRows(
        mapped.inventoryRows,
        tenantId,
        branchId,
      );
    }

    return {
      ...productResult,
      inventory,
      storesDetected:   mapped.storesDetected,
      unmappedHeaders:  mapped.unmappedHeaders,
      variantsExpanded: mapped.variantsExpanded,
    };
  }

  async importInventory(
    file: Express.Multer.File,
    tenantId: string,
    branchId: string,
  ): Promise<ImportResult> {
    const rows = await this.parseFile(file);
    return this.importInventoryFromRows(rows, tenantId, branchId);
  }

  private async importInventoryFromRows(
    rows: string[][],
    tenantId: string,
    branchId: string,
  ): Promise<ImportResult> {
    const headerIdx = this.findHeaderRow(rows, [
      'Product Name or Barcode*', 'Product Name*', 'Product Name',
    ]);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart)
      throw new BadRequestException(
        'File must have a header row and at least one data row.',
      );

    const result: ImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    let dataRows = rows.slice(dataStart);
    // Skip optional hints row (qty cell isn't numeric)
    // Same literal hints-row detection as the products importer -- the old
    // numeric guess silently swallowed a real first row.
    if (this.isHintRow(dataRows[0])) dataRows = dataRows.slice(1);

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [productName, barcodeOrQty, qtyOrAlert, alertStr] = dataRows[i];

      // Support two column layouts: [Name, Qty, Alert] or [Name, Barcode, Qty, Alert]
      let qty: number;
      let lowAlert: number;
      const lookup = productName?.trim();

      if (!lookup) {
        result.skipped++;
        continue;
      }

      // Detect if 2nd col is barcode or qty
      const col2IsNum = !isNaN(this.num(barcodeOrQty));
      if (col2IsNum) {
        qty = this.num(barcodeOrQty);
        lowAlert = this.num(qtyOrAlert) || 0;
      } else {
        qty = this.num(qtyOrAlert);
        lowAlert = this.num(alertStr) || 0;
      }

      if (isNaN(qty) || qty < 0) {
        result.errors.push({
          row: rowNum,
          message: `Invalid quantity: "${barcodeOrQty}"`,
        });
        continue;
      }

      try {
        const product = await this.prisma.product.findFirst({
          where: { tenantId, OR: [{ name: lookup }, { barcode: lookup }] },
        });
        if (!product) {
          result.errors.push({
            row: rowNum,
            message: `Product not found: "${lookup}"`,
          });
          continue;
        }

        const inv = await this.prisma.inventoryItem.findUnique({
          where: { branchId_productId: { branchId, productId: product.id } },
        });

        if (inv) {
          await this.prisma.inventoryItem.update({
            where: { id: inv.id },
            data: {
              quantity: qty,
              lowStockAlert: lowAlert || inv.lowStockAlert,
            },
          });
          result.updated++;
        } else {
          await this.prisma.inventoryItem.create({
            data: {
              tenantId,
              branchId,
              productId: product.id,
              quantity: qty,
              lowStockAlert: lowAlert,
            },
          });
          result.imported++;
        }
      } catch (err: any) {
        result.errors.push({
          row: rowNum,
          message: err.message ?? 'Unknown error',
        });
      }
    }
    return result;
  }

  async inventoryTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Inventory',
      ['Product Name or Barcode*', 'Quantity on Hand*', 'Low Stock Alert'],
      [
        ['Garlic Rice',      '100', '10'],
        ['Bottled Water',    '200', '20'],
        ['4806507000123',    '50',  '5'],   // matched by barcode
        ['Iced Latte 16oz',  '0',   ''],    // SKU exists but no opening stock yet
      ],
      {
        title: 'Clerque — Opening Inventory Import Template',
        instructions: [
          'How to use:',
          '  1. Set the branch in Clerque BEFORE running this import (POS → Inventory → pick branch).',
          '  2. Each row updates the on-hand quantity for one product at the selected branch.',
          '  3. Match by Product Name OR Barcode — the import tries both. Spelling must match the product master exactly.',
          '  4. Quantity replaces (not adds to) the current quantity. Use 0 if you have no stock.',
          '  5. Low Stock Alert is the threshold below which the dashboard flags re-ordering. Optional; leave blank to disable.',
          '  6. Save as .xlsx (or .csv). Upload via POS → Inventory → Import.',
          'Tip: Run the Products import FIRST so all SKUs exist; then this Inventory import sets opening balances.',
        ],
        columnHints: [
          'Required. Must match an existing product.',
          'Required. Number ≥ 0.',
          'Optional. Re-order trigger.',
        ],
      },
    );
  }

  // ── Journal Entry Import ────────────────────────────────────────────────────
  // Expected columns: Reference*, Date*, Description, Account Code*, Debit, Credit, Memo
  // Rows with the same Reference are grouped into one JournalEntry
  async importJournalEntries(
    file: Express.Multer.File,
    tenantId: string,
    userId: string,
  ): Promise<ImportResult> {
    const rows = await this.parseFile(file);
    if (rows.length < 2)
      throw new BadRequestException(
        'File must have a header row and at least one data row.',
      );

    const result: ImportResult = {
      imported: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    // Header is not row 0 — the template has a title + instruction block above
    // it. Without this, "How to use:" is read as an account code and NOTHING
    // imports (this is the path used for opening balances).
    const headerIdx = this.findHeaderRow(rows, ['Reference*', 'Reference']);
    let dataStart   = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (this.isHintRow(rows[dataStart])) dataStart++;
    const dataRows = rows.slice(dataStart);

    // Group rows by Reference
    const groups = new Map<
      string,
      {
        rowNum: number;
        date: string;
        description: string;
        lines: {
          accountCode: string;
          debit: number;
          credit: number;
          memo: string;
        }[];
      }
    >();

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 1;   // real spreadsheet row
      // Sample lines never reach a group, so an all-sample Reference (the
      // template's JE-2026-001 / -002) is never posted.
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [ref, date, description, accountCode, debitStr, creditStr, memo] =
        dataRows[i];
      if (!ref?.trim()) {
        result.skipped++;
        continue;
      }
      const debit = this.num(debitStr) || 0;
      const credit = this.num(creditStr) || 0;
      if (!accountCode?.trim()) {
        result.errors.push({
          row: rowNum,
          message: 'Account Code is required.',
        });
        continue;
      }
      if (!groups.has(ref)) {
        groups.set(ref, {
          rowNum,
          date:
            date?.trim() || new Date().toISOString().split('T')[0],
          description: description?.trim() || ref,
          lines: [],
        });
      }
      groups.get(ref)!.lines.push({
        accountCode: accountCode.trim(),
        debit,
        credit,
        memo: memo?.trim() || '',
      });
    }

    // Post each group as one JournalEntry
    for (const [ref, group] of groups) {
      const totalDebit = group.lines.reduce((s, l) => s + l.debit, 0);
      const totalCredit = group.lines.reduce((s, l) => s + l.credit, 0);
      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        result.errors.push({
          row: group.rowNum,
          message: `Ref "${ref}": debits (${totalDebit}) ≠ credits (${totalCredit})`,
        });
        continue;
      }

      try {
        // Resolve account IDs from codes
        const resolvedLines: {
          accountId: string;
          debit: number;
          credit: number;
          memo: string;
        }[] = [];
        let lineError = false;
        for (const line of group.lines) {
          const account = await this.prisma.account.findFirst({
            where: { tenantId, code: line.accountCode },
          });
          if (!account) {
            result.errors.push({
              row: group.rowNum,
              message: `Account code not found: "${line.accountCode}"`,
            });
            lineError = true;
            break;
          }
          resolvedLines.push({
            accountId: account.id,
            debit: line.debit,
            credit: line.credit,
            memo: line.memo,
          });
        }
        if (lineError) continue;

        // Generate entry number: JE-IMPORT-timestamp-ref
        const entryNumber = `JE-IMP-${Date.now()}-${ref}`.slice(0, 50);

        await this.prisma.journalEntry.create({
          data: {
            tenantId,
            entryNumber,
            reference: ref,
            description: group.description,
            date: new Date(group.date),
            status: 'POSTED',
            source: 'MANUAL',
            createdBy: userId,
            lines: {
              create: resolvedLines.map((l) => ({
                accountId: l.accountId,
                debit: l.debit,
                credit: l.credit,
                // The template's per-line "Memo" column maps to
                // JournalLine.description — there is no `memo` field on the
                // model, and passing one made Prisma reject EVERY entry, so
                // opening-balance imports failed wholesale.
                description: l.memo,
              })),
            },
          },
        });
        result.imported++;
      } catch (err: any) {
        result.errors.push({
          row: group.rowNum,
          message: err.message ?? 'Unknown error',
        });
      }
    }
    return result;
  }

  // ── Chart of Accounts Import ────────────────────────────────────────────────
  // Expected columns: Code*, Name*, Type*, Normal Balance, Description, Parent Code
  // Rules:
  //   - Existing account (same code): update name/description if different; skip isSystem accounts
  //   - New account: create with postingControl = OPEN; derive normalBalance from type if blank
  //   - Valid types: ASSET, LIABILITY, EQUITY, REVENUE, EXPENSE
  //   - Normal balance auto-derived: ASSET/EXPENSE → DEBIT; LIABILITY/EQUITY/REVENUE → CREDIT
  async importChartOfAccounts(
    file: Express.Multer.File,
    tenantId: string,
  ): Promise<ImportResult> {
    return this.importChartOfAccountsFromRows(await this.parseFile(file), tenantId);
  }

  private async importChartOfAccountsFromRows(rows: string[][], tenantId: string): Promise<ImportResult> {
    if (rows.length < 2)
      throw new BadRequestException('File must have a header row and at least one data row.');

    const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
    type AcctType = typeof VALID_TYPES[number];

    function deriveNormalBalance(type: AcctType): 'DEBIT' | 'CREDIT' {
      return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
    }

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    // The template ships a title + "How to use:" instruction block ABOVE the
    // header, so the header is not row 0. Locate it (same helper the other
    // importers use) or the instruction text is parsed as an account and the
    // whole import fails. Then skip the column-hints row if present.
    const headerIdx = this.findHeaderRow(rows, ['Code*', 'Code']);
    let dataStart   = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (this.isHintRow(rows[dataStart])) dataStart++;
    const dataRows = rows.slice(dataStart);

    // Build a local code → id map for parent resolution (includes existing + rows above current)
    const existingMap = new Map<string, { id: string; isSystem: boolean }>();
    const existing = await this.prisma.account.findMany({
      where:  { tenantId },
      select: { id: true, code: true, isSystem: true },
    });
    for (const a of existing) existingMap.set(a.code, { id: a.id, isSystem: a.isSystem });

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 1;   // real spreadsheet row
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      // Columns: Code, Name, Type, Normal Balance, Description, Parent Code
      const [codeRaw, nameRaw, typeRaw, normalBalanceRaw, descriptionRaw, parentCodeRaw] = dataRows[i];

      const code = codeRaw?.trim();
      const name = nameRaw?.trim();

      if (!code) { result.skipped++; continue; }
      if (!name) {
        result.errors.push({ row: rowNum, message: `Row ${rowNum}: Name is required.` });
        continue;
      }

      const typeUpper = typeRaw?.trim().toUpperCase() as AcctType;
      if (!VALID_TYPES.includes(typeUpper)) {
        result.errors.push({ row: rowNum, message: `Row ${rowNum}: Invalid type "${typeRaw}". Must be ASSET, LIABILITY, EQUITY, REVENUE, or EXPENSE.` });
        continue;
      }

      const nbRaw = normalBalanceRaw?.trim().toUpperCase();
      const normalBalance: 'DEBIT' | 'CREDIT' =
        nbRaw === 'DEBIT' || nbRaw === 'CREDIT' ? nbRaw : deriveNormalBalance(typeUpper);

      const description = descriptionRaw?.trim() || null;
      const parentCode  = parentCodeRaw?.trim() || null;

      // Resolve parent
      let parentId: string | null = null;
      if (parentCode) {
        const parentEntry = existingMap.get(parentCode);
        if (!parentEntry) {
          result.errors.push({ row: rowNum, message: `Row ${rowNum}: Parent account code "${parentCode}" not found.` });
          continue;
        }
        parentId = parentEntry.id;
      }

      try {
        const entry = existingMap.get(code);
        if (entry) {
          // Existing account — skip system accounts, update user accounts
          if (entry.isSystem) {
            result.skipped++;
            continue;
          }
          await this.prisma.account.update({
            where: { id: entry.id },
            data: {
              name,
              type: typeUpper,
              normalBalance,
              ...(description !== null && { description }),
              ...(parentId !== null && { parentId }),
            },
          });
          result.updated++;
        } else {
          // New account
          const created = await this.prisma.account.create({
            data: {
              tenantId,
              code,
              name,
              type: typeUpper,
              normalBalance,
              postingControl: 'OPEN',
              isSystem:       false,
              isActive:       true,
              description,
              ...(parentId !== null && { parentId }),
            },
          });
          existingMap.set(code, { id: created.id, isSystem: false });
          result.imported++;
        }
      } catch (err: any) {
        result.errors.push({ row: rowNum, message: err.message ?? 'Unknown error' });
      }
    }
    return result;
  }

  async coaTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Chart of Accounts',
      [
        'Code*',
        'Name*',
        'Type* (ASSET/LIABILITY/EQUITY/REVENUE/EXPENSE)',
        'Normal Balance (DEBIT/CREDIT)',
        'Description',
        'Parent Code',
      ],
      [
        // Realistic ADDITIONS (not duplicates of seeded accounts).
        // Each row demonstrates a common custom account a tenant might add.
        ['1023', 'Cash in Bank – BPI Savings',     'ASSET',   'DEBIT',  'BPI Savings Account ending 1234',         '1020'],
        ['1024', 'Cash in Bank – Metrobank Corp',  'ASSET',   'DEBIT',  'Metrobank corporate checking',            '1020'],
        ['4015', 'Service Revenue – Consulting',   'REVENUE', 'CREDIT', 'Consulting & advisory revenue',           ''],
        ['4016', 'Service Revenue – Subscriptions','REVENUE', 'CREDIT', 'SaaS / recurring subscription revenue',   ''],
        ['6149', 'Software License – Adobe',       'EXPENSE', 'DEBIT',  'Adobe Creative Cloud subscription',       '6148'],
      ],
      {
        title: 'Clerque — Chart of Accounts Import Template',
        instructions: [
          'How to use:',
          '  1. Clerque ships with a comprehensive PH-standard COA already seeded (~187 accounts). Use this template ONLY',
          '     when adding tenant-specific accounts — see the existing list under Ledger → Chart of Accounts before adding.',
          '  2. Code: 4-digit numeric. Reserved ranges: 1xxx Assets, 2xxx Liab, 3xxx Equity, 4xxx Revenue, 5xxx COGS,',
          '     6xxx OpEx, 7xxx Other Expenses & Finance Costs.',
          '  3. Type drives report grouping (Income Statement vs Balance Sheet). Spell exactly as listed.',
          '  4. Normal Balance: DEBIT for ASSET/EXPENSE, CREDIT for LIABILITY/EQUITY/REVENUE.',
          '  5. Parent Code: optional, for nested grouping (e.g. a new bank account under "1020 Cash in Bank").',
          '     Leave blank for top-level accounts. NEVER point a code at itself.',
          '  6. Sample rows below are EXAMPLES of typical additions. They are ignored on import — add your own rows below them.',
          '  7. Save as .xlsx (or .csv). Upload via Ledger → Chart of Accounts → Import.',
        ],
        columnHints: [
          'Required. 4-digit, must not collide with seeded.',
          'Required. Display name.',
          'Required. One of 5 enum values.',
          'Required. DEBIT or CREDIT.',
          'Optional. Free text.',
          'Optional. Existing parent code or blank.',
        ],
      },
    );
  }

  async journalTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Journal Entries',
      [
        'Reference*',
        'Date* (YYYY-MM-DD)',
        'Description',
        'Account Code*',
        'Debit',
        'Credit',
        'Memo',
      ],
      [
        // JE-001 — Office supplies paid in cash. Two lines = balanced entry.
        ['JE-2026-001', '2026-04-26', 'Office supplies purchase', '6070', '500',   '',      'Paper and pens'],
        ['JE-2026-001', '2026-04-26', 'Office supplies purchase', '1010', '',      '500',   'Cash payment'],
        // JE-002 — Monthly office rent.
        ['JE-2026-002', '2026-05-01', 'Office rent — May 2026',   '6051', '15000', '',      ''],
        ['JE-2026-002', '2026-05-01', 'Office rent — May 2026',   '1020', '',      '15000', 'BDO check #1234'],
      ],
      {
        title: 'Clerque — Journal Entries Import Template',
        instructions: [
          'How to use:',
          '  1. Each ROW is one journal LINE. Multiple lines with the same Reference become one Journal Entry.',
          '  2. Reference: any unique string per JE — keeps lines together. JE-YYYY-### convention recommended.',
          '  3. Each JE must balance: sum of debits = sum of credits across rows with the same Reference.',
          '  4. Account Code must match an existing GL account. Check Ledger → Chart of Accounts for valid codes.',
          '     Common codes: 1010 Cash on Hand · 1020 Cash in Bank · 4010 Sales Revenue · 5010 COGS ·',
          '     6010 Salaries · 6051 Rent–Office · 6070 Office Supplies · 6148 IT/Software Subscriptions.',
          '  5. Use Debit OR Credit per row, not both. Leave the other blank or 0.',
          '  6. Save as .xlsx (or .csv). Upload via Ledger → Journal Entries → Import.',
          'Common use: posting opening balances, importing historical entries from old accounting software.',
        ],
        columnHints: [
          'Required. Groups lines into a JE.',
          'Required. ISO format.',
          'Optional. JE narrative.',
          'Required. Must exist in COA.',
          'Optional. Use one or the other.',
          'Optional. Use one or the other.',
          'Optional. Per-line note.',
        ],
      },
    );
  }

  // ── Setup Pack: Products + Inventory in ONE workbook ────────────────────
  // Two sheets ("Products", "Inventory"). Run BOTH imports atomically per
  // sheet so a new tenant can stand up their entire catalog in one upload.

  /**
   * Generate the Setup Pack template — one .xlsx with two sheets:
   *   Sheet 1: "Products"  — same as the standalone Products template
   *   Sheet 2: "Inventory" — same as the standalone Inventory template
   * Plus a leading "Read Me" sheet explaining the two-step flow.
   */
  async setupPackTemplate(tenantId?: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';

    let packBusinessType = 'RETAIL';
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { businessType: true },
      });
      packBusinessType = tenant?.businessType ?? 'RETAIL';
    }
    // Shared with the UI so the pack's contents and the text describing
    // them can never disagree again.
    const recipeVertical = isRecipeBusinessType(packBusinessType);

    // ── Read Me sheet ──
    const readme = wb.addWorksheet('Read Me');
    readme.mergeCells('A1:F1');
    const t = readme.getCell('A1');
    t.value = 'Clerque — Business Setup Pack';
    t.font  = { bold: true, size: 16, color: { argb: 'FF8B5E3C' } };
    readme.getRow(1).height = 26;
    const recipeSteps = [
      'Step 2 — "Ingredients": everything you BUY to make your menu — beans, milk, syrup, cups, lids.',
      '         Unit is how you measure it (g / ml / pc). Cost per Unit is what one of those costs you.',
      '         Tip: divide bulk pricing. 1L milk at P85 = 0.085 per ml.',
      '         This sheet sets COST only. Quantities come later, from the Stock Receipts template.',
      '',
      'Step 3 — "Recipes": what goes INTO each menu item. One row per ingredient, per product.',
      '         An Iced Latte with 5 ingredients = 5 rows. Names must match Products and Ingredients exactly.',
      '         This is what makes your true cost and gross margin correct.',
      '',
    ];
    const plainSteps = [
      'Step 2 — "Customers": only if you invoice on credit / on account. Skip it for a walk-in shop.',
      '',
      'Step 3 — "Vendors": your suppliers, for recording bills and expenses. Optional at first.',
      '',
    ];

    const lines = [
      '',
      'One file, several sheets. Fill only the sheets you are ready for — anything you leave',
      'untouched is simply skipped, and you can upload the file again later.',
      '',
      'Fill the sheets IN ORDER. Recipes link to Products and Ingredients by name, so those must',
      'be filled in first.',
      '',
      'Step 1 — "Products": every item you sell.',
      '         Required: Name, Selling Price, Cost Price. Cost Price drives gross profit — do not leave it blank.',
      '         Opening Stock: fill it for things you buy READY TO SELL (bottled water, chips) and you are done.',
      ...(recipeVertical
        ? ['         Leave Opening Stock blank for anything you MAKE TO ORDER — those are stocked by their',
           '         ingredients, on the next two sheets.']
        : []),
      '',
      ...(recipeVertical ? recipeSteps : plainSteps),
      ...(recipeVertical
        ? ['Step 4 — "Customers": only if you invoice on credit / on account. Skip it for a walk-in shop.',
           '',
           'Step 5 — "Vendors": your suppliers, for recording bills and expenses. Optional at first.',
           '']
        : []),
      'Last sheet — "Chart of Accounts": ONLY if your accountant wants their own account codes.',
      '         Clerque already installs a full PH-standard chart automatically, so most shops skip this entirely.',
      '',
      'Then — Save, and upload this file at Settings -> Import Templates -> Import (Setup Pack row).',
      '       Sheets are imported in the correct order automatically.',
      ...(recipeVertical
        ? ['',
           'AFTER this file: use the Stock Receipts template to record your opening delivery of',
           'ingredients. That is what puts real quantities on the beans, milk and cups, and it is what',
           'lets Clerque deduct them automatically on every sale.']
        : []),
      '',
      'Notes:',
      '  • Categories are auto-created if they do not exist.',
      '  • VAT column is Y/N. Most retail items in PH = Y (VAT-able).',
      '  • Grey SAMPLE rows are examples and are always ignored — delete them or leave them.',
      '  • Safe to re-run. Rows are matched by NAME and updated, never duplicated, and a blank cell',
      '    means "leave this as it is" — it will not wipe a value you typed into the app.',
      '  • Opening Stock REPLACES the count rather than adding to it, so correcting a number and',
      '    re-uploading gives you that number, not double.',
      '  • Two things a re-run will NOT do, because it matches on name:',
      '      - Renaming a product in this file creates a SECOND product. Rename it in the app instead.',
      '      - Deleting a Recipes line here does not remove that ingredient from the recipe. Remove it',
      '        on the product page.',
      '  • Opening Stock applies to your main branch. For a second branch, use the standalone',
      '    Inventory template after switching branch.',
    ];
    for (const line of lines) {
      readme.addRow([line]);
    }
    readme.getColumn(1).width = 110;
    for (let i = 2; i <= readme.rowCount; i++) {
      readme.getRow(i).font = { color: { argb: 'FF333333' }, size: 11 };
      readme.getRow(i).alignment = { wrapText: true };
    }

    // Copy each standalone template in as its own sheet. Doing it by loop
    // keeps the pack honest: whatever is listed here is what the file
    // actually contains, and the importer below reads the same list.
    //
    // Inventory is deliberately NOT bundled. Products now carries an
    // "Opening Stock" column, so a second stock sheet in the first-time pack
    // just re-creates the "which one do I fill?" confusion. The standalone
    // Inventory template still exists for later stock takes and for setting
    // counts at a second branch.
    const bundled: Array<{ name: string; buf: Buffer }> = [
      { name: 'Products', buf: await this.productsTemplate(tenantId) },
      // Ingredients + Recipes only for businesses that MAKE what they sell.
      // Sheet order mirrors the import order: a recipe links a product to an
      // ingredient BY NAME, so both must be filled in before it.
      ...(recipeVertical
        ? [
            { name: 'Ingredients', buf: await this.ingredientsTemplate(tenantId) },
            { name: 'Recipes',     buf: await this.recipesTemplate(tenantId) },
          ]
        : []),
      { name: 'Customers',         buf: await this.customersTemplate() },
      { name: 'Vendors',           buf: await this.vendorsTemplate() },
      { name: 'Chart of Accounts', buf: await this.coaTemplate() },
    ];

    for (const { name, buf } of bundled) {
      const srcWb = new ExcelJS.Workbook();
      await srcWb.xlsx.load(buf as any);
      const src = srcWb.worksheets[0];
      const dest = wb.addWorksheet(name);
      src.eachRow((row, rowIdx) => {
        const newRow = dest.getRow(rowIdx);
        newRow.values    = row.values as any;
        newRow.font      = row.font;
        newRow.fill      = row.fill;
        newRow.alignment = row.alignment;
        newRow.height    = row.height;
      });
      src.columns.forEach((col, i) => {
        dest.getColumn(i + 1).width = col.width ?? 20;
      });
      dest.views = src.views;
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Run the Setup Pack import: parse both sheets and call the per-sheet
   * importers in order (Products first so the SKUs exist before Inventory
   * tries to look them up). Returns a combined report.
   */
  /**
   * Import every sheet the Setup Pack carries, in dependency order.
   *
   * Order matters: the chart of accounts underpins the ledger, products must
   * exist before any stock references them, and customers/vendors are
   * independent masters. A sheet that is absent (or left untouched) is
   * reported as notIncluded rather than treated as an error, so an owner can
   * fill in only the parts they are ready for.
   *
   * Inventory is no longer bundled — Products carries Opening Stock — but a
   * pack downloaded before that change still has the sheet, so it is still
   * honoured when present.
   */
  async importSetupPack(
    file: Express.Multer.File,
    tenantId: string,
    branchId: string,
  ): Promise<Record<string, ImportResult & { notIncluded: boolean }>> {
    const sheets = await this.parseAllSheets(file);
    const pick = (...names: string[]): string[][] | null => {
      for (const n of names) {
        const hit = sheets.get(n) ?? sheets.get(n.toLowerCase());
        if (hit) return hit;
      }
      return null;
    };

    const plan: Array<{
      key:  string;
      rows: string[][] | null;
      run:  (rows: string[][]) => Promise<ImportResult>;
    }> = [
      {
        key:  'chartOfAccounts',
        rows: pick('Chart of Accounts', 'ChartOfAccounts', 'COA'),
        run:  (r) => this.importChartOfAccountsFromRows(r, tenantId),
      },
      {
        key:  'products',
        rows: pick('Products'),
        run:  (r) => this.importProductsFromRows(r, tenantId),
      },
      {
        key:  'ingredients',
        rows: pick('Ingredients', 'Raw Materials'),
        run:  (r) => this.importIngredientsFromRows(r, tenantId),
      },
      {
        // Must run after BOTH products and ingredients: a recipe line links
        // the two by name, and importing one flips its product to
        // RECIPE_BASED so COGS is derived from ingredients at sale time.
        key:  'recipes',
        rows: pick('Recipes', 'Recipe', 'BOM'),
        run:  (r) => this.importRecipesFromRows(r, tenantId),
      },
      {
        key:  'customers',
        rows: pick('Customers'),
        run:  (r) => this.importCustomersFromRows(r, tenantId),
      },
      {
        key:  'vendors',
        rows: pick('Vendors', 'Suppliers'),
        run:  (r) => this.importVendorsFromRows(r, tenantId),
      },
      {
        key:  'inventory',
        rows: pick('Inventory'),
        run:  (r) => this.importInventoryFromRows(r, tenantId, branchId),
      },
    ];

    if (plan.every((p) => !p.rows)) {
      throw new BadRequestException(
        'This file has none of the Setup Pack sheets (Products, Ingredients, Recipes, Customers, Vendors, Chart of Accounts). ' +
        'Download the Setup Pack and fill the sheets inside it.',
      );
    }

    const out: Record<string, ImportResult & { notIncluded: boolean }> = {};
    for (const step of plan) {
      if (!step.rows) {
        out[step.key] = { imported: 0, updated: 0, skipped: 0, errors: [], notIncluded: true };
        continue;
      }
      try {
        out[step.key] = { ...(await step.run(step.rows)), notIncluded: false };
      } catch (err: any) {
        // One bad sheet must not discard the sheets that imported cleanly.
        out[step.key] = {
          imported: 0, updated: 0, skipped: 0, notIncluded: false,
          errors: [{ row: 0, message: err?.message ?? 'Sheet could not be imported.' }],
        };
      }
    }
    return out;
  }

  // ── Customers Import (AR master) ────────────────────────────────────────
  // Columns: Name*, TIN, Address, Email, Phone, Credit Term Days, Credit Limit, Notes

  async importCustomers(file: Express.Multer.File, tenantId: string): Promise<ImportResult> {
    return this.importCustomersFromRows(await this.parseFile(file, ['Customers']), tenantId);
  }

  private async importCustomersFromRows(rows: string[][], tenantId: string): Promise<ImportResult> {
    const headerIdx = this.findHeaderRow(rows, ['Name*', 'Name']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart)
      throw new BadRequestException('File must have a header row and at least one data row.');

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    let dataRows = rows.slice(dataStart);
    if (dataRows.length > 0) {
      const looksLikeHints = isNaN(this.num(dataRows[0][5] ?? '')) && (dataRows[0][0] ?? '').toLowerCase().includes('required');
      if (looksLikeHints) dataRows = dataRows.slice(1);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [name, tin, address, email, phone, termsStr, limitStr, notes] = dataRows[i];
      if (!name?.trim()) { result.skipped++; continue; }

      const creditTermDays = termsStr ? Math.trunc(this.num(termsStr)) : 0;
      if (termsStr && (isNaN(creditTermDays) || creditTermDays < 0)) {
        result.errors.push({ row: rowNum, message: `Invalid credit term days: "${termsStr}"` });
        continue;
      }
      const creditLimit = limitStr ? this.num(limitStr) : null;
      if (limitStr && (isNaN(creditLimit!) || creditLimit! < 0)) {
        result.errors.push({ row: rowNum, message: `Invalid credit limit: "${limitStr}"` });
        continue;
      }

      try {
        const existing = await this.prisma.customer.findFirst({
          where: { tenantId, name: name.trim() },
        });
        const data = {
          tenantId,
          name:           name.trim(),
          tin:            tin?.trim()     || null,
          address:        address?.trim() || null,
          contactEmail:   email?.trim()   || null,
          contactPhone:   phone?.trim()   || null,
          creditTermDays: creditTermDays || 0,
          creditLimit:    creditLimit != null ? new Prisma.Decimal(creditLimit) : null,
          notes:          notes?.trim()  || null,
          isActive:       true,
        };
        if (existing) {
          await this.prisma.customer.update({ where: { id: existing.id }, data: this.onlySupplied(data) });
          result.updated++;
        } else {
          await this.prisma.customer.create({ data });
          result.imported++;
        }
      } catch (err) {
        result.errors.push({ row: rowNum, message: (err as Error).message ?? 'Unknown error' });
      }
    }
    return result;
  }

  async customersTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Customers',
      ['Name*', 'TIN', 'Address', 'Email', 'Phone', 'Credit Term Days', 'Credit Limit', 'Notes'],
      [
        ['ABC Trading Inc.',     '123-456-789-000', '123 EDSA, Quezon City', 'ar@abc.ph',   '0917-1234567', '30',  '500000', 'B2B reseller'],
        ['Reyes Bakery',         '',                'Brgy. San Roque, Pasig', '',           '0922-9876543', '15',  '50000',  'Daily bread orders'],
        ['Walk-in (Anonymous)',  '',                '',                       '',           '',             '0',   '',       'For one-off cash sales'],
      ],
      {
        title: 'Clerque — Customers Import Template (AR Master)',
        instructions: [
          'How to use:',
          '  1. Add one row per customer. Name is required and must be unique within your tenant.',
          '  2. Existing customers (matched by exact Name) are updated; new names create new records.',
          '  3. TIN is optional but required for VAT-registered B2B customers (12-digit format).',
          '  4. Credit Term Days: 0 = cash on delivery; 15/30/60 = net days. Defaults to customer\'s billing terms in AR Billing.',
          '  5. Credit Limit: max outstanding receivable (₱). Leave blank for no limit. Used for over-limit warnings.',
          '  6. Save as .xlsx (or .csv). Upload via Ledger → Receivables → Customers → Import.',
        ],
        columnHints: [
          'Required. Unique within tenant.',
          'Optional. PH 12-digit TIN.',
          'Optional. Free text.',
          'Optional. Email format.',
          'Optional. Mobile or landline.',
          'Optional. Net days for billing terms.',
          'Optional. Max receivable (₱).',
          'Optional. Free text.',
        ],
      },
    );
  }

  // ── Vendors Import (AP master) ──────────────────────────────────────────
  // Columns: Name*, TIN, Address, Email, Phone, Default ATC Code, Default WHT Rate, Notes

  async importVendors(file: Express.Multer.File, tenantId: string): Promise<ImportResult> {
    return this.importVendorsFromRows(await this.parseFile(file, ['Vendors', 'Suppliers']), tenantId);
  }

  private async importVendorsFromRows(rows: string[][], tenantId: string): Promise<ImportResult> {
    const headerIdx = this.findHeaderRow(rows, ['Name*', 'Name']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart)
      throw new BadRequestException('File must have a header row and at least one data row.');

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    let dataRows = rows.slice(dataStart);
    if (dataRows.length > 0) {
      const looksLikeHints = (dataRows[0][0] ?? '').toLowerCase().includes('required');
      if (looksLikeHints) dataRows = dataRows.slice(1);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [name, tin, address, email, phone, atcCode, whtRateStr, notes] = dataRows[i];
      if (!name?.trim()) { result.skipped++; continue; }

      let whtRate: number | null = null;
      if (whtRateStr && whtRateStr.trim()) {
        whtRate = this.num(whtRateStr);
        if (isNaN(whtRate) || whtRate < 0 || whtRate > 1) {
          result.errors.push({ row: rowNum, message: `Invalid WHT rate: "${whtRateStr}". Use decimal (0.05 for 5%).` });
          continue;
        }
      }

      try {
        const existing = await this.prisma.vendor.findFirst({
          where: { tenantId, name: name.trim() },
        });
        const data = {
          tenantId,
          name:           name.trim(),
          tin:            tin?.trim()     || null,
          address:        address?.trim() || null,
          contactEmail:   email?.trim()   || null,
          contactPhone:   phone?.trim()   || null,
          defaultAtcCode: atcCode?.trim() || null,
          defaultWhtRate: whtRate != null ? new Prisma.Decimal(whtRate) : null,
          notes:          notes?.trim()  || null,
          isActive:       true,
        };
        if (existing) {
          await this.prisma.vendor.update({ where: { id: existing.id }, data: this.onlySupplied(data) });
          result.updated++;
        } else {
          await this.prisma.vendor.create({ data });
          result.imported++;
        }
      } catch (err) {
        result.errors.push({ row: rowNum, message: (err as Error).message ?? 'Unknown error' });
      }
    }
    return result;
  }

  async vendorsTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Vendors',
      ['Name*', 'TIN', 'Address', 'Email', 'Phone', 'Default ATC Code', 'Default WHT Rate', 'Notes'],
      [
        ['Globe Telecom',          '000-727-419-000', 'BGC, Taguig',        'ar@globe.com.ph', '02-7300-1010', 'WC158', '0.02', 'Internet provider — 2% EWT on services'],
        ['Manila Electric Company','000-101-528-000', 'Ortigas, Pasig',     '',                '02-1622',      'WC100', '0.05', 'Electricity — 5% EWT on rentals'],
        ['Suki Lending Corp.',     '987-654-321-000', '',                   '',                '',             'WI160', '0.05', 'Office space landlord'],
      ],
      {
        title: 'Clerque — Vendors Import Template (AP Master)',
        instructions: [
          'How to use:',
          '  1. Add one row per vendor (supplier, utility, landlord, contractor, etc.). Name must be unique within your tenant.',
          '  2. Existing vendors (matched by exact Name) are updated; new names create new records.',
          '  3. TIN is required when issuing 2307 to the vendor at year-end (12-digit format).',
          '  4. Default ATC Code: BIR Alphanumeric Tax Code, e.g. WC158 (goods 1%), WC160 (services 2%), WI160 (rentals 5%).',
          '  5. Default WHT Rate: decimal — 0.01 = 1%, 0.02 = 2%, 0.05 = 5%, 0.10 = 10%, 0.15 = 15%.',
          '  6. These defaults pre-fill when you create a new AP Bill — you can still override per bill.',
          '  7. Save as .xlsx (or .csv). Upload via Ledger → Payables → Vendors → Import.',
        ],
        columnHints: [
          'Required. Unique within tenant.',
          'Optional. PH 12-digit TIN. Needed for 2307.',
          'Optional. Free text.',
          'Optional. Email format.',
          'Optional. Mobile or landline.',
          'Optional. WC158/WC160/WI160/WI010/WI011.',
          'Optional. 0-1 (e.g. 0.05 for 5%).',
          'Optional. Free text.',
        ],
      },
    );
  }

  // ── Ingredients (Raw Materials) Import — Sprint 19 ────────────────────────
  // For F&B / manufacturing tenants where COGS lives at the recipe level.
  // Ingredients (espresso beans, milk, flour) carry the cost per unit; the
  // Recipes importer then maps menu items to ingredients × quantity. Together
  // they replace the per-product Cost Price column on the Products import for
  // recipe-based businesses.
  //
  // Columns: Name*, Unit*, Cost per Unit (₱)*, Low Stock Alert, Notes
  //   ... plus two OPTIONAL columns: Recipe Unit, Pack Size.
  //
  // WHY THE SECOND UNIT EXISTS
  // A shop does not think in one unit. It BUYS milk by the litre and POURS it
  // by the millilitre; it buys beans by the kilo and pulls shots in grams.
  // Asking for a single unit forces the owner to do that conversion in his
  // head before he types, and when he gets it wrong nothing downstream
  // questions it — the cost is simply 1000x out and every recipe built on it
  // inherits the error silently.
  //
  // So the sheet accepts both, plus the pack size that bridges them, and the
  // importer does the arithmetic:
  //
  //   Name        Unit   Recipe Unit  Pack Size  Cost per Unit
  //   Fresh Milk  L      ml           -          88.00      -> 0.088 per ml
  //   Fresh Milk  carton ml           1000       88.00      -> 0.088 per ml
  //   Beans       kg     g            -          1100.00    -> 1.10  per g
  //
  // Both columns are optional and the old three-column sheet still imports
  // exactly as before, so no existing file breaks.

  async importIngredients(file: Express.Multer.File, tenantId: string): Promise<ImportResult> {
    return this.importIngredientsFromRows(await this.parseFile(file, ['Ingredients', 'Raw Materials']), tenantId);
  }

  private async importIngredientsFromRows(rows: string[][], tenantId: string): Promise<ImportResult> {
    const headerIdx = this.findHeaderRow(rows, ['Name*', 'Name']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart) {
      throw new BadRequestException('File must have a header row and at least one data row.');
    }

    // Resolved by HEADER, not position, so the seven-column sheets already in
    // the wild keep importing — they land as INGREDIENT, which is how they are
    // being treated today anyway.
    const headerRow = headerIdx >= 0 ? (rows[headerIdx] ?? []) : [];
    const catCol = headerRow.findIndex((h) => /^categor/i.test(String(h ?? '').trim()));

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    let dataRows = rows.slice(dataStart);
    if (dataRows.length > 0) {
      const looksLikeHints = (dataRows[0][0] ?? '').toLowerCase().includes('required');
      if (looksLikeHints) dataRows = dataRows.slice(1);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [name, unit, costStr, lowStockStr, notes, recipeUnitRaw, packSizeRaw] = dataRows[i];
      // Category is resolved by header rather than by position, so the
      // thousands of seven-column sheets already in the wild keep importing —
      // they simply land as INGREDIENT, which is what they are being treated
      // as today anyway.
      const categoryRaw = catCol >= 0 ? dataRows[i][catCol] : undefined;
      let category: 'INGREDIENT' | 'KITCHEN_SUPPLY' | 'BAR_SUPPLY' | 'OFFICE_SUPPLY' | undefined;
      if (categoryRaw != null && String(categoryRaw).trim() !== '') {
        // Accept what a person would actually type — "kitchen supply",
        // "Kitchen Supplies", "KITCHEN_SUPPLY" — and reject anything else by
        // name rather than silently filing it as food.
        const key = String(categoryRaw).trim().toUpperCase()
          .replace(/[\s-]+/g, '_').replace(/IES$/, 'Y').replace(/S$/, '');
        const map: Record<string, typeof category> = {
          INGREDIENT: 'INGREDIENT', INGREDIENTS: 'INGREDIENT', FOOD: 'INGREDIENT',
          KITCHEN_SUPPLY: 'KITCHEN_SUPPLY', KITCHEN: 'KITCHEN_SUPPLY',
          BAR_SUPPLY: 'BAR_SUPPLY', BAR: 'BAR_SUPPLY',
          OFFICE_SUPPLY: 'OFFICE_SUPPLY', OFFICE: 'OFFICE_SUPPLY',
        };
        category = map[key];
        if (!category) {
          result.errors.push({
            row: rowNum,
            message: `Category "${categoryRaw}" is not one of: Ingredient, `
              + 'Kitchen Supply, Bar Supply, Office Supply.',
          });
          continue;
        }
      }
      void notes; // currently unused — RawMaterial has no notes column

      if (!name?.trim()) { result.skipped++; continue; }
      if (!unit?.trim()) {
        result.errors.push({ row: rowNum, message: 'Unit is required (e.g. g, ml, kg, L, pc).' });
        continue;
      }
      // Cost per Unit drives recipe COGS, but a blank one must not reject the
      // row. A shop typically knows WHAT goes into a drink long before it has
      // priced every carton and cup, and rejecting here cascades: with no
      // ingredients created, every Recipes row then fails with "ingredient not
      // found" and the whole recipe structure is lost for a missing number.
      // Blank imports as 0 and is counted, so it stays visible; a non-numeric
      // value is still a real mistake and is rejected.
      const ingCostBlank = costStr == null || String(costStr).trim() === '';
      if (ingCostBlank) result.missingCost = (result.missingCost ?? 0) + 1;
      const costPrice = ingCostBlank ? 0 : this.num(costStr);
      if (isNaN(costPrice) || costPrice < 0) {
        result.errors.push({ row: rowNum, message: `Invalid Cost per Unit: "${costStr}".` });
        continue;
      }
      // ── Resolve buy-unit vs use-unit ───────────────────────────────────
      // Everything downstream — recipe COGS, stock deduction, low-stock
      // alerts — speaks ONE unit per ingredient. That unit is the one recipes
      // use, because that is the fine-grained one. The cost is converted into
      // it here, once, where the sheet still says plainly what was meant.
      let storedUnit = unit.trim();
      let storedCost = costPrice;

      const recipeUnit = (recipeUnitRaw ?? '').trim();
      const packSize = packSizeRaw != null && String(packSizeRaw).trim() !== ''
        ? this.num(packSizeRaw) : null;
      if (packSize != null && (isNaN(packSize) || packSize <= 0)) {
        result.errors.push({ row: rowNum, message: `Invalid Pack Size: "${packSizeRaw}". Leave it blank if the unit already says the size.` });
        continue;
      }

      if (recipeUnit && recipeUnit.toLowerCase() !== storedUnit.toLowerCase()) {
        const factor = this.unitFactor(storedUnit, recipeUnit);
        if (factor != null) {
          // Convertible outright: L -> ml is 1000, kg -> g is 1000.
          // A pack size here would double-count, so it is refused rather than
          // silently ignored — a shop that wrote both meant something.
          if (packSize != null) {
            result.errors.push({ row: rowNum, message:
              `"${storedUnit}" already converts to "${recipeUnit}", so Pack Size must be blank. ` +
              `Use Pack Size only when the buying unit is a container (pc, pack, carton, bottle).` });
            continue;
          }
          storedCost = ingCostBlank ? 0 : costPrice / factor;
          storedUnit = recipeUnit;
        } else if (packSize != null) {
          // A countable container: 1 carton holds 1000 ml, and the cost given
          // is per carton.
          storedCost = ingCostBlank ? 0 : costPrice / packSize;
          storedUnit = recipeUnit;
        } else {
          result.errors.push({ row: rowNum, message:
            `Cannot get from "${unit.trim()}" to "${recipeUnit}". ` +
            `Add a Pack Size saying how many ${recipeUnit} are in one ${unit.trim()}.` });
          continue;
        }
      }

      let lowStockAlert: number | null = null;
      if (lowStockStr && lowStockStr.trim()) {
        lowStockAlert = this.num(lowStockStr);
        if (isNaN(lowStockAlert) || lowStockAlert < 0) {
          result.errors.push({ row: rowNum, message: `Invalid Low Stock Alert: "${lowStockStr}".` });
          continue;
        }
      }

      try {
        const existing = await this.prisma.rawMaterial.findFirst({
          where: { tenantId, name: name.trim() },
        });
        const data = {
          tenantId,
          name:          name.trim(),
          // Only supplied when the sheet says so. A blank cell must not
          // re-file an item the owner has already categorised in the app.
          ...(category ? { category } : {}),
          // The RECIPE unit is what gets stored — it is the fine-grained one
          // every downstream calculation speaks. The buying unit did its job
          // above, converting the cost.
          unit:          storedUnit,
          costPrice:     new Prisma.Decimal(storedCost),
          lowStockAlert: lowStockAlert != null ? new Prisma.Decimal(lowStockAlert) : null,
          isActive:      true,
        };
        if (existing) {
          /*
            The same rule the app enforces: an item a recipe uses cannot be
            re-filed as a supply.

            inventory.service.updateRawMaterial refuses this, but the
            spreadsheet went straight to the row. It bites first on packaging —
            cups, lids and straws ARE in every drink BOM, and "Bar supply" is
            what a barista would naturally type against Cups. From that moment
            each case of cups expenses to 6210 while every latte sold still
            relieves 1051 for the cup inside its recipe, driving the asset
            negative at the rate the shop sells drinks.

            A row error rather than a throw: one bad cell must not abandon the
            other two hundred rows.
          */
          if (category && category !== 'INGREDIENT' && existing.category === 'INGREDIENT') {
            const [bom, variant, sub] = await Promise.all([
              this.prisma.bomItem.count({ where: { rawMaterialId: existing.id } }),
              this.prisma.variantBomItem.count({ where: { rawMaterialId: existing.id } }),
              this.prisma.subRecipeItem.count({ where: { rawMaterialId: existing.id } }),
            ]);
            const uses = bom + variant + sub;
            if (uses > 0) {
              result.errors.push({
                row: rowNum,
                message: `"${name.trim()}" is used in ${uses} recipe${uses === 1 ? '' : 's'}, so it `
                  + 'cannot be changed to a supply. If it is consumed with every item sold — a cup '
                  + 'or a lid — leave the Category blank or set it to Ingredient, so its cost stays '
                  + 'in what the drink costs.',
              });
              continue;
            }
          }

          // Same rule as products: a blank cell is "not supplied", not zero.
          // Blanking Cost per Unit used to write 0 over a cost the owner had
          // entered in the app, which silently zeroes recipe COGS for every
          // product using that ingredient.
          const { costPrice: _c, lowStockAlert: _l, ...rest } = data;
          await this.prisma.rawMaterial.update({
            where: { id: existing.id },
            data: {
              ...rest,
              ...(ingCostBlank ? {} : { costPrice: data.costPrice }),
              ...(lowStockAlert != null ? { lowStockAlert: data.lowStockAlert } : {}),
            },
          });
          result.updated++;
        } else {
          await this.prisma.rawMaterial.create({ data });
          result.imported++;
        }
      } catch (err: any) {
        result.errors.push({ row: rowNum, message: err.message ?? 'Unknown error' });
      }
    }
    return result;
  }

  /**
   * A worked example of the Loyverse "Item list" export, showing exactly which
   * columns we read. Owners who still have their Loyverse account should
   * upload their REAL export rather than filling this in — this exists so they
   * can see the expected shape, and so a shop without Loyverse access can hand
   * the same columns over by typing them.
   *
   * Sample rows are prefixed and skipped on import like every other template.
   */
  async loyverseTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Loyverse Item List',
      [
        'Item Name', 'Category', 'SKU', 'Barcode', 'Description',
        'Option1 Name', 'Option1 Value', 'Track stock',
        'Cost', 'Price', 'Price Main Store', 'In stock Main Store',
      ],
      [
        ['Cafe Latte', 'Hot Coffee', '10001', '4801234567890', 'House blend', 'Size', 'Small', 'Y', '18.50', '', '120', '25'],
        ['Cafe Latte', 'Hot Coffee', '10002', '4801234567891', 'House blend', 'Size', 'Large', 'Y', '24.00', '', '150', '12'],
        ['Hot Chocolate', 'Hot Coffee', '10003', '', '', '', '', 'Y', '20.00', '130', '', '8'],
        ['Blueberry Muffin', 'Pastries', '10004', '', '', '', '', 'N', '15.00', '75', '', ''],
      ],
      {
        title: 'Clerque — Loyverse Migration (sample of the Loyverse export)',
        instructions: [
          'Moving from Loyverse? Do NOT retype your catalog.',
          '',
          'How to use:',
          '  1. In Loyverse: Back office > Items > Export. Save the Item list file.',
          '  2. Upload THAT file unchanged via Settings > Import Templates > Import on the Loyverse row.',
          '  3. Column order does not matter and extra Loyverse columns are ignored — we match by column name.',
          '',
          'What happens to your data:',
          '  - Items with sizes/variants (Option columns) become one Clerque product each, e.g. "Cafe Latte - Large".',
          '  - Price is taken from the Price column; if it is blank we use your store price column.',
          '  - Stock on hand is carried over for items where Track stock = Y, summed across all your stores.',
          '  - Categories are created automatically as they appear.',
          '  - Barcode is used when present, otherwise the SKU.',
          '',
          'After migrating: check prices, then set up Ingredients and Recipes if you want true ingredient-level',
          'stock and COGS — Loyverse does not export recipes, so those are entered once in Clerque.',
        ],
      },
    );
  }

  async ingredientsTemplate(tenantId?: string): Promise<Buffer> {
    let businessType: string = 'RETAIL';
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { businessType: true },
      });
      businessType = tenant?.businessType ?? 'RETAIL';
    }

    let title = 'Clerque — Ingredients (Raw Materials) Import Template';
    let sampleRows: string[][];
    switch (businessType) {
      case 'COFFEE_SHOP':
        title = 'Clerque — Coffee Shop Ingredients Import Template';
        sampleRows = [
          ['Espresso Beans (Single-Origin)', 'g',   '0.65',  '500',   'Specialty 250g bag = ₱600 ÷ 250 ≈ ₱2.40 per gram; here we use whole beans bulk pricing'],
          ['Whole Milk',                     'ml',  '0.085', '2000',  'Magnolia 1L ≈ ₱85'],
          ['Soy Milk',                       'ml',  '0.18',  '1000',  'Vitasoy / oatside alternative'],
          ['Vanilla Syrup',                  'ml',  '0.95',  '500',   'Monin / Torani 750ml ≈ ₱700'],
          ['Caramel Syrup',                  'ml',  '0.95',  '500',   ''],
          ['Hot Cup 16oz',                   'pc',  '4.50',  '200',   'Paper cup with sleeve'],
          ['Cold Cup 16oz',                  'pc',  '5.00',  '200',   'Plastic cup'],
          ['Lid (universal)',                'pc',  '1.50',  '300',   ''],
          ['Stirrer',                        'pc',  '0.30',  '500',   ''],
          ['Sugar Sachet',                   'pc',  '0.50',  '300',   '5g'],
        ];
        break;
      case 'RESTAURANT':
      case 'BAKERY':
      case 'FOOD_STALL':
      case 'BAR_LOUNGE':
      case 'CATERING':
        title = 'Clerque — Restaurant Ingredients Import Template';
        sampleRows = [
          ['Jasmine Rice',     'g',  '0.055', '5000',  '50kg sack ≈ ₱2,750'],
          ['Pork Belly',       'g',  '0.42',  '2000',  '₱420 per kilo'],
          ['Chicken Thigh',    'g',  '0.32',  '2000',  '₱320 per kilo'],
          ['Onion',            'g',  '0.08',  '1000',  '₱80 per kilo'],
          ['Garlic',           'g',  '0.18',  '500',   '₱180 per kilo'],
          ['Soy Sauce',        'ml', '0.06',  '500',   'Datu Puti 1L ≈ ₱60'],
          ['Vinegar',          'ml', '0.05',  '500',   'Datu Puti 1L ≈ ₱50'],
          ['Cooking Oil',      'ml', '0.15',  '1000',  'Baguio 1L ≈ ₱150'],
          ['Iodized Salt',     'g',  '0.025', '500',   '500g pack ≈ ₱12'],
          ['Bottled Coke',     'pc', '22.00', '24',    'Coca-Cola 240ml glass'],
        ];
        break;
      case 'MANUFACTURING':
        title = 'Clerque — Manufacturing Raw Materials Import Template';
        sampleRows = [
          ['Pine Wood Plank',     'pc', '420',  '20',  '8ft x 1in x 6in'],
          ['Steel Bracket',       'pc', '85',   '50',  ''],
          ['Wood Screws (box)',   'pc', '180',  '10',  '500-pc box'],
          ['Wood Stain (Oak)',    'ml', '0.55', '1000','1L can ≈ ₱550'],
          ['Sandpaper 180-grit',  'pc', '12',   '50',  ''],
        ];
        break;
      default:
        title = 'Clerque — Ingredients / Raw Materials Import Template';
        sampleRows = [
          ['Sample Ingredient', 'g',  '0.50', '500',  'Cost = ₱0.50 per gram', '', ''],
        ];
        break;
    }

    // Two units, because a shop buys in one and cooks in another. Asking for
    // a single unit makes the OWNER do the conversion in his head before he
    // types — and when he gets it wrong the cost is 1000x out with nothing to
    // catch it. Let him write what he actually knows ("I buy milk by the
    // litre, I pour it by the millilitre") and do the arithmetic here.
    // Worked examples of the two-unit idea. They MUST carry the "Sample -"
    // prefix that isSampleRow() looks for, or the template ships three
    // phantom ingredients into every new shop that uploads it untouched.
    sampleRows = [
      ...sampleRows,
      ['Sample - Fresh Milk',   'L',      '88',   '5', 'Buy by the litre, pour by the ml', 'ml', ''],
      ['Sample - Coffee Beans', 'kg',     '1100', '2', 'Buy by the kilo, dose in grams',   'g',  ''],
      ['Sample - Oat Milk',     'carton', '95',   '6', 'A carton holds 1000 ml',           'ml', '1000'],
      ['Sample - Zonrox Bleach', 'L',      '62',   '',  'Not food — kept out of recipe costing', 'ml', '', 'Kitchen Supply'],
    ];

    return this.makeTemplate(
      'Ingredients',
      ['Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes',
       'Recipe Unit', 'Pack Size', 'Category'],
      sampleRows,
      {
        title,
        instructions: [
          'How to use:',
          '  1. List every ingredient / raw material your products are made from. Name must be unique.',
          '',
          '  2. THE TWO UNITS — this is the part worth getting right.',
          '     Unit*       = how you BUY it and count it on the shelf (L, kg, carton, pc, bottle).',
          '     Recipe Unit = how a RECIPE uses it (ml, g, pc). Leave blank if it is the same as Unit*.',
          '     Pack Size   = only when the buying unit is a container. How many Recipe Units are in one?',
          '',
          '     You buy milk by the litre and pour it by the millilitre:',
          '         Fresh Milk | L | 88.00 | Recipe Unit ml            -> we work out ₱0.088 per ml',
          '     You buy oat milk by the carton and a carton holds 1000 ml:',
          '         Oat Milk | carton | 95.00 | Recipe Unit ml | Pack Size 1000  -> ₱0.095 per ml',
          '     Salt is measured in grams and used in grams:',
          '         Salt | g | 0.06 | Recipe Unit blank',
          '',
          '     Write the cost as the price of ONE Unit* — one litre, one carton, one kilo.',
          '     Do NOT pre-divide it yourself. That is what this sheet is for.',
          '',
          '  3. Category (optional): Ingredient / Kitchen Supply / Bar Supply / Office Supply.',
          '     Blank means Ingredient, so leave it alone unless the row is NOT food.',
          '     Only an Ingredient can go into a recipe, so only an Ingredient reaches the',
          '     cost of a drink. Bleach, tissue, trash bags and a burner brush get bought,',
          '     counted and run out exactly like food — they are simply an expense, not a',
          '     cost of sale. Marking them keeps them out of your menu costing, and out of',
          '     the low-stock list you take shopping.',
          '',
          '  4. Low Stock Alert (optional): flagged when any branch falls below this, in Recipe Units.',
          '  5. Save as .xlsx (or .csv). Upload via Settings → Import Templates → Import.',
          '',
          'Next: once ingredients are loaded, the Recipes template maps menu items to ingredient quantities.',
          'Recipes may use any convertible unit — write "200 ml" even if the ingredient is stored in litres.',
        ],
        columnHints: [
          'Required. Unique within tenant.',
          'Required. How you BUY it: L / kg / carton / pc / bottle.',
          'REQUIRED. Price of ONE of the unit above. Do not pre-divide.',
          'Optional. Stock-low threshold, in Recipe Units.',
          'Optional. Free text.',
          'Optional. How a RECIPE uses it: ml / g / pc. Blank = same as Unit.',
          'Only for containers. How many Recipe Units in one Unit.',
          'Optional. Ingredient / Kitchen Supply / Bar Supply / Office Supply. Blank = Ingredient.',
        ],
      },
    );
  }

  /** Enum -> the words the import template asks for, so the file round-trips. */
  private static readonly CATEGORY_LABEL: Record<string, string> = {
    INGREDIENT:     'Ingredient',
    KITCHEN_SUPPLY: 'Kitchen Supply',
    BAR_SUPPLY:     'Bar Supply',
    OFFICE_SUPPLY:  'Office Supply',
  };

  /**
   * Export the tenant's ingredients as the Ingredients import file.
   *
   * The columns are the ones importIngredientsFromRows reads, in that order, so
   * the file round-trips: download it, change a price, upload it back. Nothing
   * else about the ingredient moves.
   *
   * Two details make that true rather than nearly-true:
   *
   *   Recipe Unit is written as the SAME unit the ingredient is stored in, and
   *   Pack Size is left blank. The importer only converts when the recipe unit
   *   DIFFERS from the buying unit, so writing them equal means the conversion
   *   branch never runs — the cost comes back exactly as it went out. Writing
   *   Recipe Unit blank would work too, but then a shop editing the file has
   *   no reminder of what the ingredient is actually measured in.
   *
   *   Names are written verbatim. The importer matches on an exact,
   *   case-sensitive name, so a name that survives the round trip is the whole
   *   point: it is what makes the downloaded file safe to re-upload instead of
   *   a way to accidentally create a second copy of every ingredient.
   */
  async ingredientsExport(tenantId: string): Promise<Buffer> {
    const materials = await this.prisma.rawMaterial.findMany({
      where:   { tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select:  { name: true, unit: true, costPrice: true, lowStockAlert: true, category: true },
    });

    const rows: string[][] = materials.map((m) => [
      m.name,
      m.unit,
      m.costPrice     != null ? String(m.costPrice)     : '',
      m.lowStockAlert != null ? String(m.lowStockAlert) : '',
      '',            // Notes — RawMaterial has no notes column to export
      m.unit,        // same as Unit*, so re-importing converts nothing
      '',            // Pack Size — for the same reason, must stay blank
      // Written in the words the template offers rather than the enum, so the
      // file reads the way the sheet asks for it. Omitting it entirely would
      // not destroy anything — a blank cell is "not supplied" on import — but
      // it would mean the one place you can see and change every category at
      // once could not show them.
      ImportService.CATEGORY_LABEL[m.category] ?? 'Ingredient',
    ]);

    const priced = materials.filter((m) => m.costPrice != null
                                        && Number(m.costPrice) > 0).length;

    return this.makeTemplate(
      'Ingredients',
      ['Name*', 'Unit*', 'Cost per Unit (₱)*', 'Low Stock Alert', 'Notes',
       'Recipe Unit', 'Pack Size', 'Category'],
      rows,
      {
        realData: true,
        title: 'Clerque — Your Ingredients (exported)',
        instructions: [
          `${materials.length} ingredients, ${priced} of them costed.`,
          '',
          'This is YOUR data, not a sample. Edit it and upload it back at',
          'Settings > Import > Ingredients — every row updates the ingredient it',
          'came from rather than creating a new one.',
          '',
          'Do NOT change anything in the Name column. Clerque finds an ingredient',
          'by its exact name, so an edited name creates a SECOND ingredient and',
          'leaves the original behind, with your recipes still pointing at it.',
          'To rename something, do it in the app instead.',
          '',
          'Leaving a cost blank is safe — the row is skipped, not zeroed. So you',
          'can fill in a few prices at a time and upload as often as you like.',
          '',
          'Buying in a bigger unit than the recipe uses? Put the buying unit in',
          'Unit*, the price of ONE of those in Cost per Unit, and the recipe unit',
          'in Recipe Unit — e.g. kg / 250 / g gives ₱0.25 per gram. For a carton',
          'or can, add the Pack Size saying how many recipe units are inside one.',
        ],
      },
    );
  }

  /**
   * Export the tenant's recipes as the Recipes import file.
   *
   * Same four columns the importer reads, Unit included, so it round-trips:
   * download, change a quantity, upload it back. The unit written is the
   * ingredient's OWN unit, which makes the number unambiguous and means
   * re-importing converts nothing.
   */
  async recipesExport(tenantId: string): Promise<Buffer> {
    const lines = await this.prisma.bomItem.findMany({
      where:   { product: { tenantId } },
      select:  {
        quantity:    true,
        product:     { select: { name: true } },
        rawMaterial: { select: { name: true, unit: true } },
      },
    });
    lines.sort((a, b) =>
      a.product.name.localeCompare(b.product.name)
      || a.rawMaterial.name.localeCompare(b.rawMaterial.name));

    const rows = lines.map((l) => [
      l.product.name,
      l.rawMaterial.name,
      String(l.quantity),
      l.rawMaterial.unit,
    ]);

    const products = new Set(lines.map((l) => l.product.name)).size;
    return this.makeTemplate(
      'Recipes',
      ['Product Name*', 'Ingredient Name*', 'Quantity*', 'Unit'],
      rows,
      {
        realData: true,
        title: 'Clerque — Your Recipes (exported)',
        instructions: [
          `${lines.length} recipe lines across ${products} products.`,
          '',
          'This is YOUR data, not a sample. Edit it and upload it back at',
          'Settings > Import > Recipes — each row updates the recipe line it came',
          'from, matched on Product + Ingredient.',
          '',
          'Unit is the unit the ingredient is stored in, so the quantities read',
          'unambiguously. Change it only if you want to write a quantity in a',
          'different unit — 0.2 with L instead of 200 with ml, say. Clerque',
          'converts, and refuses to cross weight and volume rather than guess.',
          '',
          'Do NOT edit the Product or Ingredient columns. Both are matched by',
          'name; an edited one either fails to find its target or attaches the',
          'line to the wrong thing.',
        ],
      },
    );
  }

  /**
   * The whole setup as ONE file — the same seven sheets the blank pack ships,
   * but filled in where the data exists.
   *
   * The blank pack answers "what do I have to fill in?". This answers "what do
   * I already have?", which is the question every shop after day one is
   * actually asking. Same sheet names, same columns, so the file that comes out
   * is the file the importer takes back.
   *
   * Ingredients and Recipes carry real rows. The rest ship as blank templates,
   * labelled as such on the Read Me: Products vary by business type and
   * Customers, Vendors and the Chart of Accounts are rarely bulk-edited, so
   * pretending to export them would cost more than it returns.
   */
  async setupPackExport(tenantId: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';

    const [ingredientCount, recipeCount] = await Promise.all([
      this.prisma.rawMaterial.count({ where: { tenantId, isActive: true } }),
      this.prisma.bomItem.count({ where: { product: { tenantId } } }),
    ]);

    const readme = wb.addWorksheet('Read Me');
    readme.getColumn(1).width = 96;
    const say = (text: string, bold = false, size = 11) => {
      const r = readme.addRow([text]);
      r.font = { bold, size };
    };
    say('Clerque — your setup, in one file', true, 16);
    say('');
    say('Edit any sheet and upload this SAME file at Settings > Import > Setup Pack.');
    say('Every sheet is read in order, so a recipe can reference an ingredient the');
    say('same upload just created.');
    say('');
    say('WHAT IS FILLED IN', true, 12);
    say(`  Ingredients   ${ingredientCount} rows — your own, with costs and units.`);
    say(`  Recipes       ${recipeCount} rows — your own, with the unit each quantity is in.`);
    say('');
    say('WHAT IS BLANK', true, 12);
    say('  Products, Customers, Vendors, Chart of Accounts ship as empty templates.');
    say('  Fill them only if you are adding to them; leaving a sheet blank changes');
    say('  nothing, it is simply skipped.');
    say('');
    say('THE ONE RULE', true, 12);
    say('Do not edit a Name column. Clerque matches ingredients, products and');
    say('recipes by name, so an edited name creates a second record and leaves the');
    say('original behind — with your recipes still pointing at it. Rename in the');
    say('app instead, then export again.', true);

    const bundled: Array<{ name: string; buf: Buffer }> = [
      { name: 'Ingredients',       buf: await this.ingredientsExport(tenantId) },
      { name: 'Recipes',           buf: await this.recipesExport(tenantId) },
      { name: 'Products',          buf: await this.productsTemplate(tenantId) },
      { name: 'Customers',         buf: await this.customersTemplate() },
      { name: 'Vendors',           buf: await this.vendorsTemplate() },
      { name: 'Chart of Accounts', buf: await this.coaTemplate() },
    ];

    for (const { name, buf } of bundled) {
      const srcWb = new ExcelJS.Workbook();
      await srcWb.xlsx.load(buf as any);
      const src = srcWb.worksheets[0];
      const dest = wb.addWorksheet(name);
      src.eachRow((row, rowIdx) => {
        const newRow = dest.getRow(rowIdx);
        newRow.values    = row.values as any;
        newRow.font      = row.font;
        newRow.fill      = row.fill;
        newRow.alignment = row.alignment;
        newRow.height    = row.height;
      });
      src.columns.forEach((col, i) => {
        dest.getColumn(i + 1).width = col.width ?? 20;
      });
      dest.views = src.views;
    }

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Recipes (BOM) Import — Sprint 19 ─────────────────────────────────────
  // Maps existing menu items (Products) to existing ingredients (RawMaterial)
  // with a per-line quantity. Run AFTER Products import + Ingredients import.
  // The product is auto-flipped to RECIPE_BASED so its COGS is derived from
  // ingredients × WAC at sale time, not from Product.costPrice.
  //
  // Columns: Product Name*, Ingredient Name*, Quantity*


  /**
   * Unit reconciliation for recipe rows.
   *
   * A recipe source says "200 ml milk". The Ingredients sheet may define Milk
   * in `ml` — or in `L`, because that is how the shop buys it. Writing 200
   * against an ingredient measured in litres puts 200 LITRES of milk in one
   * latte, and nothing downstream questions it: stock drains to zero, COGS
   * explodes, and the only clue is a wrong number in a report.
   *
   * The Recipes template therefore carries an optional Unit column, and this
   * reconciles it against the ingredient's own unit:
   *   - same unit (or blank)      -> use the quantity as written
   *   - convertible (ml -> L)     -> convert, silently and exactly
   *   - different families        -> reject the row, naming both units
   *
   * Deliberately conservative: only unambiguous units are listed. "oz" is
   * weight, "fl oz" is volume, and anything unrecognised (shot, scoop, pump,
   * sachet) is treated as a bare count that must match exactly — guessing a
   * shop's idea of a "scoop" would be worse than asking.
   */
  /**
   * How many `to` units fit in one `from` unit — 1000 for L to ml.
   *
   * Returns null when the two are not convertible (a "carton" is not a
   * quantity of anything until the sheet says how big it is), which is the
   * caller's cue to look for a Pack Size instead of guessing one.
   */
  /*
    Unit conversion moved to inventory/unit-conversion.ts.

    The app's own Add-ingredient form needs exactly this table and exactly
    these rules, and two copies that disagree is how the same ingredient ends
    up stocked twice under two units. These stay as thin private methods so
    every call site in this file is untouched; the answers now come from one
    place.
  */
  private unitFactor(from: string, to: string): number | null {
    return sharedUnitFactor(from, to);
  }

  private static readonly UNIT_FACTORS = SHARED_UNIT_FACTORS;

  /** Lowercase, strip punctuation/plurals so "Grams." and "gram" agree. */
  private normUnit(raw: string): string {
    return sharedNormUnit(raw);
  }

  /**
   * Convert `quantity` from `fromUnit` into `toUnit`.
   * Returns the converted number, or an error string the caller reports.
   */
  private convertRecipeQuantity(
    quantity: number,
    fromUnit: string | undefined,
    toUnit: string,
  ): { value: number } | { error: string } {
    const from = this.normUnit(fromUnit ?? '');
    const to   = this.normUnit(toUnit);

    // No unit given — trust the ingredient's own unit, as before.
    if (!from) return { value: quantity };
    if (from === to) return { value: quantity };

    const f = ImportService.UNIT_FACTORS[from];
    const t = ImportService.UNIT_FACTORS[to];

    if (!f || !t) {
      return {
        error:
          `Unit "${fromUnit}" does not match the ingredient's unit "${toUnit}". ` +
          "Use the ingredient's unit, or a convertible one (g/kg, ml/L).",
      };
    }
    if (f.family !== t.family) {
      return {
        error:
          `Cannot convert ${f.family} ("${fromUnit}") into ${t.family} ("${toUnit}"). ` +
          'Weigh it or measure it — pick one and match the ingredient.',
      };
    }
    // Exact ratio, then trimmed to the 4 decimals BomItem.quantity stores.
    const converted = (quantity * f.perBase) / t.perBase;
    return { value: Math.round(converted * 10_000) / 10_000 };
  }

  async importRecipes(file: Express.Multer.File, tenantId: string): Promise<ImportResult> {
    return this.importRecipesFromRows(await this.parseFile(file, ['Recipes', 'Recipe', 'BOM']), tenantId);
  }

  private async importRecipesFromRows(rows: string[][], tenantId: string): Promise<ImportResult> {
    const headerIdx = this.findHeaderRow(rows, ['Product Name*', 'Product Name']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart) {
      throw new BadRequestException('File must have a header row and at least one data row.');
    }

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    let dataRows = rows.slice(dataStart);
    if (dataRows.length > 0) {
      const looksLikeHints = (dataRows[0][0] ?? '').toLowerCase().includes('required');
      if (looksLikeHints) dataRows = dataRows.slice(1);
    }

    // Track every product a row touched (keyed by normalised name) so we can
    // flip ONLY the products whose rows ALL imported cleanly. Flipping a
    // product with a half-loaded BOM made an incomplete recipe the COGS
    // authority (Product.costPrice ignored from then on) with no warning.
    // If a row imports but the product is missing, we skip the row (no
    // auto-create — products must be loaded first).
    // Unit column is optional and header-resolved. When present it is
    // reconciled against the ingredient's own unit, so "200 ml" written
    // against an ingredient stored in litres converts to 0.2 instead of
    // silently becoming 200 LITRES of milk in one drink.
    const headerCells = headerIdx >= 0 ? (rows[headerIdx] ?? []) : [];
    const unitCol = headerCells.findIndex((h) => /^unit/i.test(String(h ?? '').trim()));

    const touched = new Map<string, { id?: string; name: string; firstRow: number; ok: number; failed: number }>();
    // Names are matched case-insensitively with whitespace collapsed --
    // "Whole Milk" vs "whole milk" failing to link is the #1 support call.
    const normName = (raw: string) => raw.trim().replace(/\s+/g, ' ');
    const track = (name: string, rowNum: number) => {
      const key = name.toLowerCase();
      if (!touched.has(key)) touched.set(key, { name, firstRow: rowNum, ok: 0, failed: 0 });
      return touched.get(key)!;
    };

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      const [productName, ingredientName, qtyStr] = dataRows[i];
      // Optional Unit column, resolved by header so it can sit anywhere.
      const unitStr = unitCol >= 0 ? dataRows[i][unitCol] : undefined;

      if (!productName?.trim() || !ingredientName?.trim()) { result.skipped++; continue; }
      const prodName = normName(productName);
      const ingName  = normName(ingredientName);
      const tracked  = track(prodName, rowNum);
      if (qtyStr == null || qtyStr.trim() === '') {
        result.errors.push({ row: rowNum, message: 'Quantity is required.' });
        tracked.failed++;
        continue;
      }
      const quantity = this.num(qtyStr);
      if (isNaN(quantity) || quantity <= 0) {
        result.errors.push({ row: rowNum, message: `Invalid Quantity "${qtyStr}". Must be > 0.` });
        tracked.failed++;
        continue;
      }

      try {
        const product = await this.prisma.product.findFirst({
          where:  { tenantId, name: { equals: prodName, mode: 'insensitive' } },
          select: { id: true },
        });
        if (!product) {
          result.errors.push({ row: rowNum, message: `Product "${productName}" not found. Run the Products import first.` });
          tracked.failed++;
          continue;
        }
        tracked.id = product.id;
        const rm = await this.prisma.rawMaterial.findFirst({
          where:  { tenantId, name: { equals: ingName, mode: 'insensitive' } },
          select: { id: true, unit: true, category: true },
        });
        if (!rm) {
          result.errors.push({ row: rowNum, message: `Ingredient "${ingredientName}" not found. Run the Ingredients import first.` });
          tracked.failed++;
          continue;
        }

        // Only an INGREDIENT may cost a menu item.
        //
        // Bleach, till roll and a burner brush are stocked, counted and run
        // out exactly like food, so nothing stopped one being written into a
        // recipe — and once there it lands in COGS, where an operating expense
        // does not belong. Refused by name rather than skipped, because a
        // recipe line naming detergent is a mistake worth seeing.
        // The column is NOT NULL DEFAULT 'INGREDIENT', so a missing value here
        // cannot mean "uncategorised" — it can only mean a caller did not
        // select it. This query does select it, so an absent value is read as
        // the default rather than as a reason to refuse a real recipe line.
        if (rm.category != null && rm.category !== 'INGREDIENT') {
          const label = String(rm.category).toLowerCase().replace(/_/g, ' ');
          result.errors.push({
            row: rowNum,
            message: `"${ingredientName}" is a ${label}, not an ingredient, so it `
              + 'cannot be part of a recipe. Supplies are an expense, not a cost of sale. '
              + 'Change its Category on the Ingredients sheet if that is wrong.',
          });
          tracked.failed++;
          continue;
        }

        // Reconcile the written unit against the ingredient's own.
        const reconciled = this.convertRecipeQuantity(quantity, unitStr, rm.unit);
        if ('error' in reconciled) {
          result.errors.push({ row: rowNum, message: reconciled.error });
          tracked.failed++;
          continue;
        }
        const finalQty = reconciled.value;
        if (finalQty <= 0) {
          result.errors.push({
            row: rowNum,
            message: `Quantity converts to ${finalQty} ${rm.unit} — too small to record. Use a smaller unit for this ingredient.`,
          });
          tracked.failed++;
          continue;
        }

        // Upsert the BOM row by (productId, rawMaterialId)
        const existing = await this.prisma.bomItem.findFirst({
          where: { productId: product.id, rawMaterialId: rm.id },
          select: { id: true },
        });
        if (existing) {
          await this.prisma.bomItem.update({
            where: { id: existing.id },
            data:  { quantity: new Prisma.Decimal(finalQty) },
          });
          result.updated++;
        } else {
          await this.prisma.bomItem.create({
            data: {
              productId:     product.id,
              rawMaterialId: rm.id,
              quantity:      new Prisma.Decimal(finalQty),
            },
          });
          result.imported++;
        }
        tracked.ok++;
      } catch (err: any) {
        result.errors.push({ row: rowNum, message: err.message ?? 'Unknown error' });
        tracked.failed++;
      }
    }

    // Flip to RECIPE_BASED ONLY the products whose rows all imported cleanly.
    // A product with any failed row keeps its current mode and gets a note so
    // the owner knows its recipe is incomplete and not yet the COGS source.
    const productsToFlip: string[] = [];
    for (const t of touched.values()) {
      if (!t.id || t.ok === 0) continue;
      if (t.failed > 0) {
        result.errors.push({
          row: t.firstRow,
          message: `Product "${t.name}": partially imported — not activated (${t.failed} of ${t.ok + t.failed} recipe rows failed). Fix those rows and re-import to switch it to recipe-based COGS.`,
        });
        continue;
      }
      productsToFlip.push(t.id);
    }
    if (productsToFlip.length > 0) {
      await this.prisma.product.updateMany({
        where: { id: { in: productsToFlip }, tenantId, inventoryMode: 'UNIT_BASED' },
        data:  { inventoryMode: 'RECIPE_BASED' },
      });
    }
    return result;
  }

  async recipesTemplate(tenantId?: string): Promise<Buffer> {
    let businessType: string = 'RETAIL';
    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: { businessType: true },
      });
      businessType = tenant?.businessType ?? 'RETAIL';
    }

    let title = 'Clerque — Recipes (BOM) Import Template';
    let sampleRows: string[][];
    switch (businessType) {
      case 'COFFEE_SHOP':
        title = 'Clerque — Coffee Shop Recipes Import Template';
        sampleRows = [
          ['Espresso Solo',     'Espresso Beans (Single-Origin)', '18', 'g'],
          ['Espresso Solo',     'Hot Cup 16oz',                   '1', 'pc'],
          ['Espresso Solo',     'Lid (universal)',                '1', 'pc'],
          ['Iced Latte 16oz',   'Espresso Beans (Single-Origin)', '18', 'g'],
          ['Iced Latte 16oz',   'Whole Milk',                     '180', 'ml'],
          ['Iced Latte 16oz',   'Cold Cup 16oz',                  '1', 'pc'],
          ['Iced Latte 16oz',   'Lid (universal)',                '1', 'pc'],
          ['Iced Latte 16oz',   'Stirrer',                        '1', 'pc'],
          ['Cappuccino 12oz',   'Espresso Beans (Single-Origin)', '18', 'g'],
          ['Cappuccino 12oz',   'Whole Milk',                     '150', 'ml'],
          ['Cappuccino 12oz',   'Hot Cup 16oz',                   '1', 'pc'],
          ['Cappuccino 12oz',   'Lid (universal)',                '1', 'pc'],
          ['Matcha Latte 16oz', 'Whole Milk',                     '200', 'ml'],
          ['Matcha Latte 16oz', 'Cold Cup 16oz',                  '1', 'pc'],
          ['Matcha Latte 16oz', 'Lid (universal)',                '1', 'pc'],
        ];
        break;
      case 'RESTAURANT':
      case 'BAKERY':
      case 'FOOD_STALL':
      case 'BAR_LOUNGE':
      case 'CATERING':
        title = 'Clerque — Restaurant Recipes Import Template';
        sampleRows = [
          ['Garlic Rice',     'Jasmine Rice',     '180', 'g'],
          ['Garlic Rice',     'Garlic',           '8', 'g'],
          ['Garlic Rice',     'Cooking Oil',      '15', 'ml'],
          ['Garlic Rice',     'Iodized Salt',     '2', 'g'],
          ['Tapsilog',        'Pork Belly',       '180', 'g'],
          ['Tapsilog',        'Jasmine Rice',     '180', 'g'],
          ['Tapsilog',        'Soy Sauce',        '15', 'ml'],
          ['Tapsilog',        'Garlic',           '5', 'g'],
          ['Adobong Manok',   'Chicken Thigh',    '250', 'g'],
          ['Adobong Manok',   'Soy Sauce',        '30', 'ml'],
          ['Adobong Manok',   'Vinegar',          '20', 'ml'],
          ['Adobong Manok',   'Garlic',           '10', 'g'],
          ['Adobong Manok',   'Onion',            '50', 'g'],
        ];
        break;
      default:
        title = 'Clerque — Recipes (BOM) Import Template';
        sampleRows = [
          ['Sample Product', 'Sample Ingredient', '10', 'g'],
        ];
        break;
    }

    return this.makeTemplate(
      'Recipes',
      // Unit is the fourth column and MUST be here.
      //
      // importRecipesFromRows locates it by matching /^unit/i against the
      // HEADER row (see unitCol). With only three headers shipped, that search
      // returned -1 and the unit was never read — while these instructions
      // promised conversion and the sample rows below already wrote 'g' / 'ml'
      // / 'pc' into a column that had no header. Anyone who followed the
      // instructions and wrote "200 ml" against milk stored in litres got 200
      // LITRES in one drink, silently, which is the exact failure the comment
      // above convertRecipeQuantity was written to prevent.
      ['Product Name*', 'Ingredient Name*', 'Quantity*', 'Unit'],
      sampleRows,
      {
        title,
        instructions: [
          'How to use:',
          '  1. One row per ingredient PER product. A drink with 5 ingredients = 5 rows for that product.',
          '  2. Product Name must match an existing Product (run the Products template first).',
          '  3. Ingredient Name must match an existing Ingredient (run the Ingredients template first).',
          '  4. Unit is OPTIONAL but recommended — write the unit your recipe actually uses (200 + ml).',
          "     If it differs from the ingredient's unit, Clerque converts it (200 ml -> 0.2 L).",
          "     Blank means the number is already in the ingredient's own unit.",
          '     Mismatched families are REFUSED, never guessed: you cannot pour 200 g of milk.',
          '  5. Importing a recipe FLIPS the product to RECIPE_BASED — its COGS now derives from ingredients × WAC at sale time.',
          '  6. Re-importing a row UPDATES the existing recipe line (matched by Product + Ingredient), not duplicates it.',
          '  7. Save as .xlsx (or .csv). Upload via Settings → Import Templates → Import.',
          '',
          'Order:  Ingredients → Products → Recipes  (in that order, every time).',
          '',
          'Tip: Cost is computed automatically. A 16oz latte with 18g beans @ ₱0.65/g + 200ml milk @ ₱0.085/ml + 1 cold cup @ ₱5 + 1 lid @ ₱1.50 + 1 stirrer @ ₱0.30 = ₱35.50 cost; if you sell at ₱150, gross margin is ~76%.',
        ],
        columnHints: [
          'Required. Existing Product name.',
          'Required. Existing Ingredient name.',
          'REQUIRED. Qty per finished item.',
          "Optional. The unit the RECIPE uses (g / ml / pc). Blank = the ingredient's own unit.",
        ],
      },
    );
  }

  // ── Stock Receipts bulk import ────────────────────────────────────────────
  // Columns: Date*, Ingredient or Product Name*, Quantity*, Unit Cost*, Branch
  //          (defaults to first branch if blank), Payment Method (CASH/CREDIT/
  //          OWNER_FUNDED — defaults to OWNER_FUNDED), Vendor, Reference#

  async stockReceiptsTemplate(): Promise<Buffer> {
    return this.makeTemplate(
      'Stock Receipts',
      [
        'Date* (YYYY-MM-DD)',
        'Ingredient/Product Name*',
        'Quantity*',
        'Unit Cost*',
        'Branch',
        'Payment Method',
        'Vendor',
        'Reference Number',
      ],
      [
        ['2026-05-01', 'Espresso Beans',  '5',   '500',  'Main Branch', 'CASH',         'Davao Coffee Beans', 'INV-2026-0123'],
        ['2026-05-02', 'Whole Milk 1L',   '24',  '85',   '',            'CREDIT',       'Suki Dairy',         'DR-4567'],
        ['2026-05-03', 'Iced Coffee Cups','100', '4.5',  '',            'OWNER_FUNDED', 'Local Supplier',     ''],
        ['2026-05-04', 'Sugar Syrup',     '6',   '120',  '',            'CASH',         '',                   ''],
      ],
      {
        title: 'Clerque — Stock Receipts Bulk Import',
        instructions: [
          'How to use:',
          '  1. One row per delivery line. Each row creates a new FIFO lot, updates ingredient stock, and posts',
          '     a journal entry (Dr 1050 Inventory / Cr Cash/AP/Owner equity based on Payment Method).',
          '  2. Date is the receipt date — used for FIFO ordering and respects period lock.',
          '  3. Ingredient/Product Name must match an existing ingredient (raw material) or product. Recipe-based',
          '     drinks pull cost from their recipe — if you receive a finished good (retail), the system updates',
          '     that product\'s WAC.',
          '  4. Quantity is in the ingredient\'s/product\'s native unit (g, ml, pc, etc). Unit Cost is per that unit.',
          '  5. Branch — leave blank to use your first active branch. Otherwise the exact branch name.',
          '  6. Payment Method:',
          '       CASH         — credits 1010 Cash on Hand',
          '       CREDIT       — credits 2010 Accounts Payable, creates an APBill if Vendor is set',
          '       OWNER_FUNDED — credits 3010 Owner\'s Capital (default if blank)',
          '  7. Reference Number is your supplier\'s DR/PO/invoice number — purely for audit traceability.',
          '     Idempotent: rows with a Reference already used on the same ingredient are skipped on re-upload.',
          '  8. Save as .xlsx (or .csv). Upload via POS → Inventory → Receive → Bulk Import.',
          'Tip: For ongoing daily purchases. For Day-1 opening balances use the Inventory template instead.',
        ],
        columnHints: [
          'Required. ISO format.',
          'Required. Must match existing.',
          'Required. Number > 0.',
          'Required. Per-unit cost (₱).',
          'Optional. Defaults to first branch.',
          'CASH / CREDIT / OWNER_FUNDED.',
          'Optional. Required if CREDIT.',
          'Optional. Idempotency key.',
        ],
      },
    );
  }

  /**
   * Parse the Date* cell of a stock-receipt row into a noon-PH-time Date.
   *
   * Accepts what a PH owner actually produces: a real Excel date (already
   * flattened to YYYY-MM-DD by cellToString), typed 'YYYY-MM-DD' (or
   * YYYY/MM/DD), and typed 'DD/MM/YYYY' (or DD-MM-YYYY / DD.MM.YYYY), read
   * day first. A value that is ALSO a valid month-first date with a different
   * meaning (05/06/2026: 5 June or 6 May?) is REJECTED, not guessed: Windows
   * en-PH / fil-PH and PH Excel default to M/d/yyyy, so a silently day-first
   * read would back-date real receipts and GL lines with no error shown.
   * The error text says which way round we read an unambiguous value when
   * that reading is invalid. Returns an error string instead of throwing: a
   * bad date is a row-level problem, never a 500.
   */
  private parseReceiptDate(raw: string): { date: Date } | { error: string } {
    const t = (raw ?? '').trim();
    if (!t) return { error: 'Date is required.' };
    let y: number, m: number, d: number;
    let readAs = '';
    let match: RegExpMatchArray | null;
    if ((match = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s].*)?$/))) {
      y = +match[1]; m = +match[2]; d = +match[3];
    } else if ((match = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/))) {
      d = +match[1]; m = +match[2]; y = +match[3];
      readAs = ' (read as DD/MM/YYYY, day first)';
      if (d !== m && d <= 12 && m <= 12) {
        const iso = (mo: number, da: number) => `${y}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
        return {
          error: `Ambiguous date: "${raw}" could be ${iso(m, d)} (day first) or ${iso(d, m)} (month first). Type it as YYYY-MM-DD.`,
        };
      }
    } else {
      return { error: `Invalid date: "${raw}". Use YYYY-MM-DD or DD/MM/YYYY (day first).` };
    }
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    const date = new Date(`${y}-${mm}-${dd}T12:00:00+08:00`);
    // Round-trip check rejects 31/02 and 13/25 style values (JS would roll over).
    if (isNaN(date.getTime()) || date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d) {
      return { error: `Invalid date: "${raw}"${readAs}. Use YYYY-MM-DD or DD/MM/YYYY (day first).` };
    }
    return { date };
  }

  async importStockReceipts(file: Express.Multer.File, tenantId: string, userId: string): Promise<ImportResult> {
    // Name the tab, like every other importer does. Without it a multi-sheet
    // workbook handed this endpoint its FIRST sheet — so an opening-stock file
    // that leads with a review tab parsed the review tab and failed with row
    // errors that pointed at nothing the owner recognised.
    const rows = await this.parseFile(file, ['Stock Receipts', 'Receipts', 'Stock Receipt']);
    const headerIdx = this.findHeaderRow(rows, ['Date*', 'Date* (YYYY-MM-DD)', 'Date']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart) {
      throw new BadRequestException('File must have a header row and at least one data row.');
    }

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    let dataRows = rows.slice(dataStart);
    if (dataRows.length > 0 && (dataRows[0][0] ?? '').toLowerCase().includes('required')) {
      dataRows = dataRows.slice(1);
    }

    // Pre-load tenant's first active branch for default routing.
    const defaultBranch = await this.prisma.branch.findFirst({
      where:   { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select:  { id: true, name: true },
    });
    if (!defaultBranch) {
      throw new BadRequestException('Tenant has no active branch. Create one before importing receipts.');
    }

    /*
      Whether this shop can claim the input tax back, resolved once for the
      whole sheet.

      `receiveRawMaterial` has always divided a VAT tenant's delivery cost by
      1.12 so the shelf, the lot, the WAC and the ledger all carry the same
      net basis. This path did not, so opening stock loaded from the workbook
      was capitalised GROSS while every later receive of the same ingredient
      was net -- two bases blended into one weighted average, and the input
      tax on the opening buy never claimed.

      OWNER_FUNDED is excluded on both paths for the same reason: stock the
      owner brought in has no supplier and no invoice, so there is no input
      tax to claim and inventing one would fabricate a receivable from the BIR.
    */
    const tenantTax = await this.prisma.tenant.findUnique({
      where:  { id: tenantId },
      select: { taxStatus: true },
    });
    const tenantIsVat = tenantTax?.taxStatus === 'VAT';

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 2;
      if (this.isSampleRow(dataRows[i])) { result.skipped++; continue; }
      // Every cell is guarded with (x ?? '') -- a short row (blank trailing
      // cells dropped by the parser) used to make .trim() throw on undefined,
      // which 500'd the WHOLE import instead of reporting one bad row.
      const [dateStr, name, qtyStr, costStr, branchName, paymentMethodRaw, vendorName, refNumber] =
        Array.from({ length: 8 }, (_, c) => (dataRows[i][c] ?? '').trim());
      if (!name) { result.skipped++; continue; }

      const parsedDate = this.parseReceiptDate(dateStr);
      if ('error' in parsedDate) {
        result.errors.push({ row: rowNum, message: parsedDate.error });
        continue;
      }
      const { date } = parsedDate;

      // Period lock. The single-receipt path checks this before any write
      // (inventory.service.ts:1256); this bulk path did not, so a spreadsheet
      // could post stock into a month that was already closed and reconciled.
      //
      // Checked PER ROW, not once per file, because a receipt sheet routinely
      // spans a close boundary — only the locked rows should be refused.
      if (!this.periods) {
        throw new BadRequestException(
          'Stock receipt import is unavailable: the accounting-period service is not wired up.',
        );
      }
      try {
        await this.periods.assertDateIsOpen(tenantId, date);
      } catch (err) {
        result.errors.push({
          row: rowNum,
          message: err instanceof Error ? err.message
            : `The accounting period covering ${dateStr} is closed.`,
        });
        continue;
      }
      const qty = this.num(qtyStr);
      const cost = this.num(costStr);
      if (isNaN(qty) || qty <= 0) {
        result.errors.push({ row: rowNum, message: `Invalid quantity: "${qtyStr}".` });
        continue;
      }
      if (isNaN(cost) || cost < 0) {
        result.errors.push({ row: rowNum, message: `Invalid unit cost: "${costStr}".` });
        continue;
      }

      const paymentMethod = (paymentMethodRaw?.trim().toUpperCase() || 'OWNER_FUNDED') as 'CASH' | 'CREDIT' | 'OWNER_FUNDED';
      if (!['CASH', 'CREDIT', 'OWNER_FUNDED'].includes(paymentMethod)) {
        result.errors.push({ row: rowNum, message: `Invalid payment method: "${paymentMethodRaw}". Use CASH, CREDIT, or OWNER_FUNDED.` });
        continue;
      }

      /*
        What the shelf is worth (net), what the BIR gives back, and what
        actually left the till. Same three numbers, same rule, as the receive
        form -- see receiveRawMaterial.
      */
      const recoversInputVat = tenantIsVat && paymentMethod !== 'OWNER_FUNDED';
      const netCost   = recoversInputVat ? cost / 1.12 : cost;
      const grossCost = cost;

      // Resolve branch
      let branchId = defaultBranch.id;
      if (branchName?.trim()) {
        const b = await this.prisma.branch.findFirst({
          where: { tenantId, name: branchName.trim(), isActive: true },
        });
        if (!b) {
          result.errors.push({ row: rowNum, message: `Branch not found: "${branchName}".` });
          continue;
        }
        branchId = b.id;
      }

      // Resolve raw material by name
      const rm = await this.prisma.rawMaterial.findFirst({
        where: { tenantId, name: name.trim(), isActive: true },
      });
      if (!rm) {
        result.errors.push({ row: rowNum, message: `Ingredient/Product not found: "${name}". Create it first.` });
        continue;
      }

      // Idempotency: skip if a lot with this referenceNumber on this rawMaterial already exists.
      if (refNumber?.trim()) {
        const dup = await this.prisma.rawMaterialLot.findFirst({
          where: { tenantId, rawMaterialId: rm.id, referenceNumber: refNumber.trim() },
        });
        if (dup) { result.skipped++; continue; }
      }

      try {
        await this.prisma.$transaction(async (tx) => {
          // Update RawMaterial WAC
          const oldQty = await tx.rawMaterialInventory.findUnique({
            where: { branchId_rawMaterialId: { branchId, rawMaterialId: rm.id } },
            select: { quantity: true },
          });
          const oldOnHand = oldQty ? Number(oldQty.quantity) : 0;
          const newOnHand = oldOnHand + qty;

          // WAC update on RawMaterial
          const oldWac = rm.costPrice ? Number(rm.costPrice) : 0;
          const newWac = newOnHand > 0
            ? ((oldOnHand * oldWac) + (qty * netCost)) / newOnHand
            : netCost;
          await tx.rawMaterial.update({
            where: { id: rm.id },
            data:  { costPrice: new Prisma.Decimal(newWac) },
          });

          // RawMaterialInventory update
          await tx.rawMaterialInventory.upsert({
            where:  { branchId_rawMaterialId: { branchId, rawMaterialId: rm.id } },
            update: { quantity: new Prisma.Decimal(newOnHand) },
            create: { tenantId, branchId, rawMaterialId: rm.id, quantity: new Prisma.Decimal(newOnHand) },
          });

          // FIFO lot
          await tx.rawMaterialLot.create({
            data: {
              tenantId,
              branchId,
              rawMaterialId:   rm.id,
              qtyReceived:     new Prisma.Decimal(qty),
              qtyRemaining:    new Prisma.Decimal(qty),
              unitCost:        new Prisma.Decimal(netCost),
              receivedAt:      date,
              referenceNumber: refNumber?.trim() || null,
              paymentMethod,
            },
          });

          // Ripple new WAC into all products that use this ingredient
          const affectedBom = await tx.bomItem.findMany({
            where:    { rawMaterialId: rm.id, product: { tenantId } },
            select:   { productId: true },
            distinct: ['productId'],
          });
          for (const { productId } of affectedBom) {
            const allBom = await tx.bomItem.findMany({
              where:  { productId },
              select: { quantity: true, rawMaterial: { select: { costPrice: true } } },
            });
            const newProductCost = allBom.reduce(
              (sum, b) => sum + (b.rawMaterial?.costPrice != null ? Number(b.rawMaterial.costPrice) : 0) * Number(b.quantity),
              0,
            );
            await tx.product.update({
              where: { id: productId },
              data:  { costPrice: new Prisma.Decimal(newProductCost.toFixed(4)) },
            });
          }

          // Accounting event for the JE (Dr 1050 / Cr Cash/AP/Owner)
          const totalValue = qty * netCost;
          await tx.accountingEvent.create({
            data: {
              tenantId,
              type:    'INVENTORY_ADJUSTMENT',
              status:  'PENDING',
              payload: {
                kind:           'RAW_MATERIAL_RECEIPT',
                rawMaterialId:  rm.id,
                rawMaterialName: rm.name,
                /*
                  What the thing IS. Without this the journal handler falls
                  back to INGREDIENT and debits 1051 Raw Materials for EVERY
                  bulk-imported receipt, supplies included — and a supply can
                  never be relieved, because it cannot be in a recipe and its
                  reductions post nothing. That is a balance nothing can ever
                  clear, arriving through the first path a new tenant uses.
                  The whole row is already loaded above.
                */
                category:       rm.category,
                productName:    rm.name,
                adjustmentType: 'STOCK_IN',
                quantity:       qty,
                totalValue,
                costPrice:      netCost,
                inputVat:       +((qty * grossCost) - (qty * netCost)).toFixed(2),
                grossValue:     +(qty * grossCost).toFixed(2),
                paymentMethod,
                branchId,
                receivedAt:     date.toISOString(),
                referenceNumber: refNumber?.trim() || null,
                vendorName:     vendorName?.trim() || null,
                source:         'BULK_IMPORT',
                userId,
              } as Prisma.JsonObject,
            },
          });
        }, { maxWait: 10_000, timeout: 30_000 });

        result.imported++;
      } catch (err) {
        result.errors.push({ row: rowNum, message: (err as Error).message ?? 'Unknown error' });
      }
    }

    return result;
  }
}
