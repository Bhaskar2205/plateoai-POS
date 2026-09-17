import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RestaurantStatus, UserRole } from 'src/common/enums';
import type { AppConfig } from 'src/config/configuration';
import type { AuthenticatedUser } from 'src/common/interfaces/authenticated-request.interface';
import { RestaurantsService } from 'src/modules/restaurants/restaurants.service';
import { UsersService } from 'src/modules/users/users.service';

/** Claims Plateo signs into every access token. */
export interface JwtPayload {
  /** User id. */
  sub: number;
  email: string;
  /** Active restaurant id - the tenant this token is scoped to. */
  rid: number;
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
    if (!payload?.sub || !payload?.rid) {
      throw new UnauthorizedException('Malformed access token.');
    }

    const user = await this.usersService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('The account for this token no longer exists.');
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
}
