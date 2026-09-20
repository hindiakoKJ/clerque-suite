/**
 * Wrong-guess limits for the short codes staff type on a till or tablet.
 *
 * A 4-6 digit PIN or a 4-digit pairing code is only safe if nobody can keep
 * guessing. Without a limit, a cashier can type 1234, a birth year, and so on
 * into the void box at the till, and a script gets through all 10,000
 * four-digit PINs in minutes.
 *
 * The counter is per business (tenant), per kind of check: every wrong
 * supervisor PIN in the shop counts toward the same 5, whichever cashier or
 * till typed it, so spreading guesses over several logins does not help.
 * A right PIN clears the count.
 *
 * Kept in memory, which is right for one API instance. Running several
 * instances would give each its own count; move it to the database or Redis
 * then. Only real tenant ids are used as keys (never a name typed by a
 * stranger), so the map stays as small as the number of businesses.
 */
import { HttpException, HttpStatus } from '@nestjs/common';

export interface PinTry {
  /** The PIN was right: the count for this business starts again. */
  succeeded(): void;
  /** The outcome was not a wrong guess (e.g. a right PIN shared by two people): take this try back. */
  notAGuess(): void;
}

export class PinAttempts {
  private readonly misses = new Map<string, number[]>();

  constructor(
    private readonly maxMisses: number,
    private readonly windowMs: number,
    /** The refusal staff read. Gets the whole minutes left, at least 1. */
    private readonly tooManyMessage: (minutesLeft: number) => string,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Call BEFORE checking the PIN. Refuses (HTTP 429) while this business has
   * had too many wrong tries in the window; even the right PIN waits, or the
   * limit would still answer "right" or "wrong".
   *
   * The try counts as a miss from this moment, and only a right PIN (or
   * notAGuess) takes it back. Counting it after the check instead would let
   * a burst of requests sent together all get past the limit before the
   * first wrong answer was recorded.
   */
  startTry(key: string): PinTry {
    const recent = this.recent(key);
    if (recent.length >= this.maxMisses) {
      // The lock lifts when enough of the oldest misses age out of the window.
      const unlockAt = recent[recent.length - this.maxMisses] + this.windowMs;
      const minutesLeft = Math.max(1, Math.ceil((unlockAt - this.now()) / 60_000));
      throw new HttpException(
        { code: 'TOO_MANY_TRIES', message: this.tooManyMessage(minutesLeft) },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const at = this.now();
    recent.push(at);
    this.misses.set(key, recent);

    let settled = false;
    return {
      succeeded: () => {
        if (settled) return;
        settled = true;
        this.misses.delete(key);
      },
      notAGuess: () => {
        if (settled) return;
        settled = true;
        const list = this.misses.get(key);
        const i = list ? list.indexOf(at) : -1;
        if (list && i >= 0) list.splice(i, 1);
        if (list && list.length === 0) this.misses.delete(key);
      },
    };
  }

  /** Tests only. */
  clear(): void {
    this.misses.clear();
  }

  private recent(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.misses.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length === 0) this.misses.delete(key);
    return kept;
  }
}

const FIFTEEN_MINUTES = 15 * 60_000;

function minutes(n: number): string {
  return n === 1 ? '1 minute' : `${n} minutes`;
}

/** The supervisor PIN a cashier's void or refund needs. */
export const supervisorPinAttempts = new PinAttempts(
  5,
  FIFTEEN_MINUTES,
  (m) =>
    `Too many wrong supervisor PINs. Try again in ${minutes(m)}, ` +
    'or ask the owner or manager to sign in and do it.',
);

/** The till lock: a staff member's own PIN to take over the till. */
export const tillPinAttempts = new PinAttempts(
  5,
  FIFTEEN_MINUTES,
  (m) =>
    `Too many wrong PINs. Try again in ${minutes(m)}, ` +
    'or sign in with your email and password.',
);

/** The 4-digit code a kitchen, bar or customer screen is paired with. */
export const pairingCodeAttempts = new PinAttempts(
  10,
  FIFTEEN_MINUTES,
  (m) =>
    `Too many wrong pairing codes. Try again in ${minutes(m)}, ` +
    'then make a new code in Settings > Displays.',
);
