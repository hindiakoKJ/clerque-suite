import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import compression from 'compression';
import Joi from 'joi';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/prisma-exception.filter';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { envValidationSchema } from './common/config/env.validation';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// ── Bootstrap seed — runs on every start; upsert-safe, no duplicates ─────────
async function runSeed(logger: Logger) {
  const prisma = new PrismaClient();
  try {
    const SLUG = 'demo';
    const EMAIL = 'admin@demo.com';

    // Always refresh demo tenant flags so admin@demo.com can demo every
    // feature regardless of tier:
    //   - aiQuotaOverride: AI features (JE Drafter / Account Picker / Guide)
    //   - isBirRegistered + taxStatus: Tax Estimation page + VAT calculations
    //   - isVatRegistered: legacy boolean kept in sync with taxStatus
    // Idempotent — safe to run on every boot. updateMany returns 0 if the
    // tenant doesn't exist yet (handled by the upsert below).
    await prisma.tenant.updateMany({
      where: { slug: SLUG },
      data:  {
        aiQuotaOverride: 9999,
        isBirRegistered: true,
        isVatRegistered: true,
        taxStatus:       'VAT',
      },
    });

    // Fast-exit: skip seed entirely if demo tenant already exists
    const count = await prisma.tenant.count({ where: { slug: SLUG } });
    if (count > 0) { logger.log('Seed: demo tenant exists — AI quota refreshed, skipped user create', 'Bootstrap'); return; }

    const tenant = await prisma.tenant.upsert({
      where: { slug: SLUG },
      update: {},
      create: {
        name: 'Demo Business', slug: SLUG,
        businessType: 'RETAIL', status: 'ACTIVE',
        tier: 'TIER_1', branchQuota: 3, cashierSeatQuota: 5,
        aiQuotaOverride: 9999,
        isBirRegistered: true,
        isVatRegistered: true,
        taxStatus:       'VAT',
      },
    });

    const branch = await prisma.branch.upsert({
      where: { id: `seed-branch-${tenant.id}` },
      update: {},
      create: { id: `seed-branch-${tenant.id}`, tenantId: tenant.id, name: 'Main Branch', isActive: true },
    });

    const existing = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: EMAIL } });
    if (!existing) {
      const hash = await bcrypt.hash('Admin1234!', 12);
      await prisma.user.create({
        data: {
          tenantId: tenant.id, branchId: branch.id, email: EMAIL,
          passwordHash: hash, name: 'Admin', role: 'BUSINESS_OWNER', isActive: true,
          appAccess: { create: [
            { appCode: 'POS',     level: 'FULL' },
            { appCode: 'LEDGER',  level: 'FULL' },
            { appCode: 'PAYROLL', level: 'FULL' },
          ]},
        },
      });
      logger.log(`Seed: created admin@demo.com (tenant: ${SLUG})`, 'Bootstrap');
    } else {
      logger.log(`Seed: demo tenant already exists — skipped`, 'Bootstrap');
    }

    // Super Admin — for the Clerque Console (cross-tenant ops).
    // Created as a member of the demo tenant for convenience, but the
    // SUPER_ADMIN role grants platform-wide access regardless of which
    // tenant they belong to. Email is the recognisable login.
    const superEmail = 'super@clerque.test';
    const superExists = await prisma.user.findFirst({ where: { email: superEmail } });
    if (!superExists) {
      const hash = await bcrypt.hash('Super1234!', 12);
      await prisma.user.create({
        data: {
          tenantId: tenant.id, branchId: null, email: superEmail,
          passwordHash: hash, name: 'Platform Super Admin',
          role: 'SUPER_ADMIN', isActive: true,
          appAccess: { create: [
            { appCode: 'POS',     level: 'FULL' },
            { appCode: 'LEDGER',  level: 'FULL' },
            { appCode: 'PAYROLL', level: 'FULL' },
          ]},
        },
      });
      logger.log(`Seed: created ${superEmail} (SUPER_ADMIN — Clerque Console access)`, 'Bootstrap');
    }

    // Cashier
    const cashierEmail = 'cashier@demo.com';
    const cashierExists = await prisma.user.findFirst({ where: { tenantId: tenant.id, email: cashierEmail } });
    if (!cashierExists) {
      const hash = await bcrypt.hash('Cashier1234!', 12);
      await prisma.user.create({
        data: {
          tenantId: tenant.id, branchId: branch.id, email: cashierEmail,
          passwordHash: hash, name: 'Demo Cashier', role: 'CASHIER', isActive: true,
          appAccess: { create: [
            { appCode: 'POS',     level: 'OPERATOR' },
            { appCode: 'LEDGER',  level: 'NONE' },
            { appCode: 'PAYROLL', level: 'CLOCK_ONLY' },
          ]},
        },
      });
      logger.log(`Seed: created cashier@demo.com`, 'Bootstrap');
    }
  } catch (err) {
    logger.error(`Seed failed (non-fatal): ${(err as Error).message}`, 'Bootstrap');
  } finally {
    await prisma.$disconnect();
  }
}

