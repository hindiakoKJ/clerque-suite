/**
 * Run: cd apps/web && node --test components/shell/notification-link.spec.mjs
 * The web app has no test runner; Node's own runs this and loads the .ts files directly.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// notification-link.ts imports ../../lib/app-roles without an extension (Next
// resolves that); teach Node to try ".ts" so the real role table loads here.
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

const { appForLink, notificationHref } = await import('./notification-link.ts');
const { POS_ROLES, LEDGER_ROLES, PROCURE_ROLES } = await import('../../lib/app-roles.ts');

describe('appForLink: which app a notification link points into', () => {
  test('the four apps, with or without a deeper path or a query', () => {
    assert.equal(appForLink('/pos/orders'), 'pos');
    assert.equal(appForLink('/pos'), 'pos');
    assert.equal(appForLink('/ledger/ap/bills?tab=overdue'), 'ledger');
    assert.equal(appForLink('/procure/requests'), 'procure');
    assert.equal(appForLink('/payroll/payslips'), 'payroll');
  });
  test('links outside the apps, and no link, are nobody\'s app', () => {
    assert.equal(appForLink('/settings/data'), null);
    assert.equal(appForLink('/position-paper'), null); // "/pos" is a prefix, not a folder
    assert.equal(appForLink(null), null);
    assert.equal(appForLink(''), null);
  });
});

describe('notificationHref: the cook and the barista are never sent out of Procure', () => {
  test('a cook (GENERAL_EMPLOYEE) gets no link into Counter or Ledger', () => {
    assert.equal(notificationHref('/pos/orders', 'GENERAL_EMPLOYEE'), null);
    assert.equal(notificationHref('/ledger/ap/bills', 'GENERAL_EMPLOYEE'), null);
    assert.equal(notificationHref('/ledger/periods', 'GENERAL_EMPLOYEE'), null);
  });
  test('a barista (CASHIER) may open Counter but not Ledger', () => {
    assert.equal(notificationHref('/pos/orders', 'CASHIER'), '/pos/orders');
    assert.equal(notificationHref('/ledger/ar/billing', 'CASHIER'), null);
  });
  test('the owner opens everything, and the accountant opens Ledger but not Counter', () => {
    assert.equal(notificationHref('/pos/orders', 'BUSINESS_OWNER'), '/pos/orders');
    assert.equal(notificationHref('/ledger/periods', 'BUSINESS_OWNER'), '/ledger/periods');
    assert.equal(notificationHref('/ledger/periods', 'ACCOUNTANT'), '/ledger/periods');
    assert.equal(notificationHref('/pos/orders', 'ACCOUNTANT'), null);
  });
  test('Procure links go to everyone who can enter Procure, which includes the cook', () => {
    assert.equal(notificationHref('/procure/requests', 'GENERAL_EMPLOYEE'), '/procure/requests');
  });
  test('links outside the apps pass through; no link stays no link', () => {
    assert.equal(notificationHref('/settings/data', 'GENERAL_EMPLOYEE'), '/settings/data');
    assert.equal(notificationHref(null, 'CASHIER'), null);
    assert.equal(notificationHref(undefined, 'CASHIER'), null);
    assert.equal(notificationHref('/pos/orders', null), null);
  });
  test('a super admin is let in everywhere, as at the edge', () => {
    assert.equal(notificationHref('/pos/orders', 'SUPER_ADMIN'), '/pos/orders');
  });
  test('agrees with the edge guard\'s role table for every role it knows', () => {
    const roles = new Set([...POS_ROLES, ...LEDGER_ROLES, ...PROCURE_ROLES]);
    for (const role of roles) {
      assert.equal(notificationHref('/pos/x', role) !== null, POS_ROLES.has(role) || role === 'SUPER_ADMIN', role);
      assert.equal(notificationHref('/ledger/x', role) !== null, LEDGER_ROLES.has(role) || role === 'SUPER_ADMIN', role);
      assert.equal(notificationHref('/procure/x', role) !== null, PROCURE_ROLES.has(role) || role === 'SUPER_ADMIN', role);
    }
  });
});
