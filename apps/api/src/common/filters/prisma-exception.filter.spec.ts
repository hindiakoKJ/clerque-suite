import { BadRequestException, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { GlobalExceptionFilter } from './prisma-exception.filter';

/**
 * What a cashier or barista reads when the database misbehaves. The web app
 * toasts `message[]` word for word, so it must be plain words with somewhere
 * to turn -- never developer commands.
 */
describe('GlobalExceptionFilter', () => {
  const TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
  let logged: string[];

  beforeEach(() => {
    logged = [];
    for (const level of ['error', 'warn'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => { logged.push(args.map(String).join(' ')); });
    }
  });
  afterEach(() => jest.restoreAllMocks());

  function run(exception: unknown, url = '/api/v1/orders') {
    let status = 0;
    let body: any;
    const res = { status: (s: number) => { status = s; return { json: (b: unknown) => { body = b; } }; } };
    const host: any = { switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url, originalUrl: url }), getResponse: () => res }) };
    new GlobalExceptionFilter().catch(exception, host);
    return { status, body: body as { code: string; message: string[]; path: string } };
  }

  const prismaError = (code: string, message = 'Invalid `prisma.order.create()` invocation: column "orders.foo" does not exist') =>
    new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: 'test' });

  const DEVELOPER_WORDS = /prisma|db push|migrate|schema|column|invocation/i;

  it.each(['P2021', 'P2022'])('%s (database behind the code): plain words for staff, the fix only in the log', (code) => {
    const { status, body } = run(prismaError(code));
    expect(status).toBe(500);
    expect(body.code).toBe('SCHEMA_OUT_OF_SYNC');
    expect(body.message).toHaveLength(1);
    expect(body.message[0]).not.toMatch(DEVELOPER_WORDS);
    expect(body.message[0]).toContain('devsupport@hnscorpph.com');
    expect(body.message[0]).toContain(code);
    expect(logged.join('\n')).toContain('prisma migrate deploy');
  });

  it('an unmapped Prisma error in production: plain words, the code kept for support, no detail', () => {
    const old = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { status, body } = run(prismaError('P2037'));
      expect(status).toBe(500);
      expect(body.code).toBe('PRISMA_P2037');
      expect(body.message[0]).toBe('Something went wrong saving this. Please try again. If it keeps happening, email devsupport@hnscorpph.com and mention code P2037.');
      expect(body.message[0]).not.toMatch(DEVELOPER_WORDS);
    } finally {
      process.env.NODE_ENV = old;
    }
  });

  it('a failed raw query (P2010) names support and the code, not "Prisma"', () => {
    const { body } = run(prismaError('P2010'));
    expect(body.code).toBe('RAW_QUERY_FAILED');
    expect(body.message[0]).not.toMatch(DEVELOPER_WORDS);
    expect(body.message[0]).toContain('devsupport@hnscorpph.com');
  });

  it('still maps the everyday ones: duplicate, not found', () => {
    expect(run(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2002', clientVersion: 't', meta: { target: ['sku'] } })).status).toBe(409);
    expect(run(prismaError('P2025')).status).toBe(404);
  });

  it('an ordinary refusal keeps its own words and code', () => {
    const { status, body } = run(new BadRequestException({ code: 'CONFIRMATION_REQUIRED', message: 'Please confirm the shop name.' }));
    expect(status).toBe(400);
    expect(body.code).toBe('CONFIRMATION_REQUIRED');
    expect(body.message).toEqual(['Please confirm the shop name.']);
  });

  it('never writes a device token to the log or echoes it back, even when the request fails', () => {
    const { body } = run(new BadRequestException('Invalid or revoked token'), `/api/v1/display-pairing/whoami?token=${TOKEN}`);
    expect(logged.join('\n')).toContain('/api/v1/display-pairing/whoami?token=[hidden]');
    expect(logged.join('\n')).not.toContain(TOKEN);
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
