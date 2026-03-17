import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()  // empty = catch ALL exceptions
export class AllExceptionsFilter implements ExceptionFilter {

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx      = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request  = ctx.getRequest<Request>();

    // Get status — NestJS exception or default 500
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Get message — NestJS exception or generic message
    const exceptionResponse = exception instanceof HttpException
      ? exception.getResponse()
      : null;

    const message = exceptionResponse
      ? (typeof exceptionResponse === 'object'
          ? (exceptionResponse as any).message
          : exceptionResponse)
      : 'Internal server error';

    // Always return this consistent shape
    response.status(status).json({
      statusCode: status,
      message,
      error:      HttpStatus[status] ?? 'Error',
      timestamp:  new Date().toISOString(),
      path:       request.url,
    });
  }
}