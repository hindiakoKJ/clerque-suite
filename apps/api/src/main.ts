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

    // Always upsert the demo tenant so flags + existence are guaranteed
    // for both first-boot (creates) and subsequent boots (no-op).
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

    // Idempotent user seeder — runs every boot. Each user is created only
    // if missing. Adding new users to this list later (after the demo
    // tenant exists) will still create them on the next deploy.
    async function ensureUser(args: {
      email: string;
      password: string;
      name: string;
      role: 'SUPER_ADMIN' | 'BUSINESS_OWNER' | 'CASHIER';
      branchId: string | null;
      access: Array<{ appCode: 'POS' | 'LEDGER' | 'PAYROLL'; level: 'FULL' | 'OPERATOR' | 'READ_ONLY' | 'CLOCK_ONLY' | 'NONE' }>;
      // For SUPER_ADMIN, lookup is global (email only) — they shouldn't be
      // confused with a tenant-scoped user with the same email in another tenant
      globalLookup?: boolean;
    }) {
      const where = args.globalLookup
        ? { email: args.email }
        : { tenantId: tenant.id, email: args.email };
      const existing = await prisma.user.findFirst({ where });
      if (existing) {
        // Bring access up-to-date if missing (cheap)
        return existing;
      }
      const hash = await bcrypt.hash(args.password, 12);
      await prisma.user.create({
        data: {
          tenantId: tenant.id,
          branchId: args.branchId,
          email:    args.email,
          passwordHash: hash,
          name:     args.name,
          role:     args.role,
          isActive: true,
          appAccess: { create: args.access },
        },
      });
      logger.log(`Seed: created ${args.email} (${args.role})`, 'Bootstrap');
    }

    // 1) Tenant owner — admin@demo.com
    await ensureUser({
      email: EMAIL,
      password: 'Admin1234!',
      name: 'Admin',
      role: 'BUSINESS_OWNER',
      branchId: branch.id,
      access: [
        { appCode: 'POS',     level: 'FULL' },
        { appCode: 'LEDGER',  level: 'FULL' },
        { appCode: 'PAYROLL', level: 'FULL' },
      ],
    });

    // 2) Platform super admin — super@clerque.test (Clerque Console access)
    //    Lives inside the demo tenant by convention; SUPER_ADMIN role bypasses
    //    tenant scoping at the auth layer. globalLookup so we don't create
    //    duplicates if the email exists in another tenant.
    await ensureUser({
      email: 'super@clerque.test',
      password: 'Super1234!',
      name: 'Platform Super Admin',
      role: 'SUPER_ADMIN',
      branchId: null,
      access: [
        { appCode: 'POS',     level: 'FULL' },
        { appCode: 'LEDGER',  level: 'FULL' },
        { appCode: 'PAYROLL', level: 'FULL' },
      ],
      globalLookup: true,
    });

    // 3) Demo cashier — cashier@demo.com
    await ensureUser({
      email: 'cashier@demo.com',
      password: 'Cashier1234!',
      name: 'Demo Cashier',
      role: 'CASHIER',
      branchId: branch.id,
      access: [
        { appCode: 'POS',     level: 'OPERATOR' },
        { appCode: 'LEDGER',  level: 'NONE' },
        { appCode: 'PAYROLL', level: 'CLOCK_ONLY' },
      ],
    });
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
