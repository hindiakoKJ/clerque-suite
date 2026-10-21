/**
 * Stand-in for lib/api.ts. Records every call with the shop whose token the
 * real client would have attached at that moment (read from 'app-auth', as the
 * real request interceptor does). `respond` decides the answer per call.
 */

export const calls = [];
let respond = async () => ({ data: {} });

export function onRequest(fn) { respond = fn; }
export function resetApi() { calls.length = 0; respond = async () => ({ data: {} }); }

function tokenShop() {
  try {
    const state = JSON.parse(globalThis.localStorage.getItem('app-auth') ?? '{}')?.state;
    return state?.accessToken ? (state.user?.tenantId ?? null) : null;
  } catch { return null; }
}

function call(method) {
  return async (url, body) => {
    const entry = { method, url, body, shop: tokenShop() };
    calls.push(entry);
    return respond(entry);
  };
}

export const api = {
  get: call('GET'),
  post: call('POST'),
  patch: call('PATCH'),
  put: call('PUT'),
  delete: call('DELETE'),
};
