/**
 * Run: cd apps/web && node --test lib/pos/thermal-text.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts files directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// printer.ts imports ./thermal-text without an extension (Next resolves that);
// teach Node to try ".ts" so the real module loads here.
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

const { toThermalText, thermalBytes } = await import('./thermal-text.ts');
const { buildReceipt } = await import('./printer.ts');

test('symbols the printer cannot show become plain ASCII', () => {
  assert.equal(toThermalText('2× Café Latte'), '2x Cafe Latte');
  assert.equal(toThermalText('₱150.00'), 'P150.00');
  assert.equal(toThermalText('Piña – Ñame — Crème brûlée'), 'Pina - Name - Creme brulee');
  assert.equal(toThermalText('‘Anne’s’ “special”'), '\'Anne\'s\' "special"');
  assert.equal(toThermalText('½ sugar… wait'), '1/2 sugar... wait');
  assert.equal(toThermalText('06:30 PM'), '06:30 PM');
});

test('anything with no plain version (emoji) is left out, not printed as junk', () => {
  assert.equal(toThermalText('Iced Latte 🧊'), 'Iced Latte ');
});

test('plain ASCII, including ESC/POS-safe newlines, is untouched', () => {
  const s = 'ORD-0042 # Bar\nThank you for your purchase!';
  assert.equal(toThermalText(s), s);
  assert.equal(toThermalText(toThermalText('Café × 2')), 'Cafe x 2');
});

test('thermalBytes gives one byte per printed character', () => {
  assert.deepEqual([...thermalBytes('Café')], [0x43, 0x61, 0x66, 0x65]);
});

const receipt = (over = {}) => ({
  orderNumber: 'ORD-0042',
  completedAt: '2026-09-17T10:30:00.000Z',
  lines: [
    { productName: 'Café Latte (Iced)', quantity: 2, unitPrice: 150, lineTotal: 300, discountAmount: 0 },
    // "½" prints as "1/2": the 48-column cut must be made on the printed text.
    { productName: 'Spanish Latte ½ sugar, oat milk, extra shot, no ice', quantity: 1, unitPrice: 160, lineTotal: 160, discountAmount: 0 },
  ],
  subtotal: 460,
  discountAmount: 0,
  isPwdScDiscount: false,
  vatAmount: 0,
  totalAmount: 460,
  payments: [{ method: 'GCASH_PERSONAL', amount: 460, reference: 'Ref–½' }],
  taxStatus: 'NON_VAT',
  businessName: 'Café Carolina',
  ...over,
});

/** The receipt's printable text, one entry per printed line (ESC/POS commands removed). */
function printedLines(bytes) {
  return Buffer.from(bytes).toString('latin1')
    .replace(/\x1b[@]/g, '')
    .replace(/\x1b[aEd!]./g, '')
    .replace(/\x1dV\x41\x00/g, '')
    .split('\n');
}

test('a receipt is plain ASCII: "Cafe Latte", no garbled é', () => {
  const bytes = buildReceipt(receipt());
  assert.deepEqual([...bytes].filter((b) => b > 0x7f), [], 'every byte is ASCII');
  const lines = printedLines(bytes);
  assert.ok(lines.some((l) => l.startsWith('Cafe Latte (Iced)')), lines.join('\n'));
  assert.ok(lines.some((l) => l === 'CAFE CAROLINA'), lines.join('\n'));
});

test('no receipt line runs past 48 columns after the swap, so prices stay lined up', () => {
  const lines = printedLines(buildReceipt(receipt()));
  for (const l of lines) assert.ok(l.length <= 48, `${l.length} cols: "${l}"`);
  const pay = lines.find((l) => l.startsWith('GCash Personal'));
  assert.equal(pay.length, 48, `payment line: "${pay}"`);
  assert.ok(pay.endsWith(' P460.00'));
  assert.ok(pay.startsWith('GCash Personal #Ref-1/2 '));
});
