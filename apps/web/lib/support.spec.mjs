/**
 * Run: cd apps/web && node --test lib/support.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * Two jobs: pin the one support address, and fail if any page under app/,
 * components/ or lib/ ever names one of the dead addresses again.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { SUPPORT_EMAIL, supportMailto } = await import('./support.ts');

describe('the one support mailbox', () => {
  test('is the HNS dev-support address', () => {
    assert.equal(SUPPORT_EMAIL, 'devsupport@hnscorpph.com');
  });
  test('supportMailto: plain, or with an encoded subject', () => {
    assert.equal(supportMailto(), 'mailto:devsupport@hnscorpph.com');
    assert.equal(
      supportMailto('URGENT — restore from backup'),
      'mailto:devsupport@hnscorpph.com?subject=URGENT%20%E2%80%94%20restore%20from%20backup',
    );
  });
});

/** Every .ts/.tsx source file under a folder, skipping build output. */
function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('no page names a dead support address', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = ['app', 'components', 'lib'].flatMap((d) => sources(join(root, d)));
  // Addresses that were on pages and reach nobody. lib/support.ts is allowed
  // to mention them in its own comment, so it is skipped.
  const dead = [/support@clerque\.ph/, /support@example\.com/, /@clerque\.app/];

  test('scans a real tree', () => {
    assert.ok(files.length > 50, `only ${files.length} files found under ${root}`);
  });

  for (const pattern of dead) {
    test(`${pattern} appears in no page`, () => {
      const hits = files
        .filter((f) => !f.endsWith(join('lib', 'support.ts')))
        .filter((f) => pattern.test(readFileSync(f, 'utf8')))
        .map((f) => f.slice(root.length));
      assert.deepEqual(hits, []);
    });
  }
});
