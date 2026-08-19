/**
 * The AI master switch and quota resolution.
 *
 * AI is switched OFF right now, and is meant to come back — so what matters
 * is that the switch is airtight in BOTH directions: nothing leaks through
 * while it is off, and everything comes back exactly as it was when it is
 * flipped on. Both halves are covered here.
 *
 * `resolveAiQuota` is what production calls (JWT mint + subscription screen).
 * The pure `getAiQuotaForTenant` underneath it is exercised through the
 * switched-on cases.
 */
import { AI_ADDONS, PLAN_LIMITS, DEFAULT_PLAN_CODE } from '@repo/shared-types';
import { isAiEnabled, resolveAiQuota } from './ai-availability';

const PLAN_INCLUDED = PLAN_LIMITS[DEFAULT_PLAN_CODE].maxAiPerMonth;
const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
const PAST   = new Date(Date.now() - 24 * 60 * 60 * 1000);

const ORIGINAL = process.env.AI_FEATURES_ENABLED;
const setSwitch = (v: string | undefined) => {
  if (v === undefined) delete process.env.AI_FEATURES_ENABLED;
  else process.env.AI_FEATURES_ENABLED = v;
};

afterAll(() => setSwitch(ORIGINAL));

describe('isAiEnabled — fails closed', () => {
  it.each([
    ['unset',          undefined],
    ['empty string',   ''],
    ['"false"',        'false'],
    ['"TRUE"',         'TRUE'],
    ['"True"',         'True'],
    ['"1"',            '1'],
    ['"yes"',          'yes'],
    ['" true" spaced', ' true'],
  ])('is off when AI_FEATURES_ENABLED is %s', (_label, value) => {
    // Only the exact lowercase literal counts. A typo, a truthy-looking
    // value, or a missing variable must all leave a paid provider closed.
    setSwitch(value as string | undefined);
    expect(isAiEnabled()).toBe(false);
  });

  it('is on only for the exact string "true"', () => {
    setSwitch('true');
    expect(isAiEnabled()).toBe(true);
  });
});

describe('resolveAiQuota — while AI is OFF', () => {
  beforeEach(() => setSwitch('false'));

  it('gives a plain tenant nothing', () => {
    const q = resolveAiQuota({ planIncluded: PLAN_INCLUDED });
    expect(q.monthlyQuota).toBe(0);
    expect(q.enabled).toBe(false);
    expect(q.source).toBe('kill_switch');
  });

  it('ignores a live, paid add-on', () => {
    const q = resolveAiQuota({
      planIncluded: PLAN_INCLUDED, addonType: 'PRO_500', addonExpiresAt: FUTURE,
    });
    expect(q.monthlyQuota).toBe(0);
    expect(q.activeAddon).toBeNull();
  });

  it('outranks a SUPER_ADMIN override, which otherwise beats everything', () => {
    // This is the case that makes the switch a switch rather than a default.
    // The local demo tenant carries aiQuotaOverride = 9999.
    const q = resolveAiQuota({ planIncluded: PLAN_INCLUDED, override: 9_999 });
    expect(q.monthlyQuota).toBe(0);
    expect(q.enabled).toBe(false);
  });

  it('ignores add-on and override together', () => {
    const q = resolveAiQuota({
      planIncluded: PLAN_INCLUDED,
      addonType: 'PRO_500', addonExpiresAt: FUTURE, override: 5_000,
    });
    expect(q.monthlyQuota).toBe(0);
  });

  it('stays at zero even if the package bundles prompts', () => {
    expect(resolveAiQuota({ planIncluded: 100_000 }).monthlyQuota).toBe(0);
  });
});

describe('resolveAiQuota — once AI is switched ON', () => {
  beforeEach(() => setSwitch('true'));

  it('restores the quota the package bundles', () => {
    const q = resolveAiQuota({ planIncluded: PLAN_INCLUDED });
    expect(q.monthlyQuota).toBe(PLAN_INCLUDED);
    expect(q.enabled).toBe(PLAN_INCLUDED > 0);
  });

  it.each(['STARTER_50', 'STANDARD_200', 'PRO_500'] as const)(
    'stacks the %s add-on on top of the bundled quota', (type) => {
      const q = resolveAiQuota({
        planIncluded: PLAN_INCLUDED, addonType: type, addonExpiresAt: FUTURE,
      });
      expect(q.monthlyQuota).toBe(PLAN_INCLUDED + AI_ADDONS[type].promptsIncluded);
      expect(q.activeAddon).toBe(type);
    },
  );

  it('stops honouring an expired add-on', () => {
    const q = resolveAiQuota({
      planIncluded: 0, addonType: 'PRO_500', addonExpiresAt: PAST,
    });
    expect(q.monthlyQuota).toBe(0);
    expect(q.activeAddon).toBeNull();
  });

  it('treats a null expiry as non-expiring', () => {
    // We do not issue these, but legacy rows carry them.
    const q = resolveAiQuota({
      planIncluded: 0, addonType: 'STARTER_50', addonExpiresAt: null,
    });
    expect(q.monthlyQuota).toBe(AI_ADDONS.STARTER_50.promptsIncluded);
  });

  it('lets a per-tenant override beat the package', () => {
    const q = resolveAiQuota({ planIncluded: PLAN_INCLUDED, override: 25 });
    expect(q.monthlyQuota).toBe(25);
    expect(q.source).toBe('override');
  });

  it('keeps the per-tenant kill switch at zero', () => {
    const q = resolveAiQuota({
      planIncluded: PLAN_INCLUDED, addonType: 'PRO_500', addonExpiresAt: FUTURE, override: 0,
    });
    expect(q.monthlyQuota).toBe(0);
    expect(q.source).toBe('kill_switch');
  });

  it('clamps a negative override rather than going inverse', () => {
    expect(resolveAiQuota({ planIncluded: 0, override: -50 }).monthlyQuota).toBe(0);
  });
});
