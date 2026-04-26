import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

/**
 * Global exception filter — centralises all error handling so no internals
 * ever leak to the client and every error has a consistent shape:
 *
 *   { statusCode, code, message[], path, timestamp }
 *
 * Prisma known-request errors are mapped to meaningful HTTP status codes.
 * All unhandled errors are returned as 500 with a generic message.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx  = host.switchToHttp();
    const req  = ctx.getRequest<Request>();
    const res  = ctx.getResponse<Response>();

    const { status, code, messages } = this.classify(exception);

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.url} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(`${req.method} ${req.url} → ${status}: ${messages.join('; ')}`);
    }

    res.status(status).json({
      statusCode: status,
      code,
      message: messages,
      path:      req.url,
      timestamp: new Date().toISOString(),
    });
  }

  // ─── Classification ────────────────────────────────────────────────────────

  private classify(exception: unknown): {
    status:   number;
    code:     string;
    messages: string[];
  } {
    // 1. NestJS HttpExceptions (guards, @Roles, manual throws, etc.)
    if (exception instanceof HttpException) {
      const status   = exception.getStatus();
      const response = exception.getResponse();
      const messages = this.extractMessages(response);
      return { status, code: 'HTTP_EXCEPTION', messages };
    }

    // 2. Prisma known request errors
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaKnown(exception);
    }

    // 3. Prisma validation errors (e.g., wrong field type in query)
    if (exception instanceof Prisma.PrismaClientValidationError) {
      return {
        status:   HttpStatus.BAD_REQUEST,
        code:     'VALIDATION_ERROR',
        messages: ['Invalid data provided. Please check your request.'],
      };
    }

    // 4. Fallback — unexpected errors (don't leak internals)
    return {
      status:   HttpStatus.INTERNAL_SERVER_ERROR,
      code:     'INTERNAL_ERROR',
      messages: ['An unexpected error occurred. Please try again later.'],
    };
  }

  // ─── Prisma P-code mapping ─────────────────────────────────────────────────

  private mapPrismaKnown(err: Prisma.PrismaClientKnownRequestError): {
    status:   number;
    code:     string;
    messages: string[];
  } {
    switch (err.code) {
      // Unique constraint violated → 409 Conflict
      case 'P2002': {
        const fields = Array.isArray(err.meta?.['target'])
          ? (err.meta!['target'] as string[]).join(', ')
          : 'field';
        return {
          status:   HttpStatus.CONFLICT,
          code:     'DUPLICATE_ENTRY',
          messages: [`A record with this ${fields} already exists.`],
        };
      }

      // Record not found (findUniqueOrThrow / findFirstOrThrow / update / delete) → 404
      case 'P2025':
        return {
          status:   HttpStatus.NOT_FOUND,
          code:     'RECORD_NOT_FOUND',
          messages: [(err.meta?.['cause'] as string | undefined) ?? 'Record not found.'],
        };

      // Foreign key constraint violated → 400
      case 'P2003':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'FOREIGN_KEY_VIOLATION',
          messages: ['The referenced record does not exist.'],
        };

      // Required relation not satisfied → 400
      case 'P2014':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'RELATION_VIOLATION',
          messages: ['The requested change violates a required relation.'],
        };

      // Transaction write conflict / deadlock → 409
      case 'P2034':
        return {
          status:   HttpStatus.CONFLICT,
          code:     'TRANSACTION_CONFLICT',
          messages: ['A concurrent write conflict occurred. Please retry.'],
        };

      // Null constraint violated → 400
      case 'P2011':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'NULL_CONSTRAINT',
          messages: ['A required field is missing.'],
        };

      // Value too long for column → 400
      case 'P2000':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'VALUE_TOO_LONG',
          messages: ['One or more field values exceed the maximum allowed length.'],
        };

      // Raw query failed (e.g. bad SQL syntax, incompatible PostgreSQL function) → 400
      case 'P2010':
        this.logger.error(`Raw query failed [${err.code}]`, err.message);
        return {
          status:   HttpStatus.INTERNAL_SERVER_ERROR,
          code:     'RAW_QUERY_FAILED',
          messages: ['A database query failed. Please try again or contact support.'],
        };

      // Check constraint failed → 400
      case 'P2004':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'CHECK_CONSTRAINT',
          messages: ['The submitted data failed a database validation rule.'],
        };

      // Invalid value type for column → 400
      case 'P2006':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'INVALID_VALUE',
          messages: ['One or more field values have an invalid type.'],
        };

      // Missing required value in query → 400
      case 'P2012':
        return {
          status:   HttpStatus.BAD_REQUEST,
          code:     'MISSING_REQUIRED_VALUE',
          messages: ['A required value is missing from the request.'],
        };

      // Connection pool timeout → 503
      case 'P2024':
        this.logger.error(`Connection pool timeout [${err.code}]`, err.message);
        return {
          status:   HttpStatus.SERVICE_UNAVAILABLE,
          code:     'DB_POOL_TIMEOUT',
          messages: ['The database is temporarily busy. Please try again in a moment.'],
        };

      // Can't reach DB / timeout at connection level → 503
      case 'P1001':
      case 'P1002':
      case 'P1008':
        this.logger.error(`Database connection error [${err.code}]`, err.message);
        return {
          status:   HttpStatus.SERVICE_UNAVAILABLE,
          code:     'DB_UNREACHABLE',
          messages: ['Cannot reach the database. Please try again shortly.'],
        };

      // Default: unrecognised code — log full details for debugging, return safe generic message
      default:
        this.logger.error(
          `Unhandled Prisma error [${err.code}]: ${err.message}`,
          err.stack ?? String(err),
        );
        return {
          status:   HttpStatus.INTERNAL_SERVER_ERROR,
          code:     `PRISMA_${err.code}`,
          messages: ['A database error occurred. Please try again.'],
        };
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private extractMessages(response: string | object): string[] {
    if (typeof response === 'string') return [response];
    if (typeof response === 'object' && response !== null) {
      const r = response as Record<string, unknown>;
      if (Array.isArray(r['message'])) return r['message'] as string[];
      if (typeof r['message'] === 'string') return [r['message']];
      if (typeof r['error'] === 'string') return [r['error']];
    }
    return ['An error occurred.'];
  }
}
