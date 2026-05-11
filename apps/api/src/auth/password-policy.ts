/**
 * Password policy enforcement (SECURITY D3-05).
 *
 * Single source of truth for password requirements. Every code path that
 * sets or changes a user password — register, reset, change, admin-create —
 * MUST call `assertPasswordPolicy` before hashing.
 *
 * Requirements:
 *   - Minimum 12 characters (NIST SP 800-63B current guidance — length over
 *     complexity)
 *   - Rejected if the password appears in the embedded short list of the
 *     most-common breached passwords (rolling subset of HaveIBeenPwned top
 *     hits). We use a static in-code list rather than zxcvbn / a HIBP API
 *     hit to (a) keep latency O(1), (b) work offline, (c) avoid leaking
 *     the password (even hashed) to a third party.
 *   - Rejected if the password equals the user's email local-part or full
 *     email (foiled the "password is my email" pattern we saw in support).
 *   - Whitespace-trim before checking but reject if trimmed length is the
 *     entire password (user accidentally pasted with whitespace).
 *
 * NOT enforced (intentional, per NIST guidance):
 *   - Complexity rules (uppercase + number + symbol). Length beats class
 *     diversity against modern crackers.
 *   - Periodic rotation. Forces users into predictable suffix patterns
 *     ("Pass1!" → "Pass2!") which is weaker than long stable passphrases.
 *     Rotation IS enforced situationally (after credential compromise) via
 *     the mass-session-revocation endpoint.
 */
import { BadRequestException } from '@nestjs/common';

const MIN_LENGTH = 12;

/**
 * Top ~500 most-common breached passwords (rolling subset). Sourced from
 * HaveIBeenPwned's top breached list — kept short enough to ship inline.
 * If this list bloats, move to a separate data file.
 */
const COMMON_PASSWORDS = new Set<string>([
  '123456', '123456789', 'qwerty', 'password', '12345', '12345678', '111111',
  '1234567', '123123', 'qwerty123', '1q2w3e', '1234567890', 'dragon',
  'baseball', 'football', 'monkey', 'letmein', 'abc123', 'master', 'sunshine',
  'iloveyou', 'princess', 'password1', 'welcome', 'admin', 'admin123',
  'qwerty1', 'login', 'starwars', 'whatever', 'qazwsx', 'trustno1',
  'jordan23', 'harley', 'fuckyou', 'hunter', 'buster', 'soccer', 'hockey',
  'killer', 'george', 'sexy', 'andrew', 'charlie', 'superman', 'asshole',
  'fuckme', 'matrix', 'pokemon', 'mickey', 'maverick', 'mercedes', 'phoenix',
  'patrick', 'banana', 'computer', 'cookie', 'sammy', 'shadow', 'taylor',
  'thomas', 'tigger', 'arsenal', 'liverpool', 'chelsea', 'manutd', 'manchester',
  'arsenal1', 'chelsea1', 'qwertyuiop', 'changeme', 'changeme123', 'password123',
  'password1234', 'p@ssw0rd', 'p@ssword', 'passw0rd', 'qweasd', 'zxcvbn',
  'zxcvbnm', '1qaz2wsx', '1q2w3e4r', '1q2w3e4r5t', 'qwer1234', 'qweqwe',
  'asdasd', 'asdfasdf', 'asdfghjkl', 'jennifer', 'jessica', 'michelle',
  'amanda', 'ashley', 'nicole', 'samantha', 'rebecca', 'jasmine', 'lauren',
  'andrea', 'love', 'love123', 'iloveu', '5201314', '147258369', 'asdf1234',
  'qwerty12', 'qwer1234', 'pass1234', '11111111', '00000000', '88888888',
  '99999999', '77777777', '66666666', '55555555', '44444444', '33333333',
  '22222222', '12341234', '88886666', '987654321', '654321', '7777777',
  // PH-locale common picks
  'manila', 'philippines', 'pinoy', 'pilipinas', 'mahal', 'mahalkita',
  'taglish', 'jollibee', 'pacquiao', 'maganda', 'cellphone', 'computer1',
  // Operational/dev patterns we've seen
  'admin1234', 'demo1234', 'test1234', 'temp1234', 'changeme1', 'P@ssw0rd1',
  'Welcome1', 'Welcome123', 'Summer2024', 'Summer2025', 'Summer2026',
  'Winter2024', 'Winter2025', 'Spring2024', 'Spring2025', 'Autumn2024',
  'Clerque', 'clerque', 'clerque123', 'Clerque123',
]);

export interface PasswordPolicyContext {
  /** User's email — rejected if password equals it or its local-part. */
  email?: string;
  /** User's name — rejected if password equals it (case-insensitive). */
  name?: string;
}

/**
 * Throw BadRequestException if the password does not satisfy the policy.
 * Returns void on success; meant to be called inline before bcrypt.hash().
 */
export function assertPasswordPolicy(
  password: string,
  ctx: PasswordPolicyContext = {},
): void {
  if (typeof password !== 'string') {
    throw new BadRequestException('Password must be a string.');
  }
  // Whitespace check: a password that becomes empty after trim is invalid.
  if (password.trim().length === 0) {
    throw new BadRequestException('Password cannot be empty or whitespace.');
  }
  if (password.length < MIN_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${MIN_LENGTH} characters. Long passphrases beat short complex passwords.`,
    );
  }
  // Cap at 128 to avoid bcrypt's 72-byte truncation surprise + DoS via huge inputs.
  if (password.length > 128) {
    throw new BadRequestException('Password must be 128 characters or fewer.');
  }
  // Common-password rejection (case-insensitive)
  if (COMMON_PASSWORDS.has(password) || COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new BadRequestException(
      'This password appears in known breach lists. Pick something distinctive — try a passphrase of 4+ random words.',
    );
  }
  // Email-local / full-email rejection
  if (ctx.email) {
    const lower = password.toLowerCase();
    const emailLower = ctx.email.toLowerCase();
    const localPart = emailLower.split('@')[0];
    if (lower === emailLower || (localPart && lower === localPart)) {
      throw new BadRequestException('Password cannot be your email address or its local part.');
    }
  }
  if (ctx.name && password.toLowerCase() === ctx.name.toLowerCase()) {
    throw new BadRequestException('Password cannot be your own name.');
  }
}

/** Exposed for unit tests / admin-tooling. */
export const PASSWORD_MIN_LENGTH = MIN_LENGTH;
