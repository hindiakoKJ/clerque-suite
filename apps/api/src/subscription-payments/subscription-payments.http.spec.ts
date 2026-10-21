import { INestApplication, NotFoundException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { SubscriptionPaymentsController } from './subscription-payments.controller';
import { SubscriptionPaymentsService } from './subscription-payments.service';
import { throttleTracker } from '../common/http/throttle-tracker';

/**
 * The public payment routes over real HTTP, with the rate limiter set up
 * exactly as app.module.ts does it. The global limit (600 a minute per route
 * and address) is what let a script walk the old 5-letter codes; each public
 * route now has its own, much tighter one.
 */
describe('Public subscription-payment routes — per-address limits', () => {
  let app: INestApplication;
  const CODE = 'RENEW-7Z2K-M4PQ-X9TB-3HNC';

  beforeEach(async () => {
    const payment = {
      referenceCode: CODE, planCode: 'CLERQUE', amountPhpCents: 19900,
      periodStart: new Date('2026-10-01'), periodEnd: new Date('2026-11-01'),
      reason: 'MONTHLY_RENEWAL', status: 'AWAITING_PROOF', submittedAt: null,
      expiresAt: new Date('2026-11-01'), tenant: { name: 'Kape Tayo', slug: 'kape-tayo' },
    };
    const svc = {
      getByReferenceCode: jest.fn(async (code: string) => {
        if (code === CODE) return payment;
        throw new NotFoundException(`No pending payment for reference ${code}.`);
      }),
      submitProof: jest.fn(async () => ({ status: 'PROOF_SUBMITTED' })),
      getPublicPaymentMethods: jest.fn(async () => []),
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
      controllers: [SubscriptionPaymentsController],
      providers: [
        { provide: SubscriptionPaymentsService, useValue: svc },
        { provide: APP_GUARD, useClass: ThrottlerGuard },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterEach(async () => { await app.close(); });

  it('reading a payment: 10 a minute from one address, then 429', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 9; i++) {
      await request(server).get(`/api/v1/subscription-payments/public/RENEW-AAA${i}`).expect(404);
    }
    const ok = await request(server).get(`/api/v1/subscription-payments/public/${CODE}`).expect(200);
    expect(ok.body).toMatchObject({ referenceCode: CODE, tenantName: 'Kape Tayo', status: 'AWAITING_PROOF' });
    expect(ok.body).not.toHaveProperty('tenantId');
    await request(server).get(`/api/v1/subscription-payments/public/${CODE}`).expect(429);
  });

  it('sending proof: 5 per 10 minutes from one address, then 429', async () => {
    const server = app.getHttpServer();
    const proof = { submittedRefId: 'MAYA-123456', submittedMethod: 'MAYA' };
    for (let i = 0; i < 5; i++) {
      await request(server).post(`/api/v1/subscription-payments/public/${CODE}/submit-proof`).send(proof).expect(201);
    }
    await request(server).post(`/api/v1/subscription-payments/public/${CODE}/submit-proof`).send(proof).expect(429);
  });

  it('the payment-methods list is not caught by the reading limit', async () => {
    const server = app.getHttpServer();
    for (let i = 0; i < 12; i++) {
      await request(server).get('/api/v1/subscription-payments/public/payment-methods').expect(200);
    }
  });
});
