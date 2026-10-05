import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import type { AuditContext } from 'src/modules/audit/audit.service';

/**
 * Who made this request, taken from the request itself.
 *
 * None of it comes from the body. An audit record exists to answer "who did
 * this", and a field the caller can set is not an answer.
 *
 * The id is reused when a proxy already set `X-Request-Id`, so one id follows a
 * request across the whole stack; otherwise one is generated here. It is cached
 * on the request so two decorators in the same request cannot disagree.
 *
 * The address comes from Express's `ip`, which honours the configured proxy
 * count - so it is the diner's address rather than the load balancer's, and it
 * cannot be spoofed through `X-Forwarded-For` unless `TRUST_PROXY` is wrong.
 */
interface RequestWithContext extends Request {
  plateoRequestId?: string;
}

export const RequestContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuditContext => {
    const request = context.switchToHttp().getRequest<RequestWithContext>();

    if (!request.plateoRequestId) {
      const header = request.headers['x-request-id'];
      const supplied = Array.isArray(header) ? header[0] : header;

      request.plateoRequestId =
        typeof supplied === 'string' && supplied.length > 0 && supplied.length <= 64
          ? supplied
          : randomUUID();
    }

    const agent = request.headers['user-agent'];

    return {
      requestId: request.plateoRequestId,
      ipAddress: request.ip ?? null,
      userAgent: (Array.isArray(agent) ? agent[0] : agent) ?? null,
    };
  },
);

/** Reads the caller's `Idempotency-Key`, if one was sent. */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined => {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers['idempotency-key'];
    const value = Array.isArray(header) ? header[0] : header;

    if (typeof value !== 'string') return undefined;

    const trimmed = value.trim();

    // A key longer than the column is a caller error, not something to truncate:
    // truncating could collide two different keys into one.
    return trimmed.length > 0 && trimmed.length <= 128 ? trimmed : undefined;
  },
);
