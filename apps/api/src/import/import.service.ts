import { Injectable, BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
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

  // ── Helper: parse xlsx or csv buffer into row arrays ──
  private async parseFile(file: Express.Multer.File): Promise<string[][]> {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    if (ext === 'csv') {
      const text = file.buffer.toString('utf-8');
      return text
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
    }
    // xlsx
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer);
    const ws = wb.worksheets[0];
    const rows: string[][] = [];
    ws.eachRow((row) => {
      rows.push(
        (row.values as (string | number | null | undefined)[])
          .slice(1)
          .map((v) => (v == null ? '' : String(v))),
      );
    });
    return rows;
  }

  // ── Helper: generate Excel template buffer ──
  private async makeTemplate(
    sheetName: string,
    headers: string[],
    sampleRows: string[][],
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    const ws = wb.addWorksheet(sheetName);
    // Header row
    ws.addRow(headers);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1E293B' },
    };
    ws.getRow(1).font = { bold: true, color: { argb: 'FF00D1FF' } };
    // Sample rows
    sampleRows.forEach((r) => ws.addRow(r));
    // Auto-width
    headers.forEach((_, i) => {
      ws.getColumn(i + 1).width = 20;
    });
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ── Products Import ─────────────────────────────────────────────────────────
  // Expected columns: Name*, Category, Price*, Cost Price, VAT (Y/N), Barcode, Description
  async importProducts(
    file: Express.Multer.File,
    tenantId: string,
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
    const dataRows = rows.slice(1); // skip header

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
      const costPrice = parseFloat(costStr) || 0;
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
        'Cost Price',
        'VAT (Y/N)',
        'Barcode',
        'Description',
      ],
      [
        [
          'Garlic Rice',
          'Food',
          '35',
          '12',
          'Y',
          '',
          'Steamed garlic fried rice',
        ],
        ['Bottled Water', 'Drinks', '20', '8', 'N', '123456789', '500ml'],
      ],
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
      ['Product Name*', 'Quantity*', 'Low Stock Alert'],
      [
        ['Garlic Rice', '100', '10'],
        ['Bottled Water', '200', '20'],
      ],
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

        await this.prisma.journalEntry.create({
          data: {
            tenantId,
            reference: ref,
            description: group.description,
            entryDate: new Date(group.date),
            status: 'POSTED',
            source: 'MANUAL',
            createdById: userId,
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
        [
          'JE-2026-001',
          '2026-04-26',
          'Office supplies purchase',
          '6100',
          '500',
          '',
          'Paper and pens',
        ],
        [
          'JE-2026-001',
          '2026-04-26',
          'Office supplies purchase',
          '1010',
          '',
          '500',
          'Cash payment',
        ],
        [
          'JE-2026-002',
          '2026-04-26',
          'Rent expense April',
          '6200',
          '15000',
          '',
          '',
        ],
        [
          'JE-2026-002',
          '2026-04-26',
          'Rent expense April',
          '1010',
          '',
          '15000',
          '',
        ],
      ],
    );
  }
}
