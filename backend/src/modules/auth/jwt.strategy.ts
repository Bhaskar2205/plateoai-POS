import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import type { AppConfig } from 'src/config/configuration';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-request.interface';
import { kitchenCodeFingerprint } from 'src/modules/restaurants/kitchen-code';
import { RestaurantsService } from 'src/modules/restaurants/restaurants.service';
import { UsersService } from 'src/modules/users/users.service';

/** Claims Plateo signs into every access token. */
export interface JwtPayload {
  /** User id. Absent on a kitchen screen token, which has no account behind it. */
  sub?: number;
  email?: string;
  /** Active restaurant id - the tenant this token is scoped to. Absent on a
   *  platform token, which is not scoped to one. */
  rid?: number;
  /**
   * `kitchen` for a screen signed in with a kitchen code; `platform` for a
   * Plateo administrator, who runs the platform rather than a restaurant.
   */
  scope?: 'kitchen' | 'platform';
  /** Fingerprint of the kitchen code the screen signed in with. */
  kcv?: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly restaurantsService: RestaurantsService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<AppConfig['jwt']>('jwt')!.secret,
    });
  }

  /**
   * Re-establishes trust on every request. The signature alone is not enough:
   * we reload the user and re-check that the membership backing `rid` still
   * exists, so revoking someone's access takes effect immediately instead of
   * waiting for their token to expire.
   *
   * The restaurant's own status is re-checked here for the same reason. Login
   * already refuses an INACTIVE restaurant, so without this a suspension would
   * only take hold once every outstanding token expired - up to JWT_EXPIRES_IN
   * (a day by default) of continued access after support suspended the tenant.
   * SUPER_ADMIN is exempt so platform support can still reach a suspended
   * restaurant to put it back.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (payload?.scope === 'kitchen') {
      return this.validateKitchenDevice(payload);
    }

    if (payload?.scope === 'platform') {
      return this.validatePlatformAdmin(payload);
    }

    if (!payload?.sub || !payload?.rid) {
      throw new UnauthorizedException('Malformed access token.');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('The account for this token no longer exists.');
    }

    // Checked on every request, not only at sign-in: a captain switched off
    // mid-shift should stop being able to punch immediately, not whenever their
    // token happens to expire.
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been switched off.');
    }

    const restaurant = await this.restaurantsService.findMembershipRestaurant(
      user.id,
      payload.rid,
    );

    if (!restaurant) {
      throw new UnauthorizedException(
        'You are no longer a member of the restaurant this token was issued for.',
      );
    }

    if (restaurant.status === RestaurantStatus.INACTIVE && user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('This restaurant is inactive. Contact Plateo support.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantId: payload.rid,
    };
  }

  /**
   * A Plateo administrator: an account, no restaurant.
   *
   * The role is re-read from the database on every request rather than trusted
   * from the token, so demoting somebody takes effect at once instead of when
   * their token expires - the same rule the restaurant path follows.
   *
   * `restaurantId` is null, and that is the safety property: every tenant-scoped
   * route reads its scope through `ActiveRestaurantId`, which refuses a falsy
   * value. A platform token therefore cannot be pointed at a restaurant, even by
   * accident, and platform routes carry no tenant filter to forget.
   */
  private async validatePlatformAdmin(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload?.sub) {
      throw new UnauthorizedException('Malformed access token.');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('The account for this token no longer exists.');
    }

    if (user.role !== UserRole.SUPER_ADMIN) {
      throw new ForbiddenException('This account is not a Plateo administrator.');
    }

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantId: null,
    };
  }

  /**
   * A kitchen screen: a restaurant, no account.
   *
   * It is given the KITCHEN_STAFF role, which is what confines it - `RolesGuard`
   * only lets that role reach the kitchen board, so a code leaked on a sticker
   * cannot read a bill, change the menu or see the day's takings. The restaurant
   * is re-checked on every request, so suspending a tenant or regenerating its
   * code stops the screens in the same breath.
   */
  private async validateKitchenDevice(payload: JwtPayload): Promise<AuthenticatedUser> {
    if (!payload.rid) {
      throw new UnauthorizedException('Malformed access token.');
    }

    const restaurant = await this.restaurantsService.findById(payload.rid).catch(() => null);

    if (!restaurant) {
      throw new UnauthorizedException('This kitchen screen is no longer linked to a restaurant.');
    }

    if (restaurant.status === RestaurantStatus.INACTIVE) {
      throw new ForbiddenException('This restaurant is inactive. Contact Plateo support.');
    }

    // The code was regenerated: this screen is holding a retired credential.
    if (payload.kcv !== kitchenCodeFingerprint(restaurant.kitchenCode)) {
      throw new UnauthorizedException(
        'This kitchen screen was signed out. Enter the new kitchen code.',
      );
    }

    return {
      id: 0,
      email: '',
      name: 'Kitchen screen',
      role: UserRole.KITCHEN_STAFF,
      restaurantId: restaurant.id,
      kitchenDevice: true,
    };
  }
}
