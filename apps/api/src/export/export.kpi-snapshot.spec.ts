/**
 * Ledger KPI Snapshot .xlsx export.
 *
 * The Control section used to print "SOD Overrides (last 30d)" — a figure
 * that could only ever be 0 because nothing records an override — so the
 * exported workbook carried a clean-looking control that was never measured.
 * The row is gone; the four live control metrics remain.
 */
import ExcelJS from 'exceljs';
import { ExportService } from './export.service';

const none = {} as never;

describe('ExportService.exportLedgerKpiSnapshot', () => {
  it('prints the live control metrics and no SOD Overrides row', async () => {
    const prisma = { tenant: { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Carolina' }) } };
    const ledgerMetrics = {
      getProcessMetrics: jest.fn().mockResolvedValue({
        generatedAt: '2026-09-29T08:00:00.000Z',
        timeliness: { avgEventLagMs: 0, pendingEvents: 0, failedEvents: 0, daysSalesOutstanding: 0, daysPayableOutstanding: 0, daysSinceLastClose: null },
        accuracy:   { tbVariance: 0, tbTotalDebits: 0, tbTotalCredits: 0, isBalanced: true, voidsLast30d: 0, voidRateLast30d: 0, reopensLast90d: 0 },
        volume:     { jesToday: 0, jesThisMonth: 0, eventsProcessedLast24h: 0, openArInvoices: 0, openArValue: 0, openApBills: 0, openApValue: 0 },
        control:    { pendingExpenseClaims: 3, productsMissingCost: 2, auditEntriesLast24h: 7, offlineSyncsLast24h: 1 },
      }),
    };
    const svc = new ExportService(
      prisma as never, none, none, none, none, none, none, none, none, none, none, none, none,
      ledgerMetrics as never,
    );
    const buf = await svc.exportLedgerKpiSnapshot('t1');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as never);
    const ws = wb.getWorksheet('Ledger KPI')!;
    const rows: Array<[string, string, unknown]> = [];
    ws.eachRow((r) => rows.push([String(r.getCell(1).value ?? ''), String(r.getCell(2).value ?? ''), r.getCell(3).value]));

    const control = rows.filter(([cat]) => cat === 'Control');
    expect(control).toEqual([
      ['Control', 'Pending Expense Claims', 3],
      ['Control', 'Products Missing Cost',  2],
      ['Control', 'Audit Entries (24h)',    7],
      ['Control', 'Offline Syncs (24h)',    1],
    ]);
    expect(rows.some(([, metric]) => /SOD/i.test(metric))).toBe(false);
  });
});
