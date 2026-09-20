import { HttpException, HttpStatus } from '@nestjs/common';
import {
  PinAttempts,
  pairingCodeAttempts,
  supervisorPinAttempts,
  tillPinAttempts,
} from './pin-attempts';

/**
 * The wrong-guess limit behind the supervisor PIN, the till lock and screen
 * pairing. A short code is only as strong as the number of guesses allowed.
 */
describe('PinAttempts', () => {
  const MIN = 60_000;
  let clock: number;
  const build = (max = 5, windowMs = 15 * MIN) =>
    new PinAttempts(max, windowMs, (m) => `Wait ${m}`, () => clock);

  beforeEach(() => {
    clock = 1_000_000;
  });

  function refusal(fn: () => unknown): HttpException {
    try {
      fn();
    } catch (e) {
      return e as HttpException;
    }
    throw new Error('expected a refusal');
  }

  /** A try that turns out wrong: nothing is called after it starts. */
  const miss = (tries: PinAttempts, key = 't1') => tries.startTry(key);

  it('allows 5 wrong tries, then refuses the 6th with a 429 in plain words', () => {
    const tries = build();
    for (let i = 0; i < 5; i++) expect(() => miss(tries)).not.toThrow();
    const err = refusal(() => tries.startTry('t1'));
    expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(err.getResponse()).toEqual({ code: 'TOO_MANY_TRIES', message: 'Wait 15' });
  });

  it('a burst sent together cannot slip past: each try counts the moment it starts', () => {
    // 20 requests arrive before any PIN check finishes.
    const tries = build();
    let admitted = 0;
    for (let i = 0; i < 20; i++) {
      try {
        tries.startTry('t1');
        admitted++;
      } catch {
        /* refused */
      }
    }
    expect(admitted).toBe(5);
  });

  it('counts per business: another tenant is not locked out', () => {
    const tries = build();
    for (let i = 0; i < 5; i++) miss(tries, 't1');
    expect(() => tries.startTry('t1')).toThrow(HttpException);
    expect(() => tries.startTry('t2')).not.toThrow();
  });

  it('a right PIN clears the count', () => {
    const tries = build();
    for (let i = 0; i < 4; i++) miss(tries);
    tries.startTry('t1').succeeded();
    for (let i = 0; i < 5; i++) expect(() => miss(tries)).not.toThrow();
    expect(() => tries.startTry('t1')).toThrow(HttpException);
  });

  it('an outcome that is not a wrong guess is taken back', () => {
    const tries = build();
    for (let i = 0; i < 4; i++) miss(tries);
    tries.startTry('t1').notAGuess();
    expect(() => miss(tries)).not.toThrow(); // still only the 5th real miss
    expect(() => tries.startTry('t1')).toThrow(HttpException);
  });

  it('lifts when the oldest misses are 15 minutes old, and says how long is left', () => {
    const tries = build();
    miss(tries); // at 0
    clock += 10 * MIN;
    for (let i = 0; i < 4; i++) miss(tries); // at 10 min
    // Locked; the first miss ages out at 15 min, 5 minutes from now.
    expect(refusal(() => tries.startTry('t1')).getResponse()).toEqual({
      code: 'TOO_MANY_TRIES',
      message: 'Wait 5',
    });
    clock += 5 * MIN + 1;
    expect(() => tries.startTry('t1')).not.toThrow();
  });

  it('never says 0 minutes', () => {
    const tries = build();
    for (let i = 0; i < 5; i++) miss(tries);
    clock += 15 * MIN - 1;
    expect(refusal(() => tries.startTry('t1')).getResponse()).toEqual({
      code: 'TOO_MANY_TRIES',
      message: 'Wait 1',
    });
  });

  it('the shop-wide limits are 5 PINs and 10 pairing codes, with staff-readable refusals', () => {
    for (const t of [supervisorPinAttempts, tillPinAttempts, pairingCodeAttempts]) t.clear();
    for (let i = 0; i < 5; i++) {
      supervisorPinAttempts.startTry('t1');
      tillPinAttempts.startTry('t1');
      pairingCodeAttempts.startTry('t1');
    }
    const sup = refusal(() => supervisorPinAttempts.startTry('t1')).getResponse() as { message: string };
    expect(sup.message).toMatch(
      /^Too many wrong supervisor PINs\. Try again in \d+ minutes?, or ask the owner or manager to sign in and do it\.$/,
    );
    const till = refusal(() => tillPinAttempts.startTry('t1')).getResponse() as { message: string };
    expect(till.message).toMatch(
      /^Too many wrong PINs\. Try again in \d+ minutes?, or sign in with your email and password\.$/,
    );
    // Pairing allows 10.
    for (let i = 0; i < 5; i++) expect(() => pairingCodeAttempts.startTry('t1')).not.toThrow();
    const pair = refusal(() => pairingCodeAttempts.startTry('t1')).getResponse() as { message: string };
    expect(pair.message).toMatch(/^Too many wrong pairing codes\. .*Settings > Displays\.$/);
    for (const t of [supervisorPinAttempts, tillPinAttempts, pairingCodeAttempts]) t.clear();
  });
});