async function bootstrap() {
  // ── Validate environment variables before anything else starts ─────────────
  const { error } = envValidationSchema.validate(process.env, {
    allowUnknown: true,
    abortEarly:   false,
  });
  if (error) {
    const missing = error.details.map((d) => `  • ${d.message}`).join('\n');
    // Use console.error here — Logger isn't set up yet
    console.error(`\n[Clerque] ❌ Environment validation failed:\n${missing}\n`);
    process.exit(1);
  }

  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  app.use(compression());

  // Allow configured origins + always allow the known production domains.
  // clerque.hnscorpph.com → tenant-facing apps (POS / Ledger / Sync).
  // console.hnscorpph.com → platform-wide super-admin (Clerque Console).
  // Both share the same Next.js deployment + this same backend.
  const allowedOrigins = [
    ...(process.env.ALLOWED_ORIGINS?.split(',') ?? []),
    'http://localhost:3000',
    'https://clerque.hnscorpph.com',
    'https://console.hnscorpph.com',
  ];
  app.enableCors({ origin: allowedOrigins, credentials: true });

  app.setGlobalPrefix('api/v1');

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new HttpLoggingInterceptor());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ── Swagger / OpenAPI — available in non-production environments ──────────
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Clerque API')
      .setDescription(
        'Multi-tenant POS + Accounting suite API.\n\n' +
        'All endpoints (except `/health`) require a valid JWT Bearer token.\n' +
        'Obtain one via `POST /api/v1/auth/login`.',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'access-token',
      )
      .addTag('Auth',               'Login, refresh, logout, session management')
      .addTag('Users',              'Staff CRUD and role management')
      .addTag('Products',           'Product catalog and barcode lookup')
      .addTag('Categories',         'Product categories')
      .addTag('Inventory',          'Stock levels, adjustments, low-stock alerts')
      .addTag('Orders',             'POS transactions, void, bulk offline sync')
      .addTag('Shifts',             'Cash session open/close')
      .addTag('Reports',            'Daily and shift EOD reports')
      .addTag('Accounting',         'Chart of accounts, journal entries')
      .addTag('Accounting Periods', 'Period open/close/reopen')
      .addTag('Settlement',         'Digital payment reconciliation')
      .addTag('Export',             'Excel report downloads')
      .addTag('BIR',                'BIR compliance: 2550Q, 1701Q, EIS invoices')
      .addTag('Tenant',             'Tenant profile and tax settings')
      .addTag('Health',             'Liveness probe')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
    Logger.log('📖 Swagger docs at /api/docs', 'Bootstrap');
  }

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  logger.log(`🚀 Clerque API running on port ${port}`);

  // Run seed after server is up so DB connection is guaranteed
  await runSeed(logger);
}
bootstrap();
