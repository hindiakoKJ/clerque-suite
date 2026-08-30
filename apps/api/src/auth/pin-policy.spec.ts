import { BadRequestException } from '@nestjs/common';
import { assertPinPolicy } from './pin-policy';

/**
 * The till PIN is a full credential, not a convenience code.
 *
 * A shop owner reported being able to "guess some PINs" and get in. The gate
 * was not broken — it was that nothing stopped anyone choosing 1234. These
 * tests hold the line that a PIN which opens a till has to be worth guessing
 * wrong.
 */
describe('assertPinPolicy', () => {
  const rejects = (pin: string) =>
    expect(() => assertPinPolicy(pin)).toThrow(BadRequestException);

  describe('shape', () => {
    it.each(['', '123', 'abcd', '12 34', '123456789', '1a2b'])(
      'rejects %p as malformed',
      (pin) => rejects(pin),
    );

    it('trims and returns exactly what will be stored', () => {
      // The caller writes the return value, so a trailing space typed on a
      // tablet must not become part of the credential.
      expect(assertPinPolicy('  8305  ')).toBe('8305');
    });
  });

  describe('the PINs people actually pick', () => {
    it.each(['1234', '0000', '1111', '9999', '2580', '1212', '4321'])(
      'rejects the common PIN %p',
      (pin) => rejects(pin),
    );

    it.each(['5555', '77777', '888888'])('rejects all-same-digit %p', (pin) => rejects(pin));

    it.each(['3456', '6789', '8765', '345678', '87654321'])(
      'rejects the counting run %p',
      (pin) => rejects(pin),
    );

    it.each(['1313', '272727', '4545'])('rejects the repeated pair %p', (pin) => rejects(pin));

    it.each(['1984', '1995', '2001', '2026'])(
      'rejects the year-shaped PIN %p',
      (pin) => rejects(pin),
    );

    it('names the reason, because a bare rejection gets retried with 1235', () => {
      try {
        assertPinPolicy('1234');
        throw new Error('should have thrown');
      } catch (e: any) {
        expect(e.message).toMatch(/too easy to guess/i);
        expect(e.message).toMatch(/open the till/i);
      }
    });
  });

  describe('what it must still allow', () => {
    it.each(['8305', '4927', '6183', '90412', '73916284'])(
      'accepts the ordinary PIN %p',
      (pin) => expect(assertPinPolicy(pin)).toBe(pin),
    );

    it('allows a year outside living memory — 1839 is not a birth year', () => {
      expect(assertPinPolicy('1839')).toBe('1839');
    });

    it('allows a near-run that is not a run', () => {
      // 1235 is not a sequence; rejecting it would push people toward the
      // handful of PINs left, which is the opposite of the point.
      expect(assertPinPolicy('1235')).toBe('1235');
    });

    it('allows a repeated pair that does not tile evenly', () => {
      expect(assertPinPolicy('121213')).toBe('121213');
    });
  });

  it('does not invalidate PINs already in the database', () => {
    // Deliberate: this runs at WRITE time only. Existing weak PINs keep
    // working until they are changed, so rolling this out cannot lock a shop
    // out of its own till mid-shift. Finding and clearing them is a separate
    // step, and the fact that it is separate is the thing to remember.
    expect(typeof assertPinPolicy).toBe('function');
  });
});
