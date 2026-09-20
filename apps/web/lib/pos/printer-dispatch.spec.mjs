/**
 * Run: cd apps/web && node --test lib/pos/printer-dispatch.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts files directly.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// The .ts files import each other without an extension (Next resolves that);
// teach Node to try ".ts" so the real modules load here.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (err) {
      if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) return next(`${specifier}.ts`, context);
      throw err;
    }
  },
});

const { dispatchPrintJob, buildStationTicket } = await import('./printer-dispatch.ts');

/** Just enough browser for the RawBT hand-off: records what the page creates and clicks. */
function fakeAndroidBrowser() {
  const created = [];
  const body = {
    children: [],
    appendChild(el) { this.children.push(el); el.parentNode = this; },
    removeChild(el) { this.children = this.children.filter((c) => c !== el); el.parentNode = null; },
  };
  globalThis.window = { btoa: globalThis.btoa };
  globalThis.document = {
    body,
    createElement(tag) {
      const el = { tagName: tag.toUpperCase(), style: {}, clicks: 0, click() { this.clicks++; } };
      created.push(el);
      return el;
    },
  };
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-X110) Chrome/140.0 Mobile Safari/537.36' },
    configurable: true,
  });
  return { created, body };
}

const rawbtPrinter = {
  id: 'p1', name: 'Receipt Printer', interface: 'BLUETOOTH_RAWBT', address: null,
  paperWidthMm: 58, printsReceipts: true, printsOrders: true, isActive: true,
};

test('Print on a RawBT printer clicks a rawbt: link instead of loading a hidden iframe (newer Android Chrome blocks the iframe)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { created, body } = fakeAndroidBrowser();
    const bytes = new Uint8Array([0x1b, 0x40, 0x48, 0x69, 0x0a]);

    const result = await dispatchPrintJob(rawbtPrinter, bytes, null);

    assert.deepEqual(result, { ok: true });
    assert.equal(created.filter((el) => el.tagName === 'IFRAME').length, 0, 'no iframe');
    const links = created.filter((el) => el.tagName === 'A');
    assert.equal(links.length, 1);
    assert.equal(links[0].href, `rawbt:base64,${Buffer.from(bytes).toString('base64')}`);
    assert.equal(links[0].clicks, 1);

    mock.timers.tick(1000);
    assert.equal(body.children.length, 0, 'the link is cleaned up');
  } finally {
    mock.timers.reset();
  }
});

test('RawBT off Android still says why instead of pretending it printed', async () => {
  fakeAndroidBrowser();
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0' },
    configurable: true,
  });
  const result = await dispatchPrintJob(rawbtPrinter, new Uint8Array([0x0a]), null);
  assert.equal(result.ok, false);
  assert.match(result.reason, /Android/);
});

test('a bar ticket is plain ASCII: "2x Cafe Latte", no garbled × or é', () => {
  const bytes = buildStationTicket({
    orderNumber: 'ORD-0042',
    completedAt: '2026-09-17T10:30:00.000Z',
    stationName: 'Bar',
    items: [{
      productName: 'Café Latte (Iced)',
      quantity: 2,
      modifiers: [{ optionName: 'Oat milk – ½ sugar' }],
      notes: '“less ice”',
    }],
  }, 58);

  assert.deepEqual([...bytes].filter((b) => b > 0x7f), [], 'every byte is ASCII');
  const text = Buffer.from(bytes).toString('latin1');
  assert.ok(text.includes('2x Cafe Latte (Iced)'), text);
  assert.ok(text.includes('   - Oat milk - 1/2 sugar'), text);
  assert.ok(text.includes('   * "less ice"'), text);
});
