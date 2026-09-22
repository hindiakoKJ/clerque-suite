import { JwtService } from '@nestjs/jwt';
import { rateLimitBucket } from './client-ip';

/**
 * Whose rate-limit bucket a request counts against.
 *
 * A shop's till, its kitchen and bar tablets and the owner's laptop all leave
 * through one router, so by address alone they are one caller -- and on
 * mobile data a whole neighbourhood can share an address. Signed-in traffic
 * is therefore counted per person: a request carrying an access token that
 * REALLY verifies (our signature, not expired) is bucketed by that user.
 *
 * Everything else stays per address, on purpose:
 *   - no token, a forged or expired token, a refresh or 2FA-challenge token;
 *   - every /auth/ route -- signing in, PIN, password reset. Those are the
 *     routes someone guesses against, and a guesser must not be able to move
 *     to a fresh bucket by attaching a token from an account of their own;
 *   - paired-tablet device tokens. Checking one means a database read, and an
 *     unchecked one is just a string the caller chose: honouring it would let
 *     anyone mint a new bucket per request.
 *
 * The limiter runs before any login guard, so `req.user` does not exist yet;
 * that is why the token is verified here. It is one HMAC, done once per
 * request. Any failure at all falls back to the address.
 *
 * Note the buckets are already per route (the limiter's key includes the
 * controller and handler), so "30 a second" means 30 calls to ONE endpoint.
 */

const AUTH_ROUTES = /^\/api\/v\d+\/auth(\/|$)/;
const CACHE = Symbol('throttleTracker');
const jwt = new JwtService({});

interface TrackedRequest {
  ip?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  [CACHE]?: string;
}

/** The user id inside a genuine, unexpired ACCESS token; null for anything else. */
export function verifiedUserId(authorization: unknown, secret: string | undefined = process.env.JWT_ACCESS_SECRET): string | null {
  if (!secret || typeof authorization !== 'string' || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (token.split('.').length !== 3) return null;   // a 32-hex device token, an API key: not ours to check
  try {
    const claims = jwt.verify<{ sub?: unknown; kind?: unknown; type?: unknown }>(token, { secret, algorithms: ['HS256'] });
    // Same rule as JwtStrategy: a 2FA challenge (kind) or a refresh token (type) signs nobody in.
    if (claims.kind !== undefined || claims.type !== undefined) return null;
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

export function throttleTracker(req: TrackedRequest): string {
  const cached = req[CACHE];
  if (cached) return cached;
  let tracker = `ip:${rateLimitBucket(req.ip)}`;
  try {
    const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
    if (!AUTH_ROUTES.test(path)) {
      const userId = verifiedUserId(req.headers?.['authorization']);
      if (userId) tracker = `user:${userId}`;
    }
  } catch {
    // keep the address
  }
  req[CACHE] = tracker;
  return tracker;
}
