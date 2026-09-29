// Read-only: are a shop's books whole after a busy stretch? Events posted, entries balanced, trial balance zero,
// and today's sales by payment method against the journal.
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/books-check.js
// Optional: SHOP=<company code> (default cafe-carolina), SINCE=<ISO time> (default: start of today, Manila).
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
const SHOP = process.env.SHOP || 'cafe-carolina';
const manilaMidnight = () => { const d = new Date(Date.now() + 8 * 3600e3); d.setUTCHours(0, 0, 0, 0); return new Date(d.getTime() - 8 * 3600e3); };
const SINCE = process.env.SINCE ? new Date(process.env.SINCE) : manilaMidnight();
const n = (x) => Number(x ?? 0);
(async () => {
  const t = await p.tenant.findUnique({ where: { slug: SHOP }, select: { id: true } });
  const since = { gte: SINCE };
  const events = await p.accountingEvent.groupBy({ by: ['type', 'status'], where: { tenantId: t.id, createdAt: since }, _count: { _all: true } });
  console.log('EVENTS since', SINCE.toISOString());
  for (const e of events) console.log(`  ${e.type} ${e.status}: ${e._count._all}`);
  const failed = await p.accountingEvent.findMany({ where: { tenantId: t.id, createdAt: since, status: 'FAILED' }, select: { type: true, lastError: true }, take: 5 });
  for (const f of failed) console.log('  FAILED', f.type, String(f.lastError || '').slice(0, 160));

  const entries = await p.journalEntry.findMany({ where: { tenantId: t.id, createdAt: since }, select: { entryNumber: true, source: true, lines: { select: { debit: true, credit: true } } } });
  const unbalanced = entries.filter((e) => Math.abs(e.lines.reduce((s, l) => s + n(l.debit) - n(l.credit), 0)) > 0.005);
  const bySource = {};
  for (const e of entries) bySource[e.source] = (bySource[e.source] || 0) + 1;
  console.log(`JOURNAL since: ${entries.length} entries ${JSON.stringify(bySource)}; unbalanced: ${unbalanced.length} ${unbalanced.slice(0, 5).map((e) => e.entryNumber).join(', ')}`);

  const tb = await p.journalLine.groupBy({ by: ['accountId'], where: { journalEntry: { tenantId: t.id, status: 'POSTED' } }, _sum: { debit: true, credit: true } });
  const dr = tb.reduce((s, r) => s + n(r._sum.debit), 0);
  const cr = tb.reduce((s, r) => s + n(r._sum.credit), 0);
  console.log(`TRIAL BALANCE (all time, posted): debits ${dr.toFixed(2)} credits ${cr.toFixed(2)} difference ${(dr - cr).toFixed(2)}`);
  const accts = await p.account.findMany({ where: { tenantId: t.id, code: { in: ['1010', '1020', '1031', '1051', '4010', '5010', '6090', '2010'] } }, select: { id: true, code: true, name: true } });
  for (const a of accts) {
    const s = await p.journalLine.aggregate({ where: { accountId: a.id, journalEntry: { tenantId: t.id, status: 'POSTED', createdAt: since } }, _sum: { debit: true, credit: true } });
    console.log(`  today ${a.code} ${a.name}: Dr ${n(s._sum.debit).toFixed(2)} Cr ${n(s._sum.credit).toFixed(2)}`);
  }

  const orders = await p.order.findMany({ where: { tenantId: t.id, createdAt: since }, select: { status: true, totalAmount: true, discountAmount: true, payments: { select: { method: true, amount: true } } } });
  const st = {};
  for (const o of orders) st[o.status] = (st[o.status] || 0) + 1;
  const pay = {};
  for (const o of orders.filter((x) => x.status !== 'VOIDED')) for (const pm of o.payments) pay[pm.method] = +((pay[pm.method] || 0) + n(pm.amount)).toFixed(2);
  const gross = orders.filter((x) => x.status !== 'VOIDED').reduce((s, o) => s + n(o.totalAmount), 0);
  console.log(`ORDERS since: ${orders.length} ${JSON.stringify(st)}; sold (not voided) ${gross.toFixed(2)}; by payment ${JSON.stringify(pay)}`);
  const refunds = await p.orderItem.aggregate({ where: { order: { tenantId: t.id, createdAt: since }, refundedQty: { gt: 0 } }, _count: { _all: true } });
  console.log('lines with a refund:', refunds._count._all);

  const lots = await p.rawMaterialLot.count({ where: { tenantId: t.id, createdAt: since } });
  const negative = await p.rawMaterialInventory.count({ where: { rawMaterial: { tenantId: t.id }, quantity: { lt: 0 } } });
  console.log(`STOCK: lots created since ${lots}; ingredients below zero ${negative}`);
  const shifts = await p.shift.findMany({ where: { tenantId: t.id, openedAt: since }, select: { id: true, openedAt: true, closedAt: true, openingCash: true, closingCashExpected: true, closingCashDeclared: true, variance: true } });
  console.log('SHIFTS opened since:', JSON.stringify(shifts));
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
