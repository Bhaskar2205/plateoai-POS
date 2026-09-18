import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { configuration } from 'src/config/configuration';

/** Sent by the Next.js server with the shared `INTERNAL_PROXY_SECRET`. */
export const INTERNAL_PROXY_SECRET_HEADER = 'x-plateo-proxy-secret';
/** The diner's IP address, as seen by the Next.js server. */
export const FORWARDED_CLIENT_IP_HEADER = 'x-plateo-client-ip';

interface TrackableRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}

/** Constant-time comparison that does not leak the secret's length. */
const secretsMatch = (presented: string, expected: string): boolean =>
  timingSafeEqual(createHash('sha256').update(presented).digest(), createHash('sha256').update(expected).digest());

/**
 * The address a request is rate-limited under.
 *
 * Normally `req.ip`: the direct peer, or - with `TRUST_PROXY` set - the client
 * address reported by the trusted proxies in front of the API.
 *
 * Server-rendered public menu pages are fetched by the Next.js server, so every
 * diner would otherwise share that server's IP and one shared rate-limit budget.
 * When the request carries the correct `INTERNAL_PROXY_SECRET`, the diner IP the
 * frontend forwards is used instead. Without the exact secret the header is
 * ignored, so a client cannot choose its own rate-limit bucket.
 */
export function resolveClientIp(request: TrackableRequest, internalProxySecret: string): string {
  const direct = request.ip ?? request.socket?.remoteAddress ?? 'unknown';

  if (!internalProxySecret) return direct;

  const presented = request.headers?.[INTERNAL_PROXY_SECRET_HEADER];
  const forwarded = request.headers?.[FORWARDED_CLIENT_IP_HEADER];

  if (typeof presented !== 'string' || typeof forwarded !== 'string') return direct;
  if (!secretsMatch(presented, internalProxySecret)) return direct;

  const candidate = forwarded.trim();
  return isIP(candidate) ? candidate : direct;
}

/**
 * `ThrottlerGuard` keyed on {@link resolveClientIp}. The secret is read per
 * request, like the credential limits in `common/throttling.ts`.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    return resolveClientIp(request as TrackableRequest, configuration().internalProxySecret);
  }
}
