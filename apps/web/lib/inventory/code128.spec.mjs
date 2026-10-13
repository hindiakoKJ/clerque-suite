/**
 * Run: cd apps/web && node --test lib/inventory/code128.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * The PC label print draws its own Code 128 barcode. A wrong pattern or check
 * symbol prints a label the scanner silently refuses, and the shop would only
 * find out at the till with a customer waiting.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CODE128_PATTERNS, START_B, START_C, STOP, QUIET_ZONE,
  code128Checksum, code128Values, code128Widths, code128Bars, fitsCodeSetC,
} from './code128.ts';

const sum = (s) => s.split('').map(Number).reduce((a, b) => a + b, 0);

test('the pattern table: 107 symbols, 11 modules each (the stop 13), all different', () => {
  assert.equal(CODE128_PATTERNS.length, 107);
  CODE128_PATTERNS.forEach((p, v) => {
    assert.equal(sum(p), v === STOP ? 13 : 11, `symbol ${v} (${p})`);
  });
  assert.equal(new Set(CODE128_PATTERNS).size, 107);
});

test('every symbol has an even number of bar modules (the Code 128 parity rule)', () => {
  CODE128_PATTERNS.forEach((p, v) => {
    const bars = p.split('').map(Number).filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    assert.equal(bars % 2, 0, `symbol ${v} (${p})`);
  });
});

test('a tag number goes in code set C, two digits per symbol', () => {
  assert.equal(fitsCodeSetC('000457'), true);
  assert.equal(fitsCodeSetC('00457'), false);
  assert.equal(fitsCodeSetC('A00457'), false);
  // 00 / 04 / 57; check = (105 + 1*0 + 2*4 + 3*57) % 103 = 284 % 103 = 78
  assert.equal(code128Checksum(START_C, [0, 4, 57]), 78);
  assert.deepEqual(code128Values('000457'), [START_C, 0, 4, 57, 78, STOP]);
});

test('000457: 68 modules of bars and spaces, starting with Start C, ending with Stop', () => {
  const widths = code128Widths('000457');
  assert.equal(widths.reduce((a, b) => a + b, 0), 68);
  assert.equal(widths.length % 2, 1, 'bar first and bar last');
  assert.deepEqual(widths.slice(0, 6), [2, 1, 1, 2, 3, 2]);       // Start C 211232
  assert.deepEqual(widths.slice(-7), [2, 3, 3, 1, 1, 1, 2]);      // Stop 2331112
  assert.deepEqual(widths.slice(-13, -7), [2, 4, 1, 1, 1, 2]);    // check 78 = 241112
});

test('with the quiet zones the label barcode is 88 modules: 33 mm at 0.375 mm', () => {
  const { bars, totalModules } = code128Bars('000457');
  assert.equal(totalModules, 68 + 2 * QUIET_ZONE);
  assert.equal(totalModules * 0.375, 33);
  assert.equal(bars[0].x, QUIET_ZONE);
  const last = bars[bars.length - 1];
  assert.equal(last.x + last.w, totalModules - QUIET_ZONE);
  // Bars never overlap and always leave a space between them.
  for (let i = 1; i < bars.length; i++) assert.ok(bars[i].x > bars[i - 1].x + bars[i - 1].w - 1e-9);
});

test('another number checks out by hand: 123456 -> 12 / 34 / 56, check (105+12+68+168) % 103 = 44', () => {
  assert.deepEqual(code128Values('123456'), [START_C, 12, 34, 56, 44, STOP]);
});

test('anything that is not an even run of digits falls back to code set B', () => {
  // "AB": A=33, B=34; check = (104 + 33 + 68) % 103 = 102
  assert.deepEqual(code128Values('AB'), [START_B, 33, 34, 102, STOP]);
  assert.equal(code128Values('12345')[0], START_B);
  assert.throws(() => code128Values(''));
  assert.throws(() => code128Values('café'));
});
