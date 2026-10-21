/**
 * The bits of a browser the session code touches: localStorage,
 * sessionStorage, window and document.cookie. Import this BEFORE any app
 * module, so the persisted stores find their storage when they are created.
 */
import { register } from 'node:module';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.window.location = { protocol: 'https:', pathname: '/pos/terminal', href: '' };

/** Every cookie written, last one last (the sign-out mirror cookie is what we check). */
export const cookieWrites = [];
globalThis.document = {
  get cookie() { return cookieWrites.at(-1) ?? ''; },
  set cookie(v) { cookieWrites.push(v); },
};

register('./loader.mjs', import.meta.url);
