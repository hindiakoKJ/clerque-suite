/**
 * The Control bucket no longer carries `sodOverridesLast30d`.
 *
 * Nothing in the product writes an SOD_OVERRIDE_GRANTED audit row (the
 * permission editor evaluates its warning in the browser and never sends an
 * override), so the count was a permanent 0 that the dashboard tile and the
 * KPI export presented as a clean control. The only audit-log query left is
 * the 24-hour activity count.
 */
import { LedgerMetricsService } from './ledger-metrics.service';

function prismaStub() {
  const count = (n: number) => jest.fn().mockResolvedValue(n);
  return {
    accountingEvent:  { findMany: jest.fn().mockResolvedValue([]), count: count(0) },
    aRInvoice:        { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {} }) },
    aPBill:           { findMany: jest.fn().mockResolvedValue([]), aggregate: jest.fn().mockResolvedValue({ _count: 0, _sum: {} }) },
    accountingPeriod: { findFirst: jest.fn().mockResolvedValue(null), count: count(0) },
    journalLine:      { findMany: jest.fn().mockResolvedValue([]) },
    journalEntry:     { count: count(0) },
    order:            { count: count(0) },
    expenseClaim:     { count: count(3) },
    tenant:           { findUnique: jest.fn().mockResolvedValue({ inventoryMode: 'SIMPLE' }) },
    product:          { count: count(2) },
    auditLog:         { count: count(7) },
  };
}

describe('LedgerMetricsService.getProcessMetrics — control bucket', () => {
  it('reports the four live control counts and no SOD override count', async () => {
    const prisma = prismaStub();
    const svc = new LedgerMetricsService(prisma as never);
    const m = await svc.getProcessMetrics('t1');

    expect(m.control).toEqual({
      pendingExpenseClaims: 3,
      productsMissingCost:  2,
      auditEntriesLast24h:  7,
      offlineSyncsLast24h:  0,
    });
    expect(m.control).not.toHaveProperty('sodOverridesLast30d');
  });

  it('never queries the audit log for SOD_OVERRIDE_GRANTED rows', async () => {
    const prisma = prismaStub();
    const svc = new LedgerMetricsService(prisma as never);
    await svc.getProcessMetrics('t1');

    // Only the 24h activity count touches the audit log, and it has no action filter.
    expect(prisma.auditLog.count).toHaveBeenCalledTimes(1);
    const where = prisma.auditLog.count.mock.calls[0][0].where as Record<string, unknown>;
    expect(where).not.toHaveProperty('action');
  });
});
