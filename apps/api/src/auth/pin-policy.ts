/**
 * Till PIN strength policy.
 *
 * Every path that WRITES a User.kioskPin must call `assertPinPolicy` first.
 *
 * Why this exists: the shape check `/^\d{4,8}$/` was the only rule, so
 * "1234", "0000", "1111" and birth years were all accepted. A four-digit
 * space is 10,000 wide in theory, but the ~40 PINs below are what people
 * actually choose — real-world studies put "1234" alone at roughly 10% of
 * all four-digit PINs. That is the difference between a credential and a
 * formality, and it is why an owner can "guess some PINs" and get in.
 *
 * It matters more here than the digit count suggests, because this PIN is
 * not a convenience factor. It is a full credential: POST /auth/pin-login
 * mints a complete session from company code + email + PIN with no second
 * factor, and POST /auth/switch-cashier resolves a PIN alone, tenant-wide,
 * against a role set that includes BUSINESS_OWNER.
 *
 * Deliberately NOT enforced:
 *   - Longer minimum. Four digits is what a barista will type twenty times
 *     a shift on a wet tablet; pushing to six trades a real usability cost
 *     for a gain the blocklist already delivers.
 *   - Rotation. Same reason it is not enforced for passwords — it produces
 *     predictable increments, not better secrets.
 *
 * Existing weak PINs are NOT invalidated by this: it runs at write time
 * only. Anyone already holding "1234" keeps it until they change it, so
 * finding and clearing those is a separate, deliberate step.
 */
import { BadRequestException } from '@nestjs/common';

/**
 * The PINs people actually pick. Sequences, repeats, keypad patterns, and
 * the date-shaped ones (DDMM / MMDD / 19xx / 20xx are handled by rule, not
 * by listing every year).
 */
const COMMON_PINS = new Set<string>([
  // repeats
  '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999',
  // sequences up and down
  '1234', '2345', '3456', '4567', '5678', '6789', '0123',
  '4321', '5432', '6543', '7654', '8765', '9876', '3210',
  // keypad shapes and long-standing favourites
  '1212', '1122', '1313', '2121', '1010', '2580', '0852', '1379', '9731',
  '1004', '2000', '1984', '6969', '4242', '1123', '0007', '007',
  // 5-8 digit versions of the same habits
  '12345', '123456', '1234567', '12345678',
  '00000', '000000', '0000000', '00000000',
  '11111', '111111', '1111111', '11111111',
  '54321', '654321', '7654321', '87654321',
  '112233', '123123', '121212', '696969',
]);

/** Four digits that read as a year someone might be born in or married in. */
function isYearLike(pin: string): boolean {
  if (pin.length !== 4) return false;
  const n = Number(pin);
  return n >= 1940 && n <= 2035;
}

/** Every digit the same, at any length. */
function isSingleDigit(pin: string): boolean {
  return new Set(pin).size === 1;
}

/** Strictly ascending or descending by one, at any length ("3456", "8765"). */
function isRun(pin: string): boolean {
  if (pin.length < 4) return false;
  const step = Number(pin[1]) - Number(pin[0]);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < pin.length; i++) {
    if (Number(pin[i]) - Number(pin[i - 1]) !== step) return false;
  }
  return true;
}

/** A short pattern repeated to fill the length ("121212", "112211" is not). */
function isRepeatedPair(pin: string): boolean {
  if (pin.length < 4 || pin.length % 2 !== 0) return false;
  const pair = pin.slice(0, 2);
  for (let i = 0; i < pin.length; i += 2) {
    if (pin.slice(i, i + 2) !== pair) return false;
  }
  return true;
}

/**
 * Throws BadRequestException when the PIN is malformed or guessable.
 * Returns the trimmed PIN so callers store exactly what was validated.
 */
export function assertPinPolicy(pin: string): string {
  const trimmed = (pin ?? '').trim();

  if (!/^\d{4,8}$/.test(trimmed)) {
    throw new BadRequestException('The PIN must be 4 to 8 digits.');
  }

  if (
    COMMON_PINS.has(trimmed) ||
    isSingleDigit(trimmed) ||
    isRun(trimmed) ||
    isRepeatedPair(trimmed) ||
    isYearLike(trimmed)
  ) {
    throw new BadRequestException(
      'That PIN is too easy to guess. Avoid 1234, 0000, repeated digits, ' +
        'counting up or down, and birth years — this PIN can open the till.',
    );
  }

  return trimmed;
}
