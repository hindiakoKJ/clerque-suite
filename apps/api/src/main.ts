import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import Joi from 'joi';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/prisma-exception.filter';
import { HttpLoggingInterceptor } from './common/interceptors/http-logging.interceptor';
import { envValidationSchema } from './common/config/env.validation';

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

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  });

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
  Logger.log(`🚀 Clerque API running on port ${port}`, 'Bootstrap');
}
bootstrap();
