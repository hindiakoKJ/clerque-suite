import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { PublicStubController } from './public-stub.controller';
import { LaundryService } from './laundry.service';
import { throttleTracker } from '../common/http/throttle-tracker';

/**
 * The public claim stub over real HTTP, with the rate limiter set up exactly
 * as app.module.ts does it. The global limit is 600 a minute per route and
 * address; the stub route's own limit must be the one that bites.
 */
describe('GET /api/v1/stub/:token — per-address limit', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const laundry = {
      getPublicStub: jest.fn(async (token: string) => {
        if (token === 'good-token') return { claimNumber: 'CLA-2026-000001', status: 'READY_FOR_PICKUP' };
        throw new NotFoundException('Stub not found or expired.');
      }),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [
        ThrottlerModule.forRoot({
          getTracker: (req) => throttleTracker(req),
          throttlers: [
            { name: 'short',  ttl: 1000,    limit: 30 },
            { name: 'medium', ttl: 10_000,  limit: 100 },
            { name: 'long',   ttl: 60_000,  limit: 600 },
          ],
        }),
      ],
      controllers: [PublicStubController],
      providers: [
        { provide: LaundryService, useValue: laundry },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('20 lookups a minute from one address are answered; the 21st waits, even for a real link', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 19; i++) {
      await request(server).get(`/api/v1/stub/CLA-2026-000001-${String(i).padStart(4, 'A')}`).expect(404);
    }
    await request(server).get('/api/v1/stub/good-token').expect(200);
    await request(server).get('/api/v1/stub/good-token').expect(429);
    await request(server).get('/api/v1/stub/CLA-2026-000001-ZZZZ').expect(429);
  });
});
