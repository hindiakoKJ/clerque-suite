import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
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

    const tenant = await prisma.tenant.upsert({
      where: { slug: SLUG },
      update: {},
      create: {
        name: 'Demo Business', slug: SLUG,
        businessType: 'RETAIL', status: 'ACTIVE',
        tier: 'TIER_1', branchQuota: 3, cashierSeatQuota: 5,
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

  // Allow configured origins + always allow the known production domain
  const allowedOrigins = [
    ...(process.env.ALLOWED_ORIGINS?.split(',') ?? []),
    'http://localhost:3000',
    'https://clerque.hnscorpph.com',
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
