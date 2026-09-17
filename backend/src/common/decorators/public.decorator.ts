import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'plateo:isPublic';

/**
 * Opts a route out of the globally registered `JwtAuthGuard`.
 *
 * Authentication is deny-by-default: only routes explicitly marked `@Public()`
 * (register, login, health) are reachable without a valid token.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
