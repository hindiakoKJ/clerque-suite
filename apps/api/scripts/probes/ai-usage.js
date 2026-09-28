// The last 40 AI calls as the app logged them (ai_usage): model, tokens, cost,
// duration, and the error text of any failure. Run inside the API container:
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/ai-usage.js
const { PrismaClient } = require('@prisma/client');
(async () => {
  const p = new PrismaClient();
  const rows = await p.aiUsage.findMany({
    orderBy: { createdAt: 'desc' }, take: 40,
    select: { createdAt: true, action: true, provider: true, model: true, success: true, errorMessage: true, inputTokens: true, outputTokens: true, costUsd: true, durationMs: true },
  });
  for (const r of rows) {
    console.log([
      r.createdAt.toISOString().slice(0, 16), r.action, r.provider, r.model, r.success ? 'ok' : 'FAIL',
      'in=' + r.inputTokens, 'out=' + r.outputTokens, '$' + Number(r.costUsd).toFixed(4), r.durationMs + 'ms',
      (r.errorMessage || '').slice(0, 160).replace(/\n/g, ' '),
    ].join(' | '));
  }
  const byModel = await p.aiUsage.groupBy({ by: ['provider', 'model', 'success'], _count: { _all: true } });
  console.log('--- totals by model ---');
  for (const g of byModel) console.log(g.provider, g.model, g.success ? 'ok' : 'fail', g._count._all);
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
