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
  /**
   * Null for a platform administrator, who runs Plateo rather than a restaurant
   * and belongs to none. `ActiveRestaurantId` already refuses a falsy value, so a
   * platform token that reaches a restaurant-scoped route fails loudly instead of
   * quietly reading somebody's tenant.
   */
  restaurantId: number | null;
  /**
   * True when the caller is a kitchen screen signed in with a kitchen code
   * rather than a person signed in with an account. There is no user row behind
   * it, so anything that loads the account must refuse it.
   */
  kitchenDevice?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
