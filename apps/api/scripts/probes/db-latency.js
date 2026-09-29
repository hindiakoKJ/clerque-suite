// Read-only: how long one database round trip takes from the API container, and the slowest statements
// Postgres has seen (when pg_stat_statements is enabled).
//   bash apps/api/scripts/probes/run-in-container.sh apps/api/scripts/probes/db-latency.js
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  await p.$queryRawUnsafe('select 1');
  const times = [];
  for (let i = 0; i < 30; i++) {
    const t0 = process.hrtime.bigint();
    await p.$queryRawUnsafe('select 1');
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  console.log('round trip ms: min', times[0].toFixed(2), 'median', times[15].toFixed(2), 'max', times[29].toFixed(2));
  const host = (process.env.DATABASE_URL || '').replace(/:\/\/[^@]+@/, '://***@').split('?')[0];
  console.log('db host', host.replace(/\/[^/]*$/, ''));
  try {
    const rows = await p.$queryRawUnsafe(
      "select calls, round(mean_exec_time::numeric, 1) as mean_ms, round(total_exec_time::numeric) as total_ms, left(regexp_replace(query, '\\s+', ' ', 'g'), 160) as q " +
      'from pg_stat_statements order by total_exec_time desc limit 15');
    for (const r of rows) console.log(`${r.calls} calls, mean ${r.mean_ms} ms, total ${r.total_ms} ms: ${r.q}`);
  } catch (e) {
    console.log('pg_stat_statements not available:', String(e.message).slice(0, 120));
  }
  await p.$disconnect();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
