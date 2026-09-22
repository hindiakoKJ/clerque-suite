/**
 * Run: cd apps/web && node --test lib/today.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// The shop is in Manila (UTC+8). Set before any Date is made.
process.env.TZ = 'Asia/Manila';

const { todayIso, isoDaysFromToday, startOfMonthIso, startOfYearIso, localIso, addDaysIso, endOfMonthIso } =
  await import('./today.ts');

/** Freeze "now" at a UTC instant for one test. */
function at(t, utc) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(utc).getTime() });
}

test('06:00 in Manila on the 1st is the 1st, not the last day of last month', (t) => {
  // 2026-09-01 06:00 Manila = 2026-08-31 22:00 UTC. toISOString() would say Aug 31.
  at(t, '2026-08-31T22:00:00.000Z');
  assert.equal(todayIso(), '2026-09-01');
  assert.equal(startOfMonthIso(), '2026-09-01');
  assert.equal(startOfYearIso(), '2026-01-01');
  assert.equal(isoDaysFromToday(-1), '2026-08-31');
});

test('the first of the month is the 1st at any hour (it used to be the day before, all day)', (t) => {
  at(t, '2026-09-21T07:00:00.000Z'); // 15:00 Manila
  assert.equal(startOfMonthIso(), '2026-09-01');
  // The old code, for the record:
  const d = new Date(); const old = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
  assert.equal(old, '2026-08-31');
});

test('new year: 07:59 on 1 Jan in Manila is already the new year', (t) => {
  at(t, '2026-12-31T23:59:00.000Z');
  assert.equal(todayIso(), '2027-01-01');
  assert.equal(startOfYearIso(), '2027-01-01');
});

test('localIso prints a local-midnight Date as that day', () => {
  assert.equal(localIso(new Date(2026, 8, 1)), '2026-09-01');
  assert.equal(localIso(new Date(2026, 8, 30)), '2026-09-30');
});

test('addDaysIso is calendar arithmetic and takes an API timestamp as-is', () => {
  assert.equal(addDaysIso('2026-09-30', 1), '2026-10-01');
  assert.equal(addDaysIso('2026-09-30T00:00:00.000Z', 1), '2026-10-01');
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysIso('2028-02-28', 1), '2028-02-29');
  assert.equal(addDaysIso('2026-03-01', -1), '2026-02-28');
  assert.equal(addDaysIso('2026-09-22', 30), '2026-10-22');
});

test('endOfMonthIso is the real last day of the month', () => {
  assert.equal(endOfMonthIso('2026-09-01'), '2026-09-30');
  assert.equal(endOfMonthIso('2026-10-15'), '2026-10-31');
  assert.equal(endOfMonthIso('2026-02-01'), '2026-02-28');
  assert.equal(endOfMonthIso('2028-02-10'), '2028-02-29');
  assert.equal(endOfMonthIso('2026-12-01'), '2026-12-31');
});
