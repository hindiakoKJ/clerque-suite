/**
 * Run: cd apps/web && node --test lib/pos/device-token.spec.mjs
 *
 * A kitchen or bar tablet re-checks its pairing on every load. The check
 * moved the token from ?token= into the X-Device-Token header; an API still
 * on the old code reads only ?token= and answers 400. Vercel and Railway
 * deploy the same push, and if the web goes live first, a tablet that
 * reloaded in between lost its pairing and sat on /pair until the owner made
 * a new code.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';

const { verifyDeviceToken } = await import('./device-token.ts');

const WHO = { tenantId: 't1', cashierId: 'u1', stationId: 'st-bar', role: 'KDS_BAR', label: 'Bar' };
const realGet = axios.get;
let calls;

const fail = (status) => Object.assign(new Error(`HTTP ${status}`), {
  isAxiosError: true, response: status ? { status, data: {} } : undefined,
});

/** An API that reads the token only from where `reads` says. */
function api(reads, known = 'tok-live') {
  axios.get = async (url, config = {}) => {
    calls.push(config);
    const token = reads === 'query' ? config.params?.token : config.headers?.['X-Device-Token'];
    if (token === known) return { data: WHO };
    throw fail(400);
  };
}

beforeEach(() => { calls = []; });
afterEach(() => { axios.get = realGet; });

test('the current API answers the header: one call, the token never in the address', async () => {
  api('header');
  assert.deepEqual(await verifyDeviceToken('tok-live'), WHO);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params, undefined);
});

test('an API that reads only ?token= (mid-deploy) still keeps the tablet paired', async () => {
  api('query');
  assert.deepEqual(await verifyDeviceToken('tok-live'), WHO);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].params, { token: 'tok-live' });
});

test('a revoked token is still refused, however it is asked', async () => {
  api('header');
  assert.equal(await verifyDeviceToken('tok-revoked'), null);
});

test('a network failure is not retried in the address', async () => {
  axios.get = async (_url, config = {}) => { calls.push(config); throw fail(undefined); };
  assert.equal(await verifyDeviceToken('tok-live'), null);
  assert.equal(calls.length, 1);
});
