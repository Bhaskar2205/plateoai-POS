import type { Request } from 'express';
import { UserRole } from '../enums';

/**
 * The trusted request context produced by {@link JwtStrategy}.
 *
 * `restaurantId` is the *server-validated* active tenant: it is read from the
 * signed token and re-checked against the `restaurant_users` membership table on
 * every request. No controller or service may ever take a restaurant id from a
 * request body, query string or header.
 */
export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
  restaurantId: number;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
