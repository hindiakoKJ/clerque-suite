/**
 * Run: cd apps/web && node --test middleware.spec.mjs
 *
 * middleware.ts imports next/server, so plain Node cannot load it. This reads
 * the file and pins two things that were wrong:
 *
 *   1. The matcher must leave the PWA icons alone. /icon, /icon1, /icon2 and
 *      /apple-icon are generated routes with no file extension, so they fell
 *      through to the sign-in redirect; Chrome fetched an HTML redirect for
 *      every manifest icon and the kitchen tablets' "Add to Home screen" got
 *      no icon and no install prompt.
 *   2. The design-preview mockup folder is gone, so nothing may whitelist it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const src = readFileSync(new URL('./middleware.ts', import.meta.url), 'utf8');

/** The matcher pattern, as a plain regex over a pathname. */
function matcher() {
  const m = src.match(/matcher:\s*\[\s*'([^']+)'/);
  assert.ok(m, 'middleware.ts should export config.matcher as one quoted string');
  // The file has the pattern JS-escaped ("\\d", "\\."); unescape once.
  return new RegExp(`^${m[1].replace(/\\\\/g, '\\')}$`);
}

describe('config.matcher: what the edge guard never touches', () => {
  const re = matcher();
  test('the manifest, the service worker and every generated icon route', () => {
    for (const p of ['/manifest.webmanifest', '/sw.js', '/favicon.ico', '/icon', '/icon1', '/icon2', '/apple-icon', '/logo.png']) {
      assert.equal(re.test(p), false, `${p} must be excluded from the middleware`);
    }
  });
  test('still guards the apps and anything that merely starts with "icon"', () => {
    for (const p of ['/pos/terminal', '/ledger', '/procure/requests', '/settings', '/iconography', '/icons/list', '/apple-icons']) {
      assert.equal(re.test(p), true, `${p} must still run through the middleware`);
    }
  });
});

describe('no public mockups', () => {
  test('the design-preview folder is gone and no longer whitelisted', () => {
    assert.doesNotMatch(src, /design-preview/);
    assert.equal(existsSync(new URL('./public/design-preview', import.meta.url)), false);
  });
});
