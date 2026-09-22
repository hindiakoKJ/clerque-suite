import express from 'express';
import request from 'supertest';
import { clientIpMiddleware, clientIpMiddlewareFor, isCloudflareIp, normaliseIp, rateLimitBucket, resolveClientIp, trustProxy } from './client-ip';

/**
 * Who the API believes is calling. The rate limiter, the bad-login lockout
 * and the login log all hang off this one answer, so it must be the shop's
 * real address when the request came through Cloudflare, and must never be
 * something a caller typed into a header.
 */
describe('client IP behind Cloudflare -> Railway', () => {
  const RAILWAY = '100.64.0.3';        // Railway's edge, the socket peer
  const CLOUDFLARE = '162.158.163.10'; // a Cloudflare edge (Manila/Singapore sit in 162.158.0.0/15)
  const CAFE = '112.198.74.21';        // the cafe's public address
  const SCANNER = '45.155.205.9';      // someone hammering the login

  it('knows Cloudflare addresses from everyone else', () => {
    for (const ip of ['162.158.163.10', '104.16.0.1', '172.64.0.1', '172.71.255.254', '173.245.48.1', '2606:4700::6810:1', '2a06:98c0:3600::103', '::ffff:104.16.0.1']) {
      expect(isCloudflareIp(ip)).toBe(true);
    }
    for (const ip of [CAFE, SCANNER, RAILWAY, '172.63.255.255', '172.72.0.1', '104.15.255.255', '2001:4450::1', 'not an ip', '', undefined]) {
      expect(isCloudflareIp(ip)).toBe(false);
    }
  });

  it('through Cloudflare: the shop is the caller, not Cloudflare', () => {
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${CAFE}, ${CLOUDFLARE}`, cfConnectingIp: CAFE })).toBe(CAFE);
    // Whether Railway appends to X-Forwarded-For or replaces it, the answer is the same.
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: CLOUDFLARE, cfConnectingIp: CAFE })).toBe(CAFE);
  });

  it('two shops behind the same Cloudflare edge are two different callers', () => {
    const a = resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${CAFE}, ${CLOUDFLARE}`, cfConnectingIp: CAFE });
    const b = resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${SCANNER}, ${CLOUDFLARE}`, cfConnectingIp: SCANNER });
    expect(a).not.toBe(b);
  });

  it('through Cloudflare: an address the caller typed into X-Forwarded-For is ignored', () => {
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `8.8.8.8, ${SCANNER}, ${CLOUDFLARE}`, cfConnectingIp: SCANNER })).toBe(SCANNER);
  });

  it('straight to Railway: forged CF-Connecting-IP and X-Forwarded-For buy nothing', () => {
    // The caller claims to be the cafe, and even claims a Cloudflare hop; Railway appends who really connected.
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${CAFE}, ${CLOUDFLARE}, ${SCANNER}`, cfConnectingIp: CAFE })).toBe(SCANNER);
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: SCANNER, cfConnectingIp: '1.2.3.4' })).toBe(SCANNER);
  });

  it('a doubled or junk CF-Connecting-IP is not believed; the address Cloudflare reported in X-Forwarded-For is used', () => {
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${CAFE}, ${CLOUDFLARE}`, cfConnectingIp: ['1.1.1.1', CAFE] })).toBe(CAFE);
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${CAFE}, ${CLOUDFLARE}`, cfConnectingIp: 'junk' })).toBe(CAFE);
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: CLOUDFLARE, cfConnectingIp: undefined })).toBe(CLOUDFLARE);
  });

  it('nothing in front (local development, Railway health check): the socket is the caller', () => {
    expect(resolveClientIp({ socketAddress: '::ffff:127.0.0.1', forwardedFor: undefined, cfConnectingIp: undefined })).toBe('127.0.0.1');
    expect(resolveClientIp({ socketAddress: '::1', forwardedFor: '', cfConnectingIp: '9.9.9.9' })).toBe('::1');
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: 'garbage', cfConnectingIp: CAFE })).toBe(RAILWAY);
  });

  it('an IPv6 shop keeps its IPv6 address', () => {
    const v6 = '2001:4450:4a1b:9c00:1c2d:3e4f:5a6b:7c8d';
    expect(resolveClientIp({ socketAddress: RAILWAY, forwardedFor: `${v6}, 2606:4700::6810:1`, cfConnectingIp: v6 })).toBe(v6);
  });

  it('the Express trust rule trusts the socket and Cloudflare, and nobody else', () => {
    expect(trustProxy(RAILWAY, 0)).toBe(true);
    expect(trustProxy(CLOUDFLARE, 1)).toBe(true);
    expect(trustProxy(CAFE, 1)).toBe(false);
    expect(trustProxy(SCANNER, 2)).toBe(false);
  });

  it('normalises what it is given', () => {
    expect(normaliseIp(' 1.2.3.4 ')).toBe('1.2.3.4');
    expect(normaliseIp('::ffff:1.2.3.4')).toBe('1.2.3.4');
    expect(normaliseIp('1.2.3.4:5678')).toBeNull();
    expect(normaliseIp(null)).toBeNull();
  });

  describe('rate-limit bucket', () => {
    it('an IPv4 address is its own bucket', () => {
      expect(rateLimitBucket(CAFE)).toBe(CAFE);
      expect(rateLimitBucket('::ffff:112.198.74.21')).toBe(CAFE);
    });

    it('an IPv6 caller is bucketed by /64, so rotating the back half of the address is not a free pass', () => {
      const a = rateLimitBucket('2001:4450:4a1b:9c00:1c2d:3e4f:5a6b:7c8d');
      const b = rateLimitBucket('2001:4450:4a1b:9c00:ffff:ffff:ffff:0001');
      expect(a).toBe('2001:4450:4a1b:9c00::/64');
      expect(b).toBe(a);
      expect(rateLimitBucket('2001:4450:4a1b:9c01::1')).not.toBe(a);
      expect(rateLimitBucket('2001:0DB8::1')).toBe('2001:db8:0:0::/64');
      expect(rateLimitBucket('::1')).toBe('0:0:0:0::/64');
    });

    it('never throws on junk', () => {
      expect(rateLimitBucket(undefined)).toBe('unknown');
      expect(rateLimitBucket('nope')).toBe('unknown');
    });
  });

  /**
   * The chain exactly as production delivered it on 2026-09-22: Railway
   * replaces X-Forwarded-For with the machine that connected to its edge,
   * then appends its edge (CDN77, Singapore). The first version of the
   * resolver read that last entry and gave every shop Railway's address.
   */
  describe('on Railway, which adds its own edge after the connecting machine', () => {
    const EDGE = '152.233.15.120';     // Railway's edge, appended last
    const CF_SEEN = '172.71.87.155';   // the Cloudflare server Railway saw
    const onRailway = (forwardedFor: string, cfConnectingIp?: string | string[]) =>
      resolveClientIp({ socketAddress: '::ffff:100.64.0.2', forwardedFor, cfConnectingIp, edgeHops: 1 });

    it('the captured production request resolves to the caller, not Railway edge', () => {
      expect(onRailway(`${CF_SEEN}, ${EDGE}`, '136.158.100.44')).toBe('136.158.100.44');
      // What the first version did with the same request.
      expect(resolveClientIp({ socketAddress: '::ffff:100.64.0.2', forwardedFor: `${CF_SEEN}, ${EDGE}`, cfConnectingIp: '136.158.100.44' })).toBe(EDGE);
    });

    it('two shops through the same Cloudflare server and Railway edge are two callers', () => {
      expect(onRailway(`${CF_SEEN}, ${EDGE}`, CAFE)).toBe(CAFE);
      expect(onRailway(`${CF_SEEN}, ${EDGE}`, SCANNER)).toBe(SCANNER);
    });

    it('straight to Railway edge: a forged CF-Connecting-IP buys nothing', () => {
      expect(onRailway(`${SCANNER}, ${EDGE}`, CAFE)).toBe(SCANNER);
    });

    it('if Railway ever kept what the caller typed, the typed part is still ignored', () => {
      expect(onRailway(`8.8.8.8, ${CF_SEEN}, ${EDGE}`, SCANNER)).toBe(SCANNER);
      expect(onRailway(`8.8.8.8, ${SCANNER}, ${EDGE}`, CAFE)).toBe(SCANNER);
    });

    it('if Railway ever stopped adding its edge, a single entry is still the connecting machine', () => {
      expect(onRailway(SCANNER, CAFE)).toBe(SCANNER);
      expect(onRailway(CF_SEEN, CAFE)).toBe(CAFE);
    });

    it('wired into Express the way main.ts does on Railway', async () => {
      const app = express();
      app.set('trust proxy', trustProxy);
      app.use(clientIpMiddlewareFor(1));
      app.get('/ip', (req, res) => { res.json({ ip: req.ip }); });
      const viaCloudflare = await request(app).get('/ip').set('X-Forwarded-For', `${CF_SEEN}, ${EDGE}`).set('CF-Connecting-IP', CAFE);
      expect(viaCloudflare.body.ip).toBe(CAFE);
      const direct = await request(app).get('/ip').set('X-Forwarded-For', `${SCANNER}, ${EDGE}`).set('CF-Connecting-IP', CAFE);
      expect(direct.body.ip).toBe(SCANNER);
    });
  });

  /** The real thing: an Express app with the same two lines main.ts has. */
  describe('wired into Express', () => {
    const app = express();
    app.set('trust proxy', trustProxy);
    app.use(clientIpMiddleware);
    app.get('/ip', (req, res) => { res.json({ ip: req.ip }); });

    it('req.ip is the shop when the request came through Cloudflare', async () => {
      const res = await request(app).get('/ip').set('X-Forwarded-For', `${CAFE}, ${CLOUDFLARE}`).set('CF-Connecting-IP', CAFE);
      expect(res.body.ip).toBe(CAFE);
    });

    it('req.ip is the real caller when someone goes around Cloudflare with forged headers', async () => {
      const res = await request(app).get('/ip').set('X-Forwarded-For', `${CAFE}, ${SCANNER}`).set('CF-Connecting-IP', CAFE);
      expect(res.body.ip).toBe(SCANNER);
    });

    it('req.ip is the socket with no proxy headers at all', async () => {
      const res = await request(app).get('/ip');
      expect(['127.0.0.1', '::1']).toContain(res.body.ip);
    });
  });
});
