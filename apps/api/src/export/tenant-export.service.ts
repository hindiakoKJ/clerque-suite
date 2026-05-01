/**
 * TenantExportService — one-click "download all my data" export.
 *
 * Returns a single .xlsx with one sheet per major table. For an MSME
 * (under ~50k rows total) this is fast and synchronous. Larger tenants
 * should move this to a BullMQ job with a signed-URL download — left
 * as a follow-up if/when we hit the size limit.
 *
 * Sensitive fields stripped:
 *   - User.passwordHash, refreshTokenHash, twoFactorSecret, supervisorPinHash, passwordResetToken
 *   - SubscriptionLog payment metadata (we don't store CC numbers anyway)
 *
 * What's included: every business-relevant table the tenant created.
 * What's excluded: shared system tables (PH gov tables, system roles).
 */

import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TenantExportService {
  constructor(private prisma: PrismaService) {}

  async exportAllData(tenantId: string): Promise<{ buffer: Buffer; filename: string }> {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { name: true, slug: true },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Clerque';
    wb.created = new Date();

    // ── Cover sheet ─────────────────────────────────────────────────────
    const cover = wb.addWorksheet('Read Me');
    cover.mergeCells('A1:F1');
    cover.getCell('A1').value = `Clerque — Full Data Export: ${tenant.name}`;
    cover.getCell('A1').font  = { bold: true, size: 16, color: { argb: 'FF8B5E3C' } };
    cover.getRow(1).height = 26;
    [
      '',
      `Tenant slug: ${tenant.slug}`,
      `Generated: ${new Date().toLocaleString('en-PH')}`,
      '',
      'Each subsequent sheet is one database table. Sensitive fields (password hashes,',
      'refresh tokens, 2FA secrets, supervisor PIN hashes, password reset tokens) have',
      'been stripped from the User export.',
      '',
      'This file contains EVERYTHING in your account. Treat it as confidential.',
      'For a partial export (single report), use the per-page Download .xlsx buttons.',
      '',
      'Sheets included:',
      '  Tenant, Branches, Users, AppAccess, Customers, Vendors,',
      '  Categories, Products, Inventory, RawMaterials, ProductBOM,',
      '  Orders, OrderItems, OrderPayments,',
      '  Accounts (COA), JournalEntries, JournalLines, AccountingPeriods,',
      '  ARInvoices, ARInvoiceLines, ARPayments,',
      '  APBills, APBillLines, APPayments,',
      '  ExpenseClaims, ExpenseClaimItems,',
      '  Settlements, AuditLog, AccountingEvents',
    ].forEach((line) => cover.addRow([line]));
    cover.getColumn(1).width = 90;

    // ── Helpers ─────────────────────────────────────────────────────────
    /** Add a sheet with rows. If empty, sheet is created with just the header note. */
    const addSheet = (name: string, rows: Record<string, unknown>[]) => {
      const ws = wb.addWorksheet(name);
      if (rows.length === 0) {
        ws.addRow(['(no rows)']);
        return;
      }
      const cols = Object.keys(rows[0]);
      ws.columns = cols.map((c) => ({ header: c, key: c, width: 20 }));
      // Style header
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B5E3C' } };
      for (const r of rows) {
        // Convert Decimal/Date to plain values
        const safe: Record<string, unknown> = {};
        for (const k of cols) {
          const v = r[k];
          if (v == null)            safe[k] = null;
          else if (v instanceof Date) safe[k] = v.toISOString();
          else if (typeof v === 'object' && 'toString' in (v as object)) safe[k] = String(v);
          else                      safe[k] = v;
        }
        ws.addRow(safe);
      }
      ws.views = [{ state: 'frozen', ySplit: 1 }];
    };

    /** Fetch a table scoped to tenant, with optional select. */
    const f = <T>(query: Promise<T[]>) => query;

    // Strip sensitive fields from Users
    const sanitizeUser = (u: Record<string, unknown>) => {
      const { passwordHash, refreshTokenHash, twoFactorSecret, supervisorPinHash, passwordResetToken, ...safe } = u;
      void passwordHash; void refreshTokenHash; void twoFactorSecret; void supervisorPinHash; void passwordResetToken;
      return safe;
    };

    // ── Pull every table ────────────────────────────────────────────────
    const [
      tenantRow, branches, users, appAccess,
      customers, vendors, categories, products, inventory, rawMaterials, productBom,
      orders, orderItems, orderPayments,
      accounts, journalEntries, journalLines, periods,
      arInvoices, arInvoiceLines, arPayments,
      apBills, apBillLines, apPayments,
      expenseClaims, expenseClaimItems,
      settlements, auditLog, accountingEvents,
    ] = await Promise.all([
      this.prisma.tenant.findMany({ where: { id: tenantId } }),
      f(this.prisma.branch.findMany({ where: { tenantId } })),
      this.prisma.user.findMany({ where: { tenantId } }),
      f(this.prisma.userAppAccess.findMany({ where: { user: { tenantId } } })),
      f(this.prisma.customer.findMany({ where: { tenantId } })),
      f(this.prisma.vendor.findMany({ where: { tenantId } })),
      f(this.prisma.category.findMany({ where: { tenantId } })),
      f(this.prisma.product.findMany({ where: { tenantId } })),
      f(this.prisma.inventoryItem.findMany({ where: { tenantId } })),
      f(this.prisma.rawMaterial.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.bomItem.findMany({ where: { product: { tenantId } } }).catch(() => [])),
      f(this.prisma.order.findMany({ where: { tenantId } })),
      f(this.prisma.orderItem.findMany({ where: { order: { tenantId } } })),
      f(this.prisma.orderPayment.findMany({ where: { order: { tenantId } } })),
      f(this.prisma.account.findMany({ where: { tenantId } })),
      f(this.prisma.journalEntry.findMany({ where: { tenantId } })),
      f(this.prisma.journalLine.findMany({ where: { journalEntry: { tenantId } } })),
      f(this.prisma.accountingPeriod.findMany({ where: { tenantId } })),
      f(this.prisma.aRInvoice.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.aRInvoiceLine.findMany({ where: { invoice: { tenantId } } }).catch(() => [])),
      f(this.prisma.aRPayment.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.aPBill.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.aPBillLine.findMany({ where: { bill: { tenantId } } }).catch(() => [])),
      f(this.prisma.aPPayment.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.expenseClaim.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.expenseClaimItem.findMany({ where: { claim: { tenantId } } }).catch(() => [])),
      f(this.prisma.settlementBatch.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.auditLog.findMany({ where: { tenantId } }).catch(() => [])),
      f(this.prisma.accountingEvent.findMany({ where: { tenantId } }).catch(() => [])),
    ]);

    addSheet('Tenant',            tenantRow.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Branches',          branches.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Users',             users.map((u) => sanitizeUser(u as unknown as Record<string, unknown>)));
    addSheet('AppAccess',         appAccess.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Customers',         customers.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Vendors',           vendors.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Categories',        categories.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Products',          products.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Inventory',         inventory.map((r) => r as unknown as Record<string, unknown>));
    addSheet('RawMaterials',      rawMaterials.map((r) => r as unknown as Record<string, unknown>));
    addSheet('ProductBOM',        productBom.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Orders',            orders.map((r) => r as unknown as Record<string, unknown>));
    addSheet('OrderItems',        orderItems.map((r) => r as unknown as Record<string, unknown>));
    addSheet('OrderPayments',     orderPayments.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Accounts',          accounts.map((r) => r as unknown as Record<string, unknown>));
    addSheet('JournalEntries',    journalEntries.map((r) => r as unknown as Record<string, unknown>));
    addSheet('JournalLines',      journalLines.map((r) => r as unknown as Record<string, unknown>));
    addSheet('AccountingPeriods', periods.map((r) => r as unknown as Record<string, unknown>));
    addSheet('ARInvoices',        arInvoices.map((r) => r as unknown as Record<string, unknown>));
    addSheet('ARInvoiceLines',    arInvoiceLines.map((r) => r as unknown as Record<string, unknown>));
    addSheet('ARPayments',        arPayments.map((r) => r as unknown as Record<string, unknown>));
    addSheet('APBills',           apBills.map((r) => r as unknown as Record<string, unknown>));
    addSheet('APBillLines',       apBillLines.map((r) => r as unknown as Record<string, unknown>));
    addSheet('APPayments',        apPayments.map((r) => r as unknown as Record<string, unknown>));
    addSheet('ExpenseClaims',     expenseClaims.map((r) => r as unknown as Record<string, unknown>));
    addSheet('ExpenseClaimItems', expenseClaimItems.map((r) => r as unknown as Record<string, unknown>));
    addSheet('Settlements',       settlements.map((r) => r as unknown as Record<string, unknown>));
    addSheet('AuditLog',          auditLog.map((r) => r as unknown as Record<string, unknown>));
    addSheet('AccountingEvents',  accountingEvents.map((r) => r as unknown as Record<string, unknown>));

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return {
      buffer:   Buffer.from(await wb.xlsx.writeBuffer()),
      filename: `clerque-export-${tenant.slug}-${stamp}.xlsx`,
    };
  }
}
