import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Injects the active restaurant id for the current request.
 *
 * This is the single source of tenant scope for every controller. It throws
 * rather than returning `undefined` so that a route accidentally left
 * unauthenticated fails loudly instead of silently querying across tenants.
 */
export const ActiveRestaurantId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const restaurantId = request.user?.restaurantId;

    if (!restaurantId) {
      throw new InternalServerErrorException(
        'No active restaurant on request - route is missing JwtAuthGuard.',
      );
    }

    return restaurantId;
  },
);
