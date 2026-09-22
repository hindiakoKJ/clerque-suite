/**
 * Run: cd apps/web && node --test app/settings/receipt-header-name.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts helper directly.
 *
 * The Settings preview must show the SAME heading the receipt prints
 * (apps/api/src/auth/receipt-business-name.ts builds the token that way).
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { receiptHeaderName } = await import('./receipt-header-name.ts');

describe('receiptHeaderName: the Settings receipt preview', () => {
  test('the BIR "business name as on COR" wins when filled in', () => {
    assert.equal(
      receiptHeaderName({ businessName: 'Carolina Food Ventures', name: 'Cafe Carolina' }),
      'CAROLINA FOOD VENTURES',
    );
  });
  test('BIR field blank: the business name from the profile, upper-cased like the print', () => {
    assert.equal(receiptHeaderName({ businessName: null, name: 'Cafe Carolina' }), 'CAFE CAROLINA');
    assert.equal(receiptHeaderName({ businessName: '   ', name: ' Cafe Carolina ' }), 'CAFE CAROLINA');
  });
  test('nothing known: empty, so the page can show its own placeholder', () => {
    assert.equal(receiptHeaderName(null), '');
    assert.equal(receiptHeaderName(undefined), '');
    assert.equal(receiptHeaderName({ businessName: '', name: '' }), '');
  });
});
