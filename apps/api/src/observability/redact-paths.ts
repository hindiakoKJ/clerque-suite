/**
 * Fields the structured logger blanks wherever they appear in a log payload.
 * Its own file so the spec can check it without starting the logger.
 */
export const REDACT_PATHS = [
  'password', 'passwordHash', '*.password', '*.passwordHash',
  'token', 'refreshToken', '*.token', '*.refreshToken',
  'creditCard', 'tin', 'tinNumber',
  'authorization', 'cookie',
  // A paired kitchen/bar tablet's credential, however it is logged.
  'deviceToken', '*.deviceToken',
  'headers.authorization', 'headers.cookie', 'headers["x-device-token"]',
  '*.headers.authorization', '*.headers.cookie', '*.headers["x-device-token"]',
];
