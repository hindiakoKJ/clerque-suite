import { HttpException } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import {
  ReceiptReadLimitGuard, ReceiptReadLedger, ReleaseReceiptReadInterceptor,
  resolveDailyReadLimit, startOfShopDay, receiptReadsToday,
  DEFAULT_RECEIPT_READS_PER_DAY, RECEIPT_READ_ACTION,
} from './receipt-read-limit.guard';

/**
 * The daily cap is the owner's cost circuit breaker, and the number is theirs
 * to change without a deploy. What is pinned here: the knob is read the way
 * the comments say, the day is Manila's day, the wall is a 429 with a shape
 * the screen can explain, and a read under the cap passes with the count
 * attached so the screen can say how many are left.
 */
describe('ReceiptReadLimitGuard', () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  function ctx(user: any) {
    const req: any = { user };
    return {
      req,
      ctx: { switchToHttp: () => ({ getRequest: () => req }) } as any,
    };
  }
  function prismaWith(count: number) {
    return { aiUsage: { count: jest.fn().mockResolvedValue(count) } } as any;
  }

  describe('the knob', () => {
    it('defaults to 50 a day', () => {
      delete process.env.AI_RECEIPT_READS_PER_DAY;
      delete process.env.AI_RECEIPT_READS_PER_DAY_BY_TENANT;
      expect(resolveDailyReadLimit('t1')).toBe(DEFAULT_RECEIPT_READS_PER_DAY);
      expect(DEFAULT_RECEIPT_READS_PER_DAY).toBe(50);
    });

    it('reads the deployment setting, and a tenant override on top of it', () => {
      process.env.AI_RECEIPT_READS_PER_DAY = '20';
      expect(resolveDailyReadLimit('t1')).toBe(20);
      process.env.AI_RECEIPT_READS_PER_DAY_BY_TENANT = JSON.stringify({ t1: 5, t2: 0 });
      expect(resolveDailyReadLimit('t1')).toBe(5);
      expect(resolveDailyReadLimit('t2')).toBe(0);      // zero is a real setting: switched off
      expect(resolveDailyReadLimit('t3')).toBe(20);     // not in the map -> deployment default
    });

    it('treats a blank value as "not set", never as zero', () => {
      // Clearing the variable in Railway leaves "", and null is how an
      // override is removed from the map. Neither may switch a shop off.
      process.env.AI_RECEIPT_READS_PER_DAY = '';
      expect(resolveDailyReadLimit('t1')).toBe(50);
      process.env.AI_RECEIPT_READS_PER_DAY = '   ';
      expect(resolveDailyReadLimit('t1')).toBe(50);
      process.env.AI_RECEIPT_READS_PER_DAY = '30';
      process.env.AI_RECEIPT_READS_PER_DAY_BY_TENANT = JSON.stringify({ t1: null, t2: '', t3: [], t4: '12' });
      expect(resolveDailyReadLimit('t1')).toBe(30);
      expect(resolveDailyReadLimit('t2')).toBe(30);
      expect(resolveDailyReadLimit('t3')).toBe(30);
      expect(resolveDailyReadLimit('t4')).toBe(30);   // a string is not a number here; zero has to be typed as 0
    });

    it('ignores a broken or negative setting rather than switching everyone off', () => {
      process.env.AI_RECEIPT_READS_PER_DAY = 'lots';
      expect(resolveDailyReadLimit('t1')).toBe(50);
      process.env.AI_RECEIPT_READS_PER_DAY = '-3';
      expect(resolveDailyReadLimit('t1')).toBe(50);
      process.env.AI_RECEIPT_READS_PER_DAY = '30';
      process.env.AI_RECEIPT_READS_PER_DAY_BY_TENANT = '{not json';
      expect(resolveDailyReadLimit('t1')).toBe(30);
    });
  });

  describe('the day', () => {
    it('starts at midnight in Manila, not UTC', () => {
      // 23:30 UTC on the 1st is 07:30 on the 2nd in Manila: the day has turned.
      const start = startOfShopDay(new Date('2026-09-01T23:30:00Z'));
      expect(start.toISOString()).toBe('2026-09-01T16:00:00.000Z');   // 2026-09-02 00:00 +08:00
      // 15:59 UTC on the 1st is still 23:59 on the 1st in Manila.
      const late = startOfShopDay(new Date('2026-09-01T15:59:00Z'));
      expect(late.toISOString()).toBe('2026-08-31T16:00:00.000Z');    // 2026-09-01 00:00 +08:00
    });

    it('counts only this tenant\'s receipt reads since that midnight', async () => {
      const prisma = prismaWith(3);
      const r = await receiptReadsToday(prisma, 't1', new Date('2026-09-02T04:00:00Z'));
      expect(prisma.aiUsage.count).toHaveBeenCalledWith({
        where: {
          tenantId: 't1', action: RECEIPT_READ_ACTION, createdAt: { gte: new Date('2026-09-01T16:00:00.000Z') },
          // a provider rejection that spent nothing is not a read
          OR: [{ success: true }, { inputTokens: { gt: 0 } }],
        },
      });
      expect(r.usedToday).toBe(3);
      expect(r.resetsAt).toBe('2026-09-02T16:00:00.000Z');
    });
  });

  describe('the wall', () => {
    it('lets a read through under the cap and says how many were used', async () => {
      process.env.AI_RECEIPT_READS_PER_DAY = '50';
      const guard = new ReceiptReadLimitGuard(prismaWith(12), new ReceiptReadLedger());
      const { req, ctx: c } = ctx({ tenantId: 't1' });
      await expect(guard.canActivate(c)).resolves.toBe(true);
      expect(req.receiptReads).toMatchObject({ usedToday: 12, limit: 50 });
    });

    it('refuses the fifty-first with a 429 the screen can explain', async () => {
      process.env.AI_RECEIPT_READS_PER_DAY = '50';
      const guard = new ReceiptReadLimitGuard(prismaWith(50), new ReceiptReadLedger());
      const { ctx: c } = ctx({ tenantId: 't1' });
      let err: any;
      try { await guard.canActivate(c); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({ code: 'RECEIPT_READS_EXHAUSTED', limit: 50, usedToday: 50 });
      expect(err.getResponse().message).toMatch(/50 receipt reads are used up/);
    });

    it('a cap of zero is "switched off", said in those words', async () => {
      process.env.AI_RECEIPT_READS_PER_DAY_BY_TENANT = JSON.stringify({ t1: 0 });
      const guard = new ReceiptReadLimitGuard(prismaWith(0), new ReceiptReadLedger());
      const { ctx: c } = ctx({ tenantId: 't1' });
      await expect(guard.canActivate(c)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'RECEIPT_READS_EXHAUSTED', limit: 0 }) });
      try { await guard.canActivate(c); } catch (e: any) { expect(e.getResponse().message).toMatch(/switched off/); }
    });

    it('does not apply to a request with no tenant -- that is the auth guard\'s refusal', async () => {
      const guard = new ReceiptReadLimitGuard(prismaWith(999), new ReceiptReadLedger());
      const { ctx: c } = ctx(undefined);
      await expect(guard.canActivate(c)).resolves.toBe(true);
    });

    it('does not exempt a platform admin: a read costs the same whoever asks', async () => {
      process.env.AI_RECEIPT_READS_PER_DAY = '1';
      const guard = new ReceiptReadLimitGuard(prismaWith(1), new ReceiptReadLedger());
      const { ctx: c } = ctx({ tenantId: 't1', isSuperAdmin: true });
      await expect(guard.canActivate(c)).rejects.toBeInstanceOf(HttpException);
    });
  });

  describe('the window between asking and the provider answering', () => {
    it('a read still in flight counts, so a burst at the cap does not all pass', async () => {
      /*
        The AiUsage row lands only after the provider answers. Two requests
        at 49 of 50 both see 49 in the database; the ledger makes the second
        see 50.
      */
      process.env.AI_RECEIPT_READS_PER_DAY = '50';
      const ledger = new ReceiptReadLedger();
      const guard = new ReceiptReadLimitGuard(prismaWith(49), ledger);
      const a = ctx({ tenantId: 't1' });
      const b = ctx({ tenantId: 't1' });
      await expect(guard.canActivate(a.ctx)).resolves.toBe(true);
      expect(a.req.receiptReads.usedToday).toBe(49);
      await expect(guard.canActivate(b.ctx)).rejects.toMatchObject({ response: expect.objectContaining({ usedToday: 50 }) });
      expect(ledger.pending('t1')).toBe(1);
    });

    it('the reservation is released when the request ends, even by an error', () => {
      const ledger = new ReceiptReadLedger();
      ledger.reserve('t1');
      const icpt = new ReleaseReceiptReadInterceptor(ledger);
      const req: any = { user: { tenantId: 't1' }, receiptReads: { usedToday: 1, limit: 50, resetsAt: '' } };
      const c: any = { switchToHttp: () => ({ getRequest: () => req }) };

      icpt.intercept(c, { handle: () => throwError(() => new Error('validation failed')) }).subscribe({ error: () => undefined });
      expect(ledger.pending('t1')).toBe(0);

      ledger.reserve('t1');
      icpt.intercept(c, { handle: () => of({ ok: true }) }).subscribe();
      expect(ledger.pending('t1')).toBe(0);
    });

    it('does not release what it never reserved', () => {
      const ledger = new ReceiptReadLedger();
      ledger.reserve('t1');
      const icpt = new ReleaseReceiptReadInterceptor(ledger);
      const req: any = { user: { tenantId: 't1' } };   // no receiptReads: the guard did not run
      const c: any = { switchToHttp: () => ({ getRequest: () => req }) };
      icpt.intercept(c, { handle: () => of(1) }).subscribe();
      expect(ledger.pending('t1')).toBe(1);
    });

    it('other tenants\' reads in flight are not this tenant\'s', async () => {
      process.env.AI_RECEIPT_READS_PER_DAY = '1';
      const ledger = new ReceiptReadLedger();
      ledger.reserve('other');
      const guard = new ReceiptReadLimitGuard(prismaWith(0), ledger);
      await expect(guard.canActivate(ctx({ tenantId: 't1' }).ctx)).resolves.toBe(true);
    });
  });
});
