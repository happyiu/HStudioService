import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const parserType = (exception as { type?: string } | null)?.type;
    const parserStatus = parserType === 'entity.too.large' ? HttpStatus.PAYLOAD_TOO_LARGE
      : parserType === 'entity.parse.failed' ? HttpStatus.BAD_REQUEST : undefined;
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : parserStatus ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const details = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = typeof details === 'string' || Array.isArray(details)
      ? details
      : (details as { message?: string | string[] } | undefined)?.message || (parserType === 'entity.too.large' ? '请求体超过大小限制' : parserType === 'entity.parse.failed' ? 'JSON 格式无效' : 'Internal server error');

    response.status(status).json({
      statusCode: status,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
