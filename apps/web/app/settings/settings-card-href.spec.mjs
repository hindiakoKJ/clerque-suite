/**
 * Run: cd apps/web && node --test app/settings/settings-card-href.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * Every business-type card on the Settings hub must open a page that exists.
 * The cards come from packages/shared-types/src/verticals.ts; this reads their
 * hrefs straight from that file (it cannot be imported under plain Node).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { settingsCardHref } = await import('./settings-card-href.ts');

const appDir = fileURLToPath(new URL('..', import.meta.url));
const registry = readFileSync(
  new URL('../../../../packages/shared-types/src/verticals.ts', import.meta.url),
  'utf8',
);

/** The hrefs of every settings.extraCards entry in the registry. */
function cardHrefs() {
  const out = [];
  const blocks = registry.match(/extraCards:\s*\[[\s\S]*?\]/g) ?? [];
  for (const block of blocks) {
    for (const m of block.matchAll(/href:\s*'([^']+)'/g)) out.push(m[1]);
  }
  return out;
}

/** True when an App Router page exists for the path, looking through (group) folders. */
function pageExists(path) {
  const segments = path.split('/').filter(Boolean);
  function walk(dir, i) {
    if (i === segments.length) return existsSync(join(dir, 'page.tsx'));
    const next = join(dir, segments[i]);
    if (existsSync(next) && statSync(next).isDirectory() && walk(next, i + 1)) return true;
    return readdirSync(dir)
      .filter((d) => /^\(.+\)$/.test(d) && statSync(join(dir, d)).isDirectory())
      .some((group) => walk(join(dir, group), i));
  }
  return walk(appDir, 0);
}

describe('Settings hub: business-type cards', () => {
  test('the registry has cards to check', () => {
    assert.ok(cardHrefs().length >= 3, `found ${cardHrefs().length}`);
  });
  test('the trucking Fleet Setup card goes to the POS fleet screen', () => {
    assert.equal(settingsCardHref('/settings/fleet'), '/pos/trucking/fleet');
    assert.equal(settingsCardHref('/settings/laundry'), '/settings/laundry');
  });
  test('every card opens a page that exists', () => {
    const dead = cardHrefs().map(settingsCardHref).filter((href) => !pageExists(href));
    assert.deepEqual(dead, []);
  });
});
