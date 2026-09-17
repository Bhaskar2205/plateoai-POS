import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';

interface MysqlDriverError {
  code?: string;
  sqlMessage?: string;
}

/**
 * Normalises every error into the `ErrorResponseDto` envelope.
 *
 * Unexpected errors are logged with their stack but reported to the client as a
 * generic 500, so internal details (SQL, file paths) never leak over the wire.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error = 'Internal Server Error';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        error = exception.name.replace(/Exception$/, '');
      } else {
        const payload = body as { message?: string | string[]; error?: string };
        error = payload.error ?? exception.name.replace(/Exception$/, '');

        if (Array.isArray(payload.message)) {
          // class-validator returns one string per broken constraint.
          message = 'Validation failed';
          details = payload.message;
        } else {
          message = payload.message ?? exception.message;
        }
      }
    } else if (exception instanceof QueryFailedError) {
      const driverError = exception.driverError as MysqlDriverError | undefined;
      const code = driverError?.code ?? '';

      if (code === 'ER_DUP_ENTRY' || code === 'SQLITE_CONSTRAINT') {
        status = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = 'A record with these values already exists.';
      } else if (code === 'ER_NO_REFERENCED_ROW_2') {
        status = HttpStatus.BAD_REQUEST;
        error = 'Bad Request';
        message = 'Referenced record does not exist.';
      } else {
        this.logger.error(`Database error on ${request.method} ${request.url}`, exception.stack);
      }
    } else {
      const err = exception as Error;
      this.logger.error(
        `Unhandled error on ${request.method} ${request.url}: ${err?.message}`,
        err?.stack,
      );
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      ...(details ? { details } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
