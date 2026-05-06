import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ImportResult {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; message: string }[];
}

@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Helper: parse xlsx or csv buffer into row arrays (first sheet only) ──
  private async parseFile(file: Express.Multer.File): Promise<string[][]> {
    const all = await this.parseAllSheets(file);
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
      const text = file.buffer.toString('utf-8');
      result.set('Sheet1', text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))));
      return result;
    }
    const wb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(file.buffer as any);
    for (const ws of wb.worksheets) {
      const rows: string[][] = [];
      ws.eachRow((row) => {
        rows.push(
          (row.values as (string | number | null | undefined)[])
            .slice(1)
            .map((v) => (v == null ? '' : String(v))),
        );
      });
      result.set(ws.name, rows);
    }
    return result;
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
   *   Row N+4..        — sample data rows
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
    if (opts.instructions?.length) {
      for (const line of opts.instructions) {
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
    for (const r of sampleRows) {
      ws.getRow(cursor).values = r;
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
    const rows = await this.parseFile(file);
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
    if (dataRows.length > 0) {
      const priceCellLooksNumeric = !isNaN(parseFloat(dataRows[0][2] ?? ''));
      if (!priceCellLooksNumeric) dataRows = dataRows.slice(1);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = i + 2;
      const [name, categoryName, priceStr, costStr, vatStr, barcode, description] =
        dataRows[i];

      if (!name?.trim()) {
        result.skipped++;
        continue;
      }
      const price = parseFloat(priceStr);
      if (isNaN(price) || price < 0) {
        result.errors.push({
          row: rowNum,
          message: `Invalid price: "${priceStr}"`,
        });
        continue;
      }
      // Cost Price is REQUIRED — drives COGS posting.
      // Empty / non-numeric is rejected. Explicit 0 is allowed (free items).
      if (costStr == null || costStr === '' || costStr.trim?.() === '') {
        result.errors.push({
          row: rowNum,
          message: 'Cost Price is required (column 4). Enter 0 only if the item is genuinely free.',
        });
        continue;
      }
      const costPrice = parseFloat(costStr);
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

      try {
        // Find or create category
        let categoryId: string | undefined;
        if (categoryName?.trim()) {
          const cat = await this.prisma.category
            .upsert({
              where: {
                tenantId_name: { tenantId, name: categoryName.trim() },
              } as any,
              update: {},
              create: { tenantId, name: categoryName.trim() },
            })
            .catch(async () => {
              return this.prisma.category.findFirst({
                where: { tenantId, name: categoryName.trim() },
              });
            });
          categoryId = cat?.id;
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

        if (existing) {
          await this.prisma.product.update({
            where: { id: existing.id },
            data: {
              price,
              costPrice,
              isVatable,
              ...(categoryId && { categoryId }),
              ...(description?.trim() && { description: description.trim() }),
              ...(barcode?.trim() && { barcode: barcode.trim() }),
            },
          });
          result.updated++;
        } else {
          await this.prisma.product.create({
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

  async productsTemplate(): Promise<Buffer> {
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
      ],
      [
        ['Garlic Rice',     'Food',    '35',  '12',  'Y', '',           'Steamed garlic fried rice'],
        ['Bottled Water',   'Drinks',  '20',  '8',   'N', '4806507000123', '500ml'],
        ['Iced Latte 16oz', 'Drinks',  '110', '35',  'Y', '',           'Espresso + cold milk + ice'],
        ['Plain Donut',     'Bakery',  '25',  '9',   'N', '',           'Sugar-glazed cake donut'],
      ],
      {
        title: 'Clerque — Product Master Import Template',
        instructions: [
          'How to use:',
          '  1. Fill the rows below the headers. Remove the sample rows when you\'re ready.',
          '  2. Columns marked with * are required. Existing products are matched by Name (or Barcode if provided) and updated.',
          '  3. Cost Price is REQUIRED. It drives COGS posting on every sale. Enter 0 for complimentary items.',
          '  4. VAT column accepts Y / Yes / 1 / true (case-insensitive) for VAT-able items; anything else means no VAT.',
          '  5. Category — if it doesn\'t exist yet, Clerque creates it. Use consistent spelling across rows.',
          '  6. Save as .xlsx (or .csv). Upload via POS → Products → Import.',
          'Tip: After import, head to Inventory and import opening stock for each branch using the Inventory template.',
        ],
        columnHints: [
          'Required. Unique within tenant.',
          'Optional. Auto-creates if new.',
          'Required. Selling price (₱).',
          'REQUIRED. Unit cost (₱) for COGS.',
          'Y or N. Default N.',
          'Optional. EAN-13 / UPC etc.',
          'Optional. Free text.',
        ],
      },
    );
  }

  // ── Inventory Import ────────────────────────────────────────────────────────
  // Expected columns: Product Name* OR Barcode*, Quantity*, Low Stock Alert
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
    if (dataRows.length > 0) {
      const qtyLooksNumeric = !isNaN(parseFloat(dataRows[0][1] ?? ''));
      if (!qtyLooksNumeric) dataRows = dataRows.slice(1);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = i + 2;
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
      const col2IsNum = !isNaN(parseFloat(barcodeOrQty));
      if (col2IsNum) {
        qty = parseFloat(barcodeOrQty);
        lowAlert = parseFloat(qtyOrAlert) || 0;
      } else {
        qty = parseFloat(qtyOrAlert);
        lowAlert = parseFloat(alertStr) || 0;
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
    const dataRows = rows.slice(1);

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
      const rowNum = i + 2;
      const [ref, date, description, accountCode, debitStr, creditStr, memo] =
        dataRows[i];
      if (!ref?.trim()) {
        result.skipped++;
        continue;
      }
      const debit = parseFloat(debitStr) || 0;
      const credit = parseFloat(creditStr) || 0;
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
                memo: l.memo,
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
    const rows = await this.parseFile(file);
    if (rows.length < 2)
      throw new BadRequestException('File must have a header row and at least one data row.');

    const VALID_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
    type AcctType = typeof VALID_TYPES[number];

    function deriveNormalBalance(type: AcctType): 'DEBIT' | 'CREDIT' {
      return type === 'ASSET' || type === 'EXPENSE' ? 'DEBIT' : 'CREDIT';
    }

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    const dataRows = rows.slice(1);

    // Build a local code → id map for parent resolution (includes existing + rows above current)
    const existingMap = new Map<string, { id: string; isSystem: boolean }>();
    const existing = await this.prisma.account.findMany({
      where:  { tenantId },
      select: { id: true, code: true, isSystem: true },
    });
    for (const a of existing) existingMap.set(a.code, { id: a.id, isSystem: a.isSystem });

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = i + 2;
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
          '  6. Sample rows below are EXAMPLES of typical additions. Replace with your own; remove sample rows before importing.',
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
  async setupPackTemplate(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';

    // ── Read Me sheet ──
    const readme = wb.addWorksheet('Read Me');
    readme.mergeCells('A1:F1');
    const t = readme.getCell('A1');
    t.value = 'Clerque — Business Setup Pack';
    t.font  = { bold: true, size: 16, color: { argb: 'FF8B5E3C' } };
    readme.getRow(1).height = 26;
    const lines = [
      '',
      'This single file lets you stand up your product catalog and opening stock in one upload.',
      '',
      'Step 1 — Fill the "Products" sheet with every SKU you sell.',
      '         Required: Name, Selling Price, Cost Price.',
      '         Cost Price drives gross profit reporting — DO NOT leave it blank.',
      '',
      'Step 2 — Fill the "Inventory" sheet with the on-hand quantity for each product at this branch.',
      '         Match by Product Name or Barcode. The quantity overwrites whatever is currently recorded.',
      '',
      'Step 3 — Save. Go to POS → Inventory → "Import Setup Pack" → upload this file.',
      '         Clerque will (a) create/update your products from sheet 1, then (b) set opening stock from sheet 2.',
      '',
      'Notes:',
      '  • Categories are auto-created if they don\'t exist.',
      '  • VAT column is Y/N. Most retail items in PH = Y (VAT-able).',
      '  • If you have multiple branches, run this for each branch (switch branch in POS first).',
      '  • Errors per row are reported back so you can fix and re-upload — safe to re-run.',
    ];
    for (const line of lines) {
      readme.addRow([line]);
    }
    readme.getColumn(1).width = 110;
    for (let i = 2; i <= readme.rowCount; i++) {
      readme.getRow(i).font = { color: { argb: 'FF333333' }, size: 11 };
      readme.getRow(i).alignment = { wrapText: true };
    }

    // ── Products sheet ──
    const productsBuf = await this.productsTemplate();
    const productsWb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await productsWb.xlsx.load(productsBuf as any);
    const productsSheet = productsWb.worksheets[0];
    const ws1 = wb.addWorksheet('Products');
    productsSheet.eachRow((row, rowIdx) => {
      const newRow = ws1.getRow(rowIdx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newRow.values = row.values as any;
      // copy basic styling
      newRow.font      = row.font;
      newRow.fill      = row.fill;
      newRow.alignment = row.alignment;
      newRow.height    = row.height;
    });
    productsSheet.columns.forEach((col, i) => {
      ws1.getColumn(i + 1).width = col.width ?? 20;
    });
    ws1.views = productsSheet.views;

    // ── Inventory sheet ──
    const invBuf = await this.inventoryTemplate();
    const invWb = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await invWb.xlsx.load(invBuf as any);
    const invSheet = invWb.worksheets[0];
    const ws2 = wb.addWorksheet('Inventory');
    invSheet.eachRow((row, rowIdx) => {
      const newRow = ws2.getRow(rowIdx);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newRow.values = row.values as any;
      newRow.font      = row.font;
      newRow.fill      = row.fill;
      newRow.alignment = row.alignment;
      newRow.height    = row.height;
    });
    invSheet.columns.forEach((col, i) => {
      ws2.getColumn(i + 1).width = col.width ?? 20;
    });
    ws2.views = invSheet.views;

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  /**
   * Run the Setup Pack import: parse both sheets and call the per-sheet
   * importers in order (Products first so the SKUs exist before Inventory
   * tries to look them up). Returns a combined report.
   */
  async importSetupPack(
    file: Express.Multer.File,
    tenantId: string,
    branchId: string,
  ): Promise<{
    products:  ImportResult & { notIncluded: boolean };
    inventory: ImportResult & { notIncluded: boolean };
  }> {
    const sheets = await this.parseAllSheets(file);
    const productsRows  = sheets.get('Products')  ?? sheets.get('products')  ?? null;
    const inventoryRows = sheets.get('Inventory') ?? sheets.get('inventory') ?? null;

    if (!productsRows && !inventoryRows) {
      throw new BadRequestException(
        'Setup Pack must contain at least a "Products" or "Inventory" sheet.',
      );
    }

    let products: ImportResult & { notIncluded: boolean } = {
      imported: 0, updated: 0, skipped: 0, errors: [], notIncluded: true,
    };
    let inventory: ImportResult & { notIncluded: boolean } = {
      imported: 0, updated: 0, skipped: 0, errors: [], notIncluded: true,
    };

    if (productsRows) {
      const r = await this.importProductsFromRows(productsRows, tenantId);
      products = { ...r, notIncluded: false };
    }
    if (inventoryRows) {
      const r = await this.importInventoryFromRows(inventoryRows, tenantId, branchId);
      inventory = { ...r, notIncluded: false };
    }

    return { products, inventory };
  }

  // ── Customers Import (AR master) ────────────────────────────────────────
  // Columns: Name*, TIN, Address, Email, Phone, Credit Term Days, Credit Limit, Notes

  async importCustomers(file: Express.Multer.File, tenantId: string): Promise<ImportResult> {
    const rows = await this.parseFile(file);
    const headerIdx = this.findHeaderRow(rows, ['Name*', 'Name']);
    const dataStart = headerIdx >= 0 ? headerIdx + 1 : 1;
    if (rows.length <= dataStart)
      throw new BadRequestException('File must have a header row and at least one data row.');

    const result: ImportResult = { imported: 0, updated: 0, skipped: 0, errors: [] };
    let dataRows = rows.slice(dataStart);
    if (dataRows.length > 0) {
      const looksLikeHints = isNaN(parseFloat(dataRows[0][5] ?? '')) && (dataRows[0][0] ?? '').toLowerCase().includes('required');
      if (looksLikeHints) dataRows = dataRows.slice(1);
    }

    for (let i = 0; i < dataRows.length; i++) {
      const rowNum = dataStart + i + 2;
      const [name, tin, address, email, phone, termsStr, limitStr, notes] = dataRows[i];
      if (!name?.trim()) { result.skipped++; continue; }

      const creditTermDays = termsStr ? parseInt(termsStr, 10) : 0;
      if (termsStr && (isNaN(creditTermDays) || creditTermDays < 0)) {
        result.errors.push({ row: rowNum, message: `Invalid credit term days: "${termsStr}"` });
        continue;
      }
      const creditLimit = limitStr ? parseFloat(limitStr) : null;
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
          await this.prisma.customer.update({ where: { id: existing.id }, data });
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
    const rows = await this.parseFile(file);
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
      const [name, tin, address, email, phone, atcCode, whtRateStr, notes] = dataRows[i];
      if (!name?.trim()) { result.skipped++; continue; }

      let whtRate: number | null = null;
      if (whtRateStr && whtRateStr.trim()) {
        whtRate = parseFloat(whtRateStr);
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
          await this.prisma.vendor.update({ where: { id: existing.id }, data });
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
}
