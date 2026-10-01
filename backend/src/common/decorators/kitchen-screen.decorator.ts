import { SetMetadata } from '@nestjs/common';

export const KITCHEN_SCREEN_KEY = 'kitchenScreen';

/**
 * Marks the routes a kitchen screen may reach.
 *
 * A kitchen signs in with a code printed on a sticker, not with an account, so
 * the blast radius of that code has to be small and obvious. Rather than relying
 * on the KITCHEN_STAFF role happening to be excluded everywhere else, a
 * kitchen-scoped token is refused on every route that does not carry this
 * decorator - so a new endpoint is closed to kitchen screens unless someone
 * deliberately opens it.
 */
export const KitchenScreen = () => SetMetadata(KITCHEN_SCREEN_KEY, true);
