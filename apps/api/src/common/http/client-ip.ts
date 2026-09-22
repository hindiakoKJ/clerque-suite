import { BlockList, isIP } from 'net';
import type { NextFunction, Request, Response } from 'express';

/**
 * Who is really calling.
 *
 * Production traffic arrives as  browser -> Cloudflare -> Railway edge -> this
 * process.  Express was told to trust one proxy, so `req.ip` came out as
 * Cloudflare's address: every shop behind the same Cloudflare data centre
 * shared one rate-limit bucket and one bad-login counter, and the login log
 * recorded Cloudflare instead of the shop.
 *
 * Simply trusting two proxies would be worse. The Railway-provided hostname
 * still answers without Cloudflare in front, and a direct caller can put any
 * address it likes in X-Forwarded-For; with two trusted hops that made-up
 * address would become `req.ip`, and the login throttle could be walked
 * around by changing a header. So nothing a caller can type is trusted:
 *
 *   1. Railway writes X-Forwarded-For itself. Measured on production
 *      (2026-09-22, GET /health/ip through Cloudflare, with a forged
 *      X-Forwarded-For and X-Real-IP sent along): the header arrived as
 *      "172.71.87.155, 152.233.15.120" -- the Cloudflare server that
 *      connected to Railway's edge, then Railway's edge itself (a CDN77
 *      address in Singapore), which Railway's inner proxy appends. Whatever
 *      the caller sent was thrown away. So the entry just before Railway's
 *      own hop (RAILWAY_EDGE_HOPS) is the machine that connected to Railway,
 *      and a caller cannot forge it.
 *   2. Only when that machine is one of Cloudflare's published addresses did
 *      the request really come through Cloudflare, and only then is
 *      CF-Connecting-IP (which Cloudflare always overwrites) believed.
 *   3. Otherwise the caller came straight to Railway, and the address Railway
 *      saw IS the caller. Anything further left could only have been typed
 *      by the caller and is ignored.
 *
 * The first version of this file took the LAST entry as the machine that
 * connected to Railway. That was Railway's own edge, so every shop shared
 * one address again. GET /health/ip is the check after any change here.
 *
 * Cloudflare's ranges change about once in several years
 * (https://www.cloudflare.com/ips/). If one is ever missing here the failure
 * is the safe one: those requests are keyed on Cloudflare's address again,
 * exactly as before this file existed. Nothing becomes spoofable.
 */
const CLOUDFLARE_RANGES = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

const cloudflare = new BlockList();
for (const range of CLOUDFLARE_RANGES) {
  const [address, bits] = range.split('/');
  cloudflare.addSubnet(address, Number(bits), address.includes(':') ? 'ipv6' : 'ipv4');
}

/** A clean IPv4 or IPv6 address, or null. "::ffff:1.2.3.4" (IPv4 seen through an IPv6 socket) becomes "1.2.3.4". */
export function normaliseIp(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let a = raw.trim();
  if (a.toLowerCase().startsWith('::ffff:') && isIP(a.slice(7)) === 4) a = a.slice(7);
  return isIP(a) ? a : null;
}

export function isCloudflareIp(raw: unknown): boolean {
  const a = normaliseIp(raw);
  if (!a) return false;
  return cloudflare.check(a, isIP(a) === 4 ? 'ipv4' : 'ipv6');
}

/**
 * How many addresses Railway adds to X-Forwarded-For after the machine that
 * connected to it: one, its edge (see the note at the top). Zero anywhere
 * else -- local development has no proxy in front.
 */
export const RAILWAY_EDGE_HOPS =
  process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID ? 1 : 0;

/**
 * Express "trust proxy" rule. Hop 0 is the socket itself -- Railway's
 * private network, the only thing that can reach this process -- then
 * Railway's edge, and further hops are trusted only while they are
 * Cloudflare. Keeps req.protocol and req.ips honest.
 */
export function trustProxy(address: string, hop: number): boolean {
  return hop <= RAILWAY_EDGE_HOPS || isCloudflareIp(address);
}

export function resolveClientIp(input: {
  socketAddress: string | null | undefined;
  forwardedFor: string | string[] | null | undefined;
  cfConnectingIp: string | string[] | null | undefined;
  /** Addresses the hosting proxy appends after the machine that connected to it (RAILWAY_EDGE_HOPS in production). */
  edgeHops?: number;
}): string | undefined {
  const socket = normaliseIp(input.socketAddress) ?? undefined;
  const header = Array.isArray(input.forwardedFor) ? input.forwardedFor.join(',') : input.forwardedFor ?? '';
  const hops = header.split(',').map((h) => h.trim()).filter(Boolean);
  if (hops.length === 0) return socket;   // nothing in front of us: local development

  // The machine that connected to the hosting proxy: the entry before the proxy's own. A single entry is that machine.
  const peerAt = Math.max(0, hops.length - 1 - (input.edgeHops ?? 0));
  const edgePeer = normaliseIp(hops[peerAt]);
  if (!edgePeer) return socket;
  if (!isCloudflareIp(edgePeer)) return edgePeer;   // came straight to Railway

  // Through Cloudflare. A header sent twice arrives joined by a comma and fails the check, on purpose.
  const viaCloudflare = normaliseIp(Array.isArray(input.cfConnectingIp) ? input.cfConnectingIp.join(',') : input.cfConnectingIp);
  if (viaCloudflare) return viaCloudflare;

  // Cloudflare always sends CF-Connecting-IP; if it ever does not, take the first address to its left that is not Cloudflare's own.
  for (let i = peerAt - 1; i >= 0; i--) {
    const a = normaliseIp(hops[i]);
    if (!a) break;
    if (!isCloudflareIp(a)) return a;
  }
  return edgePeer;
}

/**
 * Pins `req.ip` to the caller worked out above, for everything downstream:
 * the rate limiter, the login log and lockout, the audit trail.
 */
export function clientIpMiddlewareFor(edgeHops: number) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ip = resolveClientIp({
      socketAddress:  req.socket?.remoteAddress,
      forwardedFor:   req.headers['x-forwarded-for'],
      cfConnectingIp: req.headers['cf-connecting-ip'],
      edgeHops,
    });
    if (ip) Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
    next();
  };
}

export const clientIpMiddleware = clientIpMiddlewareFor(RAILWAY_EDGE_HOPS);

/**
 * The bucket an address is rate-limited in. An IPv4 address is its own
 * bucket. An IPv6 customer is handed a whole /64 -- billions of addresses --
 * so the bucket is the /64, or changing the last half of the address would
 * be a free pass around every limit.
 */
export function rateLimitBucket(ip: string | null | undefined): string {
  const a = normaliseIp(ip);
  if (!a) return 'unknown';
  if (isIP(a) === 4) return a;
  const [head, tail = ''] = a.split('::');
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  // An embedded IPv4 tail ("64:ff9b::1.2.3.4") counts as two groups.
  const rightGroups = right.reduce((n, g) => n + (g.includes('.') ? 2 : 1), 0);
  const groups = a.includes('::')
    ? [...left, ...Array(Math.max(0, 8 - left.length - rightGroups)).fill('0'), ...right]
    : left;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '').toLowerCase()).join(':') + '::/64';
}
