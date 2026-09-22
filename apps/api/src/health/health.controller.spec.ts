import { HttpException, Logger } from '@nestjs/common';
import { HealthController } from './health.controller';

/** The health check is public: it may say "the database is down", never why. */
describe('HealthController', () => {
  const PRISMA_ERROR =
    "Can't reach database server at `postgres-prod.railway.internal:5432`. Please make sure your database server is running (user clerque_admin).";

  afterEach(() => jest.restoreAllMocks());

  it('says ok when the database answers', async () => {
    const ctrl = new HealthController({ $queryRaw: jest.fn(async () => [{ '?column?': 1 }]) } as never);
    await expect(ctrl.check()).resolves.toMatchObject({ status: 'ok', db: 'ok' });
  });

  it('a database outage is a 503 with a plain message, and the real reason only in the log', async () => {
    const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ctrl = new HealthController({ $queryRaw: jest.fn(async () => { throw new Error(PRISMA_ERROR); }) } as never);

    const err: HttpException = await ctrl.check().then(() => { throw new Error('expected a 503'); }, (e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(503);

    const body = JSON.stringify(err.getResponse());
    expect(body).toContain('The database is not reachable right now.');
    expect(body).toContain('DB_UNREACHABLE');
    for (const leak of ['railway.internal', '5432', 'clerque_admin', 'dbError']) expect(body).not.toContain(leak);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining('postgres-prod.railway.internal:5432'));
  });

  it('tells a caller the address the API sees for them', () => {
    const ctrl = new HealthController({} as never);
    expect(ctrl.ip({ ip: '112.198.74.21' } as never)).toEqual({ ip: '112.198.74.21' });
    expect(ctrl.ip({} as never)).toEqual({ ip: null });
  });
});
